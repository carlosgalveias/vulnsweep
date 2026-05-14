'use strict';

/**
 * VulnSweep - NVD API v2 Source Module
 *
 * Queries the NVD API v2 (https://services.nvd.nist.gov/rest/json/cves/2.0)
 * for CVSS scores, CWE IDs, and other metadata for a given CVE ID.
 *
 * Rate-limiting: NVD free tier allows ~5 req/30s without an API key.
 * We use a simple serial queue with a 6-second delay between calls.
 * When NVD_API_KEY env var is set, the delay is reduced to 500 ms.
 *
 * On HTTP 429 responses, exponential backoff with jitter is applied:
 *   wait = baseDelay * 2^attempt + random(0, 1000)ms  (up to 3 retries)
 * After 3 failed retries, returns { found: false, error: 'rate_limit_exceeded' }.
 *
 * Return shape:
 * {
 *   found:        boolean,
 *   cvssScore:    number|null,
 *   cvssVector:   string|null,
 *   cvssCategory: string|null,
 *   cweIds:       string[],
 *   url:          string|null,
 *   error?:       string
 * }
 */

const https = require('https');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

// ─── Rate-limit queue ────────────────────────────────────────────────────────
let _nvdQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueNvd(fn) {
  const delayMs = ENRICHMENT_CONFIG.NVD_API_KEY ? 500 : ENRICHMENT_CONFIG.NVD_RATE_LIMIT_MS;
  const result = _nvdQueue.then(fn);
  _nvdQueue = result.then(
    () => sleep(delayMs),
    () => sleep(delayMs)
  );
  return result;
}

// ─── Exponential backoff helper ───────────────────────────────────────────────

function backoffDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      'User-Agent': ENRICHMENT_CONFIG.USER_AGENT,
      Accept: 'application/json',
    };
    if (ENRICHMENT_CONFIG.NVD_API_KEY) {
      headers['apiKey'] = ENRICHMENT_CONFIG.NVD_API_KEY;
    }
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode === 429) {
            const err = new Error('NVD rate-limited (429)');
            err.isRateLimit = true;
            reject(err);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`NVD HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`NVD JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`NVD timeout ${timeoutMs}ms`)));
    req.end();
  });
}

// ─── Score to category mapping ────────────────────────────────────────────────

function scoreToCvssCategory(score) {
  if (score === null || score === undefined || typeof score !== 'number') return null;
  if (score === 0.0) return 'NONE';
  if (score <= 3.9) return 'LOW';
  if (score <= 6.9) return 'MEDIUM';
  if (score <= 8.9) return 'HIGH';
  return 'CRITICAL';
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseNvdResponse(json, cveId) {
  const empty = {
    found: false,
    cvssScore: null,
    cvssVector: null,
    cvssCategory: null,
    cweIds: [],
    url: null,
  };

  if (!json || !Array.isArray(json.vulnerabilities) || json.vulnerabilities.length === 0) {
    return empty;
  }

  const item = json.vulnerabilities[0];
  const cve = item && item.cve;
  if (!cve) return empty;

  let cvssScore = null;
  let cvssVector = null;

  const metrics = cve.metrics || {};

  const tryMetric = (key) => {
    const arr = metrics[key];
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const m = arr[0].cvssData || arr[0];
    if (m && typeof m.baseScore === 'number') {
      cvssScore = m.baseScore;
      cvssVector = m.vectorString || null;
      return true;
    }
    return false;
  };

  tryMetric('cvssMetricV31') || tryMetric('cvssMetricV30') || tryMetric('cvssMetricV2');

  const cweIds = [];
  const weaknesses = cve.weaknesses || [];
  for (const w of weaknesses) {
    const descs = w.description || [];
    for (const d of descs) {
      if (d.value && d.value.startsWith('CWE-')) cweIds.push(d.value);
    }
  }

  const nvdUrl = `https://nvd.nist.gov/vuln/detail/${cve.id || cveId}`;

  return {
    found: true,
    cvssScore,
    cvssVector,
    cvssCategory: scoreToCvssCategory(cvssScore),
    cweIds,
    url: nvdUrl,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const NVD_BACKOFF_BASE_MS = ENRICHMENT_CONFIG.NVD_RATE_LIMIT_MS; // 6000 ms free tier
const NVD_MAX_RETRIES = 3;

/**
 * Query the NVD API v2 for a given CVE ID.
 * On HTTP 429, exponential backoff with jitter is used (up to 3 retries).
 * After all retries are exhausted, returns { found: false, error: 'rate_limit_exceeded' }.
 *
 * @param {string} cveId
 * @returns {Promise<{found: boolean, cvssScore: number|null, cvssVector: string|null, cvssCategory: string|null, cweIds: string[], url: string|null, error?: string}>}
 */
async function queryNVD(cveId) {
  if (!cveId || !/^CVE-\d{4}-\d{4,}$/i.test(cveId)) {
    return {
      found: false,
      cvssScore: null,
      cvssVector: null,
      cvssCategory: null,
      cweIds: [],
      url: null,
      error: 'Invalid or missing CVE ID',
    };
  }

  const url = `${ENRICHMENT_CONFIG.NVD_API_URL}?cveId=${encodeURIComponent(cveId.toUpperCase())}`;

  return enqueueNvd(async () => {
    for (let attempt = 0; attempt <= NVD_MAX_RETRIES; attempt++) {
      try {
        const json = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS);
        if (json === null) {
          return {
            found: false,
            cvssScore: null,
            cvssVector: null,
            cvssCategory: null,
            cweIds: [],
            url: null,
          };
        }
        return parseNvdResponse(json, cveId);
      } catch (err) {
        if (err.isRateLimit && attempt < NVD_MAX_RETRIES) {
          const delay = backoffDelay(NVD_BACKOFF_BASE_MS, attempt);
          console.warn(
            `[nvd] Rate limited, retry ${attempt + 1}/${NVD_MAX_RETRIES} after ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
        if (err.isRateLimit) {
          console.warn(`[nvd] Rate limit exceeded after ${NVD_MAX_RETRIES} retries for ${cveId}`);
          return {
            found: false,
            cvssScore: null,
            cvssVector: null,
            cvssCategory: null,
            cweIds: [],
            url: null,
            error: 'rate_limit_exceeded',
          };
        }
        console.warn(`[nvd-source] queryNVD error for ${cveId}: ${err.message}`);
        return {
          found: false,
          cvssScore: null,
          cvssVector: null,
          cvssCategory: null,
          cweIds: [],
          url: null,
          error: err.message,
        };
      }
    }
    // Should not be reached but satisfies static analysis
    return {
      found: false,
      cvssScore: null,
      cvssVector: null,
      cvssCategory: null,
      cweIds: [],
      url: null,
      error: 'rate_limit_exceeded',
    };
  });
}

module.exports = { queryNVD, scoreToCvssCategory };
