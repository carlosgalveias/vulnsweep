'use strict';

const semver = require('semver');
const { determineFixStrategy } = require('../audit/strategies/fix-strategy');
const { mergeSeverity } = require('../enrichment/severity-merger');
const { isInstalledVersionVulnerable } = require('./sources/npm-audit-source');

const SOURCE_PRIORITY = Object.freeze([
  'nvd',
  'github-advisory',
  'osv',
  'npm-audit',
  'cisa-kev',
  'epss',
]);
const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const GHSA_PATTERN = /^GHSA-/i;

function isCveId(id) {
  return typeof id === 'string' && CVE_PATTERN.test(id);
}

/**
 * Returns true for any advisory identifier usable as a merge key:
 * CVE-YYYY-NNNNN or GHSA-xxxx-xxxx-xxxx.
 * @param {string} id
 * @returns {boolean}
 */
function isAdvisoryId(id) {
  return typeof id === 'string' && (CVE_PATTERN.test(id) || GHSA_PATTERN.test(id));
}

function getSourcePriority(sid) {
  const i = SOURCE_PRIORITY.indexOf(sid);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

function sortByPriority(g) {
  return [...g].sort((a, b) => getSourcePriority(a.sourceId) - getSourcePriority(b.sourceId));
}

function firstByPriority(g, f) {
  for (const r of sortByPriority(g)) {
    const v = r[f];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function minSemver(vs) {
  let min = null;
  for (const v of vs) {
    if (!v || typeof v !== 'string') continue;
    try {
      const c = semver.coerce(v);
      if (!c) continue;
      if (min === null) {
        min = v;
      } else {
        const cm = semver.coerce(min);
        if (cm && semver.lt(c.version, cm.version)) min = v;
      }
    } catch {
      /* ignore invalid semver */
    }
  }
  return min;
}

/**
 * Correlates SourceResults by shared advisory identifiers (CVE IDs AND GHSA IDs)
 * so that enrichment data from different sources (NVD CVSS scores, OSV severity,
 * npm-audit vulnerability ranges) for the same CVE/advisory is paired correctly
 * before being merged into a single UnifiedVulnerability.
 *
 * Each returned group is subsequently processed by mergeGroup() to produce one
 * UnifiedVulnerability per advisory cluster. deduplicateVulnerabilities() then
 * collapses those per-advisory rows into one row per package+installedVersion
 * (the final UI requirement). The grouping here serves enrichment correlation,
 * NOT final row separation.
 *
 * Extends the previous CVE-only grouping to also key on GHSA IDs present in
 * `result.aliases`. This fixes the duplicate-row problem where:
 *   - npm-audit reports a vulnerability with only a GHSA URL in via[].url
 *     (no CVE), so cveIds is empty but aliases contains the GHSA ID.
 *   - GitHub Advisory / OSV reports the same vulnerability with the GHSA ID
 *     in aliases and the associated CVE ID in cveIds.
 * Without GHSA-key merging those two SourceResults ended up in separate groups,
 * producing duplicate UnifiedVulnerability rows in the UI.
 *
 * Handles transitive merges: if result A shares CVE-001 with result C, and result B
 * shares GHSA-xxxx with result C, all three end up in the same group even though A
 * and B share no identifiers directly.
 *
 * Algorithm:
 *   For each result, collect ALL advisory IDs from both cveIds and aliases
 *   (filtered to CVE-YYYY-NNNNN and GHSA-* patterns). Find all existing group
 *   indices mapped to any of those IDs.
 *   - Zero matches    -> new singleton group.
 *   - One match       -> add to that group.
 *   - Multiple matches -> merge all matching groups into lowest-index, then add result.
 *   Filter out empty slots vacated during merges.
 *
 * @param {object[]} allResults
 * @returns {object[][]}
 */
function groupResultsByAdvisoryId(allResults) {
  const groups = [];
  const idToGroupIdx = new Map();

  for (const result of allResults) {
    const allIds = [
      ...(Array.isArray(result.cveIds) ? result.cveIds : []),
      ...(Array.isArray(result.aliases) ? result.aliases : []),
    ]
      .filter(isAdvisoryId)
      .map((id) => id.toUpperCase());

    if (allIds.length === 0) {
      groups.push([result]);
      continue;
    }

    const groupIndices = new Set();
    for (const id of allIds) {
      if (idToGroupIdx.has(id)) {
        groupIndices.add(idToGroupIdx.get(id));
      }
    }

    if (groupIndices.size === 0) {
      const newIdx = groups.length;
      groups.push([result]);
      for (const id of allIds) {
        idToGroupIdx.set(id, newIdx);
      }
    } else if (groupIndices.size === 1) {
      const existingIdx = [...groupIndices][0];
      groups[existingIdx].push(result);
      for (const id of allIds) {
        idToGroupIdx.set(id, existingIdx);
      }
    } else {
      const targetIdx = Math.min(...groupIndices);

      for (const srcIdx of groupIndices) {
        if (srcIdx === targetIdx) continue;
        for (const r of groups[srcIdx]) {
          groups[targetIdx].push(r);
        }
        groups[srcIdx] = [];
      }

      groups[targetIdx].push(result);

      for (const [id, idx] of idToGroupIdx) {
        if (groupIndices.has(idx)) {
          idToGroupIdx.set(id, targetIdx);
        }
      }

      for (const id of allIds) {
        idToGroupIdx.set(id, targetIdx);
      }
    }
  }

  return groups.filter((g) => g.length > 0);
}

function find(g, sid) {
  return g.find((r) => r.sourceId === sid) || null;
}

function mergeCveIds(g) {
  const s = new Set();
  for (const r of g) {
    if (!Array.isArray(r.cveIds)) continue;
    for (const id of r.cveIds) {
      if (isCveId(id)) s.add(id.toUpperCase());
    }
  }
  return Array.from(s);
}

function mergeAliases(g) {
  const s = new Set();
  for (const r of g) {
    if (!Array.isArray(r.aliases)) continue;
    for (const id of r.aliases) {
      if (typeof id === 'string' && id.length > 0) s.add(id);
    }
  }
  return Array.from(s);
}
/**
 * Collects all unique, non-empty URLs across every source result in the group,
 * ordered by source priority (highest-priority sources first).
 *
 * @param {object[]} g - group of SourceResults
 * @returns {string[]}
 */
function mergeUrls(g) {
  const seen = new Set();
  const urls = [];
  for (const r of sortByPriority(g)) {
    if (typeof r.url === 'string' && r.url.length > 0 && !seen.has(r.url)) {
      seen.add(r.url);
      urls.push(r.url);
    }
  }
  return urls;
}

function mergeGroupSeverity(g) {
  const nv = find(g, 'nvd'),
    np = find(g, 'npm-audit'),
    os = find(g, 'osv'),
    gh = find(g, 'github-advisory');
  const nvdCvssScore = nv && typeof nv.cvssScore === 'number' ? nv.cvssScore : null;
  const osvSeverity = os ? os.severity || null : null;
  const npmSeverity = np ? np.severity || null : null;
  const ghaSeverity = gh ? gh.severity || null : null;
  return mergeSeverity(npmSeverity, osvSeverity, nvdCvssScore, ghaSeverity);
}

function mergePatchedVersion(g, installedVersion) {
  const clean = installedVersion
    ? semver.clean(installedVersion) || (semver.coerce(installedVersion) || {}).version
    : null;
  const fixes = g
    .map((r) => r.fixedIn)
    .filter((v) => v != null && v !== '')
    // A fix must move forward — never surface a version <= what's installed,
    // otherwise multi-branch advisories drag the suggestion into a downgrade.
    .filter((v) => {
      if (!clean) return true;
      const cv = semver.coerce(v);
      return cv ? semver.gt(cv.version, clean) : true;
    });
  return minSemver(fixes);
}

function buildSourceDetails(g) {
  const d = {};
  for (const r of g) {
    const k =
      r.sourceId === 'github-advisory'
        ? 'github'
        : r.sourceId === 'cisa-kev'
          ? 'cisaKev'
          : r.sourceId === 'npm-audit'
            ? 'npmAudit'
            : r.sourceId;
    d[k] = r.rawData !== undefined ? r.rawData : null;
  }
  return d;
}

async function mergeGroup(g, pkg) {
  const npm = find(g, 'npm-audit'),
    ck = find(g, 'cisa-kev'),
    nv = find(g, 'nvd');
  const ep = find(g, 'epss');
  const { mergedSeverity, nvdCategory, severityDiscrepancy, discrepancyDetails } =
    mergeGroupSeverity(g);
  const cveIds = mergeCveIds(g),
    aliases = mergeAliases(g);
  const patchedVersion = mergePatchedVersion(
    g,
    (pkg && pkg.version) || (g[0] && g[0].packageVersion)
  );
  const vulnerableRange = firstByPriority(g, 'vulnerableRange') || null;
  const title = firstByPriority(g, 'title') || null;
  const url = firstByPriority(g, 'url') || null;
  const urls = mergeUrls(g);
  const cvssScore = nv ? nv.cvssScore || null : null;
  const cvssVector = nv ? nv.cvssVector || null : null;
  const cisaKnownExploited = g.some((r) => r.cisaKnownExploited === true);
  const epssScore = (ck ? (ck.epssScore ?? null) : null) ?? (ep ? (ep.epssScore ?? null) : null);
  const epssPercentile =
    (ck ? (ck.epssPercentile ?? null) : null) ?? (ep ? (ep.epssPercentile ?? null) : null);
  const description = firstByPriority(g, 'description') || null;
  const npmRaw = npm ? npm.rawData || {} : {};
  const via = npmRaw.via != null ? (Array.isArray(npmRaw.via) ? npmRaw.via : [npmRaw.via]) : null;
  const resolvesDependents =
    npmRaw.resolvesDependents !== undefined ? npmRaw.resolvesDependents : [];
  const isPromotedDependent =
    npmRaw.isPromotedDependent !== undefined ? npmRaw.isPromotedDependent : false;
  const unfixableRootCause =
    npmRaw.unfixableRootCause !== undefined ? npmRaw.unfixableRootCause : null;
  const nvdRaw = nv ? nv.rawData || {} : {};
  const cwe = Array.isArray(nvdRaw.cwe) ? nvdRaw.cwe : [];
  const sources = [...new Set(g.map((r) => r.sourceId))];
  const sourceDetails = buildSourceDetails(g);
  const uv = {
    package: pkg.name,
    installedVersion: pkg.version,
    isDirect: pkg.isDirect || false,
    isDevDep: pkg.isDevDep || false,
    lockfileDepth: typeof pkg.lockfileDepth === 'number' ? pkg.lockfileDepth : 0,
    severity: mergedSeverity ? mergedSeverity.toLowerCase() : 'unknown',
    nvdCategory: nvdCategory || null,
    severityDiscrepancy: severityDiscrepancy || false,
    discrepancyDetails: discrepancyDetails || null,
    cveIds,
    aliases,
    title,
    url,
    urls,
    description,
    patchedVersion,
    vulnerableRange,
    cvssScore,
    cvssVector,
    cisaKnownExploited,
    epssScore,
    epssPercentile,
    via,
    cwe,
    resolvesDependents,
    isPromotedDependent,
    unfixableRootCause,
    sources,
    sourceDetails,
    enrichedAt: new Date().toISOString(),
    strategy: null,
  };
  if (npmRaw.strategy != null) {
    uv.strategy = npmRaw.strategy;
  } else {
    try {
      uv.strategy = await determineFixStrategy(
        {
          package: pkg.name,
          isDirect: uv.isDirect,
          fixAvailable: Boolean(patchedVersion),
          patchedVersion,
          installedVersion: pkg.version,
          isPromotedDependent,
          unfixableRootCause,
          vulnerableRange,
        },
        { vulnerabilities: {} }
      );
    } catch (e) {
      console.warn(`[result-aggregator] determineFixStrategy failed for ${pkg.name}: ${e.message}`);
    }
  }
  return uv;
}

const SEV_RANK = { critical: 5, high: 4, medium: 3, moderate: 3, low: 2, none: 1, unknown: 0 };
function sevRank(s) {
  return typeof s === 'string' ? SEV_RANK[s.toLowerCase()] || 0 : 0;
}
function highestSeverity(vs) {
  let h = 'unknown';
  for (const v of vs) {
    if (sevRank(v.severity) > sevRank(h)) h = v.severity;
  }
  return h;
}

/**
 * Returns true when two UnifiedVulnerability objects describe the same
 * package+installedVersion and should be merged into a single UI row.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function isDuplicateVuln(a, b) {
  return (
    typeof a.package === 'string' &&
    a.package.length > 0 &&
    a.package === b.package &&
    a.installedVersion === b.installedVersion
  );
}

/**
 * Merges all intelligence from secondary into primary in-place.
 * Takes the higher severity, unions CVE IDs / aliases / sources / sourceDetails,
 * keeps the higher CVSS score, and preserves the first available EPSS + patchedVersion.
 *
 * @param {object} primary - mutated in place
 * @param {object} secondary - read-only source
 */
function mergeVulnInto(primary, secondary) {
  if (sevRank(secondary.severity) > sevRank(primary.severity))
    primary.severity = secondary.severity;
  const cveSet = new Set((primary.cveIds || []).map((id) => id.toUpperCase()));
  for (const id of secondary.cveIds || []) {
    if (typeof id === 'string' && id.length > 0) cveSet.add(id.toUpperCase());
  }
  primary.cveIds = Array.from(cveSet);
  const aliasSet = new Set(primary.aliases || []);
  for (const id of secondary.aliases || []) {
    if (typeof id === 'string' && id.length > 0) aliasSet.add(id);
  }
  primary.aliases = Array.from(aliasSet);
  const srcSet = new Set(primary.sources || []);
  for (const s of secondary.sources || []) srcSet.add(s);
  primary.sources = Array.from(srcSet);
  if (secondary.sourceDetails && typeof secondary.sourceDetails === 'object') {
    if (!primary.sourceDetails || typeof primary.sourceDetails !== 'object')
      primary.sourceDetails = {};
    for (const [k, val] of Object.entries(secondary.sourceDetails)) {
      if (!(k in primary.sourceDetails)) primary.sourceDetails[k] = val;
    }
  }
  if (
    secondary.cvssScore != null &&
    (primary.cvssScore == null || secondary.cvssScore > primary.cvssScore)
  ) {
    primary.cvssScore = secondary.cvssScore;
    primary.cvssVector =
      secondary.cvssVector != null
        ? secondary.cvssVector
        : primary.cvssVector != null
          ? primary.cvssVector
          : null;
  }
  if (secondary.epssScore != null && primary.epssScore == null) {
    primary.epssScore = secondary.epssScore;
    primary.epssPercentile = secondary.epssPercentile != null ? secondary.epssPercentile : null;
  }
  if (secondary.cisaKnownExploited === true) primary.cisaKnownExploited = true;
  if (primary.patchedVersion == null && secondary.patchedVersion != null)
    primary.patchedVersion = secondary.patchedVersion;
  if (primary.vulnerableRange == null && secondary.vulnerableRange != null)
    primary.vulnerableRange = secondary.vulnerableRange;
  // Merge strategy: prefer any actionable (non-null, non-NO_FIX) strategy
  if (
    secondary.strategy != null &&
    secondary.strategy.type !== 'NO_FIX' &&
    (primary.strategy == null || primary.strategy.type === 'NO_FIX')
  ) {
    primary.strategy = secondary.strategy;
  }
}

/**
 * Final deduplication: one row per unique (package, installedVersion).
 *
 * Two UnifiedVulnerability objects for the same package+version are ALWAYS
 * merged regardless of whether they share advisory IDs. The UI shows one row
 * per installed package, not one row per CVE. All CVE IDs, aliases, and source
 * details are unioned into the surviving entry so no intelligence is lost.
 *
 * @param {object[]} vulnerabilities
 * @returns {object[]}
 */
function deduplicateVulnerabilities(vulnerabilities) {
  if (!vulnerabilities || vulnerabilities.length === 0) return vulnerabilities;
  const result = [];
  const absorbed = new Set();
  for (let i = 0; i < vulnerabilities.length; i++) {
    if (absorbed.has(i)) continue;
    // Shallow-clone the winning entry so mergeVulnInto() mutations do not
    // propagate back to the perAdvisoryVulns array produced by mergeGroup().
    const primary = { ...vulnerabilities[i] };
    for (let j = i + 1; j < vulnerabilities.length; j++) {
      if (absorbed.has(j)) continue;
      if (isDuplicateVuln(primary, vulnerabilities[j])) {
        mergeVulnInto(primary, vulnerabilities[j]);
        absorbed.add(j);
      }
    }
    result.push(primary);
  }
  return result;
}

async function aggregate(pkg, allSourceResults) {
  // Flatten all source results from all plugins into a single array
  const flat = allSourceResults
    .filter(Array.isArray)
    .flat()
    .filter((r) => r && typeof r === 'object');

  // Safety-net: Remove source results where the installed version does NOT satisfy
  // the reported vulnerableRange. This catches false positives from any source that
  // fails to perform version filtering (defense-in-depth).
  const filtered = flat.filter((r) => {
    if (!r.vulnerableRange || typeof r.vulnerableRange !== 'string') return true;
    const version = r.packageVersion || (pkg && pkg.version);
    if (!version) return true;
    return isInstalledVersionVulnerable(version, r.vulnerableRange);
  });

  // Pass 1: Group by advisory ID to correlate source enrichment data correctly
  // (ensures NVD CVSS, OSV severity, and npm-audit data for the same CVE are paired)
  const advisoryGroups = groupResultsByAdvisoryId(filtered);

  // Pass 2: Merge each advisory group into one UnifiedVulnerability
  const perAdvisoryVulns = await Promise.all(advisoryGroups.map((g) => mergeGroup(g, pkg)));

  // Pass 3: Collapse to one row per package+version (UI requirement)
  const vulnerabilities = deduplicateVulnerabilities(perAdvisoryVulns);

  const strategies = vulnerabilities.map((v) => v.strategy ?? null);
  return {
    package: pkg,
    vulnerabilities,
    strategies,
    highestSeverity: highestSeverity(vulnerabilities),
    vulnCount: vulnerabilities.length,
    fixableCount: vulnerabilities.filter((v) => v.patchedVersion != null).length,
  };
}
module.exports = { aggregate };
