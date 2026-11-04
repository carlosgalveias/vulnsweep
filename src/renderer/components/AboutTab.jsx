/* eslint-disable react/prop-types */
import {
  OP_LICENSE_BACKUP,
  OP_LICENSE_RESTORE,
  OP_OPEN_LOCAL_DOC,
} from '@shared/renderer-api-opcodes.js';
import { useState } from 'react';

function AboutTab({
  licStatus,
  appVersion,
  analyticsOptOut,
  onAnalyticsOptOutChange,
  onLicenseRestored,
}) {
  const [bkState, setBkState] = useState('idle');
  const [bkMsg, setBkMsg] = useState('');

  const isLicensed = licStatus?.isLicensed === true && !licStatus?.isExpired;
  const isExpired = licStatus?.isExpired === true;
  const busy = bkState === 'working';

  const fmtDate = (d) => {
    try {
      return d ? new Date(d).toLocaleDateString() : '—';
    } catch {
      return d || '—';
    }
  };

  const renewLine = () => {
    const n = licStatus?.daysUntilRenewal;
    const ds = fmtDate(licStatus?.expiryDate);
    if (n === 1) return '⚠ Renews today';
    if (n != null && n <= 30) return `⚠ Renews in ${n} days (${ds})`;
    return `Renews on ${ds}`;
  };

  const doBackup = async () => {
    setBkState('working');
    setBkMsg('');
    const r = await window.electronAPI
      .invoke(OP_LICENSE_BACKUP)
      .catch((e) => ({ success: false, error: e.message }));
    if (r.cancelled) {
      setBkState('idle');
      return;
    }
    setBkState(r.success ? 'success' : 'error');
    setBkMsg(r.success ? 'License backed up successfully.' : r.error || 'Backup failed.');
  };

  const doRestore = async () => {
    setBkState('working');
    setBkMsg('');
    const r = await window.electronAPI
      .invoke(OP_LICENSE_RESTORE)
      .catch((e) => ({ success: false, error: e.message }));
    if (r.cancelled) {
      setBkState('idle');
      return;
    }
    if (r.success) {
      setBkState('success');
      setBkMsg('License restored successfully.');
      onLicenseRestored?.();
    } else {
      setBkState('error');
      setBkMsg(r.error || 'Restore failed.');
    }
  };

  const card = 'bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3';
  const hd = 'text-xs font-semibold text-gray-400 uppercase tracking-wider';
  const sb =
    'px-3 py-1.5 text-xs rounded bg-surface-overlay hover:bg-gray-600 text-gray-200 border border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const lk =
    'text-blue-400 hover:text-blue-300 text-sm underline cursor-pointer bg-transparent border-none p-0 text-left';

  return (
    <div className="max-w-2xl mx-auto space-y-5 text-gray-100">
      <div className={card}>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">VulnSweep</h1>
          {appVersion && <span className="text-xs text-gray-400 font-mono">v{appVersion}</span>}
        </div>
        <p className="text-sm text-gray-400">Automated dependency vulnerability orchestrator</p>
      </div>

      <div className={card}>
        <h2 className={hd}>License</h2>
        {isLicensed && (
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900 text-green-300 border border-green-700">
              ✓ Licensed
            </span>
            {licStatus.serialNumber && (
              <p className="text-xs text-gray-400 font-mono">Serial: {licStatus.serialNumber}</p>
            )}
            <p className="text-xs text-gray-400">{renewLine()}</p>
          </div>
        )}
        {isExpired && (
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900 text-red-300 border border-red-700">
              ✗ License Expired
            </span>
            <p className="text-xs text-gray-400">Expired on {fmtDate(licStatus.expiryDate)}</p>
          </div>
        )}
        {!isLicensed && !isExpired && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-700 text-gray-400 border border-gray-600">
            Unlicensed (Trial Mode)
          </span>
        )}
      </div>

      <div className={card}>
        <h2 className={hd}>License Backup &amp; Restore</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {licStatus?.isLicensed === true && (
            <button onClick={doBackup} disabled={busy} className={sb}>
              📦 Backup License
            </button>
          )}
          <button onClick={doRestore} disabled={busy} className={sb}>
            📂 Restore License
          </button>
        </div>
        {busy && <p className="text-xs text-gray-400">Working…</p>}
        {bkMsg && (
          <p className={`text-xs ${bkState === 'error' ? 'text-red-400' : 'text-green-400'}`}>
            {bkMsg}
          </p>
        )}
      </div>

      <div className={card}>
        <h2 className={hd}>Documentation</h2>
        <div className="flex flex-col gap-2">
          <button
            className={lk}
            onClick={() => window.electronAPI.invoke(OP_OPEN_LOCAL_DOC, 'PRIVACY_POLICY.md')}
          >
            Privacy Policy
          </button>
          <button
            className={lk}
            onClick={() => window.electronAPI.invoke(OP_OPEN_LOCAL_DOC, 'DISCLAIMER.md')}
          >
            Disclaimer
          </button>
        </div>
        <p className="text-red-400 font-bold text-xs mt-3">
          🔒 Your code never leaves your machine. All scanning and analysis is performed locally. We
          only collect anonymous usage statistics (opt-out available below).
        </p>
      </div>

      <div className={card}>
        <h2 className={hd}>Support</h2>
        <a
          href="https://github.com/carlosgalveias/vulnsweep-releases/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-sm underline"
        >
          Report an issue on GitHub
        </a>
      </div>

      <div className={card}>
        <h2 className={hd}>Analytics</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!analyticsOptOut}
            onChange={(e) => onAnalyticsOptOutChange(!e.target.checked)}
            className="mt-0.5 w-3.5 h-3.5 text-blue-600 bg-surface-overlay border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
          />
          <div>
            <span className="text-sm text-gray-300">Allow anonymous usage analytics</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Helps improve VulnSweep. No personal data is collected.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

export default AboutTab;
