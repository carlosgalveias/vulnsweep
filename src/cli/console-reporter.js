'use strict';

/**
 * Console reporter module for VulnSweep CLI.
 * Formats scan results for terminal display using box-drawing characters.
 *
 * @module cli/console-reporter
 */

const { extractUpdatesFromArray } = require('./utils');

// ─── ANSI Color Codes ────────────────────────────────────────────────────────

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  boldRed: '\x1b[1;31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
};

const SEVERITY_COLORS = {
  critical: 'boldRed',
  high: 'red',
  medium: 'yellow',
  low: 'cyan',
  info: 'dim',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Writes a line to stdout with a trailing newline.
 *
 * @param {string} line - Text to output
 */
function writeln(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * Wraps text with an ANSI color code, respecting noColor option.
 *
 * @param {string} text - Text to colorize
 * @param {string} code - Key from CODES map
 * @param {boolean} noColor - If true, returns text unmodified
 * @returns {string} Colorized or raw text
 */
function color(text, code, noColor) {
  if (noColor) return text;
  return `${CODES[code] || ''}${text}${CODES.reset}`;
}

/**
 * Returns the terminal width, defaulting to 80.
 *
 * @returns {number}
 */
function getTermWidth() {
  return process.stdout.columns || 80;
}

/**
 * Truncates a string to the given max length, appending "…" if clipped.
 *
 * @param {string} str - Input string
 * @param {number} max - Max character count
 * @returns {string}
 */
function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return `${str.slice(0, max - 1)}…`;
}

/**
 * Sorts vulnerabilities by severity (critical first).
 *
 * @param {Array} vulns - Array of vulnerability objects
 * @returns {Array} Sorted copy
 */
function sortBySeverity(vulns) {
  return [...vulns].sort((a, b) => {
    const aIdx = SEVERITY_ORDER.indexOf((a.severity || 'info').toLowerCase());
    const bIdx = SEVERITY_ORDER.indexOf((b.severity || 'info').toLowerCase());
    return aIdx - bIdx;
  });
}

/**
 * Builds the top-level header box for a report.
 *
 * @param {string} title - Report title
 * @param {string} projectCount - Number of projects scanned
 * @param {string} findingCount - Number of findings
 * @param {string} findingLabel - Label for findings (e.g., "vulnerabilities")
 * @param {object|null} severitySummary - Optional severity breakdown
 * @param {boolean} noColor - Disable colors
 * @returns {string} Formatted header block
 */
function buildHeaderBox(title, projectCount, findingCount, findingLabel, severitySummary, noColor) {
  const width = 62;
  const lines = [];

  lines.push(`╔${'═'.repeat(width)}╗`);

  // Title line - centered
  const titlePad = Math.max(0, Math.floor((width - title.length) / 2));
  const titleLine = `${' '.repeat(titlePad)}${title}${' '.repeat(width - titlePad - title.length)}`;
  lines.push(`║${color(titleLine, 'bold', noColor)}║`);

  lines.push(`╠${'═'.repeat(width)}╣`);

  // Stats line
  const statsText = `Scanned: ${projectCount} project(s)  │  Found: ${findingCount} ${findingLabel}`;
  const statsPad = Math.max(0, width - statsText.length - 2);
  lines.push(`║ ${statsText}${' '.repeat(statsPad)} ║`);

  // Severity breakdown (only for audit)
  if (severitySummary) {
    lines.push(`╠${'═'.repeat(width)}╣`);
    const sevParts = [
      `CRITICAL: ${severitySummary.critical}`,
      `HIGH: ${severitySummary.high}`,
      `MEDIUM: ${severitySummary.medium}`,
      `LOW: ${severitySummary.low}`,
      `INFO: ${severitySummary.info}`,
    ];
    const sevText = `  ${sevParts.join('  │  ')}  `;
    const sevPad = Math.max(0, width - sevText.length);
    lines.push(`║${sevText}${' '.repeat(sevPad)}║`);
  }

  lines.push(`╚${'═'.repeat(width)}╝`);

  return lines.join('\n');
}

/**
 * Formats a severity label with color and bullet.
 *
 * @param {string} severity - Severity level
 * @param {boolean} noColor - Disable colors
 * @returns {string} Formatted severity label
 */
function formatSeverityLabel(severity, noColor) {
  const sev = (severity || 'info').toLowerCase();
  const colorCode = SEVERITY_COLORS[sev] || 'dim';
  const bullet = sev === 'critical' || sev === 'high' ? '●' : '○';
  const label = sev.toUpperCase();
  return color(`${bullet} ${label}`, colorCode, noColor);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Prints a formatted vulnerability audit report to stdout.
 *
 * @param {object} result - Scan result from runner
 * @param {object} opts - Display options
 * @param {boolean} opts.noColor - Disable ANSI colors
 * @param {boolean} opts.quiet - Suppress detailed output (header only)
 * @param {string} opts.sources - Source preset used (fast/optimal/full)
 */
function printAuditReport(result, opts) {
  const { noColor = false, quiet = false, sources } = opts || {};
  const termWidth = getTermWidth();
  const maxTitleLen = termWidth - 30;

  const summary = result.summary || { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const projects = result.projects || [];
  const validProjects = projects.filter(Boolean);

  // Header box
  writeln(
    buildHeaderBox(
      'VULNERABILITY REPORT',
      String(validProjects.length),
      String(summary.total),
      'vulnerabilities',
      summary,
      noColor
    )
  );

  // Source preset info line
  if (sources) {
    writeln(`  ${color('Sources:', 'dim', noColor)} ${sources}`);
  }

  if (quiet) return;

  writeln('');

  // Per-project details
  for (const project of validProjects) {
    const projectName = project.projectName || project.name || 'unknown';
    const projectPath = project.projectPath || project.path || '.';

    writeln(`┌─ Project: ${color(projectName, 'bold', noColor)} (${projectPath})`);
    writeln('│');

    const vulns = project.vulnerabilities || [];

    if (vulns.length === 0) {
      writeln('│  No vulnerabilities found');
    } else {
      const sorted = sortBySeverity(vulns);

      for (const vuln of sorted) {
        const sev = formatSeverityLabel(vuln.severity, noColor);
        const id = vuln.id || 'N/A';
        const pkg = vuln.package ? `${vuln.package}@${vuln.installedVersion || '?'}` : 'unknown';
        writeln(`│  ${sev}  ${id}  ${pkg}`);

        const title = truncate(vuln.title || '', maxTitleLen);
        if (title) {
          writeln(`│    ${title}`);
        }

        if (vuln.fixAvailable && vuln.fixVersion) {
          writeln(`│    Fix: upgrade to ${vuln.fixVersion}`);
        } else {
          writeln(`│    ${color('No fix available', 'dim', noColor)}`);
        }

        writeln('│');
      }
    }

    const count = vulns.length;
    writeln(`└─ ${count} vulnerabilit${count === 1 ? 'y' : 'ies'} in this project`);
    writeln('');
  }
}

/**
 * Prints a formatted dependency update report to stdout.
 *
 * @param {object} result - Scan result from runner
 * @param {object} opts - Display options
 * @param {boolean} opts.noColor - Disable ANSI colors
 * @param {boolean} opts.quiet - Suppress detailed output (header only)
 */
function printDependencyReport(result, opts) {
  const { noColor = false, quiet = false } = opts || {};

  const projects = result.projects || [];
  const validProjects = projects.filter(Boolean);

  // Count total updates across all projects
  let totalUpdates = 0;
  const normalizedProjects = [];

  for (const project of validProjects) {
    // Handle both flat array format and structured object format
    const updates = Array.isArray(project)
      ? extractUpdatesFromArray(project)
      : project.updates || project.candidates || [];

    totalUpdates += updates.length;
    normalizedProjects.push({
      name: project.projectName || project.name || 'unknown',
      path: project.projectPath || project.path || '.',
      updates,
    });
  }

  // Header box
  writeln(
    buildHeaderBox(
      'DEPENDENCY UPDATE REPORT',
      String(validProjects.length),
      String(totalUpdates),
      'available updates',
      null,
      noColor
    )
  );

  if (quiet) return;

  writeln('');

  // Per-project details
  for (const proj of normalizedProjects) {
    writeln(`┌─ Project: ${color(proj.name, 'bold', noColor)} (${proj.path})`);
    writeln('│');

    if (proj.updates.length === 0) {
      writeln('│  All dependencies are up to date');
    } else {
      // Sort high risk first
      const sorted = [...proj.updates].sort((a, b) => {
        const aRisk = (a.riskLevel || 'Low').toLowerCase() === 'high' ? 0 : 1;
        const bRisk = (b.riskLevel || 'Low').toLowerCase() === 'high' ? 0 : 1;
        return aRisk - bRisk;
      });

      for (const dep of sorted) {
        const isHigh = (dep.riskLevel || 'Low').toLowerCase() === 'high';
        const bullet = isHigh ? '▲' : '△';
        const riskLabel = isHigh ? 'HIGH RISK' : 'LOW RISK';
        const riskColor = isHigh ? 'red' : 'green';
        const name = dep.name || 'unknown';
        const from = dep.currentVersion || '?';
        const to = dep.recommendedVersion || dep.latestVersion || '?';
        const updateType = dep.updateType ? `(${dep.updateType})` : '';

        writeln(
          `│  ${color(`${bullet} ${riskLabel}`, riskColor, noColor)}  ${name}  ${from} → ${to}  ${updateType}`
        );
      }
    }

    writeln('│');
    writeln(`└─ ${proj.updates.length} update${proj.updates.length === 1 ? '' : 's'} available`);
    writeln('');
  }
}

module.exports = { printAuditReport, printDependencyReport };
