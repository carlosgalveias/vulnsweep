'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { applyFixes } = require('../main/modules/audit/appliers/fix-applier');
const { applyUpdates } = require('../main/modules/dep-updates/dep-updates-scanner');

const execFileAsync = promisify(execFile);

// ─── Input Validation ────────────────────────────────────────────────────────

const SAFE_PKG_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const SAFE_VER_RE = /^[0-9a-zA-Z._-]+$/;

/**
 * Validates a package name and version to prevent command injection.
 *
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @throws {Error} If name or version contains unsafe characters
 */
function validatePkgInput(name, version) {
  if (!SAFE_PKG_RE.test(name)) throw new Error(`Invalid package name: ${name}`);
  if (version && !SAFE_VER_RE.test(version)) throw new Error(`Invalid version: ${version}`);
}

/**
 * Determines whether a strategy is eligible based on the fix-level filter.
 *
 * @param {object} strategy - A fix strategy from scanner-orchestrator
 * @param {'low'|'high'} fixLevel - Risk level filter
 * @returns {boolean} True if eligible for application
 */
function isEligibleStrategy(strategy, fixLevel) {
  if (!strategy || strategy.type === 'NO_FIX' || !strategy.targetVersion) {
    return false;
  }
  if (fixLevel === 'high') return true;
  // low: only non-breaking (riskLevel LOW or missing)
  return strategy.riskLevel !== 'HIGH';
}

/**
 * Determines whether a dependency update candidate is eligible based on update-level.
 *
 * @param {object} candidate - An UpdateCandidate from dep-updates-scanner
 * @param {'low'|'high'} updateLevel - Update scope filter
 * @returns {boolean} True if eligible for application
 */
function isEligibleUpdate(candidate, updateLevel) {
  if (!candidate || !candidate.selectedVersion) return false;
  if (updateLevel === 'high') return true;
  // low: only same-major (riskLevel 'Low')
  return candidate.riskLevel === 'Low';
}

/**
 * Writes a progress line to stderr (unless quiet mode).
 *
 * @param {string} msg - Message to write
 * @param {boolean} quiet - Suppress output flag
 */
function logProgress(msg, quiet) {
  if (!quiet) {
    process.stderr.write(`  ${msg}\n`);
  }
}

/**
 * Applies autofix for audit-type scan results.
 * Filters strategies by fix-level and applies eligible fixes per project.
 *
 * @param {object} result - Run result from runner.js
 * @param {object} opts - CLI options
 * @returns {Promise<{applied: number, failed: number, skipped: number, total: number, modifiedPaths: string[]}>}
 */
async function applyAuditFixes(result, opts) {
  const fixLevel = opts['fix-level'] || opts.fixLevel || 'low';
  const quiet = opts.quiet || false;
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  const modifiedPaths = [];

  const projects = (result.projects || []).filter(Boolean);

  for (const project of projects) {
    const strategies = project.strategies || [];
    const projectPath = project.projectPath || '';
    const projectName = projectPath.split(/[\\/]/).pop() || 'unknown';

    if (strategies.length === 0) continue;

    const eligible = [];
    const ineligible = [];

    for (const strategy of strategies) {
      if (!strategy || strategy.type === 'NO_FIX' || !strategy.targetVersion) {
        // Not fixable at all — not counted towards total
        continue;
      }
      total++;
      if (isEligibleStrategy(strategy, fixLevel)) {
        eligible.push(strategy);
      } else {
        ineligible.push(strategy);
      }
    }

    skipped += ineligible.length;

    if (eligible.length === 0) continue;

    // Report what we're about to fix
    for (const strategy of eligible) {
      const pkg = strategy.package || strategy.parentPackage || 'unknown';
      const from = strategy.currentVersion || '?';
      const to = strategy.targetVersion;
      logProgress(`Fixing: ${pkg}@${from} → ${to} (project: ${projectName})`, quiet);
    }

    // Apply all eligible strategies for this project via fix-applier
    try {
      const fixResult = await applyFixes(projectPath, eligible, !!opts.bump);

      if (fixResult.success) {
        const appliedCount =
          fixResult.content && fixResult.content.applied
            ? fixResult.content.applied.length
            : eligible.length;
        applied += appliedCount;
        if (appliedCount > 0) modifiedPaths.push(projectPath);
        logProgress(`✓ Applied ${appliedCount} fixes in ${projectName}`, quiet);
      } else {
        // Bulk apply failed — attempt individual npm installs as fallback
        const individualResults = await applyIndividualFixes(eligible, projectPath, quiet);
        applied += individualResults.applied;
        failed += individualResults.failed;
        if (individualResults.applied > 0) {
          modifiedPaths.push(projectPath);
          logProgress(
            `✓ Applied ${individualResults.applied} fixes in ${projectName} (${individualResults.failed} failed)`,
            quiet
          );
        } else {
          logProgress(`✗ All ${individualResults.failed} fixes failed in ${projectName}`, quiet);
        }
      }
    } catch (err) {
      // applyFixes threw — attempt individual fallback
      const individualResults = await applyIndividualFixes(eligible, projectPath, quiet);
      applied += individualResults.applied;
      failed += individualResults.failed;
      if (individualResults.applied > 0) {
        modifiedPaths.push(projectPath);
        logProgress(
          `✓ Applied ${individualResults.applied} fixes in ${projectName} (${individualResults.failed} failed)`,
          quiet
        );
      } else {
        logProgress(`✗ Fix failed in ${projectName}: ${err.message}`, quiet);
      }
    }
  }

  return { applied, failed, skipped, total, modifiedPaths: [...new Set(modifiedPaths)] };
}

/**
 * Fallback: applies fixes individually via npm install when bulk apply fails.
 *
 * @param {Array} strategies - Eligible strategies to apply
 * @param {string} projectPath - Project directory path
 * @param {boolean} quiet - Suppress output flag
 * @returns {Promise<{applied: number, failed: number}>}
 */
async function applyIndividualFixes(strategies, projectPath, quiet) {
  let applied = 0;
  let failed = 0;

  for (const strategy of strategies) {
    const pkg = strategy.package || strategy.parentPackage;
    const version = strategy.targetVersion;

    if (!pkg || !version) {
      failed++;
      continue;
    }

    try {
      validatePkgInput(pkg, version);
      await execFileAsync('npm', ['install', `${pkg}@${version}`, '--no-audit', '--no-fund'], {
        cwd: projectPath,
        encoding: 'utf8',
      });
      applied++;
    } catch (err) {
      failed++;
      logProgress(`  ⚠ Failed to fix ${pkg}@${version}: ${err.message}`, quiet);
    }
  }

  return { applied, failed };
}

/**
 * Applies autofix for dependency-type scan results.
 * Filters candidates by update-level and applies eligible updates.
 *
 * @param {object} result - Run result from runner.js
 * @param {object} opts - CLI options
 * @returns {Promise<{applied: number, failed: number, skipped: number, total: number, modifiedPaths: string[]}>}
 */
async function applyDependencyUpdates(result, opts) {
  const updateLevel = opts['update-level'] || opts.updateLevel || 'low';
  const quiet = opts.quiet || false;
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  const modifiedPaths = [];

  const projects = (result.projects || []).filter(Boolean);

  for (const repoResults of projects) {
    // Each project entry is a RepoUpdateResult[] from scanDependencyUpdates
    const repos = Array.isArray(repoResults) ? repoResults : [repoResults];

    for (const repo of repos) {
      if (!repo || !Array.isArray(repo.candidates)) continue;

      const repoPath = repo.repoPath || '';
      const repoName = repo.repoName || repoPath.split(/[\\/]/).pop() || 'unknown';
      const candidates = repo.candidates;

      if (candidates.length === 0) continue;

      const eligible = [];
      const ineligible = [];

      for (const candidate of candidates) {
        if (!candidate.selectedVersion) continue;
        total++;
        if (isEligibleUpdate(candidate, updateLevel)) {
          eligible.push(candidate);
        } else {
          ineligible.push(candidate);
        }
      }

      skipped += ineligible.length;

      if (eligible.length === 0) continue;

      // Report what we're about to update
      for (const candidate of eligible) {
        logProgress(
          `Updating: ${candidate.name}@${candidate.currentVersion} → ${candidate.selectedVersion} (project: ${repoName})`,
          quiet
        );
      }

      // Convert candidates to ApplyUpdate format
      const updates = eligible.map((c) => ({
        name: c.name,
        fromVersion: c.currentVersion,
        toVersion: c.selectedVersion,
        repoPath,
      }));

      try {
        const updateResult = await applyUpdates(repoPath, updates);

        if (updateResult.success) {
          applied += eligible.length;
          modifiedPaths.push(repoPath);
          logProgress(`✓ Updated ${eligible.length} dependencies in ${repoName}`, quiet);
        } else {
          // Bulk failed — try individual installs
          const individualResults = await applyIndividualUpdates(updates, quiet);
          applied += individualResults.applied;
          failed += individualResults.failed;
          if (individualResults.applied > 0) {
            modifiedPaths.push(repoPath);
            logProgress(
              `✓ Updated ${individualResults.applied} dependencies in ${repoName} (${individualResults.failed} failed)`,
              quiet
            );
          } else {
            logProgress(
              `✗ All ${individualResults.failed} updates failed in ${repoName}: ${updateResult.error || 'unknown'}`,
              quiet
            );
          }
        }
      } catch (err) {
        // applyUpdates threw — try individual
        const individualResults = await applyIndividualUpdates(updates, quiet);
        applied += individualResults.applied;
        failed += individualResults.failed;
        if (individualResults.applied > 0) {
          modifiedPaths.push(repoPath);
          logProgress(
            `✓ Updated ${individualResults.applied} dependencies in ${repoName} (${individualResults.failed} failed)`,
            quiet
          );
        } else {
          logProgress(`✗ Update failed in ${repoName}: ${err.message}`, quiet);
        }
      }
    }
  }

  return { applied, failed, skipped, total, modifiedPaths: [...new Set(modifiedPaths)] };
}

/**
 * Fallback: applies updates individually via npm install when bulk apply fails.
 *
 * @param {Array} updates - Array of { name, toVersion, repoPath }
 * @param {boolean} quiet - Suppress output flag
 * @returns {Promise<{applied: number, failed: number}>}
 */
async function applyIndividualUpdates(updates, quiet) {
  let applied = 0;
  let failed = 0;

  for (const update of updates) {
    try {
      validatePkgInput(update.name, update.toVersion);
      await execFileAsync(
        'npm',
        ['install', `${update.name}@${update.toVersion}`, '--save', '--no-audit', '--no-fund'],
        { cwd: update.repoPath, encoding: 'utf8' }
      );
      applied++;
    } catch (err) {
      failed++;
      logProgress(`  ⚠ Failed to update ${update.name}@${update.toVersion}: ${err.message}`, quiet);
    }
  }

  return { applied, failed };
}

/**
 * Main autofix entry point. Routes to audit or dependency fix logic
 * based on the scan type.
 *
 * @param {object} result - The run result from runner.js (contains `projects` array)
 * @param {object} opts - CLI options including autofix, fixLevel, updateLevel, type, quiet, noColor
 * @returns {Promise<{applied: number, failed: number, skipped: number, total: number, modifiedPaths: string[]}>}
 */
async function applyAutofix(result, opts) {
  if (!result || !Array.isArray(result.projects)) {
    return { applied: 0, failed: 0, skipped: 0, total: 0, modifiedPaths: [] };
  }

  const type = result.type || opts.type || 'audit';

  if (type === 'audit') {
    return applyAuditFixes(result, opts);
  }

  return applyDependencyUpdates(result, opts);
}

module.exports = { applyAutofix };
