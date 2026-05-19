'use strict';

const {
  fetchOsvRaw,
  extractFixedIn,
  extractSeverity,
  extractAliases,
  extractUrl,
} = require('../../enrichment/sources/osv-source');

const SOURCE_ID = 'osv';

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Partitions an aliases array into CVE IDs and non-CVE aliases (GHSA/OSV IDs etc.).
 *
 * @param {string[]} allAliases - Full alias list from extractAliases()
 * @returns {{ cveIds: string[], aliases: string[] }}
 */
function partitionAliases(allAliases) {
  const cveIds = [];
  const aliases = [];
  for (const id of allAliases) {
    if (CVE_PATTERN.test(id)) {
      cveIds.push(id);
    } else {
      aliases.push(id);
    }
  }
  return { cveIds, aliases };
}

/**
 * Queries the OSV API for vulnerabilities affecting a specific npm package.
 * Produces one SourceResult per distinct OSV vulnerability entry — unlike the
 * legacy queryOSV() which merges all entries into a single record, this plugin
 * keeps per-entry CVE IDs isolated so downstream consumers see only the CVEs
 * that belong to each individual vulnerability.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name - Package name (e.g., "lodash" or "@babel/core")
 * @param {string} pkg.version - Exact installed version (e.g., "4.17.21")
 * @param {string|null} [pkg.resolved] - Resolved registry URL; null for git/local packages
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}   sourceId             - Always 'osv'
 * @property {string}   packageName          - pkg.name
 * @property {string}   packageVersion       - pkg.version
 * @property {string}   severity             - Normalised severity or 'unknown'
 * @property {string[]} cveIds               - CVE identifiers for this specific entry
 * @property {string[]} aliases              - Non-CVE identifiers (GHSA, OSV, etc.)
 * @property {string}   title                - vuln.summary or empty string
 * @property {string|null} description       - vuln.details or null
 * @property {string|null} fixedIn           - First fixed version or null
 * @property {string|null} url               - Primary advisory URL or null
 * @property {null}     cvssScore            - Reserved for enrichment phase
 * @property {null}     cvssVector           - Reserved for enrichment phase
 * @property {boolean}  cisaKnownExploited   - Populated by enrichment phase; always false here
 * @property {null}     epssScore            - Reserved for enrichment phase
 * @property {null}     epssPercentile       - Reserved for enrichment phase
 * @property {object}   rawData              - Raw OSV vulnerability object
 */
async function query(pkg) {
  if (!pkg || !pkg.version || !pkg.resolved) return [];

  try {
    const vulns = await fetchOsvRaw(pkg.name, pkg.version, 'npm');
    if (!vulns || vulns.length === 0) return [];

    return vulns.map((v) => {
      const allAliases = extractAliases(v);
      const { cveIds, aliases } = partitionAliases(allAliases);

      return {
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: extractSeverity(v) || 'unknown',
        cveIds,
        aliases,
        title: v.summary || '',
        description: v.details || null,
        fixedIn: extractFixedIn(v),
        url: extractUrl(v),
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: false,
        epssScore: null,
        epssPercentile: null,
        rawData: v,
      };
    });
  } catch (err) {
    console.warn(`[scanner/osv-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`);
    return [];
  }
}

module.exports = { query, SOURCE_ID };
