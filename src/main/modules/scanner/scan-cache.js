'use strict';

/**
 * VulnSweep - Persistent Scan Result Cache
 *
 * Sharded, TTL-based disk cache for vulnerability scan results.
 * Five separate JSON files, one per source, stored in userData/scan-cache/.
 *
 * Design rationale (see plans/scan-cache-spec.md section 3.1):
 *   22,000 packages x 4 sources = 88,000 entries. A single flat file would be
 *   8-50 MB and block the Electron main process event loop on parse/serialize.
 *   Per-source sharding: each file is ~8-12 MB, loads/saves independently,
 *   only dirty files are written, and a corrupt file only loses one source.
 *
 * TTL policy (spec section 5.2):
 *   OSV / NVD / GitHub Advisory: 24 h (advisory metadata rarely changes)
 *   CISA KEV: 2 h (actively-exploited threat state, stale data is a security liability)
 *
 * npm-audit is explicitly NOT cached; it reads the lockfile and must always run fresh.
 *
 * @module scanner/scan-cache
 */

const fs = require('fs');
const path = require('path');
const { SCAN_CACHE_CONFIG } = require('../../config/constants');

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * One Map per cacheable source.
 * Keys are buildKey() strings; values are { timestamp: number, results: Array, publishedDate: string|null }.
 */
const _caches = {
  osv: new Map(),
  nvd: new Map(),
  'github-advisory': new Map(),
  'cisa-kev': new Map(),
  epss: new Map(),
};

/**
 * Per-source dirty flags. True after set() or clearAll() until save() completes.
 */
const _dirty = {
  osv: false,
  nvd: false,
  'github-advisory': false,
  'cisa-kev': false,
  epss: false,
};

/**
 * Per-source debounce timer handles for async saves.
 */
const _saveTimers = {
  osv: null,
  nvd: null,
  'github-advisory': null,
  'cisa-kev': null,
  epss: null,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the cache directory path.
 * Uses Electron userData when available; falls back to os.tmpdir() for tests.
 *
 * @returns {string} Absolute path to the scan-cache directory
 */
function _resolveCacheDirPath() {
  const { resolveDataDir } = require('../../utils/resolve-data-dir');
  return path.join(resolveDataDir(), 'scan-cache');
}

/**
 * Returns the full path for a source cache JSON file.
 *
 * @param {string} sourceId  - One of CACHEABLE_SOURCES
 * @param {string} cacheDir  - Directory that holds the cache files
 * @returns {string}
 */
function _cacheFilePath(sourceId, cacheDir) {
  return path.join(cacheDir, `${sourceId}-cache.json`);
}

/**
 * Debounced per-source async write. Cancels any existing timer for that
 * sourceId, then schedules a new one. On fire, writes only this source's file.
 *
 * @param {string} sourceId - Cacheable source ID
 */
function _scheduleSave(sourceId) {
  if (_saveTimers[sourceId]) {
    clearTimeout(_saveTimers[sourceId]);
  }
  // Resolve the dir now, in the caller context: the deferred callback must
  // never hit require() after a Jest environment (or exiting process) dies.
  const cacheDir = _resolveCacheDirPath();
  const timer = setTimeout(() => {
    _saveTimers[sourceId] = null;
    try {
      _writeSingleSource(sourceId, cacheDir);
    } catch (err) {
      // Async context: an uncaught throw here surfaces as an unhandled
      // exception and kills the process. Same non-fatal contract as sync.
      console.warn(`[scan-cache] Debounced save failed for ${sourceId}: ${err.message}`);
    }
  }, SCAN_CACHE_CONFIG.SAVE_DEBOUNCE_MS);
  // Pending debounced writes must not hold the event loop open on their
  // own; production commits them via flushAndClose() on before-quit.
  if (typeof timer.unref === 'function') timer.unref();
  _saveTimers[sourceId] = timer;
}

/**
 * Synchronously write a single source's cache to disk.
 * Resets the dirty flag after a successful write.
 * Errors are logged but do NOT throw (cache failures are non-fatal).
 *
 * @param {string} sourceId  - Cacheable source ID
 * @param {string} cacheDir  - Destination directory
 */
function _writeSingleSource(sourceId, cacheDir) {
  if (!_dirty[sourceId]) return;

  try {
    fs.mkdirSync(cacheDir, { recursive: true });

    const entries = {};
    for (const [key, entry] of _caches[sourceId].entries()) {
      entries[key] = entry;
    }

    const payload = JSON.stringify({ version: 1, entries });
    fs.writeFileSync(_cacheFilePath(sourceId, cacheDir), payload, 'utf8');
    _dirty[sourceId] = false;
  } catch (err) {
    console.warn(`[scan-cache] Failed to write ${sourceId} cache: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a cache key for a (packageName, packageVersion) pair.
 * sourceId is NOT part of the key; it is implicit from which Map is used.
 *
 * Scoped package names like @babel/core are percent-encoded so the key
 * is safe for JSON object keys.
 *
 * @param {string} packageName    - e.g. 'express' or '@babel/core'
 * @param {string} packageVersion - e.g. '4.18.2'
 * @returns {string} e.g. 'express@4.18.2' or '%40babel%2Fcore@7.0.0'
 */
function buildKey(packageName, packageVersion) {
  return `${encodeURIComponent(packageName)}@${packageVersion}`;
}

/**
 * Retrieve a cached result for the given source and key.
 * Does NOT check TTL; callers should call isValid() first.
 *
 * @param {string} sourceId - Cacheable source ID
 * @param {string} key      - Cache key from buildKey()
 * @returns {Array|undefined} Cached SourceResult array, or undefined on miss
 */
function get(sourceId, key) {
  const entry = _caches[sourceId]?.get(key);
  return entry?.results;
}

/**
 * Store a scan result for the given source and key.
 * Marks the source dirty and schedules a debounced async save.
 *
 * @param {string}      sourceId        - Cacheable source ID
 * @param {string}      key             - Cache key from buildKey()
 * @param {Array}       results         - SourceResult array to cache
 * @param {string|null} [publishedDate] - ISO 8601 date string of the CVE's publication date,
 *                                        or null when not available. Stored in the entry so
 *                                        isCveRecent() can determine soft-refresh eligibility.
 */
function set(sourceId, key, results, publishedDate = null) {
  if (!_caches[sourceId]) return;
  _caches[sourceId].set(key, { timestamp: Date.now(), results, publishedDate });
  _dirty[sourceId] = true;
  _scheduleSave(sourceId);
  // Enforce entry count limit (best-effort — only checks total, not per-source)
  evictOldestIfOverLimit();
}

/**
 * Check whether a cached entry exists AND has not expired for the given source.
 * Returns false if CACHE_ENABLED is false, the source is unknown, the entry is
 * missing, or the entry has exceeded its TTL.
 *
 * @param {string} sourceId - Cacheable source ID
 * @param {string} key - Cache key
 * @returns {boolean}
 */
function isValid(sourceId, key) {
  if (!SCAN_CACHE_CONFIG.CACHE_ENABLED) return false;
  if (!_caches[sourceId]) return false;
  const entry = _caches[sourceId].get(key);
  if (!entry) return false;
  const ttl = SCAN_CACHE_CONFIG.TTL_BY_SOURCE?.[sourceId] ?? SCAN_CACHE_CONFIG.DEFAULT_TTL_MS;
  return Date.now() - entry.timestamp < ttl;
}

function getSize(sourceId) {
  return (_caches[sourceId] && _caches[sourceId].size) || 0;
}

/**
 * Returns true if the cache entry is older than HARD_INVALIDATE_AGE_MS.
 * Hard-expired entries must be deleted before use.
 * @param {string} sourceId
 * @param {string} key
 * @returns {boolean}
 */
function isHardExpired(sourceId, key) {
  if (!_caches[sourceId]) return false;
  const entry = _caches[sourceId].get(key);
  if (!entry) return false;
  return Date.now() - entry.timestamp > SCAN_CACHE_CONFIG.HARD_INVALIDATE_AGE_MS;
}

/**
 * Returns true if the entry exists, is not hard-expired, but is older than
 * SOFT_REFRESH_AGE_MS. Callers should attempt a fresh fetch and fall back to
 * the cached result if the network call fails.
 * @param {string} sourceId
 * @param {string} key
 * @returns {boolean}
 */
function isSoftStale(sourceId, key) {
  if (!_caches[sourceId]) return false;
  const entry = _caches[sourceId].get(key);
  if (!entry) return false;
  if (isHardExpired(sourceId, key)) return false;
  return Date.now() - entry.timestamp > SCAN_CACHE_CONFIG.SOFT_REFRESH_AGE_MS;
}

/**
 * Returns true if the cached entry's CVE publishedDate is within CVE_RECENT_AGE_MS
 * (default: 3 months). "Recent" CVEs are still being actively updated by NVD/OSV,
 * so they should trigger a soft-refresh attempt even when the cache entry itself
 * is still within its normal TTL window.
 *
 * Returns false if the entry has no publishedDate (null) — treat as non-recent
 * so the normal TTL logic governs the refresh decision.
 *
 * @param {string} sourceId
 * @param {string} key
 * @returns {boolean}
 */
function isCveRecent(sourceId, key) {
  if (!_caches[sourceId]) return false;
  const entry = _caches[sourceId].get(key);
  if (!entry || !entry.publishedDate) return false;
  const publishedMs = new Date(entry.publishedDate).getTime();
  if (Number.isNaN(publishedMs)) return false;
  return Date.now() - publishedMs < SCAN_CACHE_CONFIG.CVE_RECENT_AGE_MS;
}

/**
 * Delete a single cache entry. Used for hard invalidation.
 * @param {string} sourceId
 * @param {string} key
 */
function deleteEntry(sourceId, key) {
  if (!_caches[sourceId]) return;
  if (_caches[sourceId].has(key)) {
    _caches[sourceId].delete(key);
    _dirty[sourceId] = true;
    _scheduleSave(sourceId);
  }
}

/**
 * Evict oldest entries across all sources until both CACHE_MAX_ENTRIES and
 * CACHE_MAX_SIZE_BYTES limits are satisfied. No-op if neither limit is configured.
 */
function evictOldestIfOverLimit() {
  const entryLimit = SCAN_CACHE_CONFIG.CACHE_MAX_ENTRIES;
  const byteLimit = SCAN_CACHE_CONFIG.CACHE_MAX_SIZE_BYTES;
  if (!entryLimit && !byteLimit) return;

  // Cheap entry-count gate: skip the expensive O(n log n) sort unless we are
  // within 5% of the entry limit. Only short-circuits when there is no byte
  // limit configured (byte limit always requires full scan to measure).
  if (entryLimit && !byteLimit) {
    let total = 0;
    for (const sid of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) total += _caches[sid].size;
    if (total <= entryLimit * 1.05) return;
  }

  // Collect all entries with their serialized byte size for dual-limit enforcement
  const allEntries = [];
  let totalBytes = 0;
  for (const sid of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    for (const [key, entry] of _caches[sid]) {
      let bytes = 0;
      try {
        bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
      } catch {
        /* corrupt entry — count as 0 bytes */
      }
      totalBytes += bytes;
      allEntries.push({ sid, key, timestamp: entry.timestamp, bytes });
    }
  }

  const entryCount = allEntries.length;
  const overEntries = entryLimit && entryCount > entryLimit;
  const overBytes = byteLimit && totalBytes > byteLimit;
  if (!overEntries && !overBytes) return;

  // Sort oldest-first — evict from the front
  allEntries.sort((a, b) => a.timestamp - b.timestamp);

  let currentCount = entryCount;
  let currentBytes = totalBytes;

  for (const { sid, key, bytes } of allEntries) {
    const stillOverEntries = entryLimit && currentCount > entryLimit;
    const stillOverBytes = byteLimit && currentBytes > byteLimit;
    if (!stillOverEntries && !stillOverBytes) break;
    _caches[sid].delete(key);
    _dirty[sid] = true;
    currentCount--;
    currentBytes -= bytes;
  }

  for (const sid of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    if (_dirty[sid]) _scheduleSave(sid);
  }
}

function load(cacheDir) {
  if (cacheDir === undefined) cacheDir = _resolveCacheDirPath();
  for (const sourceId of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    const filePath = _cacheFilePath(sourceId, cacheDir);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || typeof parsed.entries !== 'object') {
        console.warn(`[scan-cache] Invalid cache format for ${sourceId}, resetting.`);
        _caches[sourceId] = new Map();
        continue;
      }
      _caches[sourceId] = new Map(Object.entries(parsed.entries));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(
          `[scan-cache] Could not load ${sourceId} cache: ${err.message}. Deleting corrupt file.`
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore — file already gone */
        }
      }
      _caches[sourceId] = new Map();
    }
  }
  // Enforce entry count limit after loading from disk
  evictOldestIfOverLimit();
}

function save(cacheDir) {
  if (cacheDir === undefined) cacheDir = _resolveCacheDirPath();
  for (const sourceId of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    _writeSingleSource(sourceId, cacheDir);
  }
}

function clear(sourceId) {
  if (!_caches[sourceId]) return;
  _caches[sourceId] = new Map();
  _dirty[sourceId] = true;
}

function clearAll(cacheDir) {
  for (const sourceId of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    _caches[sourceId] = new Map();
    _dirty[sourceId] = true;
  }
  save(cacheDir);
}

function flushAndClose() {
  for (const sourceId of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    if (_saveTimers[sourceId]) {
      clearTimeout(_saveTimers[sourceId]);
      _saveTimers[sourceId] = null;
    }
  }
  save();
}

function getStats() {
  const stats = {};
  for (const sourceId of SCAN_CACHE_CONFIG.CACHEABLE_SOURCES) {
    stats[sourceId] = { count: getSize(sourceId) };
  }
  return stats;
}

module.exports = {
  buildKey,
  load,
  save,
  get,
  set,
  isValid,
  isHardExpired,
  isSoftStale,
  isCveRecent,
  deleteEntry,
  evictOldestIfOverLimit,
  getSize,
  clear,
  clearAll,
  flushAndClose,
  getStats,
  _saveTimers,
  _dirty,
  _caches,
};
