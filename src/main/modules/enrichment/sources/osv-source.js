'use strict';

const https = require('https');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

const SEV_ORDER = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, MODERATE: 3, LOW: 2, NONE: 1, UNKNOWN: 0 };

function higherSeverity(a, b) {
  const aS = SEV_ORDER[(a || '').toUpperCase()] || 0;
  const bS = SEV_ORDER[(b || '').toUpperCase()] || 0;
  if (!aS && !bS) return null;
  return aS >= bS ? a : b;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
}

const OSV_BACKOFF_BASE_MS = 1000;
const OSV_MAX_RETRIES = 3;

function httpsPost(url, body, timeoutMs, signal = undefined) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request aborted'));
      return;
    }

    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
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
          if (res.statusCode === 429) {
            const err = new Error('OSV rate-limited (429)');
            err.isRateLimit = true;
            reject(err);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`OSV HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`OSV JSON parse error: ${e.message}`));
          }
        });
      }
    );
    // Abort request if signal is triggered
    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy(new Error('Request aborted'));
      });
    }
    req.on('error', (err) => {
      if (signal?.aborted) return;
      reject(err);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`OSV timeout ${timeoutMs}ms`)));
    req.write(payload);
    req.end();
  });
}

function extractSeverity(v) {
  const db = v.database_specific && v.database_specific.severity;
  if (db) return db.toUpperCase();
  if (Array.isArray(v.affected)) {
    for (const a of v.affected) {
      const es = a.ecosystem_specific && a.ecosystem_specific.severity;
      if (es) return es.toUpperCase();
    }
  }
  return null;
}

function extractAliases(v) {
  const s = new Set();
  if (v.id) s.add(v.id);
  if (Array.isArray(v.aliases)) v.aliases.forEach((a) => typeof a === 'string' && s.add(a));
  if (Array.isArray(v.references)) {
    for (const r of v.references) {
      const u = r.url || (typeof r === 'string' ? r : '');
      const m = u.match(/CVE-\d{4}-\d{4,}/i);
      if (m) s.add(m[0].toUpperCase());
    }
  }
  return Array.from(s);
}

function extractUrl(v) {
  if (!Array.isArray(v.references) || !v.references.length) return null;
  const urls = v.references.map((r) => (typeof r === 'string' ? r : r.url || ''));
  return (
    urls.find((u) => u.includes('github.com/advisories')) ||
    urls.find((u) => u.includes('nvd.nist.gov')) ||
    urls.find((u) => u.startsWith('https://')) ||
    urls[0] ||
    null
  );
}

/**
 * Internal variant of fetchOsvRaw that propagates non-rate-limit errors instead of
 * swallowing them. Used by queryOSV() so it can return { found: false, error: '...' }
 * rather than silently returning an empty result on HTTP errors.
 */
async function _fetchOsvRawOrThrow(packageName, version, ecosystem = 'npm', signal = undefined) {
  const requestBody = {
    package: { name: packageName, ecosystem },
    version: version || '',
  };
  for (let attempt = 0; attempt <= OSV_MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    try {
      const response = await httpsPost(
        ENRICHMENT_CONFIG.OSV_API_URL,
        requestBody,
        ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS,
        signal
      );
      return Array.isArray(response.vulns) ? response.vulns : [];
    } catch (err) {
      if (err.isRateLimit && attempt < OSV_MAX_RETRIES) {
        await sleep(backoffDelay(OSV_BACKOFF_BASE_MS, attempt));
        continue;
      }
      console.warn(`[osv-source] fetchOsvRaw error for ${packageName}@${version}: ${err.message}`);
      throw err;
    }
  }
  return [];
}

/**
 * Merge an array of raw OSV vulnerability objects into a single result object.
 * @param {object[]} vulns - Array of raw OSV vulnerability objects
 * @returns {{found: boolean, severity: string|null, aliases: string[], url: string|null}}
 */
function _mergeOsvVulns(vulns) {
  if (!Array.isArray(vulns) || vulns.length === 0) {
    return { found: false, severity: null, aliases: [], url: null };
  }

  let mergedSeverity = null;
  const allAliases = new Set();
  let firstUrl = null;

  for (const vuln of vulns) {
    const s = extractSeverity(vuln);
    mergedSeverity = mergedSeverity === null ? s : higherSeverity(mergedSeverity, s);
    for (const alias of extractAliases(vuln)) {
      allAliases.add(alias);
    }
    if (!firstUrl) {
      firstUrl = extractUrl(vuln);
    }
  }

  return {
    found: true,
    severity: mergedSeverity,
    aliases: Array.from(allAliases),
    url: firstUrl,
  };
}

/**
 * Fetches raw vulnerability entries from the OSV API for a given package.
 * Unlike queryOSV(), this returns the complete array of individual vulnerability
 * objects without merging — one entry per distinct OSV vulnerability.
 *
 * @param {string} packageName - npm package name (e.g., "lodash" or "@babel/core")
 * @param {string} version - exact installed version (e.g., "4.17.21")
 * @param {string} [ecosystem='npm'] - OSV ecosystem identifier
 * @returns {Promise<object[]>} Array of raw OSV vulnerability objects, empty if none found
 */
async function fetchOsvRaw(packageName, version, ecosystem = 'npm', signal = undefined) {
  if (!packageName || typeof packageName !== 'string') return [];
  try {
    return await _fetchOsvRawOrThrow(packageName, version, ecosystem, signal);
  } catch {
    return [];
  }
}

/**
 * Internal variant for batch fetching that propagates non-rate-limit errors.
 * @param {Object[]} queries - Array of query objects, each with {package: {name, ecosystem}, version}
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<Object[]>} Promise that resolves to an array of raw vulns arrays (one per query)
 * @throws {Error} On abort, rate limit exhaustion, or other HTTP errors
 */
async function _fetchOsvRawBatchOrThrow(queries, signal = undefined) {
  const numQueries = queries.length;
  if (numQueries === 0) return [];

  const allVulns = Array.from({ length: numQueries }, () => []);
  const nextTokens = Array.from({ length: numQueries }, () => null); // null means no token yet (first page not fetched)
  const done = Array.from({ length: numQueries }, () => false);
  let pending = numQueries;

  while (pending > 0) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Build the batch request for queries that are not done.
    const batchQueries = [];
    const indices = []; // mapping from batchQueries index to original query index
    for (let i = 0; i < numQueries; i++) {
      if (done[i]) continue;
      const q = { ...queries[i] };
      if (nextTokens[i] !== null) {
        // we have a token to continue
        q.next_token = nextTokens[i];
      }
      batchQueries.push(q);
      indices.push(i);
    }

    if (batchQueries.length === 0) break; // should not happen

    // Try request with retries for rate limit
    let response;
    for (let attempt = 0; attempt <= OSV_MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new Error('Request aborted');
      }
      try {
        response = await httpsPost(
          'https://api.osv.dev/v1/querybatch',
          { queries: batchQueries },
          ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS,
          signal
        );
        break; // success
      } catch (err) {
        if (err.isRateLimit && attempt < OSV_MAX_RETRIES) {
          await sleep(backoffDelay(OSV_BACKOFF_BASE_MS, attempt));
          continue;
        }
        throw err; // rethrow after retries exhausted or non-rate-limit error
      }
    }

    // Process response: response should have a `results` array same length as batchQueries
    if (!Array.isArray(response.results) || response.results.length !== batchQueries.length) {
      throw new Error('Unexpected OSV batch response format');
    }

    for (let j = 0; j < batchQueries.length; j++) {
      const origIndex = indices[j];
      const res = response.results[j];
      if (Array.isArray(res.vulns)) {
        allVulns[origIndex].push(...res.vulns);
      }
      const token = res.next_page_token;
      if (token) {
        nextTokens[origIndex] = token;
        // not done yet
      } else {
        nextTokens[origIndex] = null;
        done[origIndex] = true;
        pending--;
      }
    }
  }

  return allVulns;
}

/**
 * Returns the minimum version from an array of version strings.
 * Handles standard semver (1.2.3), pre-release (1.2.3-alpha.1), and
 * non-standard strings (0.0.1-security) by treating pre-release identifiers
 * as having lower precedence than the release version.
 *
 * @param {string[]} versions
 * @returns {string|null}
 */
function minVersion(versions) {
  if (!versions || versions.length === 0) return null;
  if (versions.length === 1) return versions[0];

  return versions.reduce((min, v) => {
    // Split into numeric version and optional pre-release label
    // e.g. "1.2.3-alpha.1" -> core="1.2.3", prerelease="alpha.1"
    const [minCore, minPre] = min.split('-');
    const [vCore, vPre] = v.split('-');

    // Compare numeric core parts only
    const minParts = minCore.split('.').map((p) => parseInt(p, 10) || 0);
    const vParts = vCore.split('.').map((p) => parseInt(p, 10) || 0);

    const len = Math.max(minParts.length, vParts.length);
    for (let i = 0; i < len; i++) {
      const a = minParts[i] || 0;
      const b = vParts[i] || 0;
      if (b < a) return v; // v has smaller core — v is minimum
      if (a < b) return min; // min has smaller core — min stays
    }

    // Core versions are equal — pre-release has LOWER precedence than release
    // If min has no pre-release and v has pre-release, v is lower (pre-release)
    if (!minPre && vPre) return v;
    // If min has pre-release and v does not, min is lower (min stays)
    if (minPre && !vPre) return min;
    // Both have pre-release or neither does — string comparison as fallback
    if (minPre && vPre) return minPre <= vPre ? min : v;
    // Both are equal
    return min;
  });
}

function compareVersions(a, b) {
  const aCoreStr = String(a).split('-')[0];
  const bCoreStr = String(b).split('-')[0];
  const aPre = String(a).indexOf('-') !== -1 ? String(a).slice(String(a).indexOf('-') + 1) : null;
  const bPre = String(b).indexOf('-') !== -1 ? String(b).slice(String(b).indexOf('-') + 1) : null;
  const aParts = aCoreStr.split('.').map((p) => {
    return parseInt(p, 10) || 0;
  });
  const bParts = bCoreStr.split('.').map((p) => {
    return parseInt(p, 10) || 0;
  });
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = aParts[i] || 0;
    const bv = bParts[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;
  return 0;
}

function parseLastKnownAffectedBound(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const trimmed = rangeStr.trim();
  const m1 = trimmed.match(/^<=\s*(\S+)$/);
  if (m1) return m1[1];
  const m2 = trimmed.match(/^<\s*(\S+)$/);
  if (m2) return m2[1];
  return null;
}

function extractFixedIn(osvVuln) {
  if (!Array.isArray(osvVuln.affected)) return null;
  const npmFixed = [];
  for (const aff of osvVuln.affected) {
    if (!aff.package || aff.package.ecosystem !== 'npm') continue;
    if (!Array.isArray(aff.ranges)) continue;
    for (const range of aff.ranges) {
      if (range.type !== 'ECOSYSTEM' && range.type !== 'SEMVER') continue;
      if (!Array.isArray(range.events)) continue;
      for (const ev of range.events) {
        if (ev.fixed && typeof ev.fixed === 'string') npmFixed.push(ev.fixed);
      }
    }
  }
  if (npmFixed.length > 0) return minVersion(npmFixed);
  const npmBounds = [];
  for (const aff of osvVuln.affected) {
    if (!aff.package || aff.package.ecosystem !== 'npm') continue;
    const bound = parseLastKnownAffectedBound(
      aff.database_specific && aff.database_specific.last_known_affected_version_range
    );
    if (bound) npmBounds.push(bound);
  }
  if (npmBounds.length > 0) return minVersion(npmBounds);
  for (const aff of osvVuln.affected) {
    if (!Array.isArray(aff.ranges)) continue;
    for (const range of aff.ranges) {
      if (!Array.isArray(range.events)) continue;
      for (const ev of range.events) {
        if (ev.fixed && typeof ev.fixed === 'string') return ev.fixed;
      }
    }
  }
  return null;
}

function isVersionSafe(installedVersion, osvVuln) {
  if (!installedVersion || !osvVuln) return false;
  const fixedIn = extractFixedIn(osvVuln);
  if (!fixedIn) return false;
  return compareVersions(installedVersion, fixedIn) >= 0;
}

/**
 * Query OSV.dev for a given npm package + version.
 * Delegates all HTTP transport and retry logic to fetchOsvRaw(), then
 * merges the raw vulnerability array into a single result object.
 *
 * @param {string} packageName
 * @param {string} version
 * @param {string} ecosystem - OSV ecosystem identifier; undefined falls back to fetchOsvRaw()'s default ('npm')
 * @returns {Promise<{found: boolean, severity: string|null, aliases: string[], url: string|null}>}
 */
async function queryOSV(packageName, version, ecosystem, signal = undefined) {
  // Validate input early and return error shape so callers can check r.error
  if (!packageName || typeof packageName !== 'string') {
    return { found: false, error: 'Invalid package name', severity: null, aliases: [], url: null };
  }
  let vulns;
  try {
    vulns = await _fetchOsvRawOrThrow(packageName, version, ecosystem, signal);
  } catch (err) {
    return { found: false, error: err.message, severity: null, aliases: [], url: null };
  }
  if (vulns.length === 0) {
    return { found: false, severity: null, aliases: [], url: null };
  }

  let mergedSeverity = null;
  const allAliases = new Set();
  let firstUrl = null;

  for (const vuln of vulns) {
    const s = extractSeverity(vuln);
    mergedSeverity = mergedSeverity === null ? s : higherSeverity(mergedSeverity, s);
    for (const alias of extractAliases(vuln)) {
      allAliases.add(alias);
    }
    if (!firstUrl) {
      firstUrl = extractUrl(vuln);
    }
  }

  return {
    found: true,
    severity: mergedSeverity,
    aliases: Array.from(allAliases),
    url: firstUrl,
  };
}

/**
 * Query OSV.dev for a batch of package + version pairs.
 * @param {Array<{packageName: string, version: string}>} packageVersions - Array of package name and version objects
 * @param {string} [ecosystem='npm'] - OSV ecosystem identifier
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<Array<{found: boolean, severity: string|null, aliases: string[], url: string|null}>>}
 */
async function queryOsvBatch(packageVersions, ecosystem = 'npm', signal = undefined) {
  if (!Array.isArray(packageVersions)) {
    throw new Error('packageVersions must be an array');
  }
  const queries = packageVersions.map(({ packageName, version }) => ({
    package: { name: packageName, ecosystem },
    version: version || '',
  }));
  const rawResults = await _fetchOsvRawBatchOrThrow(queries, signal);
  return rawResults.map((vulns) => _mergeOsvVulns(vulns));
}

module.exports = {
  queryOSV,
  fetchOsvRaw,
  extractFixedIn,
  extractSeverity,
  extractAliases,
  extractUrl,
  isVersionSafe,
  queryOsvBatch,
};
