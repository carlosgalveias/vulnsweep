'use strict';

/**
 * VulnSweep - CISA Known Exploited Vulnerabilities (KEV) Source Module
 *
 * Downloads and caches the CISA KEV catalog JSON, then provides a lookup
 * function to check if a given CVE ID is listed in the catalog.
 *
 * Cache strategy (two layers):
 *   - HOT  : in-process Set<string> (24-hr TTL) — zero I/O for repeat lookups
 *   - WARM : disk JSON file (24-hr TTL)          — survives app restarts
 *
 * Return shape:
 *   isCisaKnownExploited(cveId) → Promise<boolean>
 *   clearKevCache()             → void
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

// ─── Disk cache path ──────────────────────────────────────────────────────────

function getDiskCachePath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'cisa-kev-cache.json');
  } catch {
    return path.join(require('os').tmpdir(), 'vulnsweep-cisa-kev-cache.json');
  }
}

// ─── In-process HOT cache ─────────────────────────────────────────────────────

/**
 * Mutable state object for the HOT cache.
 * Using a const object (instead of separate `let` vars) keeps property mutations
 * out of scope for the `require-atomic-updates` ESLint rule, which only flags
 * assignments to `let`/`var` identifiers after an `await`.
 * @type {{ kevSet: Set<string>|null, fetchedAt: number }}
 */
const _kevCache = { kevSet: null, fetchedAt: 0 };

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
            reject(new Error(`CISA KEV HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`CISA KEV JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`CISA KEV timeout ${timeoutMs}ms`)));
    req.end();
  });
}

// ─── WARM cache loader ────────────────────────────────────────────────────────

/**
 * Attempt to load the KEV catalog from the disk cache.
 * Populates the HOT cache if a valid, non-expired entry is found.
 * @returns {boolean} true if the HOT cache was successfully populated from disk
 */
function tryLoadDiskCache() {
  try {
    const filePath = getDiskCachePath();
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.cveIds) || typeof data.fetchedAt !== 'string') return false;
    const fetchedAt = new Date(data.fetchedAt).getTime();
    if (isNaN(fetchedAt)) return false;
    if (Date.now() - fetchedAt > ENRICHMENT_CONFIG.DISK_CACHE_TTL_MS) return false;
    _kevCache.kevSet = new Set(data.cveIds);
    _kevCache.fetchedAt = fetchedAt;
    return true;
  } catch {
    return false;
  }
}

// ─── Network fetch helper ─────────────────────────────────────────────────────

/**
 * Fetch the KEV catalog from the network, parse it, and write to disk cache.
 * Returns a resolved { kevSet, fetchedAt } on both success and error paths —
 * never throws. Keeping all awaits inside this dedicated async helper means
 * the module-level variables are only assigned synchronously in the caller,
 * which satisfies the `require-atomic-updates` ESLint rule.
 *
 * @returns {Promise<{ kevSet: Set<string>, fetchedAt: number }>}
 */
async function fetchKevFromNetwork() {
  try {
    const json = await httpsGet(
      ENRICHMENT_CONFIG.CISA_KEV_URL,
      ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS
    );

    if (!json || !Array.isArray(json.vulnerabilities)) {
      throw new Error('Unexpected KEV catalog shape');
    }

    // Extract and upper-case all CVE IDs
    const upperIds = json.vulnerabilities
      .map((v) => (typeof v.cveID === 'string' ? v.cveID.toUpperCase() : ''))
      .filter(Boolean);
    const kevSet = new Set(upperIds);
    const fetchedAt = Date.now();

    // Disk write (non-fatal on failure)
    try {
      const cacheData = {
        fetchedAt: new Date().toISOString(),
        cveIds: Array.from(kevSet),
      };
      fs.writeFileSync(getDiskCachePath(), JSON.stringify(cacheData), 'utf8');
    } catch (writeErr) {
      console.warn(`[cisa-kev] Failed to write KEV disk cache: ${writeErr.message}`);
    }

    return { kevSet, fetchedAt };
  } catch (err) {
    console.warn(`[cisa-kev] Failed to fetch KEV catalog: ${err.message}`);
    // Return empty set to prevent retry storms within the same session
    return { kevSet: new Set(), fetchedAt: Date.now() };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a CVE ID appears in the CISA Known Exploited Vulnerabilities catalog.
 * Loads the catalog from disk cache (24 h TTL) or fetches from network on cache miss.
 * Always returns false on any error — never throws.
 *
 * @param {string} cveId  e.g. "CVE-2021-44228"
 * @returns {Promise<boolean>}
 */
async function isCisaKnownExploited(cveId) {
  // Step 1 — Input guard
  if (!cveId || typeof cveId !== 'string') return false;

  const upperCveId = cveId.toUpperCase();

  // Step 2 — HOT cache check
  if (
    _kevCache.kevSet !== null &&
    Date.now() - _kevCache.fetchedAt <= ENRICHMENT_CONFIG.DISK_CACHE_TTL_MS
  ) {
    return _kevCache.kevSet.has(upperCveId);
  }

  // Step 3 — WARM cache check (disk)
  if (tryLoadDiskCache()) {
    return _kevCache.kevSet.has(upperCveId);
  }

  // Step 4 — Network fetch via dedicated helper. The two assignments below
  // are genuine false positives for require-atomic-updates: we are writing
  // a freshly resolved value, not reading-then-writing the same variable.
  const result = await fetchKevFromNetwork();
  // eslint-disable-next-line require-atomic-updates
  _kevCache.kevSet = result.kevSet;
  // eslint-disable-next-line require-atomic-updates
  _kevCache.fetchedAt = result.fetchedAt;

  // Step 5 — Return lookup result
  return _kevCache.kevSet.has(upperCveId);
}

/**
 * Force-clears the in-process KEV cache (used by tests and between sessions).
 * @returns {void}
 */
function clearKevCache() {
  _kevCache.kevSet = null;
  _kevCache.fetchedAt = 0;
}

module.exports = { isCisaKnownExploited, clearKevCache };
