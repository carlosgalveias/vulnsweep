/* eslint-disable react/prop-types */
import { OP_SBOM_GET_SAVE_PATH, OP_SBOM_EXPORT } from '@shared/renderer-api-opcodes.js';
import { Download } from 'lucide-react';
import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { LICENSE_TIER_COLORS } from '../constants';

const TIER_PALETTES = {
  safe: ['#22c55e', '#16a34a', '#4ade80', '#86efac', '#bbf7d0', '#15803d'],
  warning: ['#f59e0b', '#d97706', '#fbbf24', '#fde68a', '#b45309', '#fcd34d'],
  dangerous: ['#ef4444', '#dc2626', '#f87171', '#fca5a5', '#b91c1c', '#fee2e2'],
  unknown: ['#6b7280', '#4b5563', '#9ca3af', '#d1d5db', '#374151', '#e5e7eb'],
};

function getTierForLicense(spdxId) {
  const SAFE = new Set([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'Unlicense',
    'CC0-1.0',
    'Python-2.0',
    'BlueOak-1.0.0',
  ]);
  const WARNING = new Set([
    'LGPL-2.0-only',
    'LGPL-2.1-only',
    'LGPL-3.0-only',
    'LGPL-2.0-or-later',
    'LGPL-2.1-or-later',
    'LGPL-3.0-or-later',
    'MPL-2.0',
    'CDDL-1.0',
    'EPL-1.0',
    'EPL-2.0',
    'EUPL-1.1',
    'EUPL-1.2',
  ]);
  const DANGEROUS = new Set([
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'SSPL-1.0',
  ]);
  if (spdxId === 'UNKNOWN') return 'unknown';
  if (SAFE.has(spdxId)) return 'safe';
  if (WARNING.has(spdxId)) return 'warning';
  if (DANGEROUS.has(spdxId)) return 'dangerous';
  return 'unknown';
}

function SpinnerSvg() {
  return (
    <svg className="w-4 h-4 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function LicenseTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-surface-raised border border-gray-600 rounded px-3 py-2 text-xs shadow-lg">
      <span className="font-semibold" style={{ color: entry.payload && entry.payload.fill }}>
        {entry.name}
      </span>
      <span className="text-gray-300 ml-2">{entry.value}</span>
    </div>
  );
}

function LicensesTab({ licenseResult, isScanning, scanError }) {
  const [exportFormat, setExportFormat] = useState('cyclonedx');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const stats = licenseResult
    ? licenseResult.stats
    : { total: 0, safe: 0, warning: 0, dangerous: 0, unknown: 0 };

  // Per-license-identifier donut chart data (R3)
  const pieData = useMemo(() => {
    if (!licenseResult?.byLicense) return [];
    const tierIdx = { safe: 0, warning: 0, dangerous: 0, unknown: 0 };
    return Object.entries(licenseResult.byLicense)
      .map(([name, value]) => {
        const tier = getTierForLicense(name);
        const palette = TIER_PALETTES[tier];
        const fill = palette[tierIdx[tier] % palette.length];
        tierIdx[tier] += 1;
        return { name, value, fill, tier };
      })
      .sort((a, b) => b.value - a.value);
  }, [licenseResult]);

  const atRiskEntries = useMemo(
    () =>
      (licenseResult ? licenseResult.entries : []).filter(
        (e) => e.riskTier === 'warning' || e.riskTier === 'dangerous'
      ),
    [licenseResult]
  );

  const unknownEntries = useMemo(
    () => (licenseResult ? licenseResult.entries : []).filter((e) => e.riskTier === 'unknown'),
    [licenseResult]
  );

  async function handleExportSbom() {
    setIsExporting(true);
    setExportError(null);
    setExportSuccess(false);
    try {
      const saveRes = await window.electronAPI.invoke(OP_SBOM_GET_SAVE_PATH, {
        format: exportFormat,
      });
      if (saveRes.canceled || !saveRes.filePath) return;
      const exportRes = await window.electronAPI.invoke(OP_SBOM_EXPORT, {
        licenseResult,
        format: exportFormat,
        outputPath: saveRes.filePath,
      });
      if (exportRes.success) {
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 3000);
      } else {
        setExportError(exportRes.error || 'Export failed');
      }
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  }

  if (isScanning) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-8 justify-center">
        <SpinnerSvg />
        <span>Scanning licenses...</span>
      </div>
    );
  }

  if (!licenseResult && !scanError) {
    return (
      <div className="flex flex-col h-full p-4 bg-surface text-gray-100">
        <div className="text-center text-gray-400 text-xs py-8">
          Run an audit scan to see license data.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 overflow-auto bg-surface text-gray-100">
      {scanError && (
        <div className="mb-3 px-3 py-2 bg-red-900 bg-opacity-50 border border-red-700 rounded text-xs text-red-300">
          Scan error: {scanError}
        </div>
      )}
      {exportSuccess && (
        <div className="mb-3 px-3 py-2 bg-green-900 bg-opacity-50 border border-green-700 rounded text-xs text-green-300">
          SBOM exported successfully.
        </div>
      )}
      {exportError && (
        <div className="mb-3 px-3 py-2 bg-red-900 bg-opacity-50 border border-red-700 rounded text-xs text-red-300">
          Export error: {exportError}
        </div>
      )}
      {licenseResult && (
        <div className="flex items-center justify-end gap-2 mb-4">
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value)}
            className="bg-surface text-gray-100 text-xs rounded border border-gray-600 px-2 py-1"
          >
            <option value="cyclonedx">CycloneDX JSON v1.6</option>
            <option value="spdx">SPDX JSON v2.3</option>
            <option value="csv">CSV</option>
          </select>
          <button
            onClick={handleExportSbom}
            disabled={isExporting || !licenseResult}
            className="compact-btn bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isExporting ? <SpinnerSvg /> : <Download className="w-3.5 h-3.5" />}
            Export SBOM
          </button>
        </div>
      )}
      {licenseResult && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gridTemplateRows: 'repeat(4, auto)',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div className="bg-surface-raised border border-gray-700 rounded-lg px-5 py-3 text-center flex flex-col items-center justify-center">
            <div className="text-3xl font-bold text-white">{stats.total}</div>
            <div className="text-xs text-gray-400 mt-0.5">Total Packages</div>
          </div>
          <div className="bg-surface-raised border border-gray-700 rounded-lg px-5 py-3 text-center flex flex-col items-center justify-center">
            <div className="text-3xl font-bold" style={{ color: LICENSE_TIER_COLORS.warning }}>
              {stats.warning}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">Warnings</div>
          </div>
          <div className="bg-surface-raised border border-gray-700 rounded-lg px-5 py-3 text-center flex flex-col items-center justify-center">
            <div className="text-3xl font-bold" style={{ color: LICENSE_TIER_COLORS.dangerous }}>
              {stats.dangerous}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">Potential Problems</div>
          </div>
          <div className="bg-surface-raised border border-gray-700 rounded-lg px-5 py-3 text-center flex flex-col items-center justify-center">
            <div className="text-3xl font-bold" style={{ color: LICENSE_TIER_COLORS.unknown }}>
              {stats.unknown || 0}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">Need Review</div>
          </div>
          <div
            style={{ gridColumn: '2', gridRow: '1 / 5' }}
            className="bg-surface-raised border border-gray-700 rounded-lg p-4 flex flex-col"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              License Distribution
            </h3>
            {pieData.length > 0 ? (
              <>
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
                    >
                      {pieData.map((entry) => (
                        <Cell key={`cell-${entry.name}`} fill={entry.fill} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<LicenseTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                  {pieData.map((entry) => (
                    <div
                      key={entry.name}
                      className="flex items-center gap-1.5 text-xs text-gray-300"
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: entry.fill }}
                      />
                      <span>{entry.name}</span>
                      <span className="text-gray-500 font-mono">({entry.value})</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-xs text-gray-500 text-center mt-8">No data</div>
            )}
          </div>
        </div>
      )}
      {licenseResult && atRiskEntries.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            At-Risk Packages ({atRiskEntries.length})
          </h3>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-1.5 pr-3 font-medium">Package</th>
                  <th className="py-1.5 pr-3 font-medium">Version</th>
                  <th className="py-1.5 pr-3 font-medium">License</th>
                  <th className="py-1.5 pr-3 font-medium">Risk</th>
                  <th className="py-1.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {atRiskEntries.map((entry) => (
                  <tr key={entry.purl} className="border-b border-gray-800 hover:bg-surface-raised">
                    <td className="py-1.5 pr-3 font-mono text-gray-100">
                      <a
                        href={`https://www.npmjs.com/package/${entry.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline"
                      >
                        {entry.name}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-gray-300">{entry.version}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{entry.license}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: `${LICENSE_TIER_COLORS[entry.riskTier]}33`,
                          color: LICENSE_TIER_COLORS[entry.riskTier],
                        }}
                      >
                        {entry.riskTier}
                      </span>
                    </td>
                    <td className="py-1.5 text-gray-400 text-xs max-w-xs truncate">
                      {entry.description || '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {licenseResult && unknownEntries.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Licenses Needing Review ({unknownEntries.length})
          </h3>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-1.5 pr-3 font-medium">Package</th>
                  <th className="py-1.5 pr-3 font-medium">Version</th>
                  <th className="py-1.5 pr-3 font-medium">License</th>
                  <th className="py-1.5 pr-3 font-medium">Risk</th>
                  <th className="py-1.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {unknownEntries.map((entry) => (
                  <tr key={entry.purl} className="border-b border-gray-800 hover:bg-surface-raised">
                    <td className="py-1.5 pr-3 font-mono text-gray-100">
                      <a
                        href={`https://www.npmjs.com/package/${entry.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline"
                      >
                        {entry.name}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-gray-300">{entry.version}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {entry.licenseRaw || entry.license}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: '#6b728033', color: '#6b7280' }}
                      >
                        Unknown
                      </span>
                    </td>
                    <td className="py-1.5 text-gray-500 text-xs">
                      License not recognised — review manually
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default LicensesTab;
