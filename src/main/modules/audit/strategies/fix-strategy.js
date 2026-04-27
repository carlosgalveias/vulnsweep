/**
 * VulnSweep - Fix Strategy Module
 *
 * Implements the PRD decision tree for determining how to fix each vulnerability:
 * - Scenario A: Direct Dependency (Minor/Patch Update)
 * - Scenario B: Transient Dependency (Parent Update)
 * - Scenario C: Deep Root/No Direct Update (Use npm overrides)
 *
 * Returns strategy objects that guide package.json modifications.
 */

const semver = require('semver');
const { fetchLatestSafeVersion, determineSafeVersion } = require('./version-resolver');

/**
 * Find the direct parent package for a transient dependency
 * @param {string} pkgName - Package name
 * @param {Object} auditData - npm audit data
 * @returns {string|null} Parent package name or null
 */
function findParentPackage(pkgName, auditData) {
  if (!auditData || !auditData.vulnerabilities) {
    return null;
  }

  const vulnData = auditData.vulnerabilities[pkgName];
  if (!vulnData || !Array.isArray(vulnData.via)) {
    return null;
  }

  // Find first direct dependency in the via chain
  for (const viaItem of vulnData.via) {
    if (typeof viaItem === 'string') {
      // Check if this package is direct
      const parentVuln = auditData.vulnerabilities[viaItem];
      if (parentVuln && parentVuln.isDirect) {
        return viaItem;
      }
    }
  }

  return null;
}

/**
 * Determine the appropriate fix strategy based on the PRD decision tree
 * @param {Object} vulnerability - Vulnerability object
 * @param {Object} auditData - Full npm audit data for context
 * @returns {Promise<Object>} Strategy object
 */
async function determineFixStrategy(vulnerability, auditData) {
  const {
    package: pkgName,
    isDirect,
    fixAvailable,
    patchedVersion,
    installedVersion,
  } = vulnerability;

  // Scenario A: Direct Dependency (Minor/Patch Update)
  if (isDirect) {
    if (!fixAvailable) {
      return {
        type: 'NO_FIX',
        package: pkgName,
        currentVersion: installedVersion,
        targetVersion: null,
        riskLevel: 'N/A',
        reason: 'No fix available for direct dependency',
      };
    }

    let targetVersion;
    let isMajor = false;

    if (typeof fixAvailable === 'object' && fixAvailable.version) {
      // fixAvailable is an object with version info
      targetVersion = fixAvailable.version;
      isMajor = fixAvailable.isSemVerMajor || false;
    } else if (typeof fixAvailable === 'boolean' && fixAvailable === true) {
      // fixAvailable is just true, need to determine version from vulnerability range
      const vulnerabilityRange =
        vulnerability.vulnerableRange || auditData.vulnerabilities[pkgName]?.range;
      if (vulnerabilityRange) {
        targetVersion = await determineSafeVersion(
          pkgName,
          vulnerabilityRange,
          installedVersion,
          null
        );
      }

      if (!targetVersion) {
        // Could not determine a safe version
        targetVersion = await fetchLatestSafeVersion(pkgName);
      }

      if (!targetVersion) {
        return {
          type: 'NO_FIX',
          package: pkgName,
          currentVersion: installedVersion,
          targetVersion: null,
          riskLevel: 'N/A',
          reason: 'Could not determine safe version for direct dependency',
        };
      }
    } else if (typeof fixAvailable === 'string') {
      // fixAvailable is a version string
      targetVersion = fixAvailable;
    } else {
      // Unknown fixAvailable format
      return {
        type: 'NO_FIX',
        package: pkgName,
        currentVersion: installedVersion,
        targetVersion: null,
        riskLevel: 'N/A',
        reason: 'Invalid fix information for direct dependency',
      };
    }

    return {
      type: 'UPDATE_DIRECT',
      package: pkgName,
      currentVersion: installedVersion,
      targetVersion,
      riskLevel: isMajor ? 'HIGH' : 'LOW',
      reason: `Direct dependency can be updated to ${targetVersion}${isMajor ? ' (major version change)' : ''}`,
    };
  }

  // Scenario B & C: Transient Dependency
  // Check if a parent dependency update can resolve it
  const parentPackage = findParentPackage(pkgName, auditData);

  if (parentPackage && fixAvailable) {
    // Scenario B: Parent dependency can be updated
    const targetVersion = typeof fixAvailable === 'object' ? fixAvailable.version : fixAvailable;
    const isMajor = typeof fixAvailable === 'object' ? fixAvailable.isSemVerMajor : false;

    return {
      type: 'UPDATE_PARENT',
      package: pkgName,
      parentPackage,
      currentVersion: installedVersion,
      targetVersion,
      riskLevel: isMajor ? 'HIGH' : 'LOW',
      reason: `Updating parent dependency '${parentPackage}' to ${targetVersion} will resolve transient vulnerability`,
    };
  }

  // Scenario C: Deep root or no direct update available - use npm overrides
  // Try to determine safe version from the vulnerability range
  const vulnerabilityRange =
    vulnerability.vulnerableRange || auditData.vulnerabilities[pkgName]?.range;
  let targetVersion = patchedVersion;

  if (vulnerabilityRange) {
    // Pass installedVersion to prevent downgrades
    const safeVersion = await determineSafeVersion(
      pkgName,
      vulnerabilityRange,
      installedVersion,
      null
    );
    if (safeVersion) {
      targetVersion = safeVersion;
    } else {
      // No safe version could be determined (e.g., all versions vulnerable with >=X.Y.Z pattern)
      // Or the only safe version would be a downgrade
      return {
        type: 'NO_FIX',
        package: pkgName,
        currentVersion: installedVersion,
        targetVersion: null,
        riskLevel: 'N/A',
        reason:
          'No safe version available (all versions may be vulnerable or would require downgrade)',
      };
    }
  }

  if (!targetVersion) {
    // Fallback: no version could be determined
    return {
      type: 'NO_FIX',
      package: pkgName,
      currentVersion: installedVersion,
      targetVersion: null,
      riskLevel: 'N/A',
      reason: 'No target version available for transient dependency',
    };
  }

  // Determine risk level based on version difference
  let riskLevel = 'LOW';
  try {
    const current = semver.coerce(installedVersion);
    const target = semver.coerce(targetVersion);

    if (current && target) {
      const diff = semver.diff(current.version, target.version);
      if (diff === 'major') {
        riskLevel = 'HIGH';
      }
    }
  } catch (error) {
    console.warn(`[audit] Could not compare versions for ${pkgName}: ${error.message}`);
  }

  return {
    type: 'ADD_OVERRIDE',
    package: pkgName,
    currentVersion: installedVersion,
    targetVersion,
    riskLevel,
    reason: `Add override for ${pkgName} to version ${targetVersion} (deep transient dependency${riskLevel === 'HIGH' ? ', MAJOR update' : ''})`,
  };
}

// Export functions
module.exports = {
  determineFixStrategy,
  findParentPackage,
};
