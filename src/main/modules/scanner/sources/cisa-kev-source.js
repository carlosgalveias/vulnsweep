'use strict';

const { isCisaKnownExploited } = require('../../enrichment/sources/cisa-kev-source');
const { queryEPSS } = require('../../enrichment/sources/epss-source');
const { fetchOsvRaw, extractAliases } = require('../../enrichment/sources/osv-source');

const SOURCE_ID = 'cisa-kev';

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Collects all unique CVE IDs from across all OSV vulnerability entries for a package.
 * Unlike T5/T6 which process one entry at a time, CISA KEV lookup is purely by CVE ID
 * and per-entry association is not relevant for determining known-exploitation status.
 *
 * @param {object[]} vulns - Raw OSV vulnerability entries from fetchOsvRaw()
 * @returns {string[]} Deduplicated array of CVE ID strings
 */
function collectAllCveIds(vulns) {
  const seen = new Set();
  for (const v of vulns) {
    for (const alias of extractAliases(v)) {
      if (CVE_PATTERN.test(alias)) {
        seen.add(alias);
      }
    }
  }
  return Array.from(seen);
}

/**
 * Queries the CISA Known Exploited Vulnerabilities (KEV) catalog for each CVE
 * associated with a package. Only produces SourceResult objects for CVEs that are
 * confirmed in the CISA KEV catalog — most packages return [].
 *
 * The CISA KEV catalog is fetched once and cached for 24 hours by the existing
 * isCisaKnownExploited() function — no additional caching is needed here.
 *
 * Both isCisaKnownExploited() and queryEPSS() are called in parallel via
 * Promise.allSettled() to minimise latency per CVE ID.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name - Package name
 * @param {string} pkg.version - Exact installed version
 * @param {string|null} [pkg.resolved] - Resolved registry URL; null for git/local
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}   sourceId             - Always 'cisa-kev'
 * @property {string}   packageName          - pkg.name
 * @property {string}   packageVersion       - pkg.version
 * @property {'critical'} severity           - Always 'critical' for CISA KEV results
 * @property {string[]} cveIds               - Single CVE ID that matched CISA KEV
 * @property {string[]} aliases              - Always [] for CISA KEV results
 * @property {string}   title                - 'CISA KEV: <cveId>'
 * @property {null}     description          - Not provided by CISA KEV source
 * @property {null}     fixedIn              - Not provided by CISA KEV source
 * @property {string}   url                  - CISA KEV catalog URL
 * @property {null}     cvssScore            - Not provided by CISA KEV source
 * @property {null}     cvssVector           - Not provided by CISA KEV source
 * @property {true}     cisaKnownExploited   - Always true
 * @property {number|null} epssScore         - EPSS exploitation probability score
 * @property {number|null} epssPercentile    - EPSS percentile ranking
 * @property {object}   rawData              - { cveId, epss: epssResult }
 */
async function query(pkg) {
  if (!pkg || !pkg.name || !pkg.version) return [];

  try {
    const vulns = await fetchOsvRaw(pkg.name, pkg.version, 'npm');
    if (!vulns || vulns.length === 0) return [];

    // Collect all CVE IDs across all OSV entries (flattened — per-entry association
    // is not relevant for CISA KEV; exploitation status is per-CVE-ID)
    const cveIds = collectAllCveIds(vulns);
    if (cveIds.length === 0) return [];

    const results = [];

    for (const cveId of cveIds) {
      // Run CISA KEV check and EPSS query in parallel for this CVE ID
      const [kevSettled, epssSettled] = await Promise.allSettled([
        isCisaKnownExploited(cveId),
        queryEPSS(cveId),
      ]);

      const isKnownExploited = kevSettled.status === 'fulfilled' ? kevSettled.value : false;
      if (!isKnownExploited) continue;

      const epssResult = epssSettled.status === 'fulfilled' ? epssSettled.value : null;

      results.push({
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: 'critical',
        cveIds: [cveId],
        aliases: [],
        title: `CISA KEV: ${cveId}`,
        description: null,
        fixedIn: null,
        url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: true,
        epssScore: epssResult?.epssScore ?? null,
        epssPercentile: epssResult?.epssPercentile ?? null,
        rawData: { cveId, epss: epssResult },
      });
    }

    return results;
  } catch (err) {
    console.warn(
      `[scanner/cisa-kev-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`
    );
    return [];
  }
}

module.exports = { query, SOURCE_ID };
