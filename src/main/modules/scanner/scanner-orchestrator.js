'use strict';

const { SCANNER_CONFIG } = require('../../config/constants');
const scanTelemetry = require('../../utils/scan-telemetry');
const { clearNvdSessionCache } = require('../enrichment/sources/nvd-source');
const { buildPackageUniverse, getUniqueQueryTargets } = require('./package-universe-builder');
const { aggregate } = require('./result-aggregator');
const scanCache = require('./scan-cache');
const { isCveRecent } = require('./scan-cache');
const cisaKevSource = require('./sources/cisa-kev-source');
const epssSource = require('./sources/epss-source');
const githubSource = require('./sources/github-advisory-source');
const npmAuditSource = require('./sources/npm-audit-source');
const nvdSource = require('./sources/nvd-source');
const osvSource = require('./sources/osv-source');

// Source plugin registry keyed by SOURCE_ID
const ALL_SOURCES = Object.freeze({
  osv: osvSource,
  nvd: nvdSource,
  'github-advisory': githubSource,
  'cisa-kev': cisaKevSource,
  'npm-audit': npmAuditSource,
  epss: epssSource,
});

// Source IDs per named scan mode; unknown modes fall back to 'fast'
const SCAN_MODE_SOURCES = Object.freeze({
  fast: ['npm-audit', 'osv'],
  full: ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'],
});

// Race a promise against a reject-after-ms sentinel (per plugin, inside allSettled)
function withTimeout(promise, ms) {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Package scan timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fire progress callback, swallowing errors so a bad callback cannot abort the scan
function emit(cb, payload) {
  if (typeof cb !== 'function') return;
  try {
    cb(payload);
  } catch (err) {
    console.warn('[scanner-orchestrator] progressCb threw:', err.message);
  }
}

// Resolve active plugins from options. Priority: enabledSources > mode > DEFAULT_SCAN_MODE
function resolvePlugins(options) {
  if (Array.isArray(options.enabledSources) && options.enabledSources.length > 0) {
    return options.enabledSources.filter((id) => ALL_SOURCES[id]).map((id) => ALL_SOURCES[id]);
  }
  const mode = options.mode != null ? options.mode : SCANNER_CONFIG.DEFAULT_SCAN_MODE || 'fast';
  const ids = SCAN_MODE_SOURCES[mode] != null ? SCAN_MODE_SOURCES[mode] : SCAN_MODE_SOURCES.fast;
  return ids.filter((id) => ALL_SOURCES[id]).map((id) => ALL_SOURCES[id]);
}

function pluginsToIds(plugins) {
  return plugins.map((p) => p.SOURCE_ID).filter(Boolean);
}

// Canonical severity bucket names
const SEV_BUCKETS = ['critical', 'high', 'moderate', 'low', 'info'];

function normaliseSev(sev) {
  if (!sev || typeof sev !== 'string') return 'info';
  const s = sev.toLowerCase();
  if (s === 'medium') return 'moderate';
  return SEV_BUCKETS.includes(s) ? s : 'info';
}

function buildSummary(vulnerabilities, sourceIds) {
  const bySource = {};
  for (const id of sourceIds) bySource[id] = 0;
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };
  for (const vuln of vulnerabilities) {
    const bucket = normaliseSev(vuln.severity);
    counts[bucket] += 1;
    counts.total += 1;
    if (Array.isArray(vuln.sources)) {
      for (const sid of vuln.sources) {
        if (Object.prototype.hasOwnProperty.call(bySource, sid)) bySource[sid] += 1;
      }
    }
  }
  return Object.assign(counts, { bySource });
}

function buildEmptyScanResult(projectPath, sourceIds, allPackages = 0) {
  return {
    projectPath,
    packages: [],
    allPackages,
    vulnerabilities: [],
    strategies: [],
    summary: {
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
      info: 0,
      total: 0,
      bySource: Object.fromEntries(sourceIds.map((id) => [id, 0])),
    },
    scannedAt: new Date().toISOString(),
    sources: sourceIds,
  };
}

/**
 * Scans a project for vulnerabilities using all enabled source plugins.
 *
 * @param {string} projectPath - Absolute path to the project directory
 * @param {object} [options] - Optional scan options
 * @param {string[]} [options.enabledSources] - Override active source plugin IDs
 * @param {string} [options.mode] - Named scan mode: 'fast' or 'full'
 * @param {number} [options.maxConcurrent] - Max packages processed concurrently
 * @param {function} [progressCb] - Progress callback: ({phase, current, total, packageName, partialResult})
 * @returns {Promise<ScanResult>}
 */
async function scanProject(projectPath, options, progressCb) {
  // Normalise arguments — legacy callers may pass progressCb as second arg
  if (typeof options === 'function') {
    progressCb = options;
    options = {};
  }
  if (options == null) options = {};

  // [telemetry] Reset all counters and start the total-scan wall-clock timer
  scanTelemetry.reset();
  const tlTotal = scanTelemetry.start('scan:total');

  // Reset caches at the start of every scan so stale data from a previous
  // scanProject() invocation cannot bleed into this one.
  // Guards: test mocks may not include all cache functions.
  if (typeof npmAuditSource.clearCache === 'function') {
    npmAuditSource.clearCache();
  }
  // OPT-4: Clear NVD session cache so duplicate CVE lookups within a scan are served
  // from the new per-scan Map rather than a populated Map from the previous scan.
  clearNvdSessionCache();

  // Load the persistent scan cache (idempotent — only reads files on first call)
  scanCache.load();

  const plugins = resolvePlugins(options);
  const sourceIds = pluginsToIds(plugins);
  const maxConcurrent = options.maxConcurrent ?? SCANNER_CONFIG.MAX_CONCURRENT_PACKAGES;
  const timeoutMs = SCANNER_CONFIG.PER_PACKAGE_TIMEOUT_MS;
  const batchPauseMs = SCANNER_CONFIG.BATCH_PAUSE_MS;

  // Phase 1: Build package universe (called exactly once per scanProject invocation)
  let universe;
  const tlUniverse = scanTelemetry.start('scan:phase:universe-build');
  try {
    universe = await buildPackageUniverse(projectPath);
  } catch (err) {
    console.error('[scanner-orchestrator] buildPackageUniverse failed:', err.message);
    scanTelemetry.end(tlUniverse, 'scan:phase:universe-build');
    scanTelemetry.end(tlTotal, 'scan:total');
    throw err;
  }
  scanTelemetry.end(tlUniverse, 'scan:phase:universe-build');

  const targets = getUniqueQueryTargets(universe);
  const total = targets.length;

  scanTelemetry.count('packages:total', universe.length);

  emit(progressCb, { phase: 'universe', total });

  if (total === 0) {
    scanTelemetry.end(tlTotal, 'scan:total');
    return buildEmptyScanResult(projectPath, sourceIds, universe.length);
  }

  // OPT-3: NPM-Audit Pre-warm — run npm audit once BEFORE the concurrent batch loop
  // so all query() calls find a fully resolved Promise in the cache, eliminating the
  // first-batch blocking wait that previously added ~1-5s latency to each first-batch call.
  if (typeof npmAuditSource.prewarmCache === 'function') {
    await npmAuditSource.prewarmCache(projectPath);
  }

  // Enrich each unique query target with the full PackageDescriptor metadata
  // (isDirect, isDevDep, lockfileDepth, resolved) plus projectPath for npm-audit-source
  const universeMap = new Map(universe.map((u) => [`${u.name}@${u.version}`, u]));
  const enrichedTargets = targets.map((target) => {
    const descriptor = universeMap.get(`${target.name}@${target.version}`);
    return Object.assign({}, descriptor || target, { projectPath });
  });

  // Phase 2: Process in batches of maxConcurrent
  const packageResults = [];
  let current = 0;

  for (let batchStart = 0; batchStart < enrichedTargets.length; batchStart += maxConcurrent) {
    const batch = enrichedTargets.slice(batchStart, batchStart + maxConcurrent);

    const batchSettled = await Promise.allSettled(
      batch.map(async (pkg) => {
        current += 1;

        // Query all active plugins in parallel for this package, each with its own timeout.
        // For cacheable sources (non-npm-audit), check the persistent scan cache first.
        const pluginSettled = await Promise.allSettled(
          plugins.map((plugin) => {
            const sourceId = plugin.SOURCE_ID;
            const tlabel = `scan:source:${sourceId}`;

            // npm-audit always runs fresh — never cached
            if (sourceId === 'npm-audit') {
              const tlToken = scanTelemetry.start(tlabel);
              return withTimeout(plugin.query(pkg), timeoutMs)
                .then((r) => {
                  scanTelemetry.end(tlToken, tlabel);
                  return r;
                })
                .catch((e) => {
                  scanTelemetry.end(tlToken, tlabel);
                  throw e;
                });
            }

            const cacheKey = scanCache.buildKey(pkg.name, pkg.version);

            // Tier 1: Hard invalidation — entry is over 1 year old → delete and fetch fresh
            if (scanCache.isHardExpired(sourceId, cacheKey)) {
              scanCache.deleteEntry(sourceId, cacheKey);
              // Fall through to fresh fetch below
            }
            // Tier 2: Cache hit within soft-refresh window — use as-is
            else if (
              scanCache.isValid(sourceId, cacheKey) &&
              !scanCache.isSoftStale(sourceId, cacheKey)
            ) {
              scanTelemetry.count('cache:hits', 1);
              return Promise.resolve(scanCache.get(sourceId, cacheKey) || []);
            }
            // Tier 3: Soft stale — entry exists but is older than 30 days; try refresh, fallback to cache
            else if (scanCache.isSoftStale(sourceId, cacheKey)) {
              const cached = scanCache.get(sourceId, cacheKey) || [];
              // T8: capture token in outer closure so .catch() can reach it
              const tlToken = scanTelemetry.start(tlabel);
              return withTimeout(plugin.query(pkg), timeoutMs)
                .then((results) => {
                  scanTelemetry.end(tlToken, tlabel);
                  if (Array.isArray(results) && results.length > 0) {
                    scanCache.set(sourceId, cacheKey, results);
                    scanTelemetry.count('cache:soft-refreshed', 1);
                    return results;
                  }
                  // Network returned empty — keep stale cache rather than lose data
                  return cached;
                })
                .catch(() => {
                  scanTelemetry.end(tlToken, tlabel);
                  return cached;
                });
            }

            // Cache miss or post-hard-invalidation → fetch fresh
            const tlToken = scanTelemetry.start(tlabel);
            scanTelemetry.count('cache:fresh-fetched', 1);
            return withTimeout(plugin.query(pkg), timeoutMs)
              .then((results) => {
                scanTelemetry.end(tlToken, tlabel);
                // Cache both non-empty AND empty arrays — an empty result ([]) is a valid,
                // cacheable fact: "this package has no vulnerabilities from this source".
                // Only skip caching when results is null/undefined (fetch genuinely failed).
                if (Array.isArray(results) && !isCveRecent(sourceId, cacheKey)) {
                  scanCache.set(sourceId, cacheKey, results);
                }
                return results ?? [];
              })
              .catch((e) => {
                scanTelemetry.end(tlToken, tlabel);
                throw e;
              });
          })
        );

        // Extract fulfilled arrays; timed-out or errored plugins contribute []
        const sourceResultGroups = pluginSettled.map((r) =>
          r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
        );

        // Aggregate all plugin results for this package into a PackageScanResult
        const pkgResult = await aggregate(pkg, sourceResultGroups);

        emit(progressCb, {
          phase: 'scanning',
          packageName: pkg.name,
          current,
          total,
          partialResult: pkgResult,
        });

        return pkgResult;
      })
    );

    // Collect fulfilled PackageScanResults; skip packages that threw unexpectedly
    for (const settled of batchSettled) {
      if (settled.status === 'fulfilled' && settled.value != null) {
        packageResults.push(settled.value);
      }
    }

    // Pause between batches (not after the final batch)
    if (batchStart + maxConcurrent < enrichedTargets.length) {
      await sleep(batchPauseMs);
    }
  }

  emit(progressCb, { phase: 'complete', current: total, total });

  // Build flat vulnerabilities and index-aligned strategies arrays from all packages.
  // ScanResult.strategies[i] always corresponds to ScanResult.vulnerabilities[i]
  // because both are derived from the same ordered packageResults array — the contract
  // established in T9 (result-aggregator) is preserved here at the top level.
  const vulnerabilities = packageResults.flatMap((pr) => pr.vulnerabilities);
  const strategies = vulnerabilities.map((v) => v.strategy ?? null);

  // [telemetry] Record vulnerable package count + stop total timer + write report
  scanTelemetry.count(
    'packages:vulnerable',
    packageResults.filter((p) => p.vulnerabilities.length > 0).length
  );
  scanTelemetry.end(tlTotal, 'scan:total');
  // report() is async but we don't await it — fire-and-forget so the scan result
  // is returned to the caller immediately without waiting for disk I/O.
  scanTelemetry.report().catch(() => {});

  return {
    projectPath,
    packages: packageResults,
    allPackages: universe.length,
    vulnerabilities,
    strategies,
    summary: buildSummary(vulnerabilities, sourceIds),
    scannedAt: new Date().toISOString(),
    sources: sourceIds,
  };
}

module.exports = { scanProject };
