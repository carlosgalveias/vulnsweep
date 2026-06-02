'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { scanDependencyUpdates } = require('../main/modules/dep-updates/dep-updates-scanner');
const { discoverProjects } = require('../main/modules/discovery');
const { scanProject } = require('../main/modules/scanner/scanner-orchestrator');

const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

/**
 * Creates a progress callback that writes to stderr.
 * Keeps stdout clean for piped data output.
 *
 * @param {boolean} quiet - Suppress progress output
 * @param {boolean} noColor - Disable ANSI color codes
 * @returns {function} Progress callback
 */
function createProgressCb(quiet, noColor) {
  if (quiet) return () => {};

  const dim = noColor ? '' : '\x1b[2m';
  const reset = noColor ? '' : '\x1b[0m';

  return (progress) => {
    const { current, total, message, phase } = progress || {};
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const label = message || phase || '';
    process.stderr.write(`\r  ${dim}[${pct}%] ${label}${reset}`);
  };
}

/**
 * Computes an aggregate severity summary across all project scan results.
 * Normalises "moderate" → "medium" for CLI-friendly output.
 *
 * @param {Array} projectResults - Array of scanProject result objects
 * @returns {{total: number, critical: number, high: number, medium: number, low: number, info: number}}
 */
function computeSummary(projectResults) {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  for (const result of projectResults) {
    if (!result || !result.vulnerabilities) continue;

    for (const vuln of result.vulnerabilities) {
      summary.total++;
      let sev = (vuln.severity || 'info').toLowerCase();
      // Scanner uses "moderate"; CLI exposes "medium" for consistency with npm
      if (sev === 'moderate') sev = 'medium';
      if (summary[sev] !== undefined) {
        summary[sev]++;
      } else {
        summary.info++;
      }
    }
  }

  return summary;
}

/**
 * Computes summary for dependency update results.
 *
 * @param {Array} projectResults - Array of scanDependencyUpdates results
 * @returns {{total: number, critical: number, high: number, medium: number, low: number, info: number}}
 */
function computeDepSummary(projectResults) {
  let totalCandidates = 0;

  for (const result of projectResults) {
    if (!result || !Array.isArray(result)) continue;
    for (const repo of result) {
      if (repo && Array.isArray(repo.candidates)) {
        totalCandidates += repo.candidates.length;
      }
    }
  }

  return { total: totalCandidates, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/**
 * Main CLI runner — orchestrates scans based on parsed CLI options.
 *
 * @param {object} opts - Validated options from arg-parser
 * @param {string} opts.dir - Absolute path to scan
 * @param {'audit'|'dependency'} opts.type - Scan type
 * @param {boolean} opts.output - Print results to stdout
 * @param {boolean} opts.quiet - Suppress non-essential output
 * @param {boolean} opts.noColor - Disable colored output
 * @returns {Promise<{type: string, projects: Array, summary: object, timestamp: string}>}
 */
async function run(opts) {
  const { dir, type, quiet } = opts;
  const noColor = opts['no-color'] || false;

  // 1. Banner
  if (!quiet) {
    process.stderr.write(`VulnSweep CLI v${version} - Scanning...\n`);
  }

  // 2. Discover projects
  const discoveryResult = await discoverProjects(dir);

  if (!discoveryResult.success) {
    if (!quiet) {
      process.stderr.write(`Error: ${discoveryResult.error || 'Discovery failed'}\n`);
    }
    process.exit(4);
  }

  const projects = discoveryResult.content;

  if (!Array.isArray(projects) || projects.length === 0) {
    if (!quiet) {
      process.stderr.write('No projects found in the specified directory.\n');
    }
    process.exit(4);
  }

  if (!quiet) {
    process.stderr.write(`Found ${projects.length} project(s)\n`);
  }

  // 3. Execute scan based on type
  const progressCb = createProgressCb(quiet, noColor);
  const projectResults = [];
  let failCount = 0;

  if (type === 'audit') {
    const scanOptions = { perPackageTimeoutMs: 30000 };

    for (const project of projects) {
      try {
        const result = await scanProject(project.path, scanOptions, progressCb);
        projectResults.push(result);
      } catch (err) {
        failCount++;
        if (!quiet) {
          process.stderr.write(`\nWarning: Scan failed for "${project.name}": ${err.message}\n`);
        }
        projectResults.push(null);
      }
    }

    // Clear progress line
    if (!quiet) process.stderr.write('\n');

    // If ALL projects failed, exit with error code 3
    if (failCount === projects.length) {
      if (!quiet) {
        process.stderr.write('Error: All project scans failed.\n');
      }
      process.exit(3);
    }

    const validResults = projectResults.filter(Boolean);
    const summary = computeSummary(validResults);

    return {
      type,
      projects: projectResults,
      summary,
      timestamp: new Date().toISOString(),
    };
  }

  // type === 'dependency'
  for (const project of projects) {
    try {
      const result = await scanDependencyUpdates(project.path, progressCb);

      if (result.success) {
        projectResults.push(result.content);
      } else {
        failCount++;
        if (!quiet) {
          process.stderr.write(
            `\nWarning: Dependency scan failed for "${project.name}": ${result.error || 'Unknown error'}\n`
          );
        }
        projectResults.push(null);
      }
    } catch (err) {
      failCount++;
      if (!quiet) {
        process.stderr.write(
          `\nWarning: Dependency scan failed for "${project.name}": ${err.message}\n`
        );
      }
      projectResults.push(null);
    }
  }

  // Clear progress line
  if (!quiet) process.stderr.write('\n');

  // If ALL projects failed, exit with error code 3
  if (failCount === projects.length) {
    if (!quiet) {
      process.stderr.write('Error: All dependency scans failed.\n');
    }
    process.exit(3);
  }

  const validResults = projectResults.filter(Boolean);
  const summary = computeDepSummary(validResults);

  return {
    type,
    projects: projectResults,
    summary,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { run };
