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
  const { buildBox } = require('./utils');
  const rows = [];

  // Title row (centered)
  rows.push({ text: `  ${title}  `, align: 'center' });
  rows.push({ separator: true });

  // Stats row
  const statsText = ` Scanned: ${projectCount} project(s)  │  Found: ${findingCount} ${findingLabel} `;
  rows.push({ text: statsText, align: 'left' });

  // Severity row (only for audit)
  if (severitySummary) {
    rows.push({ separator: true });
    const sevParts = [
      `CRITICAL: ${severitySummary.critical}`,
      `HIGH: ${severitySummary.high}`,
      `MEDIUM: ${severitySummary.medium}`,
      `LOW: ${severitySummary.low}`,
      `INFO: ${severitySummary.info}`,
    ];
    const sevText = `  ${sevParts.join('  │  ')}  `;
    rows.push({ text: sevText, align: 'left' });
  }

  // Build the box, then apply bold color to title line only
  const box = buildBox(rows, { minWidth: 40, borderStyle: 'double' });
  const outputLines = box.split('\n');
  // Title is at index 1 (after top border)
  const titleContent = outputLines[1].slice(1, -1); // strip ║ on both sides
  outputLines[1] = `║${color(titleContent, 'bold', noColor)}║`;
  return outputLines.join('\n');
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

  // Coverage note — surfaces config-dependent result completeness so the same
  // project producing different counts across runs is explainable, not silent.
  const meta = result.metadata;
  if (meta && meta.repoLevelAdvisoryCoverage === false) {
    writeln(
      `  ${color(
        '⚠ Coverage reduced: no GITHUB_TOKEN — repo-level advisory fallback skipped; findings may be a subset of an authenticated scan.',
        'yellow',
        noColor
      )}`
    );
  }
  if (meta && meta.hasNvdApiKey === false) {
    writeln(
      `  ${color(
        '⚠ NVD enrichment limited: no NVD_API_KEY — CVSS scores/enrichment use free-tier rate limits.',
        'yellow',
        noColor
      )}`
    );
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
    const strategies = project.strategies || [];

    if (vulns.length === 0) {
      writeln('│  No vulnerabilities found');
    } else {
      // Map strategies onto vulnerabilities before sorting (index-aligned)
      const enriched = vulns.map((vuln, idx) => ({
        ...vuln,
        strategy: vuln.strategy || strategies[idx] || null,
      }));
      const sorted = sortBySeverity(enriched);

      for (const vuln of sorted) {
        const sev = formatSeverityLabel(vuln.severity, noColor);
        // Evidence: prefer CVE/GHSA identifiers. Seed with the legacy `id`
        // field (still populated by some call paths / fixtures) when it holds a
        // real advisory ID, then layer on the structured CVE/GHSA arrays.
        const legacyId = vuln.id || '';
        const ids = [
          ...(/^(CVE-|GHSA-)/i.test(legacyId) ? [legacyId] : []),
          ...(Array.isArray(vuln.cveIds) ? vuln.cveIds : []),
          ...(Array.isArray(vuln.aliases) ? vuln.aliases : []),
        ];
        const primaryId = ids[0] || 'N/A';
        const idLine = ids.length > 1 ? ` (${ids.slice(1).join(', ')})` : '';
        const pkg = vuln.package ? `${vuln.package}@${vuln.installedVersion || '?'}` : 'unknown';
        const srcs =
          Array.isArray(vuln.sources) && vuln.sources.length
            ? `  [sources: ${vuln.sources.join(', ')}]`
            : '';
        writeln(`│  ${sev}  ${primaryId}${idLine}  ${pkg}${srcs}`);

        const title = truncate(vuln.title || '', maxTitleLen);
        if (title) {
          writeln(`│    ${title}`);
        }

        const hasfix = vuln.strategy && vuln.strategy.type !== 'NO_FIX';
        const fixVer = vuln.strategy?.targetVersion || vuln.patchedVersion;
        const ev = vuln.url ? `  ${vuln.url}` : '';

        if (hasfix && fixVer) {
          writeln(`│    Fix: upgrade to ${fixVer}${ev}`);
        } else {
          writeln(`│    ${color('No fix available', 'dim', noColor)}${ev}`);
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

    // When project is an array, extract name from the first repo element
    const name = Array.isArray(project)
      ? project[0]?.projectName || 'unknown'
      : project.projectName || project.name || 'unknown';
    const projPath = Array.isArray(project)
      ? project[0]?.repoPath || '.'
      : project.projectPath || project.path || '.';

    totalUpdates += updates.length;
    normalizedProjects.push({
      name,
      path: projPath,
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
