import PropTypes from 'prop-types';
import { useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const normalizeSeverity = (s) => {
  if (s == null) return 'unknown';
  const lower = s.toLowerCase();
  return lower === 'moderate' ? 'medium' : lower;
};

// Severity tier rank: higher number = more severe
const SEVERITY_TIER = { critical: 5, high: 4, medium: 3, moderate: 3, low: 2, info: 1 };

/**
 * Returns the effective severity for a vulnerability, preferring
 * enrichment.mergedSeverity if it is strictly higher than vuln.severity.
 * Treats "moderate" and "medium" as equivalent (both rank 3).
 */
function getEffectiveSeverity(vuln) {
  const base = normalizeSeverity(vuln.severity);
  const merged = vuln.enrichment?.mergedSeverity
    ? normalizeSeverity(vuln.enrichment.mergedSeverity)
    : null;
  if (merged && (SEVERITY_TIER[merged] ?? 0) > (SEVERITY_TIER[base] ?? 0)) {
    return merged;
  }
  return base;
}

const SEVERITY_CONFIG = {
  critical: { color: '#dc2626', label: 'Critical' },
  high: { color: '#ea580c', label: 'High' },
  medium: { color: '#eab308', label: 'Medium' },
  low: { color: '#2563eb', label: 'Low' },
  info: { color: '#4b5563', label: 'Info' },
  unknown: { color: '#4b5563', label: 'Unknown' },
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info', 'unknown'];

function calculateGrade(vulns) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  vulns.forEach((v) => {
    const s = getEffectiveSeverity(v);
    if (s in counts) counts[s]++;
  });
  if (counts.critical > 0) return 'F';
  if (counts.high >= 5) return 'D';
  if (counts.high >= 1) return 'C';
  if (counts.medium >= 5) return 'C';
  if (counts.medium >= 1) return 'B';
  if (counts.low >= 1) return 'B';
  return 'A';
}

const GRADE_COLOR = { A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#ea580c', F: '#dc2626' };

function DonutCentreLabel({ viewBox, total }) {
  const cx = viewBox ? viewBox.cx : 0;
  const cy = viewBox ? viewBox.cy : 0;
  return (
    <g>
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#f3f4f6"
        style={{ fontSize: '1.75rem', fontWeight: 700 }}
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#9ca3af"
        style={{ fontSize: '0.65rem' }}
      >
        total vulns
      </text>
    </g>
  );
}
DonutCentreLabel.propTypes = {
  viewBox: PropTypes.shape({ cx: PropTypes.number, cy: PropTypes.number }),
  total: PropTypes.number.isRequired,
};
DonutCentreLabel.defaultProps = { viewBox: { cx: 0, cy: 0 } };

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-surface-raised border border-gray-600 rounded px-3 py-2 text-xs shadow-lg">
      <span
        className="capitalize font-semibold"
        style={{ color: entry.payload ? entry.payload.fill : undefined }}
      >
        {entry.name}
      </span>
      <span className="text-gray-300 ml-2">{entry.value}</span>
    </div>
  );
}
CustomTooltip.propTypes = { active: PropTypes.bool, payload: PropTypes.array };
CustomTooltip.defaultProps = { active: false, payload: [] };

/** Capitalises first letter; returns em-dash for falsy input. */
function capitalize(str) {
  if (!str) return '—';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Builds a plain-text Sources string for a PDF cell (no HTML).
 * Each confirmed source appears on its own line with its URL.
 */
function buildSourcesText(enrichment) {
  if (!enrichment || !enrichment.sources) return '—';
  const parts = [];
  const { osv, nvd, github } = enrichment.sources;
  if (osv && osv.found) {
    parts.push(osv.url ? `OSV: ${osv.url}` : 'OSV');
  }
  if (nvd && nvd.found) {
    parts.push(nvd.url ? `NVD: ${nvd.url}` : 'NVD');
  }
  if (github && github.found) {
    parts.push(github.url ? `GitHub Advisory: ${github.url}` : 'GitHub Advisory');
  }
  return parts.length > 0 ? parts.join('\n') : '—';
}

async function exportToPdf(total, pieData, repoRows, cveRows, allVulns) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  // Landscape so the Cross-Source correlation table fits on A4
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const dateSlug = now.toISOString().slice(0, 10);
  const pdfTitle = `VulnSweep Vulnerability Report - ${dateLabel}`;
  const fileName = `vulnsweep_vulnerability_report_${dateSlug}.pdf`;

  doc.setFontSize(16);
  doc.setTextColor(30, 30, 30);
  doc.text(pdfTitle, 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${now.toLocaleString()}`, 14, 25);
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(`Total Vulnerabilities: ${String(total)}`, 14, 34);
  doc.setFontSize(10);
  doc.text('Severity Breakdown', 14, 42);

  autoTable(doc, {
    startY: 45,
    head: [['Severity', 'Count']],
    body: pieData.map((r) => [r.name, String(r.value)]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55] },
  });

  const y1 = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text('Repository Security Rank', 14, y1);
  autoTable(doc, {
    startY: y1 + 3,
    head: [['Repository', 'Critical', 'High', 'Medium', 'Low', 'Info', 'Grade']],
    body: repoRows.map((r) => [
      r.projectName,
      String(r.critical),
      String(r.high),
      String(r.medium),
      String(r.low),
      String(r.info),
      r.grade,
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55] },
  });

  const y2 = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text('CVE Details', 14, y2);
  autoTable(doc, {
    startY: y2 + 3,
    head: [['Repository', 'CVE ID', 'Package', 'Severity', 'Title', 'URL']],
    body: cveRows.map((r) => [
      r.projectName,
      r.cweId,
      r.package,
      r.severity,
      r.title || '',
      r.url || '',
    ]),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 5: { cellWidth: 60 } },
  });

  const enrichedVulns = (allVulns || []).filter(
    (v) => v.enrichment && (v.enrichment.status === 'enriched' || v.enrichment.status === 'partial')
  );
  const enrichedCount = enrichedVulns.length;
  const discrepancyCount = enrichedVulns.filter(
    (v) => v.enrichment.severityDiscrepancy === true
  ).length;
  const effectiveCritical = (allVulns || []).filter(
    (v) => getEffectiveSeverity(v) === 'critical'
  ).length;
  const effectiveHigh = (allVulns || []).filter((v) => getEffectiveSeverity(v) === 'high').length;

  const y3 = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text('Cross-Source CVE Correlation', 14, y3);

  autoTable(doc, {
    startY: y3 + 3,
    head: [['Metric', 'Value']],
    body: [
      ['Enriched Vulnerabilities', String(enrichedCount)],
      ['Severity Disagreements', String(discrepancyCount)],
      ['Critical (effective)', String(effectiveCritical)],
      ['High (effective)', String(effectiveHigh)],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 30 } },
  });

  if (enrichedVulns.length > 0) {
    const y4 = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text('Correlation Details', 14, y4);

    const correlationBody = enrichedVulns.map((v) => {
      const npmSev = capitalize(v.severity);
      const effSev = getEffectiveSeverity(v);
      const isUpgraded = effSev !== normalizeSeverity(v.severity);
      const effSevLabel = isUpgraded ? `${capitalize(effSev)} ▲` : capitalize(effSev);
      const sourcesText = buildSourcesText(v.enrichment);
      const aliases =
        v.enrichment.allAliases && v.enrichment.allAliases.length > 0
          ? v.enrichment.allAliases.join(', ')
          : '—';
      const discrepancy = v.enrichment.severityDiscrepancy
        ? v.enrichment.discrepancyDetails || 'Severity mismatch'
        : '—';
      return [v.name || v.package || '—', npmSev, effSevLabel, sourcesText, aliases, discrepancy];
    });

    autoTable(doc, {
      startY: y4 + 3,
      head: [
        ['Package', 'npm Severity', 'Effective Severity', 'Sources', 'Aliases', 'Discrepancy'],
      ],
      body: correlationBody,
      styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 22 },
        2: { cellWidth: 28 },
        3: { cellWidth: 90 },
        4: { cellWidth: 45 },
        5: { cellWidth: 50 },
      },
      didParseCell(data) {
        if (data.column.index === 5 && data.section === 'body') {
          const cellText = data.cell.raw;
          if (cellText && cellText !== '—') {
            data.cell.styles.fillColor = [255, 243, 205];
            data.cell.styles.textColor = [120, 80, 0];
          }
        }
      },
    });
  }
  doc.save(fileName);
}

function StatisticsTab({ vulnerabilities, hasScanned }) {
  const total = vulnerabilities.length;

  const pieData = useMemo(() => {
    const counts = {};
    vulnerabilities.forEach((v) => {
      const s = getEffectiveSeverity(v);
      const bucket = s in SEVERITY_CONFIG ? s : 'unknown';
      counts[bucket] = (counts[bucket] || 0) + 1;
    });
    return SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => ({
      name: SEVERITY_CONFIG[s].label,
      value: counts[s],
      fill: SEVERITY_CONFIG[s].color,
    }));
  }, [vulnerabilities]);

  const repoRows = useMemo(() => {
    const byRepo = {};
    vulnerabilities.forEach((v) => {
      if (!byRepo[v.projectName]) byRepo[v.projectName] = [];
      byRepo[v.projectName].push(v);
    });
    return Object.entries(byRepo)
      .map(([projectName, vulns]) => {
        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        vulns.forEach((v) => {
          const s = getEffectiveSeverity(v);
          if (s in counts) counts[s]++;
          else counts.info++;
        });
        return { projectName, ...counts, grade: calculateGrade(vulns) };
      })
      .sort((a, b) => {
        const o = { F: 0, D: 1, C: 2, B: 3, A: 4 };
        return (o[a.grade] ?? 5) - (o[b.grade] ?? 5);
      });
  }, [vulnerabilities]);

  const cveRows = useMemo(() => {
    return vulnerabilities
      .filter((v) => v.title || v.url)
      .map((v) => ({
        projectName: v.projectName,
        cweId: v.cwe?.[0] ?? '—',
        package: v.package,
        severity: getEffectiveSeverity(v),
        title: v.title || '',
        url: v.url || '',
        installedVersion: v.installedVersion || '',
        patchedVersion: v.patchedVersion || 'N/A',
      }))
      .sort((a, b) => {
        const o = { critical: 0, high: 1, medium: 2, low: 3, info: 4, unknown: 5 };
        return (o[a.severity] ?? 6) - (o[b.severity] ?? 6);
      });
  }, [vulnerabilities]);
  const handleExportPdf = useCallback(() => {
    exportToPdf(total, pieData, repoRows, cveRows, vulnerabilities).catch((err) =>
      console.error('PDF export failed:', err)
    );
  }, [total, pieData, repoRows, cveRows, vulnerabilities]);

  if (!hasScanned) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <svg
          className="w-16 h-16 mb-4 text-gray-700"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <p className="text-sm font-medium">Scan to create report</p>
        <p className="text-xs mt-1">Run a scan to generate statistics and the security report</p>
      </div>
    );
  }

  if (hasScanned && total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-100">
        <div className="bg-surface-raised border border-gray-700 rounded-lg p-8 flex flex-col items-center gap-4 max-w-sm w-full mx-auto">
          <span className="text-6xl font-bold" style={{ color: GRADE_COLOR['A'] }}>
            A
          </span>
          <div className="text-center">
            <p className="text-lg font-semibold text-white">0 vulnerabilities</p>
            <p className="text-sm text-gray-400 mt-1">All scanned projects are secure</p>
          </div>
          <div className="w-full border-t border-gray-700 pt-4 grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-white">0</div>
              <div className="text-xs text-gray-400 mt-0.5">Total Vulnerabilities</div>
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ color: GRADE_COLOR['A'] }}>
                A
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Security Grade</div>
            </div>
          </div>
          <p className="text-xs text-gray-500 text-center">
            No vulnerabilities detected. Your projects meet the highest security standard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-surface text-gray-100">
      <div className="p-4 space-y-6">
        <div className="flex items-center justify-end">
          <button
            onClick={handleExportPdf}
            className="compact-btn bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Export PDF
          </button>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-4 items-stretch">
          <div className="flex flex-col gap-4 h-full">
            <div className="bg-surface-raised border border-gray-700 rounded-lg px-5 py-3 text-center flex-1 flex flex-col items-center justify-center">
              <div className="text-3xl font-bold text-white">{total}</div>
              <div className="text-xs text-gray-400 mt-0.5">Total Vulnerabilities</div>
            </div>
            <div className="bg-surface-raised border border-gray-700 rounded-lg px-5 py-3 text-center flex-1 flex flex-col items-center justify-center">
              <div className="text-3xl font-bold text-white">{repoRows.length}</div>
              <div className="text-xs text-gray-400 mt-0.5">Repositories</div>
            </div>
          </div>
          <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 flex flex-col">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Severity Distribution
            </h3>
            <div className="flex flex-col items-center flex-1">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    labelLine={false}
                    label={<DonutCentreLabel total={total} />}
                  >
                    {pieData.map((entry) => (
                      <Cell key={`cell-${entry.name}`} fill={entry.fill} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                {pieData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs text-gray-300">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: entry.fill }}
                    />
                    <span className="capitalize">{entry.name}</span>
                    <span className="text-gray-500 font-mono">({entry.value})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-surface-raised border border-gray-700 rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
            Repository Security Rank
          </h3>
          <div className="overflow-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-[0.65rem] uppercase bg-surface text-gray-400 sticky top-0">
                <tr>
                  <th className="compact-cell">Repository</th>
                  <th className="compact-cell text-center" style={{ color: '#dc2626' }}>
                    Critical
                  </th>
                  <th className="compact-cell text-center" style={{ color: '#ea580c' }}>
                    High
                  </th>
                  <th className="compact-cell text-center" style={{ color: '#eab308' }}>
                    Medium
                  </th>
                  <th className="compact-cell text-center" style={{ color: '#2563eb' }}>
                    Low
                  </th>
                  <th className="compact-cell text-center" style={{ color: '#4b5563' }}>
                    Info
                  </th>
                  <th className="compact-cell text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {repoRows.map((row, i) => (
                  <tr
                    key={row.projectName}
                    className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-surface' : 'bg-surface-mid'}`}
                  >
                    <td className="compact-cell font-medium text-gray-200">{row.projectName}</td>
                    <td className="compact-cell text-center">
                      {row.critical > 0 ? (
                        <span style={{ color: '#dc2626' }} className="font-bold">
                          {row.critical}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="compact-cell text-center">
                      {row.high > 0 ? (
                        <span style={{ color: '#ea580c' }} className="font-bold">
                          {row.high}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="compact-cell text-center">
                      {row.medium > 0 ? (
                        <span style={{ color: '#eab308' }} className="font-bold">
                          {row.medium}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="compact-cell text-center">
                      {row.low > 0 ? (
                        <span style={{ color: '#2563eb' }} className="font-bold">
                          {row.low}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="compact-cell text-center">
                      {row.info > 0 ? (
                        <span style={{ color: '#4b5563' }} className="font-bold">
                          {row.info}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="compact-cell text-center">
                      <span
                        className="compact-badge rounded font-bold text-white"
                        style={{ backgroundColor: GRADE_COLOR[row.grade] || '#4b5563' }}
                      >
                        {row.grade}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-surface-raised border border-gray-700 rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
            CVE Details
          </h3>
          <div className="overflow-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-[0.65rem] uppercase bg-surface text-gray-400 sticky top-0">
                <tr>
                  <th className="compact-cell">Repository</th>
                  <th className="compact-cell">CVE ID</th>
                  <th className="compact-cell">Package</th>
                  <th className="compact-cell">Severity</th>
                  <th className="compact-cell">Title</th>
                  <th className="compact-cell">Version</th>
                  <th className="compact-cell">Patched</th>
                </tr>
              </thead>
              <tbody>
                {cveRows.map((row, i) => {
                  const cweNum = row.cweId !== '—' ? row.cweId.replace(/[^0-9]/g, '') : null;
                  return (
                    <tr
                      key={`${row.projectName}-${row.package}-${i}`}
                      className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-surface' : 'bg-surface-mid'}`}
                    >
                      <td className="compact-cell text-gray-200 font-medium">{row.projectName}</td>
                      <td className="compact-cell font-mono text-[0.65rem]">
                        {cweNum ? (
                          <a
                            href={`https://cwe.mitre.org/data/definitions/${cweNum}.html`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline"
                          >
                            {row.cweId}
                          </a>
                        ) : (
                          <span className="text-gray-500">{row.cweId}</span>
                        )}
                      </td>
                      <td className="compact-cell font-mono text-[0.65rem] text-gray-300">
                        {row.package}
                      </td>
                      <td className="compact-cell">
                        <span
                          className="compact-badge rounded font-semibold text-white capitalize"
                          style={{
                            backgroundColor: SEVERITY_CONFIG[row.severity]
                              ? SEVERITY_CONFIG[row.severity].color
                              : '#4b5563',
                          }}
                        >
                          {row.severity}
                        </span>
                      </td>
                      <td className="compact-cell text-gray-300 max-w-xs">
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline"
                          >
                            {row.title || row.url}
                          </a>
                        ) : (
                          <span>{row.title || '—'}</span>
                        )}
                      </td>
                      <td className="compact-cell font-mono text-[0.65rem] text-gray-400">
                        {row.installedVersion}
                      </td>
                      <td className="compact-cell font-mono text-[0.65rem] text-green-400">
                        {row.patchedVersion}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

StatisticsTab.propTypes = {
  vulnerabilities: PropTypes.array.isRequired,
  hasScanned: PropTypes.bool,
};
StatisticsTab.defaultProps = { vulnerabilities: [], hasScanned: false };

export default StatisticsTab;
