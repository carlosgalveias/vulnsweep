/**
 * VulnSweep - Package.json Updater Module
 *
 * Generates package.json modifications based on fix strategies.
 * Handles direct dependency updates, parent dependency updates, and npm overrides.
 */

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
        changes.push({
          type: 'UPDATE_DIRECT',
          location: 'dependencies',
          package: pkgName,
          from: currentPackageJson.dependencies[pkgName],
          to: targetVersion,
        });
      } else if (modifiedPackageJson.devDependencies[pkgName]) {
        modifiedPackageJson.devDependencies[pkgName] = targetVersion;
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
        changes.push({
          type: 'UPDATE_PARENT',
          location: 'dependencies',
          package: parentPackage,
          from: currentPackageJson.dependencies[parentPackage],
          to: targetVersion,
        });
      } else if (modifiedPackageJson.devDependencies[parentPackage]) {
        modifiedPackageJson.devDependencies[parentPackage] = targetVersion;
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
};
