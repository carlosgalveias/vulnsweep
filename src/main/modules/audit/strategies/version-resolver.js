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
 * Find a safe version that's not in the vulnerable range
 * @param {string} packageName - Package name
 * @param {string} range - Vulnerable version range
 * @param {string} currentVersion - Current installed version (optional)
 * @returns {Promise<string|null>} - Safe version or null
 */
async function findSafeVersionOutsideRange(packageName, range, currentVersion = null) {
  try {
    // Check if current version is already safe (outside vulnerable range)
    if (currentVersion) {
      try {
        const cleanCurrent = semver.coerce(currentVersion);
        if (cleanCurrent && !semver.satisfies(cleanCurrent.version, range)) {
          return null; // No fix needed
        }
      } catch (error) {
        console.warn(
          `[audit] Could not validate current version ${currentVersion}: ${error.message}`
        );
      }
    }

    const allVersions = await fetchAllVersions(packageName);
    if (!allVersions || allVersions.length === 0) {
      return null;
    }

    const cleanRange = range.replace(/\s+/g, ' ');
    const cleanCurrent = currentVersion ? semver.coerce(currentVersion) : null;

    // Separate candidates by semantic distance from current version
    const patchCandidates = [];
    const minorCandidates = [];
    const majorCandidates = [];

    for (const version of allVersions) {
      try {
        const isOutsideRange = !semver.satisfies(version, cleanRange);

        // Skip if not safe or not an upgrade
        if (!isOutsideRange) continue;
        if (cleanCurrent && !semver.gte(version, cleanCurrent.version)) continue;

        const cleanVersion = semver.coerce(version);
        if (!cleanVersion) continue;

        if (cleanCurrent) {
          const currentMajor = cleanCurrent.major;
          const currentMinor = cleanCurrent.minor;
          const candidateMajor = cleanVersion.major;
          const candidateMinor = cleanVersion.minor;

          // Categorize by semantic distance
          if (candidateMajor === currentMajor && candidateMinor === currentMinor) {
            patchCandidates.push(version);
          } else if (candidateMajor === currentMajor) {
            minorCandidates.push(version);
          } else {
            majorCandidates.push(version);
          }
        } else {
          // No current version to compare against, treat as major
          majorCandidates.push(version);
        }
      } catch {
        // Skip invalid versions
        continue;
      }
    }

    // Try patch candidates first (minimal change)
    if (patchCandidates.length > 0) {
      const minVersion = patchCandidates.sort((a, b) => semver.compare(a, b))[0];
      return `^${minVersion}`;
    }

    // Then try minor candidates
    if (minorCandidates.length > 0) {
      const minVersion = minorCandidates.sort((a, b) => semver.compare(a, b))[0];
      return `^${minVersion}`;
    }

    // Finally try major candidates
    if (majorCandidates.length > 0) {
      const minVersion = majorCandidates.sort((a, b) => semver.compare(a, b))[0];
      return `^${minVersion}`;
    }

    return null;
  } catch (error) {
    console.warn(`[audit] Error finding safe version for ${packageName}: ${error.message}`);
    return null;
  }
}

/**
 * Parse vulnerability range and determine safe version
 * @param {string} packageName - Package name
 * @param {string} range - Version range from vulnerability (e.g., "< 6.14.0", "<= 1.1.0", "5.0.0 - 5.2.1")
 * @param {string} currentVersion - Current installed version (optional)
 * @param {string} projectPath - Project path for lockfile lookup (optional)
 * @returns {Promise<string|null>} - Safe version to use, or null if cannot determine
 */
async function determineSafeVersion(packageName, range, currentVersion = null, projectPath = null) {
  // Pattern: >= X.Y.Z (all versions from X.Y.Z onwards are vulnerable - NO FIX)
  const greaterThanEqualMatch = range.match(/^>=\s*(\d+\.\d+\.\d+)$/);
  if (greaterThanEqualMatch) {
    return null; // No safe version available
  }

  // Pattern 1: < X.Y.Z (less than)
  const lessThanMatch = range.match(/^<\s*(\d+\.\d+\.\d+)$/);

  if (lessThanMatch) {
    const version = lessThanMatch[1];
    const safeVersion = `^${version}`;

    // Validate that the recommended version is >= currentVersion
    if (currentVersion) {
      try {
        const cleanCurrent = semver.coerce(currentVersion);
        const cleanRecommended = semver.coerce(version);
        if (cleanCurrent && cleanRecommended) {
          if (semver.lt(cleanRecommended.version, cleanCurrent.version)) {
            return null;
          }
        }
      } catch (error) {
        console.warn(`[audit] Could not compare versions: ${error.message}`);
      }
    }

    return safeVersion;
  }

  // Pattern 2: <= X.Y.Z (less than or equal)
  const lessThanEqualMatch = range.match(/^<=\s*(\d+\.\d+\.\d+)$/);
  if (lessThanEqualMatch) {
    const latestVersion = await fetchLatestSafeVersion(packageName);

    // Validate that the latest version is >= currentVersion
    if (latestVersion && currentVersion) {
      try {
        const cleanCurrent = semver.coerce(currentVersion);
        const cleanLatest = semver.coerce(latestVersion);
        if (cleanCurrent && cleanLatest) {
          if (semver.lt(cleanLatest.version, cleanCurrent.version)) {
            return null;
          }
        }
      } catch (error) {
        console.warn(`[audit] Could not compare versions: ${error.message}`);
      }
    }

    return latestVersion;
  }

  // Pattern 3: X.Y.Z - A.B.C (range pattern)
  const rangeMatch = range.match(/\d+\.\d+\.\d+\s*-\s*\d+\.\d+\.\d+/);
  if (rangeMatch) {
    const latestVersion = await fetchLatestSafeVersion(packageName);

    // Validate that the latest version is >= currentVersion
    if (latestVersion && currentVersion) {
      try {
        const cleanCurrent = semver.coerce(currentVersion);
        const cleanLatest = semver.coerce(latestVersion);
        if (cleanCurrent && cleanLatest) {
          if (semver.lt(cleanLatest.version, cleanCurrent.version)) {
            return null;
          }
        }
      } catch (error) {
        console.warn(`[audit] Could not compare versions: ${error.message}`);
      }
    }

    return latestVersion;
  }

  // Pattern 4: Complex ranges with || or multiple conditions
  // Examples: ">=5.0.0 <5.2.3 || <4.12.3", ">1.0.0 <2.0.0 || >3.0.0"
  if (range.includes('||') || (range.includes('>') && range.includes('<'))) {
    // Use provided currentVersion or get from package-lock.json
    let installedVersion = currentVersion;
    if (!installedVersion && projectPath) {
      installedVersion = await getInstalledVersionFromLockfile(projectPath, packageName);
    }

    // Try to find a safe version outside the vulnerable range
    return await findSafeVersionOutsideRange(packageName, range, installedVersion);
  }

  return null;
}

/**
 * Clear the registry cache
 * Should be called ONCE at the start of a scan session (when user clicks "Scan"),
 * NOT per-project. This ensures fresh data for each scan while preserving cache
 * hits across all projects within the same session.
 */
function clearCache() {
  registryCache.clear();
}

// Export all functions
module.exports = {
  fetchLatestSafeVersion,
  fetchAllVersions,
  getInstalledVersionFromLockfile,
  findSafeVersionOutsideRange,
  determineSafeVersion,
  clearCache,
};
