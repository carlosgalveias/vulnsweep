/**
 * VulnSweep - Package Universe Builder
 *
 * Reads package-lock.json and builds a complete inventory of every installed package,
 * independent of npm audit. Supports lockfileVersion 1, 2, and 3.
 *
 * Exported API:
 *   buildPackageUniverse(projectPath)  -> Promise<PackageDescriptor[]>
 *   getUniqueQueryTargets(universe)    -> Array<{name, version}>
 *
 * @module scanner/package-universe-builder
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the package name from a lockfile packages-map key.
 *
 * Examples:
 *   "node_modules/lodash"                   -> "lodash"
 *   "node_modules/@babel/core"              -> "@babel/core"
 *   "node_modules/a/node_modules/b"         -> "b"
 *   "node_modules/a/node_modules/@scope/b"  -> "@scope/b"
 *
 * @param {string} key - Full lockfile packages-map key
 * @returns {string} Package name
 */
function extractNameFromKey(key) {
  const segments = key.split('node_modules/');
  // Last segment is the package name; scoped packages like "@scope/pkg" appear as-is
  return segments[segments.length - 1];
}

/**
 * Count the number of `node_modules/` occurrences in a lockfile key to derive depth.
 *   "node_modules/lodash"               -> 1
 *   "node_modules/a/node_modules/b"     -> 2
 *
 * Returns 0 when the key contains no `node_modules/` segment, which indicates a
 * malformed entry (the root `""` key is already filtered before this is called).
 *
 * @param {string} key - Full lockfile packages-map key
 * @returns {number} Depth (>= 1), or 0 for malformed keys
 */
function depthFromKey(key) {
  const matches = key.match(/node_modules\//g);
  return matches ? matches.length : 0;
}

/**
 * Builds a Set of all direct dependency names from package.json.
 * Includes peerDependencies because npm v7+ installs them automatically,
 * meaning they will appear in node_modules for applications (as opposed to libraries).
 *
 * @param {object} pkgJson - Parsed package.json object
 * @returns {Set<string>}
 */
function buildDirectDepSet(pkgJson) {
  const directNames = new Set();
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const field of depFields) {
    const deps = pkgJson[field];
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) {
        directNames.add(name);
      }
    }
  }
  return directNames;
}

// ---------------------------------------------------------------------------
// Lockfile v2/v3: packages flat-map strategy
// ---------------------------------------------------------------------------

/**
 * Build the package universe from a lockfile v2/v3 `packages` flat map.
 *
 * @param {Object} packagesMap - lockfileData.packages
 * @param {Set<string>} directDepNames - Names of direct dependencies from root package.json
 * @returns {Object[]} Array of PackageDescriptor objects
 */
function buildUniverseFromPackagesMap(packagesMap, directDepNames) {
  const universe = [];

  for (const [key, entry] of Object.entries(packagesMap)) {
    // Skip root project entry
    if (key === '') continue;

    // Skip symlinked packages (workspace links, local file: references)
    if (entry.link === true) continue;

    const lockfileDepth = depthFromKey(key);
    // lockfileDepth 0 means no node_modules/ segment — malformed entry, skip
    if (lockfileDepth === 0) continue;

    const name = extractNameFromKey(key);
    const version = entry.version || '';
    // Only depth-1 packages can be direct dependencies; nested instances of the
    // same package name must NOT inherit the isDirect flag.
    const isDirect = lockfileDepth === 1 && directDepNames.has(name);
    const isDevDep = entry.dev === true;
    const resolved = entry.resolved != null ? entry.resolved : null;

    universe.push({
      name,
      version,
      isDirect,
      lockfileDepth,
      lockfilePath: key,
      isDevDep,
      resolved,
    });
  }

  return universe;
}

// ---------------------------------------------------------------------------
// Lockfile v1: dependencies recursive tree strategy
// ---------------------------------------------------------------------------

/**
 * Recursively walk the v1 `dependencies` tree and collect PackageDescriptors.
 *
 * No runtime cycle detection is needed: `JSON.parse()` produces a plain acyclic
 * object graph by definition — cycles cannot exist in valid JSON. Threading a
 * visitedPaths Set through every recursive call would be dead code that also
 * incorrectly blocks diamond dependencies appearing at the same logical path in
 * separate branches.
 *
 * Defense-in-depth: the `maxDepth` parameter guards against unexpectedly deep
 * lockfiles (e.g. malformed or adversarially crafted files) causing a stack
 * overflow. The default of 10 is well above any real-world nesting depth.
 *
 * @param {Object} depsMap - The `dependencies` object at the current recursion level
 * @param {Set<string>} directDepNames - Names of direct dependencies from root package.json
 * @param {number} depth - Current depth (1 for root-level packages)
 * @param {string} pathPrefix - Accumulated path prefix for constructing lockfilePath
 * @param {number} [maxDepth=10] - Maximum recursion depth (defense-in-depth guard)
 * @returns {Object[]} Array of PackageDescriptor objects
 */
function walkV1Dependencies(depsMap, directDepNames, depth, pathPrefix, maxDepth = 10) {
  const universe = [];

  if (!depsMap || typeof depsMap !== 'object') {
    return universe;
  }

  // Defense-in-depth: bail out if nesting exceeds the sanity threshold
  if (depth > maxDepth) {
    return universe;
  }

  for (const [name, entry] of Object.entries(depsMap)) {
    // Construct the lockfilePath mirroring node_modules nesting
    const lockfilePath =
      pathPrefix === '' ? `node_modules/${name}` : `${pathPrefix}/node_modules/${name}`;

    const version = entry.version || '';
    // isDirect only applies to depth-1 packages; nested packages are never direct
    const isDirect = depth === 1 && directDepNames.has(name);
    const isDevDep = entry.dev === true;
    const resolved = entry.resolved != null ? entry.resolved : null;

    universe.push({
      name,
      version,
      isDirect,
      lockfileDepth: depth,
      lockfilePath,
      isDevDep,
      resolved,
    });

    // Recurse into nested dependencies if present
    if (entry.dependencies && typeof entry.dependencies === 'object') {
      const nested = walkV1Dependencies(
        entry.dependencies,
        directDepNames,
        depth + 1,
        lockfilePath,
        maxDepth
      );
      for (const pkg of nested) {
        universe.push(pkg);
      }
    }
  }

  return universe;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read package-lock.json at the given project path and build a complete inventory
 * of all installed packages as PackageDescriptor objects.
 *
 * Throws a descriptive Error if:
 *   - package-lock.json does not exist at projectPath
 *   - package-lock.json contains invalid JSON
 *
 * Returns an empty array gracefully if:
 *   - The lockfile's packages/dependencies map is present but empty
 *   - package.json is missing (isDirect defaults to false for all packages)
 *
 * For lockfileVersion 2 or 3, the `packages` map is used exclusively.
 * For lockfileVersion 1, the `dependencies` tree is walked recursively.
 *
 * @param {string} projectPath - Absolute path to the project directory
 * @returns {Promise<Object[]>} Resolves to PackageDescriptor[]
 */
async function buildPackageUniverse(projectPath) {
  const lockfilePath = path.join(projectPath, 'package-lock.json');

  // Read and parse the lockfile — throw descriptively on missing or invalid JSON
  let lockfileContent;
  try {
    lockfileContent = await fs.readFile(lockfilePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`package-lock.json not found at ${lockfilePath}`);
    }
    throw err;
  }

  let lockfileData;
  try {
    lockfileData = JSON.parse(lockfileContent);
  } catch (err) {
    throw new Error(`package-lock.json at ${lockfilePath} contains invalid JSON: ${err.message}`);
  }

  const lockfileVersion = lockfileData.lockfileVersion || 1;

  // ---------------------------------------------------------------------------
  // Build the directDepNames set
  // ---------------------------------------------------------------------------

  // For v2/v3: prefer the packages[""] entry (already contains dep fields)
  // For v1: fall back to reading package.json from disk
  let directDepNames = new Set();

  if (lockfileVersion >= 2 && lockfileData.packages && lockfileData.packages['']) {
    directDepNames = buildDirectDepSet(lockfileData.packages['']);
  } else {
    // Try to read package.json — if missing, directDepNames stays empty (isDirect = false)
    const pkgJsonPath = path.join(projectPath, 'package.json');
    try {
      const pkgJsonContent = await fs.readFile(pkgJsonPath, 'utf8');
      let pkgJson;
      try {
        pkgJson = JSON.parse(pkgJsonContent);
      } catch (parseErr) {
        // package.json exists but contains malformed JSON — user-actionable error.
        // Re-throw as a descriptive Error so callers can surface the problem.
        throw new Error(
          `package.json at ${pkgJsonPath} contains invalid JSON: ${parseErr.message}`
        );
      }
      directDepNames = buildDirectDepSet(pkgJson);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // package.json missing — gracefully continue with empty direct dep set.
        // All packages will have isDirect: false.
      } else {
        throw err; // Re-throw parse errors and any other unexpected errors
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dispatch to format-specific builder
  // ---------------------------------------------------------------------------

  if (lockfileVersion >= 2) {
    // v2 has both `packages` and `dependencies`; v3 has only `packages`
    // Prefer `packages` map (more reliable flat representation)
    const packagesMap = lockfileData.packages;
    if (!packagesMap || typeof packagesMap !== 'object') {
      return [];
    }
    return buildUniverseFromPackagesMap(packagesMap, directDepNames);
  }

  // lockfileVersion === 1: use dependencies recursive tree
  const depsMap = lockfileData.dependencies;
  if (!depsMap || typeof depsMap !== 'object') {
    return [];
  }

  return walkV1Dependencies(depsMap, directDepNames, 1, '');
}

// ---------------------------------------------------------------------------
// getUniqueQueryTargets
// ---------------------------------------------------------------------------

/**
 * Deduplicate a PackageDescriptor[] universe to unique (name, version) pairs.
 *
 * A package may appear multiple times in the universe when the same version is
 * installed at multiple nested paths. This function collapses those to a single
 * query target so external sources are queried exactly once per distinct pair.
 *
 * Deduplication key: `name + '@' + version`
 *
 * @param {Object[]} universe - PackageDescriptor[] from buildPackageUniverse()
 * @returns {Array<{name: string, version: string}>} Unique query targets
 */
function getUniqueQueryTargets(universe) {
  const seen = new Set();
  const targets = [];

  for (const pkg of universe) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ name: pkg.name, version: pkg.version });
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { buildPackageUniverse, getUniqueQueryTargets };
