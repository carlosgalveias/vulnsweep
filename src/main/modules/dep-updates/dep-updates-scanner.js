'use strict';

/**
 * VulnSweep — Dependency Updates (F13)
 * Dependency Updates Scanner
 *
 * Scans a root folder's child repos for available dependency updates by:
 *   1. Discovering all immediate subdirectories that contain a package.json
 *      (exactly like discovery.js does for the audit scanner).
 *   2. Falling back to treating the root folder itself as a single repo when it
 *      directly contains a package.json (single-repo usage).
 *   3. For each discovered repo, fetching registry versions and building an
 *      UpdateCandidate list.
 *   4. Returning a grouped Array<RepoUpdateResult> instead of a flat array.
 *
 * applyUpdates() accepts updates with a `repoPath` field so that `npm install`
 * and the git commit are scoped to the correct repo subdirectory.
 *
 * Exports:
 *   scanDependencyUpdates(projectPath, progressCallback) → Promise<Result<RepoUpdateResult[]>>
 *   applyUpdates(projectPath, updates)                   → Promise<Result<{ commitMessages: string[] }>>
 *
 * @module modules/dep-updates/dep-updates-scanner
 */

const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { promisify } = require('util');
const semver = require('semver');
const { DEP_UPDATES_CONFIG, GIT_CONFIG } = require('../../config/constants');
const RegistryCache = require('../../utils/registry-cache');
const { createSuccess, createError } = require('../../utils/result');
const {
  filterNewerVersions,
  selectRecommendedVersion,
  computeRiskLevel,
} = require('./version-comparator');

/** Promisified exec for npm commands — uses the shell, which is required on Windows for npm (a .cmd script). */
const execAsync = promisify(exec);

/**
 * Module-level RegistryCache singleton (default 5-minute TTL).
 * Separate from the one in audit.js — clearing one does not affect the other.
 */
const registryCache = new RegistryCache();

// ---------------------------------------------------------------------------
// TypeDefs
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} UpdateCandidate
 * @property {string}   name               - Package name e.g. "lodash"
 * @property {string}   currentVersion     - Installed version from node_modules/<name>/package.json#version.
 *                                           Fallback: raw specifier from package.json if node_modules absent.
 * @property {string[]} availableVersions  - Sorted ascending semver strings strictly > currentVersion.
 *                                           Capped to DEP_UPDATES_CONFIG.MAX_VERSIONS_SHOWN newest entries.
 * @property {string|null} recommendedVersion - Highest same-major version; if none, highest overall.
 * @property {string|null} selectedVersion    - User choice; initialised = recommendedVersion.
 * @property {'Low'|'High'|null} riskLevel    - Low = same-major; High = cross-major; null if no recommendation.
 * @property {'dependencies'|'devDependencies'} depType
 */

/**
 * @typedef {Object} RepoUpdateResult
 * @property {string}           repoPath   - Absolute path to the repo subdirectory.
 * @property {string}           repoName   - Basename of the repo subdirectory.
 * @property {UpdateCandidate[]} candidates - Update candidates for this repo.
 */

/**
 * @typedef {Object} ApplyUpdate
 * @property {string} name        - Package name
 * @property {string} fromVersion - Installed version at scan time
 * @property {string} toVersion   - Target version chosen by user
 * @property {string} repoPath    - Absolute path to the repo where the update must be applied
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all published version strings for a package from the npm registry.
 * Uses Node.js built-in `https` only (no node-fetch / axios).
 * Returns `null` on 404 or any network / parse error — never throws.
 *
 * @param {string} packageName - npm package name (scoped names are supported).
 * @returns {Promise<string[]|null>} Array of version strings, or null on failure.
 */
function fetchAllVersionsFromRegistry(packageName) {
  return new Promise((resolve) => {
    const url = `${DEP_UPDATES_CONFIG.REGISTRY_URL}/${encodeURIComponent(packageName)}`;

    const req = https.get(url, { timeout: DEP_UPDATES_CONFIG.FETCH_TIMEOUT_MS }, (res) => {
      // 404 → package not found in registry
      if (res.statusCode === 404) {
        resolve(null);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(Object.keys(body.versions || {}));
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => {
        req.destroy();
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Check whether a directory contains a readable package.json.
 * Mirrors discovery.js's validateProject() logic exactly.
 *
 * @param {string} dirPath - Absolute path to the directory.
 * @returns {Promise<boolean>}
 */
async function hasPackageJson(dirPath) {
  try {
    await fs.promises.access(path.join(dirPath, 'package.json'), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover all immediate child subdirectories of baseDirectory that contain
 * a package.json. Mirrors the exact pattern used in discovery.js
 * discoverProjects() — reads directory entries, filters to directories,
 * checks each for package.json existence.
 *
 * @param {string} baseDirectory - Root folder to scan.
 * @returns {Promise<Array<{repoPath: string, repoName: string}>>}
 *   Array of discovered repos; empty when none found or on error.
 */
async function discoverRepoDirs(baseDirectory) {
  const repos = [];

  let entries;
  try {
    entries = await fs.promises.readdir(baseDirectory, { withFileTypes: true });
  } catch {
    return repos;
  }

  // Filter to only immediate subdirectories (same as discovery.js)
  const directories = entries.filter((entry) => entry.isDirectory());

  for (const dir of directories) {
    const repoPath = path.join(baseDirectory, dir.name);
    if (await hasPackageJson(repoPath)) {
      repos.push({ repoPath, repoName: dir.name });
    }
  }

  return repos;
}

/**
 * Scan a single repo's direct deps for available updates.
 * @param {string}   repoPath - Absolute path to the repo directory.
 * @param {Function|null} progressCallback - Optional progress reporter.
 * @param {string}   repoName - Human-readable name for progress.
 * @param {number}   baseOffset - Progress counter offset across repos.
 * @param {number}   globalTotal - Total package count across all repos.
 * @returns {Promise<UpdateCandidate[]>}
 */
async function scanSingleRepo(repoPath, progressCallback, repoName, baseOffset, globalTotal) {
  let pkg;
  try {
    const raw = await fs.promises.readFile(path.join(repoPath, 'package.json'), 'utf8');
    pkg = JSON.parse(raw);
  } catch {
    return [];
  }
  const directDeps = [
    ...Object.keys(pkg.dependencies || {}).map((name) => ({ name, depType: 'dependencies' })),
    ...Object.keys(pkg.devDependencies || {}).map((name) => ({ name, depType: 'devDependencies' })),
  ];
  if (directDeps.length === 0) return [];
  const candidates = [];
  for (let i = 0; i < directDeps.length; i++) {
    const { name, depType } = directDeps[i];
    if (typeof progressCallback === 'function') {
      progressCallback({
        current: baseOffset + i + 1,
        total: globalTotal,
        repoName,
        packageName: name,
      });
    }
    let installedVersion;
    try {
      const nmPkgRaw = await fs.promises.readFile(
        path.join(repoPath, 'node_modules', name, 'package.json'),
        'utf8'
      );
      installedVersion = JSON.parse(nmPkgRaw).version;
    } catch {
      const declaredVersion = (pkg[depType] || {})[name] || '';
      installedVersion = semver.coerce(declaredVersion)?.version ?? declaredVersion;
    }
    let cacheResult;
    try {
      cacheResult = await registryCache.getAllVersions(name, () =>
        fetchAllVersionsFromRegistry(name)
      );
    } catch {
      continue;
    }
    if (!cacheResult.success) continue;
    let newerVersions = filterNewerVersions(installedVersion, cacheResult.content);
    if (newerVersions.length === 0) continue;
    newerVersions = newerVersions.slice(-DEP_UPDATES_CONFIG.MAX_VERSIONS_SHOWN);
    const recommendedVersion = selectRecommendedVersion(installedVersion, newerVersions);
    if (!recommendedVersion) continue;
    candidates.push({
      name,
      currentVersion: installedVersion,
      availableVersions: newerVersions,
      recommendedVersion,
      selectedVersion: recommendedVersion,
      riskLevel: computeRiskLevel(installedVersion, recommendedVersion),
      depType,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Exported: scanDependencyUpdates
// ---------------------------------------------------------------------------

/**
 * Scan a project root for dependency updates across all discovered repos.
 *
 * Discovery logic mirrors discovery.js exactly:
 *   - If root has immediate child subdirs with package.json -> multi-repo mode.
 *   - Else if root itself has package.json -> single-repo mode.
 *   - Else -> return empty array (no error).
 *
 * @param {string}   projectPath - Absolute path to root folder selected by user.
 * @param {Function} [progressCallback] - Optional ({ current, total, repoName, packageName }) => void.
 * @returns {Promise<{success: boolean, content?: RepoUpdateResult[], error?: string}>}
 */
async function scanDependencyUpdates(projectPath, progressCallback) {
  const rootHasPkg = await hasPackageJson(projectPath);
  const childRepos = await discoverRepoDirs(projectPath);

  let repos;
  if (childRepos.length > 0) {
    repos = childRepos;
  } else if (rootHasPkg) {
    repos = [{ repoPath: projectPath, repoName: path.basename(projectPath) }];
  } else {
    return createSuccess([]);
  }

  // Pre-count total dependencies for accurate global progress reporting
  const depCounts = await Promise.all(
    repos.map(async ({ repoPath }) => {
      try {
        const pkg = JSON.parse(
          await fs.promises.readFile(path.join(repoPath, 'package.json'), 'utf8')
        );
        return (
          Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length
        );
      } catch {
        return 0;
      }
    })
  );
  const globalTotal = depCounts.reduce((sum, n) => sum + n, 0);

  const results = [];
  let baseOffset = 0;

  for (let i = 0; i < repos.length; i++) {
    const { repoPath, repoName } = repos[i];
    const candidates = await scanSingleRepo(
      repoPath,
      progressCallback,
      repoName,
      baseOffset,
      globalTotal
    );
    results.push({ repoPath, repoName, candidates });
    baseOffset += depCounts[i];
  }

  return createSuccess(results);
}

// ---------------------------------------------------------------------------
// Exported: applyUpdates
// ---------------------------------------------------------------------------

/**
 * Apply selected dependency updates across one or more repos.
 *
 * Runs `npm install --save <pkg>@<version>` in the correct repo subdirectory
 * for each update. Does NOT perform any git operations — the user triggers
 * Commit & Push separately via the existing app flow, using the returned
 * commitMessage as the pre-filled commit message.
 *
 * @param {string}      projectPath - Root folder path (used as fallback repoPath).
 * @param {ApplyUpdate[]} updates   - Updates to apply; each must have repoPath.
 * @returns {Promise<{success: boolean, content?: {commitMessage: string}, error?: string}>}
 */
async function applyUpdates(projectPath, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return createError('No updates provided');
  }

  // Group updates by repoPath — one npm install per repo
  const byRepo = new Map();
  for (const update of updates) {
    const rp = update.repoPath || projectPath;
    if (!byRepo.has(rp)) byRepo.set(rp, []);
    byRepo.get(rp).push(update);
  }

  const allUpdatedLabels = [];

  for (const [repoPath, repoUpdates] of byRepo) {
    // Build "npm install --save pkg@version ..." as a shell command string.
    // exec() uses the shell by default, which is required on Windows where npm
    // is a .cmd script. Package names and semver versions are shell-safe characters.
    const pkgList = repoUpdates.map((u) => `${u.name}@${u.toVersion}`).join(' ');
    const npmCmd = `npm install --save ${pkgList}`;

    try {
      await execAsync(npmCmd, { cwd: repoPath, encoding: 'utf8' });
    } catch (err) {
      return createError(`npm install failed: ${err.message}`);
    }

    for (const u of repoUpdates) {
      allUpdatedLabels.push(`${u.name}@${u.toVersion}`);
    }
  }

  let commitMessage = `chore: update ${allUpdatedLabels.join(', ')}`;
  if (commitMessage.length > GIT_CONFIG.MESSAGE_MAX_LENGTH) {
    commitMessage = commitMessage.substring(0, GIT_CONFIG.MESSAGE_MAX_LENGTH);
  }

  return createSuccess({ commitMessage });
}

module.exports = { scanDependencyUpdates, applyUpdates };
