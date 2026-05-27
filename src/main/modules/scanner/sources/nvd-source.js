'use strict';

const { queryNVD } = require('../../enrichment/sources/nvd-source');
const {
  fetchOsvRaw,
  extractFixedIn,
  extractAliases,
  extractSeverity,
  extractUrl,
  isVersionSafe,
} = require('../../enrichment/sources/osv-source');

const SOURCE_ID = 'nvd';

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Partitions an aliases array into CVE IDs and non-CVE aliases.
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
 * Queries the NVD API for CVSS data on each CVE associated with a package's
 * OSV vulnerability entries. Uses fetchOsvRaw() for per-entry CVE discovery
 * so that CVSS data is linked to the correct individual vulnerability — not
 * merged across all entries for the package.
 *
 * Rate limiting: queryNVD() uses an internal serial enqueueNvd() queue that
 * enforces a delay between NVD API calls. An NVD API key is strongly
 * recommended for 'full' scan mode.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name - Package name
 * @param {string} pkg.version - Exact installed version
 * @param {string|null} [pkg.resolved] - Resolved registry URL; null for git/local
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}   sourceId             - Always 'nvd'
 * @property {string}   packageName          - pkg.name
 * @property {string}   packageVersion       - pkg.version
 * @property {string}   severity             - NVD cvssCategory or OSV severity or 'unknown'
 * @property {string[]} cveIds               - CVE IDs from this specific OSV entry
 * @property {string[]} aliases              - Non-CVE aliases from this specific OSV entry
 * @property {string}   title                - vuln.summary or empty string
 * @property {null}     description          - Not provided by NVD source
 * @property {string|null} fixedIn           - First fixed version or null
 * @property {string|null} url               - NVD advisory URL
 * @property {number|null} cvssScore         - CVSS base score from NVD
 * @property {string|null} cvssVector        - CVSS vector string from NVD
 * @property {boolean}  cisaKnownExploited   - Always false; populated by cisa-kev plugin
 * @property {null}     epssScore            - Populated by cisa-kev plugin
 * @property {null}     epssPercentile       - Populated by cisa-kev plugin
 * @property {object}   rawData              - { osv: raw OSV entry, nvd: NVD result }
 */
async function query(pkg) {
  if (!pkg || !pkg.version || !pkg.resolved) return [];

  try {
    const vulns = await fetchOsvRaw(pkg.name, pkg.version, 'npm');
    if (!vulns || vulns.length === 0) return [];

    const results = [];

    for (const v of vulns) {
      if (isVersionSafe(pkg.version, v)) continue;
      const allAliases = extractAliases(v);
      const { cveIds, aliases } = partitionAliases(allAliases);

      // NVD requires a CVE ID — skip entries with no CVE aliases
      if (cveIds.length === 0) continue;

      // Use the first CVE ID per entry; the existing enqueueNvd() serial queue
      // in the enrichment nvd-source handles rate limiting automatically
      const nvdResult = await queryNVD(cveIds[0]);
      if (!nvdResult || !nvdResult.found) continue;

      results.push({
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: nvdResult.cvssCategory || extractSeverity(v) || 'unknown',
        cveIds,
        aliases,
        title: v.summary || '',
        description: null,
        fixedIn: extractFixedIn(v),
        url: nvdResult.url || extractUrl(v),
        cvssScore: nvdResult.cvssScore ?? null,
        cvssVector: nvdResult.cvssVector ?? null,
        cisaKnownExploited: false,
        epssScore: null,
        epssPercentile: null,
        rawData: { osv: v, nvd: nvdResult },
      });
    }

    return results;
  } catch (err) {
    console.warn(`[scanner/nvd-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`);
    return [];
  }
}

module.exports = { query, SOURCE_ID };
