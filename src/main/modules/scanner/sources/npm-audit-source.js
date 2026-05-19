'use strict';

const { runNpmAudit } = require('../../audit/commands/npm-audit');

const SOURCE_ID = 'npm-audit';

const CVE_EXTRACT_PATTERN = /CVE-\d{4}-\d{4,}/i;
// GHSA IDs appear in advisory URLs from GitHub:
//   https://github.com/advisories/GHSA-xxxx-xxxx-xxxx
//   https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-xxxx-xxxx-xxxx
const GHSA_EXTRACT_PATTERN = /\/(GHSA-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+)(?:[/?#]|$)/i;

/**
 * Module-level memoization cache — stores the in-flight Promise (not the
 * resolved value) so that concurrent query() calls for packages in the same
 * project all await the SAME Promise instead of each spawning a separate
 * runNpmAudit() process.
 *
 * Storing the Promise is the canonical solution to the async-race-condition
 * cache miss: if we stored the resolved value, every call that arrives before
 * the first call resolves would see an empty cache and start its own audit.
 *
 * @type {Map<string, Promise<object>>}
 */
const auditCache = new Map();

/** @type {Map<string, Promise<Map<string, string[]>>>} */
const dependentsCache = new Map();

/**
 * Clears the memoization cache. Exported for use in tests to reset state
 * between test runs without requiring module re-registration, and called by
 * scanner-orchestrator at the start of each scanProject() invocation so stale
 * results from a previous scan cannot bleed into the next one.
 */
function clearCache() {
  auditCache.clear();
  dependentsCache.clear();
}

/**
 * Extracts a CVE ID from a via advisory entry's url or title fields.
 *
 * @param {object} via - npm audit via advisory object
 * @returns {string|null}
 */
function extractCveId(via) {
  const source = via.url || via.title || '';
  const match = source.match(CVE_EXTRACT_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Extracts a GHSA ID from a via advisory entry's url field.
 * npm-audit URLs look like:
 *   https://github.com/advisories/GHSA-xxxx-xxxx-xxxx
 *   https://github.com/<owner>/<repo>/security/advisories/GHSA-xxxx-xxxx-xxxx
 *
 * @param {object} via - npm audit via advisory object
 * @returns {string|null}
 */
function extractGhsaId(via) {
  const url = via.url || '';
  const match = url.match(GHSA_EXTRACT_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Determines the fixed version for a package from the npm audit fixAvailable field.
 * Only uses fixAvailable.version when the fix targets this exact package — when
 * fixAvailable.name !== pkgName, npm is saying "update some other package", so
 * the version belongs to that other package, not to this one.
 *
 * @param {object} auditEntry - The full audit entry for this package
 * @param {string} pkgName - The package name to check against
 * @returns {string|null}
 */
function extractFixedIn(auditEntry, pkgName) {
  if (
    auditEntry.fixAvailable &&
    typeof auditEntry.fixAvailable === 'object' &&
    auditEntry.fixAvailable.name === pkgName
  ) {
    return auditEntry.fixAvailable.version || null;
  }
  return null;
}

/**
 * Builds a Map of packageName → string[] listing every dependent package that
 * pulls in that package transitively. Uses BFS over the `via` string references
 * in the raw npm audit vulnerabilities map.
 *
 * @param {object} vulnerabilities - The vulnerabilities map from npm audit JSON
 * @returns {Map<string, string[]>}
 */
function _buildResolvesDependentsMap(vulnerabilities) {
  const viaStrings = new Map();
  for (const [pkgName, entry] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(entry.via) ? entry.via : [];
    viaStrings.set(
      pkgName,
      via.filter((v) => typeof v === 'string')
    );
  }
  const result = new Map();
  for (const [rootName, entry] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(entry.via) ? entry.via : [];
    if (!via.some((v) => typeof v === 'object' && v !== null)) continue;
    const dependents = new Set();
    const queue = [rootName];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const [pkgName, strings] of viaStrings) {
        // `dependents` doubles as a visited set — if pkgName is already in the
        // dependents Set it has been reached via a shorter (or equal-length) BFS path;
        // re-queuing it would traverse the same subgraph again and loop infinitely on
        // circular dependency graphs.
        if (!dependents.has(pkgName) && pkgName !== rootName && strings.includes(current)) {
          dependents.add(pkgName);
          queue.push(pkgName);
        }
      }
    }
    result.set(rootName, [...dependents].sort());
  }
  return result;
}

/**
 * Returns (or lazily builds) the resolvesDependents Map for a given project.
 * Memoizes the computed Map so it is only built once per scan invocation.
 *
 * @param {string} projectPath
 * @returns {Promise<Map<string, string[]>>}
 */
async function _getResolvesDependentsMap(projectPath) {
  if (!dependentsCache.has(projectPath)) {
    dependentsCache.set(
      projectPath,
      (async () => {
        if (!auditCache.has(projectPath)) return new Map();
        const auditRunResult = await auditCache.get(projectPath);
        if (!auditRunResult || !auditRunResult.success) return new Map();
        const auditData = auditRunResult.content && auditRunResult.content.auditData;
        if (!auditData || !auditData.vulnerabilities) return new Map();
        return _buildResolvesDependentsMap(auditData.vulnerabilities);
      })()
    );
  }
  return dependentsCache.get(projectPath);
}

/**
 * Runs npm audit once per project (memoized) and maps results to SourceResult[]
 * for a specific package. Unlike other source plugins, npm audit operates at the
 * project level — query() is called per-package but runNpmAudit() executes only
 * once per projectPath per scan invocation.
 *
 * String-only entries in the via array (transitive dependency references) are
 * skipped — only object entries with url/title/severity are actual advisories.
 *
 * Root-cause/dependent promotion logic is NOT applied here — the rawData field
 * preserves resolvesDependents and isPromotedDependent for the aggregator (T9)
 * to propagate to UnifiedVulnerability.
 *
 * @param {object} pkg - PackageDescriptor from package-universe-builder
 * @param {string} pkg.name - Package name
 * @param {string} pkg.version - Exact installed version
 * @param {string|null} [pkg.resolved] - Resolved registry URL; null for git/local
 * @param {string} pkg.projectPath - Absolute path to project root (injected by orchestrator T10)
 * @returns {Promise<SourceResult[]>}
 *
 * @typedef {object} SourceResult
 * @property {string}      sourceId             - Always 'npm-audit'
 * @property {string}      packageName          - pkg.name
 * @property {string}      packageVersion       - pkg.version
 * @property {string}      severity             - Advisory severity or 'unknown'
 * @property {string[]}    cveIds               - CVE IDs extracted from advisory url/title
 * @property {string[]}    aliases              - GHSA IDs extracted from advisory url (e.g. GHSA-xxxx-xxxx-xxxx), or []
 * @property {string}      title                - Advisory title or empty string
 * @property {null}        description          - Not provided by npm-audit source
 * @property {string|null} fixedIn              - Version that fixes this package, or null
 * @property {string|null} url                  - Advisory URL
 * @property {string|null} vulnerableRange      - Semver range from audit entry
 * @property {null}        cvssScore            - Not provided by npm-audit source
 * @property {null}        cvssVector           - Not provided by npm-audit source
 * @property {false}       cisaKnownExploited   - Always false; populated by cisa-kev plugin
 * @property {null}        epssScore            - Populated by cisa-kev plugin
 * @property {null}        epssPercentile       - Populated by cisa-kev plugin
 * @property {object}      rawData              - { via, resolvesDependents, isPromotedDependent }
 */
async function query(pkg) {
  if (!pkg || !pkg.projectPath) return [];

  const { projectPath } = pkg;

  try {
    // Memoize: store the Promise itself so that all concurrent query() calls
    // that arrive before the first runNpmAudit() resolves share the same
    // in-flight Promise rather than each launching a separate audit process.
    if (!auditCache.has(projectPath)) {
      auditCache.set(projectPath, runNpmAudit(projectPath));
    }

    const auditRunResult = await auditCache.get(projectPath);

    // runNpmAudit returns createSuccess/createError shape: { success, content: { auditData } }
    if (!auditRunResult || !auditRunResult.success) return [];

    const auditData = auditRunResult.content && auditRunResult.content.auditData;
    if (!auditData || !auditData.vulnerabilities) return [];

    const auditEntry = auditData.vulnerabilities[pkg.name];
    if (!auditEntry) return [];

    const via = Array.isArray(auditEntry.via) ? auditEntry.via : [];
    const fixedIn = extractFixedIn(auditEntry, pkg.name);

    const dependentsMap = await _getResolvesDependentsMap(projectPath);
    const resolvesDependents = dependentsMap.get(pkg.name) || [];

    const results = [];

    for (const viaEntry of via) {
      // Skip string entries — transitive dependency chain references, not advisories
      if (typeof viaEntry !== 'object' || viaEntry === null) continue;

      // Skip object entries that lack both url and title — not a real advisory record
      if (!viaEntry.url && !viaEntry.title) continue;

      const cveId = extractCveId(viaEntry);
      const ghsaId = extractGhsaId(viaEntry);

      results.push({
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: viaEntry.severity || 'unknown',
        cveIds: cveId ? [cveId] : [],
        aliases: ghsaId ? [ghsaId] : [],
        title: viaEntry.title || '',
        description: null,
        fixedIn,
        url: viaEntry.url || null,
        vulnerableRange: auditEntry.range || null,
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: false,
        epssScore: null,
        epssPercentile: null,
        rawData: {
          via: viaEntry,
          resolvesDependents,
          isPromotedDependent: auditEntry.isPromotedDependent || false,
        },
      });
    }

    // Fix 2: Deduplicate by advisory identifier so the same advisory appearing in
    // multiple `via` chains (transitive dependency) only produces ONE SourceResult.
    const seen = new Set();
    const dedupedResults = results.filter((r) => {
      const key =
        (r.aliases && r.aliases[0]) ||
        (r.cveIds && r.cveIds[0]) ||
        r.url ||
        r.title ||
        JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return dedupedResults;
  } catch (err) {
    console.warn(
      `[scanner/npm-audit-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`
    );
    return [];
  }
}

module.exports = { query, clearCache, SOURCE_ID };
