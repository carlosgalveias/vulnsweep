'use strict';

const https = require('https');
const semver = require('semver');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');
const { enqueueNvd, scoreToCvssCategory } = require('./nvd-source');

const NVD_KEYWORD_MAX_RESULTS = 20;
const NVD_KW_BACKOFF_BASE_MS = ENRICHMENT_CONFIG.NVD_RATE_LIMIT_MS;
const NVD_KW_MAX_RETRIES = 3;
const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoffDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
}

function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent': ENRICHMENT_CONFIG.USER_AGENT, Accept: 'application/json' };
    if (ENRICHMENT_CONFIG.NVD_API_KEY) headers['apiKey'] = ENRICHMENT_CONFIG.NVD_API_KEY;
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
            reject(new Error(`NVD keyword HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`NVD keyword JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`NVD keyword timeout ${timeoutMs}ms`)));
    req.end();
  });
}

/**
 * Extracts the English description string from a CVE descriptions array.
 * @param {Array<{lang: string, value: string}>} descriptions
 * @returns {string}
 */
function getEnglishDescription(descriptions) {
  const enDesc = Array.isArray(descriptions) ? descriptions.find((d) => d.lang === 'en') : null;
  if (!enDesc || typeof enDesc.value !== 'string') return '';
  return enDesc.value;
}

function extractCpeMatches(vulnerabilityItem) {
  const matches = [];
  const cve = vulnerabilityItem && vulnerabilityItem.cve;
  if (!cve || !Array.isArray(cve.configurations)) return matches;
  for (const config of cve.configurations) {
    if (!Array.isArray(config.nodes)) continue;
    for (const node of config.nodes) {
      if (!Array.isArray(node.cpeMatch)) continue;
      for (const cpe of node.cpeMatch) {
        matches.push(cpe);
      }
    }
  }
  return matches;
}

/**
 * Normalizes a package name for fuzzy comparison by lowercasing
 * and stripping separator characters (-, _, .).
 * Note: scoped package prefixes (e.g. '@babel/') are intentionally NOT stripped —
 * NVD CPE entries for scoped packages are rare and would require separate handling.
 * @param {string} name
 * @returns {string}
 */
function normalizePackageName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[-_.]/g, '');
}

/**
 * Extracts the product component (index 4) from a CPE 2.3 URI string.
 * Returns null if the criteria is malformed or the product field is '*'.
 * @param {string} criteriaString - e.g. 'cpe:2.3:a:lodash:lodash:*:...'
 * @returns {string|null}
 */
function extractCpeProduct(criteriaString) {
  if (!criteriaString || typeof criteriaString !== 'string') return null;
  const parts = criteriaString.split(':');
  if (parts.length < 5) return null;
  const product = parts[4];
  if (!product || product === '*') return null;
  return product;
}

/**
 * Extracts the version component (index 5) from a CPE 2.3 URI string.
 * Returns null if the criteria is malformed, the version field is '*', or '-' (N/A).
 * Used to detect pinned-exact CPEs (a single version with no range bounds).
 * @param {string} criteriaString - e.g. 'cpe:2.3:a:axios:axios:1.5.1:*:...'
 * @returns {string|null}
 */
function extractCpeVersion(criteriaString) {
  if (!criteriaString || typeof criteriaString !== 'string') return null;
  const parts = criteriaString.split(':');
  if (parts.length < 6) return null;
  const version = parts[5];
  if (!version || version === '*' || version === '-') return null;
  return version;
}

/**
 * Returns true if the CPE criteria's product field (normalized) matches
 * the given package name (normalized). Used to gate CPE version ranges
 * to only those describing the target package.
 * @param {string} criteriaString
 * @param {string} pkgName
 * @returns {boolean}
 */
function cpeMatchesPackage(criteriaString, pkgName) {
  const product = extractCpeProduct(criteriaString);
  if (!product) return false;
  return normalizePackageName(product) === normalizePackageName(pkgName);
}

/**
 * Extracts version range information from CPE matches for a specific package.
 * Returns the earliest fixed version and a human-readable affected version range string.
 * @param {string} pkgName - The npm package name to match against CPE product fields
 * @param {Array<object>} cpeMatches - Array of CPE match objects from NVD API response
 * @returns {{ fixedIn: string|null, vulnerableRange: string|null }}
 */
function extractVersionRangeInfo(pkgName, cpeMatches) {
  if (!cpeMatches || cpeMatches.length === 0) return { fixedIn: null, vulnerableRange: null };
  const packageCpes = cpeMatches.filter(
    (cpe) => cpe.vulnerable && cpeMatchesPackage(cpe.criteria, pkgName)
  );
  if (packageCpes.length === 0) return { fixedIn: null, vulnerableRange: null };
  let bestFixedIn = null;
  let bestFixedInCoerced = null;
  const rangeParts = [];
  for (const cpe of packageCpes) {
    let fixedInCandidate = null;
    if (cpe.versionEndExcluding && typeof cpe.versionEndExcluding === 'string') {
      const coerced = semver.coerce(cpe.versionEndExcluding);
      if (coerced) {
        fixedInCandidate = coerced.version;
      }
    } else if (
      cpe.versionEndIncluding &&
      typeof cpe.versionEndIncluding === 'string' &&
      cpe.versionEndIncluding !== ''
    ) {
      try {
        const coerced = semver.coerce(cpe.versionEndIncluding);
        if (coerced) fixedInCandidate = semver.inc(coerced.version, 'patch');
      } catch {
        fixedInCandidate = null;
      }
    }
    if (fixedInCandidate !== null) {
      const candCoerced = semver.coerce(fixedInCandidate);
      if (candCoerced) {
        if (!bestFixedInCoerced || semver.lt(candCoerced.version, bestFixedInCoerced.version)) {
          bestFixedIn = fixedInCandidate;
          bestFixedInCoerced = candCoerced;
        }
      }
    }
    let lower = '';
    let upper = '';
    if (cpe.versionStartIncluding && typeof cpe.versionStartIncluding === 'string') {
      lower = `>=${cpe.versionStartIncluding}`;
    } else if (cpe.versionStartExcluding && typeof cpe.versionStartExcluding === 'string') {
      lower = `>${cpe.versionStartExcluding}`;
    }
    if (cpe.versionEndExcluding && typeof cpe.versionEndExcluding === 'string') {
      upper = `<${cpe.versionEndExcluding}`;
    } else if (cpe.versionEndIncluding && typeof cpe.versionEndIncluding === 'string') {
      upper = `<=${cpe.versionEndIncluding}`;
    }
    const part = [lower, upper].filter(Boolean).join(' ').trim();
    if (part && !rangeParts.includes(part)) rangeParts.push(part);
  }
  return {
    fixedIn: bestFixedIn,
    vulnerableRange: rangeParts.length > 0 ? rangeParts.join(' || ') : null,
  };
}

function isVersionAffected(pkgName, pkgVersion, cpeMatches) {
  if (!cpeMatches || cpeMatches.length === 0) return true;
  const packageCpes = cpeMatches.filter(
    (cpe) => cpe.vulnerable && cpeMatchesPackage(cpe.criteria, pkgName)
  );
  if (packageCpes.length === 0) return false;
  try {
    const coerced = semver.coerce(pkgVersion);
    const cleanPkg = semver.clean(pkgVersion) || (coerced && coerced.version);
    if (!cleanPkg) return true;
    for (const cpe of packageCpes) {
      if (cpe.versionStartIncluding) {
        const sc = semver.coerce(cpe.versionStartIncluding);
        const cs = semver.clean(cpe.versionStartIncluding) || (sc && sc.version);
        if (!cs) continue;
        if (!semver.gte(cleanPkg, cs)) continue;
      } else if (cpe.versionStartExcluding) {
        const sc = semver.coerce(cpe.versionStartExcluding);
        const cs = semver.clean(cpe.versionStartExcluding) || (sc && sc.version);
        if (!cs) continue;
        if (!semver.gt(cleanPkg, cs)) continue;
      }
      if (cpe.versionEndIncluding) {
        const ec = semver.coerce(cpe.versionEndIncluding);
        const ce = semver.clean(cpe.versionEndIncluding) || (ec && ec.version);
        if (ce && semver.lte(cleanPkg, ce)) return true;
      } else if (cpe.versionEndExcluding) {
        const ec = semver.coerce(cpe.versionEndExcluding);
        const ce = semver.clean(cpe.versionEndExcluding) || (ec && ec.version);
        if (ce && semver.lt(cleanPkg, ce)) return true;
      } else {
        // No versionEnd* bounds — could be a pinned-exact CPE (version field in the
        // criteria URI itself, e.g. cpe:2.3:a:axios:axios:1.5.1:*:...) or a fully
        // open-ended CPE (*). For pinned-exact CPEs, only match if the installed
        // version equals the pinned version. For open-ended CPEs (version='*'),
        // extractCpeVersion returns null and we fall through to return true.
        const pinnedVersion = extractCpeVersion(cpe.criteria);
        if (pinnedVersion !== null) {
          // Pinned-exact: compare semver-coerced versions
          const pinnedCoerced = semver.coerce(pinnedVersion);
          const pinnedClean =
            semver.clean(pinnedVersion) || (pinnedCoerced && pinnedCoerced.version);
          if (pinnedClean && semver.eq(cleanPkg, pinnedClean)) return true;
          // Installed version does not match the pinned version — not affected by this CPE
          continue;
        }
        // Open-ended CPE (no range bounds, no pinned version) — treat as universally affected
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

function parseCvss(metrics) {
  const keys = ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2'];
  for (const key of keys) {
    const arr = metrics[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const m = arr[0].cvssData || arr[0];
    if (m && typeof m.baseScore === 'number') {
      return { cvssScore: m.baseScore, cvssVector: m.vectorString || null };
    }
  }
  return { cvssScore: null, cvssVector: null };
}

/**
 * Filters a raw NVD API v2 JSON response down to CVEs that are relevant
 * to the given package name and version.
 *
 * Two filtering paths are applied per CVE:
 *  1. CPE path (preferred): if CPE data exists, gates on CPE product matching
 *     pkgName AND isVersionAffected(). Extracts fixedIn + vulnerableRange.
 *
 * @param {object} json - Raw JSON response from NVD API v2 /cves/2.0 endpoint
 * @param {string} pkgName - The npm package name being scanned
 * @param {string} pkgVersion - The installed version of the package
 * @returns {Array<{cveId: string, cvssScore: number|null, cvssVector: string|null,
 *   cvssCategory: string|null, cweIds: string[], url: string, description: string,
 *   fixedIn: string|null, vulnerableRange: string|null}>}
 */
function parseKeywordResponse(json, pkgName, pkgVersion) {
  if (!json || !Array.isArray(json.vulnerabilities)) return [];
  const results = [];

  // Strict ecosystem whitelist: The CPE MUST reference the Node ecosystem
  const NODE_ECOSYSTEMS = ['npm', 'node.js', 'nodejs'];

  for (const item of json.vulnerabilities) {
    const cve = item && item.cve;
    if (!cve || !cve.id || !CVE_PATTERN.test(cve.id)) continue;

    const cpeMatches = extractCpeMatches(item);

    // 1. If there is no structured CPE data, ignore it completely (safer fallback).
    if (cpeMatches.length === 0) {
      continue;
    }

    // 2. --- ECOSYSTEM WHITELIST GUARD ---
    // Ensure at least one CPE match explicitly targets the Node/npm ecosystem.
    // This instantly eliminates things like cpe:2.3:a:drupal:drupal...
    const isNodeEcosystem = cpeMatches.some((cpe) => {
      const criteria = (cpe.criteria || '').toLowerCase();
      return NODE_ECOSYSTEMS.some(
        (eco) => criteria.includes(`:${eco}:`) || criteria.includes(`:${eco}`)
      );
    });

    if (!isNodeEcosystem) continue;

    // 3. --- STRUCTURED VERSION VERIFICATION ---
    // Check if our installed version actually falls into the NVD's stated CPE range
    if (!isVersionAffected(pkgName, pkgVersion, cpeMatches)) {
      continue;
    }

    // --- PROCESSING VALID MATCHES ---
    const enDescText = getEnglishDescription(cve.descriptions);
    const { fixedIn, vulnerableRange } = extractVersionRangeInfo(pkgName, cpeMatches);
    const { cvssScore, cvssVector } = parseCvss(cve.metrics || {});
    const cweIds = (cve.weaknesses || []).flatMap((w) =>
      (w.description || []).filter((d) => d.value && d.value.startsWith('CWE-')).map((d) => d.value)
    );

    results.push({
      cveId: cve.id,
      cvssScore,
      cvssVector,
      cvssCategory: scoreToCvssCategory(cvssScore),
      cweIds,
      url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      description: enDescText,
      fixedIn,
      vulnerableRange,
    });
  }

  return results;
}

async function queryNvdKeyword(pkg) {
  if (!pkg || !pkg.name || !pkg.version) return [];
  const url =
    `${ENRICHMENT_CONFIG.NVD_API_URL}?keywordSearch=${encodeURIComponent(
      pkg.name
    )}&keywordExactMatch` + `&resultsPerPage=${NVD_KEYWORD_MAX_RESULTS}`;
  return enqueueNvd(async () => {
    for (let attempt = 0; attempt <= NVD_KW_MAX_RETRIES; attempt++) {
      try {
        const json = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS);
        if (json === null) return [];
        return parseKeywordResponse(json, pkg.name, pkg.version);
      } catch (err) {
        if (err.isRateLimit && attempt < NVD_KW_MAX_RETRIES) {
          const delay = backoffDelay(NVD_KW_BACKOFF_BASE_MS, attempt);
          console.warn(
            `[nvd-keyword] Rate limited, retry ${attempt + 1}/${NVD_KW_MAX_RETRIES} after ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
        if (err.isRateLimit) {
          console.warn(
            `[nvd-keyword] Rate limit exceeded after ${NVD_KW_MAX_RETRIES} retries for ${pkg.name}`
          );
          return [];
        }
        console.warn(`[nvd-keyword] query error for ${pkg.name}: ${err.message}`);
        return [];
      }
    }
    return [];
  });
}

module.exports = {
  queryNvdKeyword,
  normalizePackageName,
  extractCpeProduct,
  extractCpeVersion,
  cpeMatchesPackage,
  extractVersionRangeInfo,
  isVersionAffected,
  parseKeywordResponse,
};
