'use strict';

const { queryNvdKeyword } = require('../../enrichment/sources/nvd-keyword-source');

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_ID = 'nvd';

// ─── Severity mapping ─────────────────────────────────────────────────────────

/**
 * Maps a NVD CVSS severity category string to the canonical severity strings
 * used by the scanner. MEDIUM maps to 'moderate' (not 'medium') to match the
 * convention used by every other scanner plugin.
 *
 * @param {string|null} category - CVSS severity string (e.g. 'CRITICAL', 'HIGH')
 * @returns {string} Canonical severity: 'critical' | 'high' | 'moderate' | 'low' | 'unknown'
 */
function severityFromCvssCategory(category) {
  if (!category) return 'unknown';
  const SEVERITY_MAP = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'moderate',
    LOW: 'low',
    NONE: 'low',
  };
  return SEVERITY_MAP[category.toUpperCase()] || 'unknown';
}

// ─── Scanner plugin ───────────────────────────────────────────────────────────

/**
 * @typedef {object} NvdKeywordHit
 * @property {string}        cveId                - CVE ID (e.g. 'CVE-2026-9358')
 * @property {number|null}   cvssScore            - CVSS base score from NVD
 * @property {string|null}   cvssVector           - CVSS vector string from NVD
 * @property {string|null}   cvssCategory         - CVSS severity category (e.g. 'HIGH')
 * @property {string[]}      cweIds               - CWE IDs from NVD weaknesses
 * @property {string}        url                  - NVD advisory URL
 * @property {string}        description          - English CVE description text
 * @property {string|null}   fixedIn              - Fixed version from CPE versionEndExcluding or versionEndIncluding+1
 * @property {string|null}   vulnerableRange      - Human-readable version range (e.g. ">=4.0.0 <4.17.5")
 */

/**
 * @typedef {object} SourceResult
 * @property {string}      sourceId           - Always 'nvd'
 * @property {string}      packageName        - pkg.name
 * @property {string}      packageVersion     - pkg.version
 * @property {string}      severity           - Canonical severity string
 * @property {string[]}    cveIds             - Array containing the single CVE ID for this hit
 * @property {string[]}    aliases            - Always [] — NVD keyword results carry no non-CVE aliases
 * @property {string}      title              - First 120 chars of the NVD English description
 * @property {string|null} description        - Full NVD English description text
 * @property {string|null} fixedIn            - Fixed version propagated from NvdKeywordHit; null when not available
 * @property {string|null} url                - NVD advisory URL
 * @property {string|null} vulnerableRange      - Human-readable version range (e.g. ">=4.0.0 <4.17.5")
 * @property {number|null} cvssScore          - CVSS base score from NVD
 * @property {string|null} cvssVector         - CVSS vector string from NVD
 * @property {boolean}     cisaKnownExploited - Always false; populated by cisa-kev plugin
 * @property {null}        epssScore          - Populated by cisa-kev plugin
 * @property {null}        epssPercentile     - Populated by cisa-kev plugin
 * @property {object}      rawData            - { nvd: NvdKeywordHit }
 */

/**
 * Queries the NVD API v2 by keyword for vulnerabilities affecting a given package.
 * Returns zero or more SourceResult objects — one per matched CVE.
 *
 * Input guard: skips packages with no version or no resolved URL (git/local packages).
 * Rate limiting: delegated to queryNvdKeyword() which uses the shared enqueueNvd() queue.
 *
 * @param {object}      pkg          - PackageDescriptor from package-universe-builder
 * @param {string}      pkg.name     - Package name
 * @param {string}      pkg.version  - Exact installed version
 * @param {string|null} [pkg.resolved] - Resolved registry URL; null for git/local packages
 * @returns {Promise<SourceResult[]>}
 */
async function query(pkg) {
  if (!pkg || !pkg.name || !pkg.version || !pkg.resolved) return [];

  try {
    const hits = await queryNvdKeyword(pkg);
    if (!hits || hits.length === 0) return [];

    return hits.map((hit) => ({
      sourceId: SOURCE_ID,
      packageName: pkg.name,
      packageVersion: pkg.version,
      severity: severityFromCvssCategory(hit.cvssCategory),
      cveIds: hit.cveId ? [hit.cveId] : [],
      aliases: [],
      title: hit.description ? hit.description.slice(0, 120) : hit.cveId || '',
      description: hit.description || null,
      fixedIn: hit.fixedIn ?? null,
      url: hit.url || null,
      vulnerableRange: hit.vulnerableRange ?? null,
      cvssScore: hit.cvssScore ?? null,
      cvssVector: hit.cvssVector ?? null,
      cisaKnownExploited: false,
      epssScore: null,
      epssPercentile: null,
      rawData: { nvd: hit },
    }));
  } catch (err) {
    console.warn(`[scanner/nvd-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`);
    return [];
  }
}

module.exports = { query, SOURCE_ID };
