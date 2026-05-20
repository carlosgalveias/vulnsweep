'use strict';

/**
 * VulnSweep - EPSS (Exploit Prediction Scoring System) v3 Source Module
 *
 * OPT-2: In-process cache plus batch pre-fetch. The orchestrator calls
 * prefetchEPSS() before the scan loop, which fires ceil(N/100) parallel batch
 * requests. Every queryEPSS() call afterward is a pure Map lookup.
 */

const https = require('https');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

const EPSS_BATCH_SIZE = 100;

/**
 * In-process cache: uppercase CVE ID -> epss result object.
 * Populated by prefetchEPSS() before the per-package loop starts.
 *
 * @type {Map<string, {found: boolean, epssScore: number|null, epssPercentile: number|null}>}
 */
const _epssCache = new Map();

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

/**
 * Batch-fetches EPSS scores for an array of CVE IDs before the per-package scan loop.
 * Chunks IDs into groups of 100, fires all chunks in parallel.
 * Errors on individual chunks are silently ignored.
 *
 * @param {string[]} cveIds
 * @returns {Promise<void>}
 */
async function prefetchEPSS(cveIds) {
  const notFound = { found: false, epssScore: null, epssPercentile: null };

  const toFetch = [
    ...new Set(
      cveIds
        .map((id) => id.toUpperCase())
        .filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id) && !_epssCache.has(id))
    ),
  ];

  if (toFetch.length === 0) return;

  const chunks = [];
  for (let i = 0; i < toFetch.length; i += EPSS_BATCH_SIZE) {
    chunks.push(toFetch.slice(i, i + EPSS_BATCH_SIZE));
  }

  await Promise.allSettled(
    chunks.map(async (chunk) => {
      const url = `${ENRICHMENT_CONFIG.EPSS_API_URL}?cve=${chunk.join(',')}`;
      try {
        const json = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS);
        if (json && Array.isArray(json.data)) {
          for (const entry of json.data) {
            if (!entry || !entry.cve) continue;
            const score = parseFloat(entry.epss);
            const pct = parseFloat(entry.percentile);
            _epssCache.set(entry.cve.toUpperCase(), {
              found: true,
              epssScore: isNaN(score) ? null : score,
              epssPercentile: isNaN(pct) ? null : pct,
            });
          }
        }
        for (const id of chunk) {
          if (!_epssCache.has(id)) _epssCache.set(id, notFound);
        }
      } catch (err) {
        console.warn('[epss-source] prefetchEPSS chunk error:', err.message);
      }
    })
  );
}

/**
 * Clears the in-process EPSS cache. Called by orchestrator at scan start.
 *
 * @returns {void}
 */
function clearEpssCache() {
  _epssCache.clear();
}

/**
 * Query the EPSS v3 API for a given CVE ID.
 * Checks _epssCache first. Falls back to a direct HTTP call if not cached.
 * Always returns a result object, never throws.
 *
 * @param {string} cveId
 * @returns {Promise<{found: boolean, epssScore: number|null, epssPercentile: number|null, error?: string}>}
 */
async function queryEPSS(cveId) {
  const notFound = { found: false, epssScore: null, epssPercentile: null };

  if (!cveId || typeof cveId !== 'string' || !/^CVE-\d{4}-\d{4,}$/i.test(cveId)) {
    return { ...notFound, error: 'Invalid or missing CVE ID' };
  }

  const upperCveId = cveId.toUpperCase();

  // Cache hit — populated by prefetchEPSS() before the scan loop
  if (_epssCache.has(upperCveId)) {
    return _epssCache.get(upperCveId);
  }

  const url = `${ENRICHMENT_CONFIG.EPSS_API_URL}?cve=${encodeURIComponent(upperCveId)}`;

  try {
    const json = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS);

    if (json === null) {
      return notFound;
    }

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

module.exports = { queryEPSS, prefetchEPSS, clearEpssCache };
