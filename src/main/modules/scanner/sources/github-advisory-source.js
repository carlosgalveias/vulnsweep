'use strict';

const semver = require('semver');
const { resolveGitHubRepo } = require('../../../utils/repo-url-resolver');
const {
  queryGitHubAdvisoryByPackage,
  queryRepoLevelAdvisories,
} = require('../../enrichment/sources/github-advisory-source');

const SOURCE_ID = 'github-advisory';

/**
 * Splits a GitHub `vulnerable_version_range` into discrete OR branches.
 *
 * GitHub advisory `vulnerabilities[].vulnerable_version_range` is **NOT** a
 * single semver range — it is one-or-more version *branches* separated by
 * commas, and the branches are OR'd (any branch matching => vulnerable).
 * A comma inside a range means the constraints within that ONE branch are
 * AND'd (e.g. ">= 4.0.0, < 4.22.0" = 4.0.0 ≤ v < 4.22.0).
 *
 * The naive previous implementation did
 *   `range.split(',').join(' ')` → ">= 4.0.0 < 4.22.0, >= 5.0.0 < 5.1.0"
 * which semver.intersects() treats as a single AND range, so it could NEVER
 * match a 4.x version (false negative) AND an unconstrained upper bound like
 * "< 5.1.0" would match every version below 5.1.0 across ALL majors
 * (false positive for 4.x). Splitting into OR branches fixes both.
 *
 * @param {string} range - e.g. ">= 4.0.0, < 4.22.0, >= 5.0.0, < 5.1.0"
 * @returns {string[]} Discrete semver range strings, one per branch.
 */
function splitAdvisoryBranches(range) {
  if (!range || typeof range !== 'string') return [];
  // GitHub uses ", " between branches AND between AND'd constraints. There is
  // no reliable syntactic separator, so we split into constraint tokens and
  // rebuild branches greedily: a branch ends when an UPPER bound (a "<"/"<="
  // constraint) is followed by a LOWER bound (a ">="/">" constraint).
  const tokens = range
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const branches = [];
  let current = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const isLower = /^>=?\s/.test(tok);
    const isUpper = /^<=?\s/.test(tok);
    // Start a new branch when this token is a lower bound and we already have
    // an upper-bound-closed branch pending.
    if (isLower && current.length > 0) {
      branches.push(current.join(' '));
      current = [];
    }
    current.push(tok);
    // Defensive: if an upper-bound token is immediately followed by another
    // upper bound, the prior branch is complete.
    const next = tokens[i + 1];
    if (isUpper && next && /^<=?\s/.test(next)) {
      branches.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) branches.push(current.join(' '));
  return branches;
}

/**
 * Coerces a GitHub patched_versions / first_patched_version string to a single
 * semver version, preferring the fix whose MAJOR matches `branchMajor` so an
 * unrelated branch's fix (e.g. a 4.x fix for a 5.x install) does not wrongly
 * suppress a real vulnerable-branch match.
 *
 * Accepts "4.22.0", ">= 4.22.0", "4.22.0 || 5.1.0", etc.
 *
 * @param {string} raw - cleaned patched-version string
 * @param {number|null} branchMajor - major line of the vulnerable branch
 * @returns {object|null} semver coerced version, or null if none parseable
 */
function coercePatchedForMajor(raw, branchMajor) {
  if (!raw || typeof raw !== 'string') return null;
  const tokens = raw
    .split('||')
    .map((t) => t.trim())
    .filter(Boolean);
  let fallback = null;
  for (const tok of tokens) {
    const c = semver.coerce(tok.replace(/^>=?\s*/, ''));
    if (!c) continue;
    if (fallback === null) fallback = c;
    if (branchMajor != null && majorOf(c.version) === branchMajor) return c;
  }
  return fallback;
}

/**
 * Returns the major version number of a semver-ish string, or null if none.
 * @param {string} v
 * @returns {number|null}
 */
function majorOf(v) {
  const m = /^(\d+)\./.exec(v);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Checks if an installed version is affected by a GitHub advisory.
 * Parses the advisory's vulnerabilities[].vulnerable_version_range field
 * (which may contain MULTIPLE OR'd branches) and checks whether the
 * installed version satisfies ANY branch.
 *
 * Cross-major protection: a branch with an explicit LOWER bound
 * (e.g. ">= 5.0.0 < 5.1.0") is scoped to that major line only — it cannot flag a
 * 4.x install. An OPEN upper bound ("< 5.1.0" with no lower) stays global/cross-major
 * (GitHub's real semantics; required so "uuid < 14.0.0" still flags 11.x).
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
  const installedMajor = majorOf(cleanVersion);

  for (const vuln of advisory.vulnerabilities) {
    // Filter to npm ecosystem and matching package name
    if (!vuln.package || vuln.package.ecosystem !== 'npm') continue;
    if (vuln.package.name !== packageName) continue;

    const range = vuln.vulnerable_version_range;
    if (!range || typeof range !== 'string') continue;

    const branches = splitAdvisoryBranches(range);

    for (const branch of branches) {
      let branchRange;

      try {
        // semver.satisfies needs a parseable range; a lone upper bound like
        // "< 5.1.0" parses fine. A malformed branch is skipped.
        branchRange = new semver.Range(branch);
      } catch {
        continue;
      }

      // Determine the branch's major line. Major scoping applies ONLY when the
      // branch has an explicit LOWER bound (e.g. ">= 5.0.0 < 5.1.0" → 5.x only).
      // An OPEN upper bound ("< 5.1.0" with no lower) stays global/cross-major —
      // that is GitHub's real semantics and is required for legitimate advisories
      // like "uuid < 14.0.0" (covers 11.x/12.x/13.x). Scoping open bounds to a
      // single major would silently DROP real findings.
      // (No backslash escapes in the regex to avoid tool double-escaping.)
      const lowerTok = branch.match(/>=? *([0-9]+\.[0-9]+\.[0-9]+)/);
      const branchMajor = lowerTok && majorOf(lowerTok[1]) != null ? majorOf(lowerTok[1]) : null;

      // Cross-major guard: only when this branch is explicitly lower-bounded to a
      // major line. An installed version on a different major cannot match it.
      if (installedMajor != null && branchMajor != null && installedMajor !== branchMajor) {
        continue;
      }

      try {
        if (semver.satisfies(cleanVersion, branchRange)) {
          // Version is within a vulnerable branch — but check if it's already patched.
          // GitHub patched_versions may be a single version OR an OR-list of
          // per-branch fixes (e.g. "4.22.0 || 5.1.0"). Pick the fix whose major
          // matches THIS branch's major line; an unrelated branch's fix (e.g. a
          // 4.x fix for a 5.x install) must not suppress a real match.
          const patchedRaw = vuln.patched_versions;
          if (patchedRaw && typeof patchedRaw === 'string') {
            const patchedCleaned = patchedRaw.replace(/^>=\s*/, '').trim();
            const patchedCoerced = coercePatchedForMajor(patchedCleaned, branchMajor);
            if (patchedCoerced && semver.gte(cleanVersion, patchedCoerced.version)) {
              continue; // already patched
            }
          }
          const fpv = vuln.first_patched_version;
          const fpvStr = fpv && typeof fpv === 'object' ? fpv.identifier : fpv;
          if (fpvStr && typeof fpvStr === 'string') {
            const fpvCoerced = coercePatchedForMajor(
              fpvStr.replace(/^>=\s*/, '').trim(),
              branchMajor
            );
            if (fpvCoerced && semver.gte(cleanVersion, fpvCoerced.version)) {
              continue; // already patched
            }
          }
          return true;
        }
      } catch {
        // If range parsing fails, skip this branch
        continue;
      }
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

    // A fix must move forward. Multi-branch advisories carry open-ended ranges
    // (e.g. ">=0.31.1" patched "0.33.0" AND ">=1.15.1" patched "1.18.0"); an
    // installed 1.x version satisfies BOTH, so without this guard we'd pick the
    // lower 0.x fix and recommend a major-version downgrade.
    if (cleanVersion && semver.lte(version, cleanVersion)) continue;

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

/**
 * Returns true when a raw GitHub advisory has been withdrawn or rejected by its
 * author. GitHub signals retraction two ways, and BOTH must be handled:
 *
 *  1. Structured (spec-compliant): `withdrawn_at` timestamp and/or
 *     `state: "WITHDRAWN"`.
 *  2. Textual (feed quirk): in the package-affected feed GitHub sometimes keeps
 *     a retracted advisory at `state: "published"` with `withdrawn_at: null`,
 *     surfacing the retraction only in the summary text (e.g. express
 *     GHSA-pj86: "REJECTED (not a vulnerability): ...", or "Withdrawn
 *     Advisory: ..."). The structured fields are blank there, so we must also
 *     match the known GitHub phrasing to avoid reporting a retracted finding.
 *
 * @param {object} advisory - Raw GitHub advisory object
 * @returns {boolean}
 */
function isAdvisoryWithdrawn(advisory) {
  if (!advisory || typeof advisory !== 'object') return false;
  if (advisory.withdrawn_at) return true;
  if (typeof advisory.state === 'string' && advisory.state.toUpperCase() === 'WITHDRAWN')
    return true;
  const summary = typeof advisory.summary === 'string' ? advisory.summary.toLowerCase() : '';
  if (/rejected \(not a vulnerability\)/.test(summary)) return true;
  if (/^withdrawn advisory/.test(summary)) return true;
  return false;
}

async function query(pkg, signal) {
  if (!pkg || !pkg.name || !pkg.version) return [];

  try {
    // ─── PHASE 1: Global Advisory DB (existing behavior) ───
    const advisories = await queryGitHubAdvisoryByPackage(pkg.name, signal);

    // ─── PHASE 2: Version matching on global results ───
    const results = [];
    if (advisories && advisories.length > 0) {
      for (const advisory of advisories) {
        if (isAdvisoryWithdrawn(advisory)) continue;
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
    // Always attempt (token only affects rate limit / 401 handling, not whether
    // we try). Without a token the endpoint 401s and we degrade to [] — but the
    // coverage reduction is recorded in result.metadata by the orchestrator so
    // results stay reproducible-per-config instead of silently differing.
    if (results.length === 0) {
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
            if (isAdvisoryWithdrawn(advisory)) continue;
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
              url: advisory.html_url || (ghsaId ? `https://github.com/advisories/${ghsaId}` : null),
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
  splitAdvisoryBranches,
  majorOf,
  coercePatchedForMajor,
};
