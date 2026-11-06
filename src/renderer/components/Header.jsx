/* eslint-disable react/prop-types */
function Header({
  selectedFolder,
  onBrowseFolder,
  progress,
  onScanAudit,
  onApplyFixes,
  onCommitPush,
  buttonsState,
  scanButtonLabel = 'Scan & Audit',
  applyButtonLabel = 'Apply Selected Fixes',
  isScanning = false,
  isCancelling = false,
}) {
  const showProgress = progress && progress.total > 0;
  const disableApplyFixes = !buttonsState.applyFixes;
  const disableCommitPush = !buttonsState.commitPush;

  // Derive scan button appearance based on scanning/cancelling state:
  //   - Cancelling (in-flight abort): muted grey, disabled
  //   - Scanning (cancel available):  red, active
  //   - Idle:                         blue, normal
  const scanBtnDisabled = !buttonsState.scanAudit;
  const scanBtnClass = isCancelling
    ? 'compact-btn rounded transition-colors duration-200 whitespace-nowrap bg-gray-600 text-gray-400 cursor-not-allowed'
    : isScanning
      ? 'compact-btn rounded transition-colors duration-200 whitespace-nowrap bg-red-600 hover:bg-red-700 text-white'
      : 'compact-btn rounded transition-colors duration-200 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white';

  return (
    <header className="bg-surface-raised border-b border-gray-700 compact-header">
      <div className="flex items-center justify-between compact-gap">
        {/* Left Section: Folder Selector */}
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
          <button onClick={onScanAudit} disabled={scanBtnDisabled} className={scanBtnClass}>
            {scanButtonLabel}
          </button>
          <button
            onClick={onApplyFixes}
            disabled={disableApplyFixes}
            className={`compact-btn rounded transition-colors duration-200 whitespace-nowrap ${
              !disableApplyFixes
                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                : 'bg-surface-overlay text-text-muted cursor-not-allowed'
            }`}
          >
            {applyButtonLabel}
          </button>
          <button
            onClick={onCommitPush}
            disabled={disableCommitPush}
            className={`compact-btn rounded transition-colors duration-200 whitespace-nowrap ${
              !disableCommitPush
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-surface-overlay text-text-muted cursor-not-allowed'
            }`}
          >
            Commit &amp; Push
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
