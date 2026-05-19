'use strict';

const { queryEPSS } = require('../../enrichment/sources/epss-source');
const { fetchOsvRaw, extractAliases } = require('../../enrichment/sources/osv-source');

const SOURCE_ID = 'epss';
const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Collects all unique CVE IDs from across all OSV vulnerability entries for a package.
 *
 * @param {object[]} vulns - Raw OSV vulnerability entries from fetchOsvRaw()
 * @returns {string[]} Deduplicated array of uppercase CVE ID strings
 */
function collectCveIds(vulns) {
  const seen = new Set();
  for (const v of vulns) {
    for (const alias of extractAliases(v)) {
      if (CVE_PATTERN.test(alias)) seen.add(alias.toUpperCase());
    }
  }
  return Array.from(seen);
}

/**
 * Standalone EPSS source plugin. Queries the EPSS v3 API for every CVE associated
 * with a package (via OSV) and returns SourceResult objects with epssScore /
 * epssPercentile populated. Only emits results for CVEs that have a non-null
 * EPSS score — CVEs absent from the EPSS dataset are silently skipped.
 *
 * This plugin decouples EPSS data from CISA KEV membership. The cisa-kev plugin
 * already fetches EPSS for KEV-listed CVEs; this plugin covers the remaining ~99%
 * of CVEs that are not in KEV but still have EPSS scores.
 *
 * The result-aggregator gives the cisa-kev EPSS score precedence over this plugin's
 * score (ck ?? ep) so there is no double-counting for KEV-listed CVEs.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name    - Package name
 * @param {string} pkg.version - Exact installed version
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}      sourceId           - Always 'epss'
 * @property {string}      packageName        - pkg.name
 * @property {string}      packageVersion     - pkg.version
 * @property {'unknown'}   severity           - Not determined by EPSS
 * @property {string[]}    cveIds             - Single CVE ID for this result
 * @property {string[]}    aliases            - Always []
 * @property {string}      title              - Always ''
 * @property {null}        description        - Not provided by EPSS
 * @property {null}        fixedIn            - Not provided by EPSS
 * @property {null}        url                - Not provided by EPSS
 * @property {null}        vulnerableRange    - Not provided by EPSS
 * @property {null}        cvssScore          - Not provided by EPSS
 * @property {null}        cvssVector         - Not provided by EPSS
 * @property {false}       cisaKnownExploited - Always false; populated by cisa-kev plugin
 * @property {number}      epssScore          - EPSS exploitation probability (0–1)
 * @property {number|null} epssPercentile     - EPSS percentile ranking (0–1), or null
 * @property {object}      rawData            - { cveId, epss: epssResult }
 */
async function query(pkg) {
  if (!pkg || !pkg.name || !pkg.version) return [];

  try {
    const vulns = await fetchOsvRaw(pkg.name, pkg.version, 'npm');
    if (!vulns || vulns.length === 0) return [];

    const cveIds = collectCveIds(vulns);
    if (cveIds.length === 0) return [];

    // Query all CVEs in parallel — EPSS is a read-only scoring API with no
    // rate-limit concerns for typical package CVE counts (usually < 10).
    const settled = await Promise.allSettled(
      cveIds.map(async (cveId) => {
        const epssResult = await queryEPSS(cveId);
        return { cveId, epssResult };
      })
    );

    const results = [];
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled') continue;
      const { cveId, epssResult } = outcome.value;
      if (!epssResult || !epssResult.found || epssResult.epssScore == null) continue;

      results.push({
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: 'unknown',
        cveIds: [cveId],
        aliases: [],
        title: '',
        description: null,
        fixedIn: null,
        url: null,
        vulnerableRange: null,
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: false,
        epssScore: epssResult.epssScore,
        epssPercentile: epssResult.epssPercentile ?? null,
        rawData: { cveId, epss: epssResult },
      });
    }

    return results;
  } catch (err) {
    console.warn(
      `[scanner/epss-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`
    );
    return [];
  }
}

module.exports = { query, SOURCE_ID };
