/**
 * VulnSweep - Audit Module Orchestrator
 *
 * Main entry point for the audit and remediation engine.
 * Coordinates all sub-modules to analyze projects, determine fix strategies,
 * and apply vulnerability fixes.
 *
 * This module maintains backward compatibility by exporting the same API
 * as the original monolithic audit.js module.
 */

const { createSuccess, createError } = require('../../utils/result');
const git = require('../git');
const { applyFixes } = require('./appliers/fix-applier');
const { generatePackageJsonChanges } = require('./appliers/package-updater');
const { runNpmAudit } = require('./commands/npm-audit');
const { runNpmInstall } = require('./commands/npm-install');
const { parseVulnerabilities, collectDependents } = require('./parsers/vulnerability-parser');
const { determineFixStrategy, findParentPackage } = require('./strategies/fix-strategy');
const {
  clearCache,
  fetchLatestSafeVersion,
  fetchAllVersions,
  getInstalledVersionFromLockfile,
  findSafeVersionOutsideRange,
  determineSafeVersion,
} = require('./strategies/version-resolver');

/**
 * High-level function to analyze a project for vulnerabilities
 * @param {string} projectPath - Absolute path to the project
 * @param {boolean} allowReset - Whether to reset and pull the repository before scanning
 * @returns {Promise<Object>} { projectPath, vulnerabilities: array, strategies: array, summary: object }
 */
async function analyzeProject(projectPath, allowReset = false) {
  try {
    console.log(`[audit] Analyzing project: ${projectPath} (allowReset: ${allowReset})`);

    // Step 0: Git reset and pull if allowReset is enabled
    if (allowReset) {
      console.log('[audit] Step 0: Resetting and pulling repository...');
      try {
        const gitResult = await git.prepareRepository(projectPath, allowReset);
        if (gitResult.success) {
          console.log(
            `[audit] Repository reset and pulled successfully (branch: ${gitResult.branch})`
          );
        } else {
          console.warn(`[audit] Git preparation failed: ${gitResult.error}`);
          console.warn('[audit] Continuing with scan despite git failure...');
        }
      } catch (gitError) {
        console.error(`[audit] Git operation error: ${gitError.message}`);
        console.warn('[audit] Continuing with scan despite git error...');
      }
    }

    // Step 1: Run npm install
    console.log('[audit] Step 1: Running npm install...');
    const installResult = await runNpmInstall(projectPath);
    if (!installResult.success) {
      console.warn(`[audit] npm install had issues: ${installResult.error}`);
    }

    // Step 2: Run npm audit
    console.log('[audit] Step 2: Running npm audit...');
    const auditResult = await runNpmAudit(projectPath);
    if (!auditResult.success) {
      return createError(auditResult.error || 'npm audit failed', {
        projectPath,
        vulnerabilities: [],
        strategies: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          fixable: 0,
        },
      });
    }

    // Step 3: Parse vulnerabilities
    console.log('[audit] Step 3: Parsing vulnerabilities...');
    const vulnerabilities = await parseVulnerabilities(auditResult.content.auditData, projectPath);

    if (vulnerabilities.length === 0) {
      console.log('[audit] No vulnerabilities found!');
      return createSuccess({
        projectPath,
        vulnerabilities: [],
        strategies: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          fixable: 0,
        },
      });
    }

    // Step 4: Determine fix strategies
    console.log('[audit] Step 4: Determining fix strategies...');
    const strategies = [];
    for (let i = 0; i < vulnerabilities.length; i++) {
      const strategy = await determineFixStrategy(
        vulnerabilities[i],
        auditResult.content.auditData
      );
      strategies.push(strategy);
    }

    // Step 5: Generate summary
    // Step 5: Generate summary
    // Note: vulnerabilities now contains ONLY root-cause packages; pure dependents
    // are excluded from the list but counted in resolvedTransitively.
    const resolvedTransitively = vulnerabilities.reduce(
      (acc, v) => acc + (v.resolvesDependents ? v.resolvesDependents.length : 0),
      0
    );

    const summary = {
      total: vulnerabilities.length,
      critical: vulnerabilities.filter((v) => v.severity === 'critical').length,
      high: vulnerabilities.filter((v) => v.severity === 'high').length,
      moderate: vulnerabilities.filter((v) => v.severity === 'moderate').length,
      low: vulnerabilities.filter((v) => v.severity === 'low').length,
      fixable: strategies.filter((s) => s.type !== 'NO_FIX').length,
      directDependencies: vulnerabilities.filter((v) => v.isDirect).length,
      transientDependencies: vulnerabilities.filter((v) => !v.isDirect).length,
      resolvedTransitively,
      strategies: {
        updateDirect: strategies.filter((s) => s.type === 'UPDATE_DIRECT').length,
        updateParent: strategies.filter((s) => s.type === 'UPDATE_PARENT').length,
        addOverride: strategies.filter((s) => s.type === 'ADD_OVERRIDE').length,
        noFix: strategies.filter((s) => s.type === 'NO_FIX').length,
      },
    };
    console.log('[audit] Analysis complete:', summary);

    return createSuccess({
      projectPath,
      vulnerabilities,
      strategies,
      summary,
    });
  } catch (error) {
    console.error(`[audit] Error analyzing project: ${error.message}`);
    return createError(error.message, {
      projectPath,
      vulnerabilities: [],
      strategies: [],
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
        fixable: 0,
      },
    });
  }
}

// Export all functions (public API + internal functions for testing)
module.exports = {
  // Public API
  analyzeProject,
  applyFixes,
  clearCache,
  // Internal functions (exported for testing)
  runNpmInstall,
  runNpmAudit,
  parseVulnerabilities,
  collectDependents,
  determineFixStrategy,
  determineSafeVersion,
  fetchLatestSafeVersion,
  fetchAllVersions,
  getInstalledVersionFromLockfile,
  findSafeVersionOutsideRange,
  findParentPackage,
  generatePackageJsonChanges,
};
