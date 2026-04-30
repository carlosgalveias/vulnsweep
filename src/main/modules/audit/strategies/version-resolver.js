/**
 * VulnSweep - Version Resolution Module
 *
 * Handles all version resolution logic including:
 * - Fetching latest versions from npm registry
 * - Fetching all available versions
 * - Reading installed versions from package-lock.json
 * - Finding safe versions outside vulnerable ranges
 * - Determining safe versions based on vulnerability patterns
 *
 * Uses registry caching to improve performance during multi-project scans.
 *
 * Fix strategy for vulnerable ranges:
 *   The safe version is always the MINIMUM published version that does NOT satisfy
 *   the vulnerable range. For example, if the vulnerable range is "<14.0.0", the
 *   complement (safe) range is ">=14.0.0", and we use semver.minSatisfying() against
 *   the full list of published versions to find the lowest actually-published safe version.
 *
 *   This avoids two past bugs:
 *   (A) Returning a version string that is not actually published on npm
 *   (B) Returning the FIRST version satisfying the VULNERABLE range (e.g., "1.1.0")
 *       instead of the first version OUTSIDE it
 */

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const semver = require('semver');
const { CACHE_CONFIG, API_CONFIG } = require('../../../config/constants');
const RegistryCache = require('../../../utils/registry-cache');

const execAsync = promisify(exec);

// Create singleton cache instance for npm registry responses
// TTL configured in constants to balance freshness and performance
const registryCache = new RegistryCache(CACHE_CONFIG.TTL_MS);

/**
 * Internal function to fetch latest version directly from npm registry (bypasses cache)
 * @param {string} packageName - Package name
 * @returns {Promise<string|null>} - Latest version or null if fetch fails
 */
async function fetchLatestSafeVersionDirect(packageName) {
  try {
    // Use npm view to get latest version
    const { stdout } = await execAsync(`npm view ${packageName} version`, {
      encoding: 'utf8',
      timeout: API_CONFIG.NPM_COMMAND_TIMEOUT_MS,
      maxBuffer: API_CONFIG.MAX_BUFFER_BYTES,
    });
    const version = stdout.trim();
    return version;
  } catch (error) {
    console.warn(`[audit] Failed to fetch latest version for ${packageName}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch latest version of a package from npm registry (with caching)
 * @param {string} packageName - Package name
 * @returns {Promise<string|null>} - Latest version or null if fetch fails
 */
async function fetchLatestSafeVersion(packageName) {
  const result = await registryCache.getLatestVersion(packageName, fetchLatestSafeVersionDirect);
  if (!result.success) {
    return null;
  }
  return result.content;
}

/**
 * Internal function to fetch all versions directly from npm registry (bypasses cache)
 * @param {string} packageName - Package name
 * @returns {Promise<string[]|null>} - Array of version strings or null if fetch fails
 */
async function fetchAllVersionsDirect(packageName) {
  try {
    const { stdout } = await execAsync(`npm view ${packageName} versions --json`, {
      encoding: 'utf8',
      timeout: API_CONFIG.NPM_COMMAND_TIMEOUT_MS,
      maxBuffer: API_CONFIG.MAX_BUFFER_BYTES,
    });
    const versions = JSON.parse(stdout);
    return versions;
  } catch (error) {
    console.warn(`[audit] Failed to fetch versions for ${packageName}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch all available versions of a package from npm registry (with caching)
 * @param {string} packageName - Package name
 * @returns {Promise<string[]|null>} - Array of version strings or null if fetch fails
 */
async function fetchAllVersions(packageName) {
  const result = await registryCache.getAllVersions(packageName, fetchAllVersionsDirect);
  if (!result.success) {
    return null;
  }
  return result.content;
}

/**
 * Read package-lock.json and extract installed version of a package
 * @param {string} projectPath - Absolute path to the project
 * @param {string} packageName - Package name
 * @returns {Promise<string|null>} - Installed version or null if not found
 */
async function getInstalledVersionFromLockfile(projectPath, packageName) {
  try {
    const lockfilePath = path.join(projectPath, 'package-lock.json');

    // Check if file exists using fs.access()
    try {
      await fs.access(lockfilePath);
    } catch {
      return null;
    }

    const lockfileContent = await fs.readFile(lockfilePath, 'utf8');
    const lockfile = JSON.parse(lockfileContent);

    // npm v7+ lockfile format
    if (lockfile.packages) {
      // Check in packages section
      for (const [pkgPath, pkgInfo] of Object.entries(lockfile.packages)) {
        if (
          pkgPath.endsWith(`/node_modules/${packageName}`) ||
          pkgPath === `node_modules/${packageName}`
        ) {
          return pkgInfo.version;
        }
      }
    }

    // npm v6 lockfile format
    if (lockfile.dependencies && lockfile.dependencies[packageName]) {
      return lockfile.dependencies[packageName].version;
    }

    return null;
  } catch (error) {
    console.warn(`[audit] Failed to read package-lock.json: ${error.message}`);
    return null;
  }
}

/**
 * Find the minimum published version of a package that satisfies `safeRange`.
 *
 * Uses semver.minSatisfying() against the full list of published versions to guarantee
 * the returned version actually exists on the npm registry, then validates it is not
 * a downgrade from the currently-installed version.
 *
 * @param {string} packageName   - Package name
 * @param {string} safeRange     - The SAFE semver range (complement of the vulnerable range)
 *                                 e.g. ">=14.0.0" when the vulnerable range is "<14.0.0"
 * @param {string|null} currentVersion - Currently installed version (may be null or 'unknown')
 * @returns {Promise<string|null>} - Minimum safe version string (e.g. "14.0.0"), or null
 */
async function findMinSafeVersion(packageName, safeRange, currentVersion = null) {
  try {
    const allVersions = await fetchAllVersions(packageName);
    if (!allVersions || allVersions.length === 0) {
      return null;
    }

    // Find the lowest published version that satisfies the safe range
    const minSafe = semver.minSatisfying(allVersions, safeRange);
    if (!minSafe) {
      return null;
    }

    // Reject if it would be a downgrade from the currently installed version
    if (currentVersion) {
      const cleanCurrent = semver.coerce(currentVersion);
      if (cleanCurrent && semver.lt(minSafe, cleanCurrent.version)) {
        return null;
      }
    }

    return minSafe;
  } catch (error) {
    console.warn(`[audit] Error finding minimum safe version for ${packageName}: ${error.message}`);
    return null;
  }
}

async function findSafeVersionOutsideRange(packageName, range, currentVersion = null) {
  try {
    if (currentVersion) {
      try {
        const cleanCurrent = semver.coerce(currentVersion);
        if (cleanCurrent && !semver.satisfies(cleanCurrent.version, range)) {
          return null;
        }
      } catch (err) {
        console.warn(
          `[audit] Could not validate current version ${currentVersion}: ${err.message}`
        );
      }
    }
    const allVersions = await fetchAllVersions(packageName);
    if (!allVersions || allVersions.length === 0) return null;
    const cleanRange = range.replace(/\s+/g, ' ');
    const cleanCurrent = currentVersion ? semver.coerce(currentVersion) : null;
    const patchCandidates = [];
    const minorCandidates = [];
    const majorCandidates = [];
    for (const version of allVersions) {
      try {
        if (semver.satisfies(version, cleanRange)) continue;
        if (cleanCurrent && !semver.gte(version, cleanCurrent.version)) continue;
        const cleanVersion = semver.coerce(version);
        if (!cleanVersion) continue;
        if (cleanCurrent) {
          if (
            cleanVersion.major === cleanCurrent.major &&
            cleanVersion.minor === cleanCurrent.minor
          ) {
            patchCandidates.push(version);
          } else if (cleanVersion.major === cleanCurrent.major) {
            minorCandidates.push(version);
          } else {
            majorCandidates.push(version);
          }
        } else {
          majorCandidates.push(version);
        }
      } catch {
        continue;
      }
    }
    if (patchCandidates.length > 0)
      return `^${patchCandidates.sort((a, b) => semver.compare(a, b))[0]}`;
    if (minorCandidates.length > 0)
      return `^${minorCandidates.sort((a, b) => semver.compare(a, b))[0]}`;
    if (majorCandidates.length > 0)
      return `^${majorCandidates.sort((a, b) => semver.compare(a, b))[0]}`;
    return null;
  } catch (error) {
    console.warn(`[audit] Error finding safe version for ${packageName}: ${error.message}`);
    return null;
  }
}

async function determineSafeVersion(packageName, range, currentVersion = null, projectPath = null) {
  // Pattern: >= X.Y.Z only — all versions are vulnerable, no fix possible
  if (/^>=\s*\d+\.\d+\.\d+$/.test(range)) {
    return null;
  }

  // Pattern 1: < X.Y.Z — safe range is >= X.Y.Z
  const ltMatch = range.match(/^<\s*(\d+\.\d+\.\d+)$/);
  if (ltMatch) {
    return findMinSafeVersion(packageName, `>=${ltMatch[1]}`, currentVersion);
  }

  // Pattern 2: <= X.Y.Z — safe range is > X.Y.Z
  const lteMatch = range.match(/^<=\s*(\d+\.\d+\.\d+)$/);
  if (lteMatch) {
    return findMinSafeVersion(packageName, `>${lteMatch[1]}`, currentVersion);
  }

  // Pattern 3: X.Y.Z[-prerelease] - A.B.C[-prerelease] (hyphen range, both ends inclusive)
  // The lower bound may contain a prerelease suffix (e.g. "40.0.0-alpha.2 - 40.8.4"), so
  // the left-side regex must allow optional prerelease/build-metadata segments.
  // We only need the UPPER bound (right side) to compute the safe range (> upper).
  // Guard: skip if this is an OR range — Pattern 4 handles those correctly per-segment.
  if (!range.includes('||')) {
    const hyphenMatch = range.match(
      /\d+\.\d+\.\d+(?:[-+][^\s]*)?\s*-\s*(\d+\.\d+\.\d+(?:[-+][^\s]*)?)/
    );
    if (hyphenMatch) {
      // Use the upper-bound version string directly; strip any prerelease for safe-range boundary
      const upperBound = semver.coerce(hyphenMatch[1]);
      if (upperBound) {
        return findMinSafeVersion(packageName, `>${upperBound.version}`, currentVersion);
      }
    }
  }

  // Pattern 4: OR ranges (||) — find the safe boundary of the segment containing currentVersion.
  // Also handles complex ranges with both > and <.
  if (range.includes('||') || (range.includes('>') && range.includes('<'))) {
    let installedVersion = currentVersion;
    if (!installedVersion && projectPath) {
      installedVersion = await getInstalledVersionFromLockfile(projectPath, packageName);
    }

    // Segment-aware path for OR ranges when we know the installed version
    if (range.includes('||') && installedVersion && semver.valid(semver.coerce(installedVersion))) {
      const coercedCurrent = semver.coerce(installedVersion).version;
      const segments = range.split('||').map((s) => s.trim());
      const matchingSegmentSafeBounds = [];

      for (const segment of segments) {
        let segmentSatisfied = false;
        try {
          segmentSatisfied = semver.satisfies(coercedCurrent, segment);
        } catch {
          // If semver can't parse the segment, skip it
        }
        if (!segmentSatisfied) continue;

        // Found a segment containing installedVersion — compute its safe boundary
        const hyphenSeg = segment.match(
          /^(\d+\.\d+\.\d+(?:[-+][^\s]*)?)\s*-\s*(\d+\.\d+\.\d+(?:[-+][^\s]*)?)$/
        );
        const lteSeg = segment.match(/^<=\s*(\d+\.\d+\.\d+)$/);
        const ltSeg = segment.match(/^<\s*(\d+\.\d+\.\d+)$/);
        const complexSeg = segment.match(/>=?\s*[\d.]+\s*<\s*(\d+\.\d+\.\d+)/);

        let safeRange = null;
        if (hyphenSeg) {
          const upperBound = semver.coerce(hyphenSeg[2]);
          safeRange = upperBound ? `>${upperBound.version}` : null;
        } else if (lteSeg) {
          safeRange = `>${lteSeg[1]}`;
        } else if (ltSeg) {
          safeRange = `>=${ltSeg[1]}`;
        } else if (complexSeg) {
          safeRange = `>=${complexSeg[1]}`;
        }

        if (safeRange) {
          const candidate = await findMinSafeVersion(packageName, safeRange, coercedCurrent);
          if (candidate) matchingSegmentSafeBounds.push(candidate);
        }
      }

      if (matchingSegmentSafeBounds.length > 0) {
        // Return the minimum candidate (prefer staying as close to current version as possible)
        return matchingSegmentSafeBounds.sort((a, b) => semver.compare(a, b))[0];
      }
    }

    // Fallback: no installedVersion, installedVersion matches no segment, or non-OR complex range
    return findSafeVersionOutsideRange(packageName, range, installedVersion);
  }

  // Pattern 5: =X.Y.Z or bare X.Y.Z (exact-version pinned — only that one version is vulnerable)
  const exactMatch = range.match(/^=\s*(\d+\.\d+\.\d+)$/) || range.match(/^(\d+\.\d+\.\d+)$/);
  if (exactMatch) {
    return findMinSafeVersion(packageName, `>${exactMatch[1]}`, currentVersion);
  }

  return null;
}

function clearCache() {
  registryCache.clear();
}

module.exports = {
  fetchLatestSafeVersion,
  fetchAllVersions,
  getInstalledVersionFromLockfile,
  findSafeVersionOutsideRange,
  determineSafeVersion,
  clearCache,
};
