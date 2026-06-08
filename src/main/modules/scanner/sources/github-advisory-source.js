'use strict';

const semver = require('semver');
const { queryGitHubAdvisoryByPackage } = require('../../enrichment/sources/github-advisory-source');

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
 * Extracts the appropriate patched version from a GitHub advisory for a specific
 * package and installed version. Only considers vulnerability entries whose
 * vulnerable_version_range the installed version actually satisfies.
 *
 * This prevents incorrect fix suggestions for multi-branch advisories where
 * different version ranges have different fix versions (e.g., 3.x branch fix
 * vs 4.x branch fix).
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

    const patched = vuln.patched_versions;
    if (!patched || typeof patched !== 'string') continue;

    // patched_versions is typically like ">= 1.2.3" or a semver range
    const cleaned = patched.replace(/^>=\s*/, '').trim();
    const patchedCoerced = semver.coerce(cleaned);
    if (!patchedCoerced) continue;

    const version = patchedCoerced.version;
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
    // Query GitHub Advisory API directly — independent of OSV
    const advisories = await queryGitHubAdvisoryByPackage(pkg.name, signal);
    if (!advisories || advisories.length === 0) return [];

    const results = [];
    for (const advisory of advisories) {
      // Filter: check if pkg.version is affected by this advisory
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

    return results;
  } catch (err) {
    console.warn(
      `[scanner/github-advisory-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`
    );
    return [];
  }
}

module.exports = { query, SOURCE_ID, isVersionAffectedByAdvisory, extractFixedInFromAdvisory };
