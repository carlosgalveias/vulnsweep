'use strict';

/**
 * HTML Report Generator for VulnSweep CLI.
 * Generates a self-contained HTML file with inline CSS and Chart.js charts.
 *
 * @module cli/html-report-generator
 */

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { extractUpdatesFromArray } = require('./utils');

const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

// ─── Constants ───────────────────────────────────────────────────────────────

const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';

const COLORS = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  info: '#6b7280',
  bg: '#f9fafb',
  card: '#ffffff',
  text: '#111827',
  border: '#e5e7eb',
  success: '#16a34a',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe HTML insertion.
 *
 * @param {string} str - Raw string
 * @returns {string} HTML-escaped string
 */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats an ISO timestamp into a human-readable date string.
 *
 * @param {string} iso - ISO 8601 timestamp
 * @returns {string} Formatted date
 */
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

/**
 * Returns complete inline CSS for the report.
 *
 * @returns {string} CSS stylesheet content
 */
function buildStyles() {
  return `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
      background:${COLORS.bg};color:${COLORS.text};line-height:1.6;
      padding:0;margin:0;
    }
    .container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
    h1,h2,h3{font-weight:700}
    h1{font-size:1.75rem;margin-bottom:0.25rem}
    h2{font-size:1.25rem;margin-bottom:1rem;color:#374151}
    h3{font-size:1rem;margin-bottom:0.5rem}

    /* Header */
    .report-header{
      background:linear-gradient(135deg,#1e293b 0%,#334155 100%);
      color:#fff;padding:2rem 0;margin-bottom:2rem;
    }
    .report-header .container{display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap}
    .report-header h1{color:#fff;font-size:2rem}
    .report-header .meta{color:#94a3b8;font-size:0.875rem}
    .logo-svg{width:48px;height:48px;flex-shrink:0}

    /* Summary Cards */
    .summary-grid{
      display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
      gap:1rem;margin-bottom:2rem;
    }
    .card{
      background:${COLORS.card};border:1px solid ${COLORS.border};
      border-radius:0.75rem;padding:1.25rem;text-align:center;
      box-shadow:0 1px 3px rgba(0,0,0,0.06);
    }
    .card .value{font-size:2rem;font-weight:800;line-height:1.2}
    .card .label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-top:0.25rem}
    .card--critical .value{color:${COLORS.critical}}
    .card--high .value{color:${COLORS.high}}
    .card--medium .value{color:${COLORS.medium}}
    .card--low .value{color:${COLORS.low}}
    .card--info .value{color:${COLORS.info}}
    .card--total .value{color:${COLORS.text}}
    .card--success .value{color:${COLORS.success}}

    /* Charts */
    .charts-grid{
      display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));
      gap:1.5rem;margin-bottom:2rem;
    }
    .chart-container{
      background:${COLORS.card};border:1px solid ${COLORS.border};
      border-radius:0.75rem;padding:1.5rem;
      box-shadow:0 1px 3px rgba(0,0,0,0.06);
    }
    .chart-container canvas{max-height:300px}

    /* Tables */
    .table-wrapper{
      background:${COLORS.card};border:1px solid ${COLORS.border};
      border-radius:0.75rem;overflow:hidden;margin-bottom:2rem;
      box-shadow:0 1px 3px rgba(0,0,0,0.06);
    }
    .table-wrapper h2{padding:1rem 1.5rem;border-bottom:1px solid ${COLORS.border};margin-bottom:0}
    table{width:100%;border-collapse:collapse;font-size:0.875rem}
    thead{background:#f3f4f6}
    th{padding:0.75rem 1rem;text-align:left;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap}
    th:hover{background:#e5e7eb}
    td{padding:0.625rem 1rem;border-top:1px solid ${COLORS.border};vertical-align:top}
    tr:hover td{background:#f9fafb}

    /* Severity badges */
    .sev-badge{
      display:inline-block;padding:0.125rem 0.5rem;border-radius:9999px;
      font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;
    }
    .sev-critical{background:#fef2f2;color:${COLORS.critical};border:1px solid #fecaca}
    .sev-high{background:#fff7ed;color:${COLORS.high};border:1px solid #fed7aa}
    .sev-medium{background:#fefce8;color:${COLORS.medium};border:1px solid #fef08a}
    .sev-low{background:#eff6ff;color:${COLORS.low};border:1px solid #bfdbfe}
    .sev-info{background:#f9fafb;color:${COLORS.info};border:1px solid #d1d5db}

    /* Collapsible sections */
    .collapsible{margin-bottom:1rem}
    .collapsible summary{
      cursor:pointer;padding:0.75rem 1rem;background:#f3f4f6;
      border-radius:0.5rem;font-weight:600;font-size:0.9rem;
      list-style:none;display:flex;align-items:center;gap:0.5rem;
    }
    .collapsible summary::before{content:'▶';font-size:0.7rem;transition:transform 0.2s}
    .collapsible[open] summary::before{transform:rotate(90deg)}
    .collapsible .content{padding:1rem 0}

    /* Fix badge */
    .fix-yes{color:${COLORS.success};font-weight:600}
    .fix-no{color:#9ca3af}

    /* Advisory evidence tags */
    .id-detail{margin-top:0.15rem;font-size:0.7rem;color:#6b7280}
    .src-tags{margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.25rem}
    .src-tag{display:inline-block;padding:0.05rem 0.4rem;border-radius:9999px;
      font-size:0.65rem;font-weight:600;background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe}

    /* Footer */
    .report-footer{
      text-align:center;padding:2rem 0;color:#9ca3af;font-size:0.8rem;
      border-top:1px solid ${COLORS.border};margin-top:2rem;
    }

    /* Responsive */
    @media(max-width:768px){
      .charts-grid{grid-template-columns:1fr}
      .summary-grid{grid-template-columns:repeat(2,1fr)}
      .container{padding:1rem}
      table{font-size:0.75rem}
      th,td{padding:0.5rem}
    }

    /* Noscript */
    .noscript-msg{
      background:#fef3c7;border:1px solid #f59e0b;border-radius:0.5rem;
      padding:1rem;text-align:center;color:#92400e;margin-bottom:1.5rem;
    }
  `;
}

// ─── HTML Building Blocks ────────────────────────────────────────────────────

/**
 * Builds the <head> section with meta tags and inline CSS.
 *
 * @param {string} title - Page title
 * @returns {string} Head HTML
 */
function buildHead(title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<style>${buildStyles()}</style>
</head>`;
}

/**
 * Builds the SVG logo inline.
 *
 * @returns {string} SVG markup
 */
function buildLogo() {
  return `<svg class="logo-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="10" fill="#3b82f6"/>
  <path d="M24 8L36 14v10c0 8-5 14-12 16C17 38 12 32 12 24V14L24 8z" fill="#fff" fill-opacity="0.9"/>
  <path d="M21 24l3 3 5-5" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

/**
 * Builds the report header section.
 *
 * @param {object} result - Scan result
 * @returns {string} Header HTML
 */
function buildHeader(result) {
  const scanDir = result.dir || '.';
  const timestamp = result.timestamp || new Date().toISOString();
  const typeLabel = result.type === 'audit' ? 'Vulnerability Audit' : 'Dependency Update Check';

  return `<header class="report-header">
  <div class="container">
    ${buildLogo()}
    <div>
      <h1>VulnSweep ${esc(typeLabel)} Report</h1>
      <div class="meta">
        Scanned: <strong>${esc(scanDir)}</strong> &bull;
        Generated: <strong>${formatDate(timestamp)}</strong> &bull;
        Version: <strong>v${esc(version)}</strong>
      </div>
    </div>
  </div>
</header>`;
}

/**
 * Builds the summary cards for audit reports.
 *
 * @param {object} summary - { total, critical, high, medium, low, info }
 * @returns {string} Summary cards HTML
 */
function buildAuditSummaryCards(summary) {
  const { total = 0, critical = 0, high = 0, medium = 0, low = 0, info = 0 } = summary;

  return `<div class="summary-grid">
  <div class="card card--total"><div class="value">${total}</div><div class="label">Total Vulnerabilities</div></div>
  <div class="card card--critical"><div class="value">${critical}</div><div class="label">Critical</div></div>
  <div class="card card--high"><div class="value">${high}</div><div class="label">High</div></div>
  <div class="card card--medium"><div class="value">${medium}</div><div class="label">Medium</div></div>
  <div class="card card--low"><div class="value">${low}</div><div class="label">Low</div></div>
  <div class="card card--info"><div class="value">${info}</div><div class="label">Info</div></div>
</div>`;
}

/**
 * Builds the summary cards for dependency reports.
 *
 * @param {number} totalUpdates - Total updates available
 * @param {number} highRisk - High risk updates count
 * @param {number} lowRisk - Low risk updates count
 * @returns {string} Summary cards HTML
 */
function buildDepSummaryCards(totalUpdates, highRisk, lowRisk) {
  return `<div class="summary-grid">
  <div class="card card--total"><div class="value">${totalUpdates}</div><div class="label">Total Updates Available</div></div>
  <div class="card card--high"><div class="value">${highRisk}</div><div class="label">High Risk</div></div>
  <div class="card card--success"><div class="value">${lowRisk}</div><div class="label">Low Risk</div></div>
</div>`;
}

/**
 * Builds a severity badge span.
 *
 * @param {string} severity - Severity level
 * @returns {string} Badge HTML
 */
function buildSeverityBadge(severity) {
  const sev = (severity || 'info').toLowerCase();
  const normalized = sev === 'moderate' ? 'medium' : sev;
  return `<span class="sev-badge sev-${esc(normalized)}">${esc(normalized)}</span>`;
}

/**
 * Builds the vulnerability table for a single project.
 *
 * @param {Array} vulnerabilities - Array of vulnerability objects
 * @returns {string} Table HTML
 */
function buildVulnTable(vulnerabilities) {
  if (!vulnerabilities || vulnerabilities.length === 0) {
    return '<p style="padding:1rem;color:#6b7280;">No vulnerabilities found in this project.</p>';
  }

  const rows = vulnerabilities
    .map((vuln) => {
      const sev = buildSeverityBadge(vuln.severity);
      // Evidence: prefer CVE/GHSA identifiers. Seed with the legacy `id`
      // field (still populated by some call paths / fixtures) so real IDs in
      // that field are not lost, then layer on the structured CVE/GHSA arrays.
      const legacyId = vuln.id || '';
      const ids = [
        ...(legacyId && /^(CVE-|GHSA-)/i.test(legacyId) ? [legacyId] : []),
        ...(Array.isArray(vuln.cveIds) ? vuln.cveIds : []),
        ...(Array.isArray(vuln.aliases) ? vuln.aliases : []),
      ];
      const primaryId = ids[0] || 'N/A';
      const idCell = vuln.url
        ? `<a href="${esc(vuln.url)}" target="_blank" rel="noopener">${esc(primaryId)}</a>`
        : esc(primaryId);
      // Secondary IDs: prefer working per-alias links (home-repo path) when
      // available; otherwise fall back to the raw id list.
      let idDetail = '';
      const aliasLinks = Array.isArray(vuln.aliasUrls) ? vuln.aliasUrls : [];
      if (aliasLinks.length > 0) {
        idDetail = `<div class="id-detail">${aliasLinks
          .map((u) => {
            const label = u.split('/').pop() || u;
            return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>`;
          })
          .join(', ')}</div>`;
      } else if (ids.length > 1) {
        idDetail = `<div class="id-detail">${esc(ids.slice(1).join(', '))}</div>`;
      }
      const pkg = esc(vuln.package || 'unknown');
      const ver = esc(vuln.installedVersion || '?');
      const title = esc(vuln.title || '');
      const sources =
        Array.isArray(vuln.sources) && vuln.sources.length
          ? `<div class="src-tags">${vuln.sources.map((s) => `<span class="src-tag">${esc(s)}</span>`).join(' ')}</div>`
          : '';
      const hasFix = vuln.strategy && vuln.strategy.type !== 'NO_FIX';
      const fixAvail = hasFix
        ? '<span class="fix-yes">✓ Yes</span>'
        : '<span class="fix-no">✗ No</span>';
      const fixVer = hasFix ? esc(vuln.strategy.targetVersion || vuln.patchedVersion || '—') : '—';

      return `<tr>
      <td>${sev}</td>
      <td>${idCell}${idDetail}</td>
      <td>${pkg}</td>
      <td>${ver}</td>
      <td>${title}${sources}</td>
      <td>${fixAvail}</td>
      <td>${fixVer}</td>
    </tr>`;
    })
    .join('\n');

  return `<table>
  <thead><tr>
    <th>Severity</th><th>ID</th><th>Package</th><th>Version</th><th>Title</th><th>Fix Available</th><th>Fix Version</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/**
 * Builds collapsible per-project sections for audit reports.
 *
 * @param {Array} projects - Array of project result objects
 * @returns {string} Collapsible sections HTML
 */
function buildProjectSections(projects) {
  const validProjects = projects.filter(Boolean);

  if (validProjects.length === 0) {
    return '<p style="color:#6b7280;padding:1rem;">No project data available.</p>';
  }

  return validProjects
    .map((project, idx) => {
      const name = esc(project.projectName || project.name || `Project ${idx + 1}`);
      const projPath = esc(project.projectPath || project.path || '.');
      const vulns = project.vulnerabilities || [];
      const strategies = project.strategies || [];
      // Map strategies onto vulnerabilities (index-aligned)
      const enriched = vulns.map((vuln, i) => ({
        ...vuln,
        strategy: vuln.strategy || strategies[i] || null,
      }));
      const count = vulns.length;
      const isOpen = idx === 0 ? ' open' : '';

      return `<details class="collapsible"${isOpen}>
  <summary>${name} <span style="color:#6b7280;font-weight:400;">(${projPath}) — ${count} vulnerabilit${count === 1 ? 'y' : 'ies'}</span></summary>
  <div class="content">${buildVulnTable(enriched)}</div>
</details>`;
    })
    .join('\n');
}

/**
 * Builds collapsible per-project sections for dependency reports.
 *
 * @param {Array} projects - Array of project result objects
 * @returns {string} Collapsible sections HTML
 */
function buildDepProjectSections(projects) {
  const validProjects = projects.filter(Boolean);

  if (validProjects.length === 0) {
    return '<p style="color:#6b7280;padding:1rem;">No project data available.</p>';
  }

  return validProjects
    .map((project, idx) => {
      const updates = Array.isArray(project)
        ? extractUpdatesFromArray(project)
        : project.updates || project.candidates || extractUpdatesFromArray([project]);

      const name = esc(
        Array.isArray(project)
          ? `Project ${idx + 1}`
          : project.projectName || project.name || `Project ${idx + 1}`
      );
      const projPath = esc(
        Array.isArray(project) ? '.' : project.projectPath || project.path || '.'
      );
      const count = updates.length;
      const isOpen = idx === 0 ? ' open' : '';

      if (count === 0) {
        return `<details class="collapsible"${isOpen}>
  <summary>${name} <span style="color:#6b7280;font-weight:400;">(${projPath}) — Up to date</span></summary>
  <div class="content"><p style="padding:1rem;color:#6b7280;">All dependencies are up to date.</p></div>
</details>`;
      }

      const rows = updates
        .map((dep) => {
          const riskLevel = (dep.riskLevel || 'Low').toLowerCase();
          const riskBadge =
            riskLevel === 'high'
              ? `<span class="sev-badge sev-high">High</span>`
              : `<span class="sev-badge sev-low">Low</span>`;
          const updateType = esc(dep.updateType || '—');

          return `<tr>
        <td>${esc(dep.name || 'unknown')}</td>
        <td>${esc(dep.currentVersion || '?')}</td>
        <td>${esc(dep.recommendedVersion || dep.latestVersion || '?')}</td>
        <td>${esc(dep.latestVersion || '?')}</td>
        <td>${riskBadge}</td>
        <td>${updateType}</td>
      </tr>`;
        })
        .join('\n');

      const table = `<table>
  <thead><tr>
    <th>Package</th><th>Current</th><th>Recommended</th><th>Latest</th><th>Risk Level</th><th>Update Type</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;

      return `<details class="collapsible"${isOpen}>
  <summary>${name} <span style="color:#6b7280;font-weight:400;">(${projPath}) — ${count} update${count === 1 ? '' : 's'}</span></summary>
  <div class="content">${table}</div>
</details>`;
    })
    .join('\n');
}

/**
 * Builds the footer section.
 *
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Footer HTML
 */
function buildFooter(timestamp) {
  return `<footer class="report-footer">
  Generated by VulnSweep CLI v${esc(version)} &bull; ${formatDate(timestamp)}
</footer>`;
}

// ─── Chart Scripts ───────────────────────────────────────────────────────────

/**
 * Builds Chart.js script for audit severity doughnut chart.
 *
 * @param {object} summary - Severity summary counts
 * @returns {string} Script tag content
 */
function buildAuditChartScript(summary) {
  const { critical = 0, high = 0, medium = 0, low = 0, info = 0 } = summary;

  return `
<script>
(function() {
  if (typeof Chart === 'undefined') return;

  // Severity Doughnut
  var sevCtx = document.getElementById('severityChart');
  if (sevCtx) {
    new Chart(sevCtx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low', 'Info'],
        datasets: [{
          data: [${critical}, ${high}, ${medium}, ${low}, ${info}],
          backgroundColor: ['${COLORS.critical}', '${COLORS.high}', '${COLORS.medium}', '${COLORS.low}', '${COLORS.info}'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } },
          title: { display: true, text: 'Severity Distribution', font: { size: 14 } }
        }
      }
    });
  }

  // Top Affected Packages Bar Chart
  var pkgCtx = document.getElementById('packagesChart');
  if (pkgCtx && window.__VS_PKG_DATA) {
    new Chart(pkgCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: window.__VS_PKG_DATA.labels,
        datasets: [{
          label: 'Vulnerabilities',
          data: window.__VS_PKG_DATA.counts,
          backgroundColor: '${COLORS.high}',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Top Affected Packages', font: { size: 14 } }
        },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }
})();
</script>`;
}

/**
 * Builds Chart.js script for dependency update charts.
 *
 * @param {number} highRisk - High risk update count
 * @param {number} lowRisk - Low risk update count
 * @param {object} typeCounts - { patch, minor, major }
 * @returns {string} Script tag content
 */
function buildDepChartScript(highRisk, lowRisk, typeCounts) {
  const { patch = 0, minor = 0, major = 0 } = typeCounts;

  return `
<script>
(function() {
  if (typeof Chart === 'undefined') return;

  // Risk Distribution Pie
  var riskCtx = document.getElementById('riskChart');
  if (riskCtx) {
    new Chart(riskCtx.getContext('2d'), {
      type: 'pie',
      data: {
        labels: ['High Risk', 'Low Risk'],
        datasets: [{
          data: [${highRisk}, ${lowRisk}],
          backgroundColor: ['${COLORS.high}', '${COLORS.success}'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } },
          title: { display: true, text: 'Risk Distribution', font: { size: 14 } }
        }
      }
    });
  }

  // Update Type Bar Chart
  var typeCtx = document.getElementById('updateTypeChart');
  if (typeCtx) {
    new Chart(typeCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Patch', 'Minor', 'Major'],
        datasets: [{
          label: 'Updates',
          data: [${patch}, ${minor}, ${major}],
          backgroundColor: ['${COLORS.success}', '${COLORS.low}', '${COLORS.high}'],
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Update Type Distribution', font: { size: 14 } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }
})();
</script>`;
}

// ─── Full Report Builders ────────────────────────────────────────────────────

/**
 * Computes package vulnerability frequency for the top affected packages chart.
 *
 * @param {Array} projects - Array of project result objects
 * @param {number} limit - Max number of packages to show
 * @returns {{ labels: string[], counts: number[] }}
 */
function computeTopPackages(projects, limit = 10) {
  const freq = {};
  for (const project of projects.filter(Boolean)) {
    for (const vuln of project.vulnerabilities || []) {
      const pkg = vuln.package || 'unknown';
      freq[pkg] = (freq[pkg] || 0) + 1;
    }
  }

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  return {
    labels: sorted.map((e) => e[0]),
    counts: sorted.map((e) => e[1]),
  };
}

/**
 * Computes update type distribution across all dependency results.
 *
 * @param {Array} projects - Array of project result objects
 * @returns {{ patch: number, minor: number, major: number, highRisk: number, lowRisk: number }}
 */
function computeDepStats(projects) {
  let patch = 0;
  let minor = 0;
  let major = 0;
  let highRisk = 0;
  let lowRisk = 0;

  for (const project of projects.filter(Boolean)) {
    const updates = Array.isArray(project)
      ? extractUpdatesFromArray(project)
      : project.updates || project.candidates || extractUpdatesFromArray([project]);

    for (const dep of updates) {
      const type = (dep.updateType || '').toLowerCase();
      if (type === 'patch') patch++;
      else if (type === 'minor') minor++;
      else if (type === 'major') major++;

      const risk = (dep.riskLevel || 'Low').toLowerCase();
      if (risk === 'high') highRisk++;
      else lowRisk++;
    }
  }

  return { patch, minor, major, highRisk, lowRisk };
}

/**
 * Builds the complete audit report HTML.
 *
 * @param {object} result - Scan result from runner
 * @returns {string} Full HTML document string
 */
function buildAuditHtml(result) {
  const summary = result.summary || { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const projects = result.projects || [];
  const timestamp = result.timestamp || new Date().toISOString();
  const topPackages = computeTopPackages(projects);

  return `${buildHead('VulnSweep Audit Report')}
<body>
${buildHeader(result)}
<main class="container">
  <noscript><div class="noscript-msg">Charts require JavaScript to render. Data tables below are still accessible.</div></noscript>

  ${buildAuditSummaryCards(summary)}

  <div class="charts-grid">
    <div class="chart-container">
      <canvas id="severityChart"></canvas>
    </div>
    <div class="chart-container">
      <canvas id="packagesChart"></canvas>
    </div>
  </div>

  <div class="table-wrapper">
    <h2>Per-Project Breakdown</h2>
    <div style="padding:1rem;">
      ${buildProjectSections(projects)}
    </div>
  </div>
</main>
${buildFooter(timestamp)}
<script>window.__VS_PKG_DATA=${JSON.stringify(topPackages)};</script>
<script src="${CHART_CDN}"></script>
${buildAuditChartScript(summary)}
</body>
</html>`;
}

/**
 * Builds the complete dependency report HTML.
 *
 * @param {object} result - Scan result from runner
 * @returns {string} Full HTML document string
 */
function buildDependencyHtml(result) {
  const projects = result.projects || [];
  const timestamp = result.timestamp || new Date().toISOString();
  const stats = computeDepStats(projects);

  const totalUpdates = stats.patch + stats.minor + stats.major;

  return `${buildHead('VulnSweep Dependency Report')}
<body>
${buildHeader(result)}
<main class="container">
  <noscript><div class="noscript-msg">Charts require JavaScript to render. Data tables below are still accessible.</div></noscript>

  ${buildDepSummaryCards(totalUpdates, stats.highRisk, stats.lowRisk)}

  <div class="charts-grid">
    <div class="chart-container">
      <canvas id="riskChart"></canvas>
    </div>
    <div class="chart-container">
      <canvas id="updateTypeChart"></canvas>
    </div>
  </div>

  <div class="table-wrapper">
    <h2>Per-Project Updates</h2>
    <div style="padding:1rem;">
      ${buildDepProjectSections(projects)}
    </div>
  </div>
</main>
${buildFooter(timestamp)}
<script src="${CHART_CDN}"></script>
${buildDepChartScript(stats.highRisk, stats.lowRisk, stats)}
</body>
</html>`;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Generates a self-contained HTML report and writes it to disk.
 *
 * @param {object} result - Scan result from runner.js
 * @param {object} opts - Options
 * @param {string} opts.reportDir - Target directory for the HTML file
 * @returns {Promise<string>} Absolute path to the written HTML file
 */
async function generateHtmlReport(result, opts) {
  const { reportDir } = opts;

  // Create directory if it doesn't exist
  mkdirSync(reportDir, { recursive: true });

  // Build date stamp for filename
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const filename = `vulnsweep-report-${dateStr}.html`;
  const filePath = path.join(reportDir, filename);

  // Attach dir info to result for header rendering
  const enrichedResult = { ...result, dir: opts.dir || result.dir || '.' };

  // Generate HTML based on scan type
  const html =
    enrichedResult.type === 'dependency'
      ? buildDependencyHtml(enrichedResult)
      : buildAuditHtml(enrichedResult);

  // Write file
  writeFileSync(filePath, html, 'utf8');

  return path.resolve(filePath);
}

module.exports = { generateHtmlReport };
