'use strict';

const { queryGitHubAdvisory } = require('../../enrichment/sources/github-advisory-source');
const {
  fetchOsvRaw,
  extractFixedIn,
  extractAliases,
  extractSeverity,
  extractUrl,
} = require('../../enrichment/sources/osv-source');

const SOURCE_ID = 'github-advisory';

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const GHSA_PATTERN = /^GHSA-/i;

/**
 * Partitions an aliases array into CVE IDs, GHSA IDs, and other aliases.
 *
 * @param {string[]} allAliases - Full alias list from extractAliases()
 * @returns {{ cveIds: string[], ghsaIds: string[], aliases: string[] }}
 */
function partitionAliases(allAliases) {
  const cveIds = [];
  const ghsaIds = [];
  const aliases = [];
  for (const id of allAliases) {
    if (CVE_PATTERN.test(id)) {
      cveIds.push(id);
    } else if (GHSA_PATTERN.test(id)) {
      ghsaIds.push(id);
      aliases.push(id);
    } else {
      aliases.push(id);
    }
  }
  return { cveIds, ghsaIds, aliases };
}

/**
 * Queries the GitHub Advisory Database for each vulnerability in a package's
 * OSV vulnerability entries. Uses fetchOsvRaw() for per-entry CVE/GHSA discovery
 * so that advisory data is linked to the correct individual vulnerability.
 *
 * Query ID selection: CVE ID is preferred over GHSA ID because CVE IDs provide
 * broader NVD cross-reference coverage. Falls back to GHSA ID when no CVE is present.
 * The existing retry/backoff in queryGitHubAdvisory() handles 429/403 responses.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name - Package name
 * @param {string} pkg.version - Exact installed version
 * @param {string|null} [pkg.resolved] - Resolved registry URL; null for git/local
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}   sourceId             - Always 'github-advisory'
 * @property {string}   packageName          - pkg.name
 * @property {string}   packageVersion       - pkg.version
 * @property {string}   severity             - GitHub severity or OSV severity or 'unknown'
 * @property {string[]} cveIds               - CVE IDs from this specific OSV entry
 * @property {string[]} aliases              - GHSA IDs and other non-CVE aliases from this entry
 * @property {string}   title                - vuln.summary or empty string
 * @property {null}     description          - Not provided by this source
 * @property {string|null} fixedIn           - GitHub patchedVersions[0] or OSV fixed version
 * @property {string|null} url               - GitHub advisory URL
 * @property {null}     cvssScore            - Not provided by GitHub Advisory REST API
 * @property {null}     cvssVector           - Not provided by GitHub Advisory REST API
 * @property {boolean}  cisaKnownExploited   - Always false; populated by cisa-kev plugin
 * @property {null}     epssScore            - Populated by cisa-kev plugin
 * @property {null}     epssPercentile       - Populated by cisa-kev plugin
 * @property {object}   rawData              - { osv: raw OSV entry, github: GitHub result }
 */
async function query(pkg) {
  if (!pkg || !pkg.name || !pkg.version) return [];

  try {
    const vulns = await fetchOsvRaw(pkg.name, pkg.version, 'npm');
    if (!vulns || vulns.length === 0) return [];

    const results = [];

    for (const v of vulns) {
      const allAliases = extractAliases(v);
      const { cveIds, ghsaIds, aliases } = partitionAliases(allAliases);

      // Prefer CVE ID over GHSA ID for GitHub Advisory query (CVE gives broader coverage)
      const queryId = cveIds[0] || ghsaIds[0];
      if (!queryId) continue;

      // Existing retry/backoff in queryGitHubAdvisory() handles 429/403 automatically
      const ghResult = await queryGitHubAdvisory(queryId);
      if (!ghResult || !ghResult.found) continue;

      results.push({
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: (ghResult.severity || extractSeverity(v) || 'unknown').toLowerCase(),
        cveIds,
        aliases,
        title: v.summary || '',
        description: null,
        fixedIn: ghResult.patchedVersions?.[0] || extractFixedIn(v) || null,
        url: ghResult.url || extractUrl(v),
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: false,
        epssScore: null,
        epssPercentile: null,
        rawData: { osv: v, github: ghResult },
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

module.exports = { query, SOURCE_ID };
