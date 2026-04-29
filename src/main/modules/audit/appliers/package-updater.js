/**
 * VulnSweep - Package.json Updater Module
 *
 * Generates package.json modifications based on fix strategies.
 * Handles direct dependency updates, parent dependency updates, and npm overrides.
 */

/**
 * Sync the overrides section for a direct/parent dependency when its version changes.
 * If packageJson.overrides exists and contains pkgName, updates it to newVersion.
 * No-ops silently when overrides is absent or does not contain the package.
 * @param {Object} packageJson - Already deep-cloned package.json object (mutated in place)
 * @param {string} pkgName - Package name to synchronise
 * @param {string} newVersion - Resolved target version string (used verbatim)
 * @returns {Object} The (mutated) packageJson object
 */
function syncOverrideForDirectDep(packageJson, pkgName, newVersion) {
  if (packageJson.overrides && packageJson.overrides[pkgName] !== undefined) {
    packageJson.overrides[pkgName] = newVersion;
  }
  return packageJson;
}

/**
 * Generate package.json changes based on fix strategies
 * @param {Array} strategies - Array of strategy objects
 * @param {Object} currentPackageJson - Current package.json object
 * @returns {Object} { modifiedPackageJson: object, changes: array }
 */
function generatePackageJsonChanges(strategies, currentPackageJson) {
  const modifiedPackageJson = JSON.parse(JSON.stringify(currentPackageJson));
  const changes = [];

  // Ensure dependencies and devDependencies exist
  if (!modifiedPackageJson.dependencies) {
    modifiedPackageJson.dependencies = {};
  }
  if (!modifiedPackageJson.devDependencies) {
    modifiedPackageJson.devDependencies = {};
  }

  for (const strategy of strategies) {
    if (strategy.type === 'NO_FIX') {
      continue; // Skip strategies with no fix
    }

    if (strategy.type === 'UPDATE_DIRECT') {
      // Update direct dependency version
      const { package: pkgName, targetVersion } = strategy;

      if (modifiedPackageJson.dependencies[pkgName]) {
        modifiedPackageJson.dependencies[pkgName] = targetVersion;
        syncOverrideForDirectDep(modifiedPackageJson, pkgName, targetVersion);
        changes.push({
          type: 'UPDATE_DIRECT',
          location: 'dependencies',
          package: pkgName,
          from: currentPackageJson.dependencies[pkgName],
          to: targetVersion,
        });
      } else if (modifiedPackageJson.devDependencies[pkgName]) {
        modifiedPackageJson.devDependencies[pkgName] = targetVersion;
        syncOverrideForDirectDep(modifiedPackageJson, pkgName, targetVersion);
        changes.push({
          type: 'UPDATE_DIRECT',
          location: 'devDependencies',
          package: pkgName,
          from: currentPackageJson.devDependencies[pkgName],
          to: targetVersion,
        });
      }
    } else if (strategy.type === 'UPDATE_PARENT') {
      // Update parent dependency version
      const { parentPackage, targetVersion } = strategy;

      if (modifiedPackageJson.dependencies[parentPackage]) {
        modifiedPackageJson.dependencies[parentPackage] = targetVersion;
        syncOverrideForDirectDep(modifiedPackageJson, parentPackage, targetVersion);
        changes.push({
          type: 'UPDATE_PARENT',
          location: 'dependencies',
          package: parentPackage,
          from: currentPackageJson.dependencies[parentPackage],
          to: targetVersion,
        });
      } else if (modifiedPackageJson.devDependencies[parentPackage]) {
        modifiedPackageJson.devDependencies[parentPackage] = targetVersion;
        syncOverrideForDirectDep(modifiedPackageJson, parentPackage, targetVersion);
        changes.push({
          type: 'UPDATE_PARENT',
          location: 'devDependencies',
          package: parentPackage,
          from: currentPackageJson.devDependencies[parentPackage],
          to: targetVersion,
        });
      }
    } else if (strategy.type === 'ADD_OVERRIDE') {
      // Add npm override (npm v8+)
      const { package: pkgName, targetVersion } = strategy;

      if (!modifiedPackageJson.overrides) {
        modifiedPackageJson.overrides = {};
      }

      modifiedPackageJson.overrides[pkgName] = targetVersion;

      // Sync direct dep to the same version to prevent npm EOVERRIDE conflicts
      if (
        modifiedPackageJson.dependencies[pkgName] &&
        modifiedPackageJson.dependencies[pkgName] !== targetVersion
      ) {
        modifiedPackageJson.dependencies[pkgName] = targetVersion;
      } else if (
        modifiedPackageJson.devDependencies[pkgName] &&
        modifiedPackageJson.devDependencies[pkgName] !== targetVersion
      ) {
        modifiedPackageJson.devDependencies[pkgName] = targetVersion;
      }

      changes.push({
        type: 'ADD_OVERRIDE',
        location: 'overrides',
        package: pkgName,
        to: targetVersion,
      });
    }
  }

  return { modifiedPackageJson, changes };
}

// Export functions
module.exports = {
  generatePackageJsonChanges,
  syncOverrideForDirectDep,
};
