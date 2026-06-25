'use strict';

const semver = require('semver');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');
const { resolveGitHubRepo } = require('../../../utils/repo-url-resolver');
const {
  queryGitHubAdvisoryByPackage,
  queryRepoLevelAdvisories,
} = require('../../enrichment/sources/github-advisory-source');

const SOURCE_ID = 'github-advisory';

/**
 * Checks if an installed version is affected by a GitHub advisory.
 * Parses the advisory's vulnerabilities[].vulnerable_version_range field
 * and checks if the installed version satisfies it.
 *
 * GitHub advisory vulnerable_version_range uses comma-separated constraints
 * like ">= 1.0.0, < 2.0.0" which must be converted to semver range format.
 *
 * Also filters by package name to handle advisories that affect multiple packages.
 *
 * @param {string} installedVersion - The installed package version
 * @param {object} advisory - Raw GitHub advisory object
 * @param {string} packageName - The npm package name to match
 * @returns {boolean}
 */
function isVersionAffectedByAdvisory(installedVersion, advisory, packageName) {
  if (!advisory || !Array.isArray(advisory.vulnerabilities)) return false;

  const coerced = semver.coerce(installedVersion);
  const cleanVersion = semver.clean(installedVersion) || (coerced && coerced.version);
  if (!cleanVersion) return false;

  for (const vuln of advisory.vulnerabilities) {
    // Filter to npm ecosystem and matching package name
    if (!vuln.package || vuln.package.ecosystem !== 'npm') continue;
    if (vuln.package.name !== packageName) continue;

    const range = vuln.vulnerable_version_range;
    if (!range || typeof range !== 'string') continue;

    // Convert GitHub's comma-separated range format to semver range
    // e.g. ">= 1.0.0, < 2.0.0" → ">=1.0.0 <2.0.0"
    const semverRange = range
      .split(',')
      .map((part) => part.trim())
      .join(' ');

    try {
      if (semver.satisfies(cleanVersion, semverRange)) {
        return true;
      }
    } catch {
      // If range parsing fails, skip this vulnerability entry
      continue;
    }
  }

  return false;
}

/**
 * Attempts to infer a fixedIn version from a vulnerable_version_range string
 * when patched_versions is unavailable.
 *
 * Only handles EXCLUSIVE upper bounds: "< X.Y.Z"
 * Does NOT handle inclusive upper bounds: "<= X.Y.Z" (too complex to infer next version)
 *
 * @param {string} range - e.g. "< 14.0.0" or ">= 1.0.0, < 2.3.1"
 * @returns {string|null} The inferred fix version, or null if not inferrable
 */
function inferFixedInFromRange(range) {
  if (!range || typeof range !== 'string') return null;

  // Match "< X.Y.Z" but NOT "<= X.Y.Z"
  // The regex captures the last "< X.Y.Z" segment in a comma-separated range
  const match = range.match(/<\s+(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\s*$/);
  if (!match) return null;

  // Verify it's truly exclusive (not "<=")
  // Check the character before "<" to ensure it's not "="
  const idx = range.lastIndexOf('<');
  if (idx > 0 && range[idx - 1] === '<') return null; // bizarre edge case: "<<"
  // Check for "<=" pattern
  if (range.substring(idx, idx + 2) === '<=') return null;

  return match[1];
}

/**
 * Extracts the appropriate patched version from a GitHub advisory for a specific
 * package and installed version. Only considers vulnerability entries whose
 * vulnerable_version_range the installed version actually satisfies.
 *
 * This prevents incorrect fix suggestions for multi-branch advisories where
 * different version ranges have different fix versions (e.g., 3.x branch fix
 * vs 4.x branch fix).
 *
 * Uses a 3-tier fallback strategy:
 *   1. patched_versions (primary)
 *   2. first_patched_version (object or string form)
 *   3. Inferred from vulnerable_version_range exclusive upper bound
 *
 * @param {object} advisory - Raw GitHub advisory object
 * @param {string} packageName - The npm package name to match
 * @param {string} installedVersion - The installed version to match against ranges
 * @returns {string|null} The earliest fix version for the matching branch, or null
 */
function extractFixedInFromAdvisory(advisory, packageName, installedVersion) {
  if (!advisory || !Array.isArray(advisory.vulnerabilities)) return null;

  const coerced = semver.coerce(installedVersion);
  const cleanVersion = semver.clean(installedVersion) || (coerced && coerced.version);

  let bestFixed = null;

  for (const vuln of advisory.vulnerabilities) {
    if (!vuln.package || vuln.package.ecosystem !== 'npm') continue;
    if (vuln.package.name !== packageName) continue;

    // Only consider this entry if the installed version falls in its vulnerable range
    if (cleanVersion) {
      const range = vuln.vulnerable_version_range;
      if (range && typeof range === 'string') {
        const semverRange = range
          .split(',')
          .map((part) => part.trim())
          .join(' ');
        try {
          if (!semver.satisfies(cleanVersion, semverRange)) continue;
        } catch {
          // If range parsing fails, still consider this entry (conservative)
        }
      }
    }

    // === PRIMARY: Extract from patched_versions ===
    let version = null;
    const patched = vuln.patched_versions;
    if (patched && typeof patched === 'string') {
      const cleaned = patched.replace(/^>=\s*/, '').trim();
      const patchedCoerced = semver.coerce(cleaned);
      if (patchedCoerced) {
        version = patchedCoerced.version;
      }
    }

    // === FALLBACK 1: Extract from first_patched_version ===
    if (!version) {
      const fpv = vuln.first_patched_version;
      const fpvStr = fpv && typeof fpv === 'object' ? fpv.identifier : fpv;
      if (fpvStr && typeof fpvStr === 'string') {
        const fpvCoerced = semver.coerce(fpvStr);
        if (fpvCoerced) {
          version = fpvCoerced.version;
        }
      }
    }

    // === FALLBACK 2: Infer from vulnerable_version_range upper bound ===
    if (!version) {
      const inferred = inferFixedInFromRange(vuln.vulnerable_version_range);
      if (inferred) {
        const inferredCoerced = semver.coerce(inferred);
        if (inferredCoerced) {
          version = inferredCoerced.version;
        }
      }
    }

    // Skip entry if no fix version could be determined
    if (!version) continue;

    if (!bestFixed || semver.lt(version, bestFixed)) {
      bestFixed = version;
    }
  }

  return bestFixed;
}

/**
 * Queries the GitHub Advisory Database directly by package name for independent
 * vulnerability discovery. Does NOT depend on OSV as a discovery layer.
 *
 * Uses the package-level endpoint:
 *   GET https://api.github.com/advisories?ecosystem=npm&affects=<package_name>
 *
 * Results are filtered client-side to check if pkg.version falls within each
 * advisory's vulnerable range. Rate limiting uses the existing rateLimiter.enqueue()
 * mechanism — only ONE API call per package (not per vulnerability).
 *
 * Deduplication with other sources (OSV, NVD) is handled downstream by
 * result-aggregator.js's groupResultsByAdvisoryId() which uses transitive
 * merging on CVE IDs AND GHSA IDs.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name - Package name
 * @param {string} pkg.version - Exact installed version
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}   sourceId             - Always 'github-advisory'
 * @property {string}   packageName          - pkg.name
 * @property {string}   packageVersion       - pkg.version
 * @property {string}   severity             - GitHub severity or 'unknown'
 * @property {string[]} cveIds               - CVE IDs from the advisory
 * @property {string[]} aliases              - GHSA IDs and other aliases
 * @property {string}   title                - Advisory summary
 * @property {null}     description          - Not provided by this source
 * @property {string|null} fixedIn           - Earliest patched version for this package
 * @property {string|null} url               - GitHub advisory URL
 * @property {null}     cvssScore            - Not provided by GitHub Advisory REST API
 * @property {null}     cvssVector           - Not provided by GitHub Advisory REST API
 * @property {boolean}  cisaKnownExploited   - Always false; populated by cisa-kev plugin
 * @property {null}     epssScore            - Populated by cisa-kev plugin
 * @property {null}     epssPercentile       - Populated by cisa-kev plugin
 * @property {object}   rawData              - { github: raw advisory object }
 */
async function query(pkg, signal) {
  if (!pkg || !pkg.name || !pkg.version) return [];

  try {
    // ─── PHASE 1: Global Advisory DB (existing behavior) ───
    const advisories = await queryGitHubAdvisoryByPackage(pkg.name, signal);

    // ─── PHASE 2: Version matching on global results ───
    const results = [];
    if (advisories && advisories.length > 0) {
      for (const advisory of advisories) {
        if (!isVersionAffectedByAdvisory(pkg.version, advisory, pkg.name)) continue;

        const ghsaId = advisory.ghsa_id || null;
        const cveId = advisory.cve_id || null;
        const cveIds = cveId ? [cveId] : [];
        const aliases = ghsaId ? [ghsaId] : [];
        const fixedIn = extractFixedInFromAdvisory(advisory, pkg.name, pkg.version);

        results.push({
          sourceId: SOURCE_ID,
          packageName: pkg.name,
          packageVersion: pkg.version,
          severity: (advisory.severity || 'unknown').toLowerCase(),
          cveIds,
          aliases,
          title: advisory.summary || '',
          description: null,
          fixedIn,
          url: advisory.html_url || null,
          cvssScore: null,
          cvssVector: null,
          cisaKnownExploited: false,
          epssScore: null,
          epssPercentile: null,
          rawData: { github: advisory },
        });
      }
    }

    // ─── PHASE 3: Repo-level fallback — fires when NO matching advisories found ───
    if (results.length === 0 && ENRICHMENT_CONFIG.GITHUB_TOKEN) {
      const repoInfo = await resolveGitHubRepo(pkg.name);
      if (repoInfo) {
        const repoAdvisories = await queryRepoLevelAdvisories(
          repoInfo.owner,
          repoInfo.repo,
          signal
        );
        // Filter repo-level advisories to only those affecting this specific package
        // (a repo may contain advisories for multiple packages in a monorepo)
        if (repoAdvisories && repoAdvisories.length > 0) {
          const filtered = repoAdvisories.filter((adv) => {
            if (!Array.isArray(adv.vulnerabilities)) return false;
            return adv.vulnerabilities.some(
              (v) => v.package && v.package.ecosystem === 'npm' && v.package.name === pkg.name
            );
          });

          for (const advisory of filtered) {
            if (!isVersionAffectedByAdvisory(pkg.version, advisory, pkg.name)) continue;

            const ghsaId = advisory.ghsa_id || null;
            const cveId = advisory.cve_id || null;
            const cveIds = cveId ? [cveId] : [];
            const aliases = ghsaId ? [ghsaId] : [];
            const fixedIn = extractFixedInFromAdvisory(advisory, pkg.name, pkg.version);

            results.push({
              sourceId: SOURCE_ID,
              packageName: pkg.name,
              packageVersion: pkg.version,
              severity: (advisory.severity || 'unknown').toLowerCase(),
              cveIds,
              aliases,
              title: advisory.summary || '',
              description: null,
              fixedIn,
              url: ghsaId ? `https://github.com/advisories/${ghsaId}` : advisory.html_url || null,
              cvssScore: null,
              cvssVector: null,
              cisaKnownExploited: false,
              epssScore: null,
              epssPercentile: null,
              rawData: { github: advisory },
            });
          }
        }
      }
    }

    return results;
  } catch (err) {
    console.warn(
      `[scanner/github-advisory-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`
    );
    return [];
  }
}

module.exports = {
  query,
  SOURCE_ID,
  isVersionAffectedByAdvisory,
  extractFixedInFromAdvisory,
  inferFixedInFromRange,
};
