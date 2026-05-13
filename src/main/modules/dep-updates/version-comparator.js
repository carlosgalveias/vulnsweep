'use strict';

/**
 * VulnSweep — Dependency Updates (F13)
 * Version Comparator Utilities
 *
 * Pure synchronous functions for semver comparison, version filtering,
 * recommended version selection, and risk level computation.
 * No I/O, no async, no VulnSweep imports — depends only on `semver`.
 *
 * @module modules/dep-updates/version-comparator
 */

const semver = require('semver');

/**
 * Filter `allVersions` to those strictly greater than `currentVersion`,
 * excluding pre-release versions, sorted ascending by semver order.
 *
 * @param {string} currentVersion - The currently installed version (may include range prefix).
 * @param {string[]} allVersions  - All version strings from the registry.
 * @returns {string[]} Sorted ascending array of valid, stable, newer versions.
 */
function filterNewerVersions(currentVersion, allVersions) {
  const coercedCurrent = semver.coerce(currentVersion);
  if (!coercedCurrent) {
    return [];
  }

  const newer = [];
  for (const entry of allVersions) {
    // Skip unparseable versions
    if (!semver.valid(entry)) continue;
    // Skip pre-release versions (alpha, beta, rc, etc.)
    if (semver.prerelease(entry) !== null) continue;
    // Include only versions strictly greater than current
    if (semver.gt(entry, coercedCurrent)) {
      newer.push(entry);
    }
  }

  // Sort ascending so newest is last (index -1)
  newer.sort((a, b) => semver.compare(a, b));
  return newer;
}

/**
 * Select the recommended update version from a pre-filtered list of newer versions.
 *
 * Strategy:
 * 1. If no newer versions exist, return null.
 * 2. If current version cannot be coerced, return the newest overall version.
 * 3. Prefer the newest same-major version (patch/minor updates — lower risk).
 * 4. Fallback to the newest overall version (major bump — higher risk).
 *
 * @param {string}   currentVersion  - The currently installed version.
 * @param {string[]} newerVersions   - Pre-filtered, ascending-sorted newer versions.
 * @returns {string|null} The recommended version string, or null if none available.
 */
function selectRecommendedVersion(currentVersion, newerVersions) {
  if (newerVersions.length === 0) {
    return null;
  }

  const coercedCurrent = semver.coerce(currentVersion);
  if (!coercedCurrent) {
    // Cannot parse current — return newest overall as best guess
    return newerVersions[newerVersions.length - 1];
  }

  const currentMajor = semver.major(coercedCurrent);

  // Collect all versions sharing the same major
  const sameMajorVersions = newerVersions.filter((v) => semver.major(v) === currentMajor);

  if (sameMajorVersions.length > 0) {
    // Return newest within same major (last element after ascending sort)
    return sameMajorVersions[sameMajorVersions.length - 1];
  }

  // No same-major version available — return newest overall (cross-major bump)
  return newerVersions[newerVersions.length - 1];
}

/**
 * Compute the risk level of updating from `currentVersion` to `recommendedVersion`.
 *
 * - `'Low'`  — same major version (patch or minor bump; generally backwards-compatible).
 * - `'High'` — different major versions, or either version is null/unparseable.
 *
 * @param {string|null|undefined} currentVersion     - The currently installed version.
 * @param {string|null|undefined} recommendedVersion - The target version.
 * @returns {'Low'|'High'} Risk classification.
 */
function computeRiskLevel(currentVersion, recommendedVersion) {
  if (!currentVersion || !recommendedVersion) {
    return 'High';
  }

  const coercedCurrent = semver.coerce(currentVersion);
  const coercedRecommended = semver.coerce(recommendedVersion);

  if (!coercedCurrent || !coercedRecommended) {
    return 'High';
  }

  return semver.major(coercedCurrent) === semver.major(coercedRecommended) ? 'Low' : 'High';
}

module.exports = {
  filterNewerVersions,
  selectRecommendedVersion,
  computeRiskLevel,
};
