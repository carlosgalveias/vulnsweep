'use strict';

/**
 * VulnSweep - EPSS (Exploit Prediction Scoring System) v3 Source Module
 *
 * Queries the EPSS v3 API for a single CVE ID and returns its exploit
 * probability score and percentile.
 *
 * No caching in this module. Caching is provided by cve-enricher.js
 * two-layer HOT+WARM cache on the full enrichment object.
 *
 * Return shape:
 *   queryEPSS(cveId) → Promise<{
 *     found:           boolean,
 *     epssScore:       number|null,
 *     epssPercentile:  number|null,
 *     error?:          string
 *   }>
 */

const https = require('https');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

// ─── HTTP helper (identical pattern to nvd-source.js) ────────────────────────

function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': ENRICHMENT_CONFIG.USER_AGENT,
          Accept: 'application/json',
        },
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
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`EPSS HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`EPSS JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`EPSS timeout ${timeoutMs}ms`)));
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Query the EPSS v3 API for a given CVE ID.
 * Returns the exploit probability score and percentile (both 0–1 floats).
 * Always returns a result object — never throws.
 *
 * @param {string} cveId  e.g. "CVE-2021-44228"
 * @returns {Promise<{found: boolean, epssScore: number|null, epssPercentile: number|null, error?: string}>}
 */
async function queryEPSS(cveId) {
  const notFound = { found: false, epssScore: null, epssPercentile: null };

  // Input validation — must match CVE-YYYY-NNNNN pattern
  if (!cveId || typeof cveId !== 'string' || !/^CVE-\d{4}-\d{4,}$/i.test(cveId)) {
    return { ...notFound, error: 'Invalid or missing CVE ID' };
  }

  const url = `${ENRICHMENT_CONFIG.EPSS_API_URL}?cve=${encodeURIComponent(cveId.toUpperCase())}`;

  try {
    const json = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS);

    // null means 404 — CVE not found in EPSS
    if (json === null) {
      return notFound;
    }

    // EPSS v3 response: { status, status-code, version, access, total, offset, limit, data: [...] }
    if (!json || !Array.isArray(json.data) || json.data.length === 0) {
      return notFound;
    }

    const entry = json.data[0];
    if (!entry || typeof entry.epss === 'undefined') {
      return notFound;
    }

    const epssScore = parseFloat(entry.epss);
    const epssPercentile = parseFloat(entry.percentile);

    if (isNaN(epssScore) || isNaN(epssPercentile)) {
      return { ...notFound, error: 'EPSS parse error' };
    }

    return { found: true, epssScore, epssPercentile };
  } catch (err) {
    console.warn(`[epss-source] queryEPSS error for ${cveId}: ${err.message}`);
    return { ...notFound, error: err.message };
  }
}

module.exports = { queryEPSS };
