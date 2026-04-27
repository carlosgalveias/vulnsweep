/**
 * VulnSweep - Fix Applier Module
 *
 * Orchestrates the application of vulnerability fixes by:
 * 1. Generating package.json modifications
 * 2. Backing up the original package.json
 * 3. Writing the modified package.json
 * 4. Running npm install to apply changes
 * 5. Verifying fixes with npm audit
 */

const fs = require('fs').promises;
const path = require('path');
const { createSuccess, createError } = require('../../../utils/result');
const { runNpmAudit } = require('../commands/npm-audit');
const { runNpmInstall } = require('../commands/npm-install');
const { parseVulnerabilities } = require('../parsers/vulnerability-parser');
const { generatePackageJsonChanges } = require('./package-updater');

/**
 * Increment the patch version of a semver version string
 * @param {string} version - Current version (e.g., "1.0.1")
 * @returns {string} Incremented version (e.g., "1.0.2")
 */
function incrementPatchVersion(version) {
  const parts = version.split('.');
  if (parts.length !== 3) {
    console.warn(`[audit] Invalid version format: ${version}`);
    return version; // Return unchanged if not valid semver
  }
  
  const [major, minor, patch] = parts;
  const newPatch = parseInt(patch, 10) + 1;
  
  return `${major}.${minor}.${newPatch}`;
}

/**
 * Apply fixes to a project by modifying package.json and running npm install
 * @param {string} projectPath - Absolute path to the project
 * @param {Array} strategies - Array of strategy objects
 * @returns {Promise<Object>} { success: boolean, applied: array, resolved: array, remaining: array }
 */
async function applyFixes(projectPath, strategies) {
  try {
    console.log(`[audit] Applying fixes to: ${projectPath}`);

    // Read current package.json
    const packageJsonPath = path.join(projectPath, 'package.json');

    // Check if file exists using fs.access()
    try {
      await fs.access(packageJsonPath);
    } catch {
      return createError('package.json not found', {
        applied: [],
        resolved: [],
        remaining: [],
      });
    }

    const currentPackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

    // Generate changes
    const { modifiedPackageJson, changes } = generatePackageJsonChanges(
      strategies,
      currentPackageJson
    );

    if (changes.length === 0) {
      return createSuccess({
        applied: [],
        resolved: [],
        remaining: strategies.filter((s) => s.type === 'NO_FIX'),
      });
    }

    // Backup original package.json
    const backupPath = path.join(projectPath, 'package.json.backup');
    await fs.writeFile(backupPath, JSON.stringify(currentPackageJson, null, 2));
    console.log(`[audit] Backed up package.json to ${backupPath}`);

    // Write modified package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(modifiedPackageJson, null, 2));
    console.log('[audit] Updated package.json');

    // Increment patch version after applying fixes
    if (modifiedPackageJson.version) {
      const oldVersion = modifiedPackageJson.version;
      modifiedPackageJson.version = incrementPatchVersion(oldVersion);
      
      // Write the updated package.json with new version
      await fs.writeFile(packageJsonPath, JSON.stringify(modifiedPackageJson, null, 2));
      
      console.log(
        `[audit] Bumped project version from ${oldVersion} to ${modifiedPackageJson.version}`
      );
    } else {
      console.warn('[audit] No version field found in package.json, skipping version bump');
    }

    // Run npm install to apply changes
    const installResult = await runNpmInstall(projectPath);
    if (!installResult.success) {
      // Restore backup on failure
      await fs.writeFile(packageJsonPath, JSON.stringify(currentPackageJson, null, 2));
      console.error('[audit] npm install failed, restored backup');
      return createError(installResult.error, {
        applied: changes,
        resolved: [],
        remaining: strategies,
      });
    }

    // Run npm audit again to verify fixes
    const auditResult = await runNpmAudit(projectPath);
    if (!auditResult.success) {
      console.warn('[audit] Could not verify fixes with npm audit');
      return createSuccess({
        applied: changes,
        resolved: [],
        remaining: [],
      });
    }

    // Compare vulnerabilities before and after
    const afterVulns = await parseVulnerabilities(auditResult.content.auditData, projectPath);
    const resolved = changes.map((c) => c.package);
    const remaining = afterVulns.filter((v) => !resolved.includes(v.package));

    console.log(
      `[audit] Applied ${changes.length} fixes, resolved ${resolved.length} vulnerabilities, ${remaining.length} remaining`
    );

    return createSuccess({
      applied: changes,
      resolved,
      remaining,
    });
  } catch (error) {
    console.error(`[audit] Error applying fixes: ${error.message}`);
    return createError(error.message, {
      applied: [],
      resolved: [],
      remaining: strategies,
    });
  }
}

// Export functions
module.exports = {
  applyFixes,
};
