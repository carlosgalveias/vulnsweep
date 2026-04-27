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
}) {
  const showProgress = progress && progress.total > 0;

  return (
    <header className="bg-gray-800 border-b border-gray-700 compact-header">
      <div className="flex items-center justify-between compact-gap">
        {/* Left Section: Folder Selector & Settings */}
        <div className="flex flex-col compact-gap-sm flex-1 max-w-md">
          {/* Folder Selector */}
          <div className="flex items-center compact-gap-sm">
            <input
              type="text"
              readOnly
              value={selectedFolder || 'No folder selected'}
              className="flex-1 bg-gray-900 text-gray-100 compact-input rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-default text-xs"
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
                className="w-3.5 h-3.5 text-red-600 bg-gray-700 border-gray-600 rounded focus:ring-red-500 focus:ring-2 cursor-pointer"
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
              <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
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
            disabled={!buttonsState.applyFixes}
            className={`compact-btn rounded transition-colors duration-200 whitespace-nowrap ${
              buttonsState.applyFixes
                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Apply Selected Fixes
          </button>
          <button
            onClick={onCommitPush}
            disabled={!buttonsState.commitPush}
            className={`compact-btn rounded transition-colors duration-200 whitespace-nowrap ${
              buttonsState.commitPush
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Commit & Push
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
