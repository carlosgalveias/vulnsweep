/* eslint-disable react/prop-types */
function Header({
  selectedFolder,
  onBrowseFolder,
  progress,
  onScanAudit,
  onApplyFixes,
  onCommitPush,
  buttonsState,
  allowReset,
  onAllowResetChange,
  bumpVersion,
  onBumpVersionChange,
  licStatus,
  trialStatus,
  onBuyNow,
}) {
  const showProgress = progress && progress.total > 0;
  const isUnlicensedCommercial = licStatus?.isCommercial && !licStatus?.isLicensed;
  const trialActive = isUnlicensedCommercial && trialStatus && !trialStatus.trialExhausted;
  const canApplyFix = !isUnlicensedCommercial || trialActive;

  const disableApplyFixes = !buttonsState.applyFixes || !canApplyFix;
  const applyFixesTitle = trialActive
    ? `${trialStatus.fixesRemaining} fix${trialStatus.fixesRemaining !== 1 ? 'es' : ''} remaining in trial`
    : isUnlicensedCommercial
      ? 'Requires commercial license or active trial'
      : '';

  const disableCommitPush = !buttonsState.commitPush || !canApplyFix;
  const commitPushTitle = trialActive
    ? `${trialStatus.fixesRemaining} fix${trialStatus.fixesRemaining !== 1 ? 'es' : ''} remaining in trial`
    : isUnlicensedCommercial
      ? 'Requires commercial license or active trial'
      : '';

  return (
    <header className="bg-surface-raised border-b border-gray-700 compact-header">
      <div className="flex items-center justify-between compact-gap">
        {/* Left Section: Folder Selector & Settings */}
        <div className="flex flex-col compact-gap-sm flex-1 max-w-md">
          {/* Folder Selector */}
          <div className="flex items-center compact-gap-sm">
            <input
              type="text"
              readOnly
              value={selectedFolder || 'No folder selected'}
              className="flex-1 bg-surface text-gray-100 compact-input rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-default text-xs"
              placeholder="Select a folder..."
            />
            <button
              onClick={onBrowseFolder}
              className="compact-btn bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors duration-200 whitespace-nowrap"
            >
              Browse
            </button>
          </div>

          {/* Git Reset Toggle */}
          <div className="flex items-center gap-2 px-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={allowReset}
                onChange={(e) => onAllowResetChange(e.target.checked)}
                className="w-3.5 h-3.5 text-red-600 bg-surface-overlay border-gray-600 rounded focus:ring-red-500 focus:ring-2 cursor-pointer"
              />
              <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors">
                Allow Git Reset
              </span>
              <span
                className="text-yellow-400 hover:text-yellow-300 transition-colors"
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

          {/* Bump Version Toggle */}
          <div className="flex items-center gap-2 px-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={bumpVersion}
                onChange={(e) => onBumpVersionChange(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 bg-surface-overlay border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
              />
              <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors">
                Bump patch version on fix
              </span>
            </label>
          </div>
        </div>

        {/* Middle Section: Progress Indicator */}
        {showProgress && (
          <div className="flex-1 max-w-md">
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300 font-medium">
                  {progress.message || 'Processing...'}
                </span>
                <span className="text-xs text-gray-400">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-surface-overlay rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-brand-muted h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Right Section: Action Buttons */}
        <div className="flex items-center compact-gap-sm">
          <button
            onClick={onScanAudit}
            className="compact-btn bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors duration-200 whitespace-nowrap"
          >
            Scan & Audit
          </button>
          <button
            onClick={onApplyFixes}
            disabled={disableApplyFixes}
            title={applyFixesTitle}
            className={`compact-btn rounded transition-colors duration-200 whitespace-nowrap ${
              !disableApplyFixes
                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                : 'bg-surface-overlay text-text-muted cursor-not-allowed'
            }`}
          >
            Apply Selected Fixes
          </button>
          <button
            onClick={onCommitPush}
            disabled={disableCommitPush}
            title={commitPushTitle}
            className={`compact-btn rounded transition-colors duration-200 whitespace-nowrap ${
              !disableCommitPush
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-surface-overlay text-text-muted cursor-not-allowed'
            }`}
          >
            Commit & Push
          </button>
          {licStatus?.isCommercial && !licStatus?.isLicensed && (
            <button
              onClick={onBuyNow}
              className="compact-btn bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors duration-200 whitespace-nowrap font-bold"
            >
              Buy Now
            </button>
          )}
          {licStatus?.isCommercial && licStatus?.isLicensed && (
            <span className="compact-btn bg-green-700 text-green-100 rounded whitespace-nowrap font-bold tracking-wide cursor-default select-none">
              ✓ LICENSED
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
