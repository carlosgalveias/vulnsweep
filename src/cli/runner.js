'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { scanDependencyUpdates } = require('../main/modules/dep-updates/dep-updates-scanner');
const { discoverProjects } = require('../main/modules/discovery');
const { scanProject } = require('../main/modules/scanner/scanner-orchestrator');

const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

/**
 * Source preset mappings — defines which vulnerability sources to query per preset.
 * @type {Record<string, string[]>}
 */
const SOURCE_PRESETS = {
  fast: ['npm-audit', 'osv'],
  optimal: ['npm-audit', 'osv', 'github-advisory', 'cisa-kev', 'epss'],
  full: ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'],
};

/**
 * Per-package timeout values per source preset (in ms).
 * @type {Record<string, number>}
 */
const PRESET_TIMEOUTS = {
  fast: 15000,
  optimal: 30000,
  full: 60000,
};

/**
 * Creates a progress callback factory that writes to stderr.
 * Keeps stdout clean for piped data output.
 *
 * Returns a function that, given a project index/total/name, produces
 * a per-project progress callback showing overall scan percentage and
 * the package currently being analyzed.
 *
 * @param {boolean} quiet - Suppress progress output
 * @param {boolean} noColor - Disable ANSI color codes
 * @param {string} scanType - Scan type label (e.g. 'audit', 'dependency')
 * @returns {function} Factory: (projectIndex, totalProjects, projectName) => progressCb
 */
function createProgressFactory(quiet, noColor, scanType) {
  if (quiet) return () => () => {};

  const dim = noColor ? '' : '\x1b[2m';
  const reset = noColor ? '' : '\x1b[0m';
  const typeLabel = scanType || 'scan';

  return (projectIndex, totalProjects, projectName) => {
    return (progress) => {
      const { current, total, phase, packageName } = progress || {};

      // Compute overall percentage across all projects.
      // projectIndex is 0-based; within a project, current/total gives sub-progress.
      const subProgress = total > 0 && current != null ? current / total : 0;
      const overallPct = Math.round(((projectIndex + subProgress) / totalProjects) * 100);
      const pct = Math.min(overallPct, 100);

      // Build descriptive label
      let detail = '';
      if (phase === 'universe') {
        detail = 'Building package list...';
      } else if (phase === 'scanning' && packageName) {
        detail = `Checking ${packageName}...`;
      } else if (phase === 'complete') {
        detail = 'Done';
      } else {
        detail = phase || '';
      }

      const line = `  ${dim}[${pct}%] ${projectName} [${typeLabel}] ${detail}${reset}`;
      // Pad to overwrite any previous longer line
      const padded = line.length < 120 ? line + ' '.repeat(120 - line.length) : line;
      process.stderr.write(`\r${padded}`);
    };
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

  // 0. Resolve API keys: CLI param > VULNSWEEP_* env var > generic env var > undefined
  const githubToken =
    opts['github-token'] ||
    process.env.VULNSWEEP_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    undefined;
  const nvdApiKey =
    opts['nvd-key'] || process.env.VULNSWEEP_NVD_KEY || process.env.NVD_API_KEY || undefined;

  // Inject credentials into environment so ENRICHMENT_CONFIG getters pick them up.
  // The ENRICHMENT_CONFIG.GITHUB_TOKEN getter falls back to process.env.GITHUB_TOKEN
  // and ENRICHMENT_CONFIG.NVD_API_KEY falls back to process.env.NVD_API_KEY when
  // the secure-store is unavailable (which it always is in CLI context).
  if (githubToken) process.env.GITHUB_TOKEN = githubToken;
  if (nvdApiKey) process.env.NVD_API_KEY = nvdApiKey;

  // 1. Banner
  if (!quiet) {
    process.stderr.write(`VulnSweep CLI v${version} - Scanning...\n`);
    if (githubToken) process.stderr.write('  Using GitHub token (authenticated mode)\n');
    if (nvdApiKey) process.stderr.write('  Using NVD API key (accelerated rate limit)\n');
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
  const progressFactory = createProgressFactory(quiet, noColor, type);
  const totalProjects = projects.length;
  const projectResults = [];
  let failCount = 0;

  if (type === 'audit') {
    const sourcePreset = opts.sources || 'optimal';
    const scanOptions = {
      enabledSources: SOURCE_PRESETS[sourcePreset],
      perPackageTimeoutMs: PRESET_TIMEOUTS[sourcePreset] || 30000,
    };

    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      const projectProgressCb = progressFactory(i, totalProjects, project.name);
      try {
        const result = await scanProject(project.path, scanOptions, projectProgressCb);
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
    if (!quiet) process.stderr.write(`\r${' '.repeat(120)}\r`);

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
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const projectProgressCb = progressFactory(i, totalProjects, project.name);
    try {
      const result = await scanDependencyUpdates(project.path, projectProgressCb);

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
  if (!quiet) process.stderr.write(`\r${' '.repeat(120)}\r`);

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
