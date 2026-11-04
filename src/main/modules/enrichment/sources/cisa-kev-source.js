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
 * @type {{ kevSet: Set<string>|null, fetchedAt: number, inFlight: Promise<void>|null }}
 */
const _kevCache = { kevSet: null, fetchedAt: 0, inFlight: null };

// ─── HTTP helper (identical pattern to nvd-source.js) ────────────────────────

function httpsGet(url, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request aborted'));
      return;
    }

    const u = new URL(url);

    const abortHandler = () => {
      req.destroy(new Error('Request aborted'));
    };
    signal?.addEventListener('abort', abortHandler);

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
          if (signal?.aborted) {
            reject(new Error('Request aborted'));
            return;
          }
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
    req.on('error', (err) => {
      if (signal?.aborted) return;
      reject(err);
    });
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
async function fetchKevFromNetwork(signal) {
  try {
    const json = await httpsGet(
      ENRICHMENT_CONFIG.CISA_KEV_URL,
      ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS,
      signal
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
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<boolean>}
 */
async function isCisaKnownExploited(cveId, signal) {
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

  // Step 4: Cold start: ONE shared Promise; all concurrent callers await the same fetch.
  // Storing the Promise (not the resolved value) is the correct async singleton pattern.
  // Without this, all 10 packages in the first concurrent batch each fire an independent
  // network fetch of the same static catalog — the classic async-singleton mistake.
  if (!_kevCache.inFlight) {
    _kevCache.inFlight = fetchKevFromNetwork(signal).then((result) => {
      _kevCache.kevSet = result.kevSet;
      _kevCache.fetchedAt = result.fetchedAt;
      _kevCache.inFlight = null;
    });
  }

  await _kevCache.inFlight;
  if (signal?.aborted) return false;

  // Step 5 — Return lookup result (kevSet may be null if fetch failed; default to empty Set)
  return (_kevCache.kevSet ?? new Set()).has(upperCveId);
}

/**
 * Force-clears the in-process KEV cache (used by tests and between sessions).
 * @returns {void}
 */
function clearKevCache() {
  _kevCache.kevSet = null;
  _kevCache.fetchedAt = 0;
  _kevCache.inFlight = null;
}

module.exports = { isCisaKnownExploited, clearKevCache };
