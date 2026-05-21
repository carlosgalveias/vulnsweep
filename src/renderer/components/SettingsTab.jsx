import PropTypes from 'prop-types';
import { useState } from 'react';
import useCredentials from '../hooks/useCredentials';
import useSettings from '../hooks/useSettings';
import CredentialsPanel from './CredentialsPanel';

const SOURCE_LABELS = {
  'npm-audit': 'npm audit',
  osv: 'OSV (Open Source Vulnerabilities)',
  nvd: 'NVD (National Vulnerability Database)',
  'github-advisory': 'GitHub Security Advisory',
  'cisa-kev': 'CISA Known Exploited Vulnerabilities',
  epss: 'EPSS (Exploit Prediction Scoring System)',
};

const ALL_SOURCE_IDS = ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'];

// Preset source lists for Fast and Full scan modes
const FAST_SOURCES = ['npm-audit', 'osv'];
const FULL_SOURCES = ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'];

const card = 'bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3';
const hd = 'text-xs font-semibold text-gray-400 uppercase tracking-wider';

function SettingsTab({
  onAllowResetChange,
  onBumpVersionChange,
  onRemovePackageLockChange,
  onRemoveOverridesChange,
}) {
  const { settings, loading, saveSettings, savedIndicator } = useSettings();
  const { credentials, saveCredential, deleteCredential } = useCredentials();
  const [credSaveState, setCredSaveState] = useState({});

  const handleSaveCredential = async (sourceId, value) => {
    setCredSaveState((prev) => ({ ...prev, [sourceId]: 'saving' }));
    const r = await saveCredential(sourceId, value);
    setCredSaveState((prev) => ({ ...prev, [sourceId]: r.success ? 'saved' : 'error' }));
    setTimeout(() => setCredSaveState((prev) => ({ ...prev, [sourceId]: undefined })), 2000);
    return r;
  };

  const handleDeleteCredential = async (sourceId) => {
    return deleteCredential(sourceId);
  };

  // Apply a Fast or Full preset by writing enabledSources directly
  const handlePresetChange = (preset) => {
    saveSettings({ enabledSources: preset === 'fast' ? FAST_SOURCES : FULL_SOURCES });
  };

  const handleSourceToggle = (sourceId) => {
    if (sourceId === 'npm-audit') return;
    const current = settings.enabledSources ?? ALL_SOURCE_IDS;
    let next;
    if (current.includes(sourceId)) {
      const remaining = current.filter((id) => id !== sourceId);
      if (remaining.length === 0) return;
      next = remaining;
    } else {
      next = [...current, sourceId];
    }
    saveSettings({ enabledSources: next });
  };

  // Read the 4 scan options directly from settings (auto-hydrated from storage)
  const allowReset = settings.allowReset ?? false;
  const bumpVersion = settings.bumpVersion ?? true;
  const removePackageLock = settings.removePackageLock ?? false;
  const removeOverrides = settings.removeOverrides ?? false;

  // Auto-save a single scan option change immediately and notify parent for in-memory sync
  const handleScanOptionChange = (key, value) => {
    saveSettings({ [key]: value });
    if (key === 'allowReset' && onAllowResetChange) onAllowResetChange(value);
    if (key === 'bumpVersion' && onBumpVersionChange) onBumpVersionChange(value);
    if (key === 'removePackageLock' && onRemovePackageLockChange) onRemovePackageLockChange(value);
    if (key === 'removeOverrides' && onRemoveOverridesChange) onRemoveOverridesChange(value);
  };

  const enabledSources = settings.enabledSources ?? ALL_SOURCE_IDS;

  // Derive the active preset from current enabledSources — do not store in state
  const toSortedKey = (arr) => [...arr].sort().join(',');
  const activePreset =
    toSortedKey(enabledSources) === toSortedKey(FAST_SOURCES)
      ? 'fast'
      : toSortedKey(enabledSources) === toSortedKey(FULL_SOURCES)
        ? 'full'
        : null;

  return (
    <div className="max-w-2xl mx-auto space-y-5 text-gray-100">
      {savedIndicator && (
        <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Settings saved
        </div>
      )}
      <div className={card}>
        <h2 className={hd}>Scan Mode</h2>
        {loading ? (
          <p className="text-xs text-gray-400">Loading...</p>
        ) : (
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="radio"
                name="scanMode"
                value="fast"
                checked={activePreset === 'fast'}
                onChange={() => handlePresetChange('fast')}
                className="mt-0.5 w-3.5 h-3.5 text-blue-600 bg-surface-overlay border-gray-600 focus:ring-blue-500 focus:ring-2 cursor-pointer"
              />
              <div>
                <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors font-medium">
                  Fast
                </span>
                <p className="text-xs text-gray-500 mt-0.5">
                  Runs npm audit + OSV only. Fastest scan - recommended for CI and large monorepos.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="radio"
                name="scanMode"
                value="full"
                checked={activePreset === 'full'}
                onChange={() => handlePresetChange('full')}
                className="mt-0.5 w-3.5 h-3.5 text-blue-600 bg-surface-overlay border-gray-600 focus:ring-blue-500 focus:ring-2 cursor-pointer"
              />
              <div>
                <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors font-medium">
                  Full
                </span>
                <p className="text-xs text-gray-500 mt-0.5">
                  Runs all enabled sources: npm audit, OSV, NVD, GitHub Advisory, CISA KEV, and
                  EPSS. Most thorough - may take longer.
                </p>
              </div>
            </label>
          </div>
        )}
      </div>
      <div className={card}>
        <h2 className={hd}>Vulnerability Sources</h2>
        <p className="text-xs text-gray-500">
          Choose which data sources are queried during a scan. npm audit is always required.
        </p>
        {loading ? (
          <p className="text-xs text-gray-400">Loading...</p>
        ) : (
          <div className="space-y-2 pt-1">
            {ALL_SOURCE_IDS.map((sourceId) => {
              const isLocked = sourceId === 'npm-audit';
              const isEnabled = isLocked || enabledSources.includes(sourceId);
              const labelCls = [
                'flex items-center gap-3',
                isLocked ? 'cursor-default opacity-70' : 'cursor-pointer group',
              ].join(' ');
              return (
                <label
                  key={sourceId}
                  className={labelCls}
                  title={
                    isLocked ? 'npm audit is always required and cannot be disabled' : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    disabled={isLocked}
                    onChange={() => handleSourceToggle(sourceId)}
                    className="w-3.5 h-3.5 text-blue-600 bg-surface-overlay border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer disabled:cursor-default"
                  />
                  <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">
                    {SOURCE_LABELS[sourceId] ?? sourceId}
                    {isLocked && <span className="ml-1.5 text-xs text-gray-500">(required)</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <div className={card}>
        <h2 className={hd}>API Credentials</h2>
        <p className="text-xs text-gray-500">
          Store API tokens for sources that require authentication.
        </p>
        <CredentialsPanel
          credentials={credentials}
          onSave={handleSaveCredential}
          onDelete={handleDeleteCredential}
          saveState={credSaveState}
        />
      </div>
      <div className={card}>
        <h2 className={hd}>Scan Options</h2>
        <p className="text-xs text-gray-500">
          Options applied when running a scan or applying fixes. Changes are saved automatically.
        </p>
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={allowReset}
                onChange={(e) => handleScanOptionChange('allowReset', e.target.checked)}
                className="w-3.5 h-3.5 text-red-600 bg-surface-overlay border-gray-600 rounded focus:ring-red-500 focus:ring-2 cursor-pointer"
              />
              <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">
                Allow Git Reset
              </span>
              <span
                className="text-yellow-400"
                title="When enabled, VulnSweep will run 'git reset --hard' before pulling. This is DESTRUCTIVE and will discard any uncommitted changes in the repository."
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </label>
            <span className="text-xs text-red-400 font-medium">(Destructive)</span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={bumpVersion}
              onChange={(e) => handleScanOptionChange('bumpVersion', e.target.checked)}
              className="w-3.5 h-3.5 text-blue-600 bg-surface-overlay border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
            />
            <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">
              Bump patch version on fix
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={removePackageLock}
              onChange={(e) => handleScanOptionChange('removePackageLock', e.target.checked)}
              className="w-3.5 h-3.5 text-yellow-600 bg-surface-overlay border-gray-600 rounded focus:ring-yellow-500 focus:ring-2 cursor-pointer"
            />
            <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">
              Remove package-lock.json
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={removeOverrides}
              onChange={(e) => handleScanOptionChange('removeOverrides', e.target.checked)}
              className="w-3.5 h-3.5 text-yellow-600 bg-surface-overlay border-gray-600 rounded focus:ring-yellow-500 focus:ring-2 cursor-pointer"
            />
            <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">
              Remove overrides
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

SettingsTab.propTypes = {
  onAllowResetChange: PropTypes.func,
  onBumpVersionChange: PropTypes.func,
  onRemovePackageLockChange: PropTypes.func,
  onRemoveOverridesChange: PropTypes.func,
};

export default SettingsTab;
