const { contextBridge, ipcRenderer, shell } = require('electron');

/**
 * VulnSweep IPC Bridge - Preload Script
 *
 * Exposes a secure API for the renderer process to communicate with the main process.
 * All methods use ipcRenderer.invoke() for async request-response patterns.
 */

// Expose VulnSweep API
contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================
  // PROJECT DISCOVERY
  // ============================================

  /**
   * Opens native folder picker dialog
   * @returns {Promise<string|null>} Selected folder path or null if cancelled
   */
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  /**
   * Discovers all Node.js projects in the specified base directory
   * @param {string} basePath - Base directory path to scan
   * @returns {Promise<Object>} { success: boolean, content: Array, error?: string }
   */
  discoverProjects: (basePath) => ipcRenderer.invoke('discover-projects', basePath),

  // ============================================
  // GIT OPERATIONS
  // ============================================

  /**
   * Prepares a repository by optionally resetting and pulling latest changes
   * @param {string} projectPath - Project directory path
   * @param {boolean} allowReset - Whether to perform git reset --hard
   * @returns {Promise<Object>} { success: boolean, content?: object, error?: string }
   */
  prepareRepository: (projectPath, allowReset, options = {}) =>
    ipcRenderer.invoke('prepare-repository', projectPath, allowReset, options),

  /**
   * Commits all changes and pushes to remote
   * @param {string} projectPath - Project directory path
   * @param {string} message - Commit message
   * @returns {Promise<Object>} { success: boolean, content?: object, error?: string }
   */
  commitAndPush: (projectPath, message) =>
    ipcRenderer.invoke('commit-and-push', projectPath, message),

  // ============================================
  // AUDIT OPERATIONS
  // ============================================

  /**
   * Analyzes a single project for vulnerabilities
   * @param {string} projectPath - Project directory path
   * @returns {Promise<Object>} { success: boolean, content?: object, error?: string }
   */
  analyzeProject: (projectPath) => ipcRenderer.invoke('analyze-project', projectPath),

  /**
   * Analyzes multiple projects with progress updates
   * @param {Array<string>} projectPaths - Array of project paths
   * @param {boolean} allowReset - Whether to perform git reset before scanning
   * @returns {Promise<Object>} { success: boolean, content?: Array, error?: string }
   */
  analyzeProjects: (projectPaths, allowReset) =>
    ipcRenderer.invoke('analyze-projects', projectPaths, allowReset),

  /**
   * Applies fix strategies to a project
   * @param {string} projectPath - Project directory path
   * @param {Array} strategies - Array of fix strategy objects
   * @param {Object} options - { bumpVersion, removePackageLock, removeOverrides }
   * @returns {Promise<Object>} { success: boolean, content?: object, error?: string }
   */
  applyFixes: (projectPath, strategies, options) =>
    ipcRenderer.invoke('apply-fixes', projectPath, strategies, options),

  // ============================================
  // COMMERCIAL & LICENSING
  // ============================================

  getCommercialStatus: () => ipcRenderer.invoke('get-commercial-status'),

  activateLicense: (paymentData) => ipcRenderer.invoke('activate-license', paymentData),

  getInstallInfo: () => ipcRenderer.invoke('get-install-info'),

  /**
   * Returns the current trial status for unlicensed users.
   * @returns {Promise<{ fixesRemaining: number, fixesConsumed: number, daysUntilPriceChange: number, trialExhausted: boolean }>}
   */
  getTrialStatus: () => ipcRenderer.invoke('get-trial-status'),

  /**
   * Increments the trial fix counter by one for the current user-initiated
   * "Apply Fixes" operation. No-op for licensed users (skipped server-side).
   * @returns {Promise<{ success: boolean, fixesConsumed?: number, skipped?: boolean, error?: string }>}
   */
  incrementTrialFix: () => ipcRenderer.invoke('increment-trial-fix'),

  /**
   * Opens a managed payment BrowserWindow pointing at the PayPal payment link.
   * Resolves when the user completes payment (success URL detected) or closes
   * the window without paying. On success URL detection, resolves with
   * { ok: false, needsVerification: true } to signal the verification phase.
   * @returns {Promise<{ ok: false, needsVerification: true } | { ok: false, cancelled?: true, error?: string }>}
   */
  openPaymentWindow: (isPromo) => ipcRenderer.invoke('open-payment-window', isPromo),

  /**
   * Verifies a PayPal payment via the license Worker and generates a local license.
   * Called after the user provides their transaction ID post-payment.
   * @param {string} email - Email used for PayPal payment
   * @param {string} transactionId - Transaction ID from PayPal receipt
   * @returns {Promise<{ ok: true, key: string } | { ok: false, error: string }>}
   */
  verifyAndActivate: (email, transactionId) =>
    ipcRenderer.invoke('verify-and-activate', email, transactionId),

  /**
   * Returns the active purchase price based on installation date.
   * Promo price applies within the first PROMO_DAYS days; full price after that.
   * @returns {Promise<{ price: number, isPromo: boolean, promoEndsAt: string|null }>}
   */
  getActivePrice: () => ipcRenderer.invoke('get-active-price'),

  // ============================================
  // SCANNER (Sprint 3)
  // ============================================

  /**
   * Scan a single project for vulnerabilities using the modular scanner pipeline.
   * @param {string} projectPath - Absolute path to the project directory
   * @returns {Promise<{ success: boolean, content?: ScanResult, error?: string }>}
   */
  scanProject: (projectPath) => ipcRenderer.invoke('scan-project', projectPath),

  /**
   * Scan multiple projects sequentially.
   * @param {string[]} projectPaths - Array of absolute project paths
   * @param {boolean} [allowReset] - Passed through to the main process handler
   * @returns {Promise<{ success: boolean, content?: ScanResult[], error?: string }>}
   */
  scanProjects: (projectPaths, allowReset) =>
    ipcRenderer.invoke('scan-projects', projectPaths, allowReset),

  /**
   * Retrieve current scanner configuration from the main process.
   * @returns {Promise<{ success: boolean, content?: object }>}
   */
  getScanSettings: () => ipcRenderer.invoke('get-scan-settings'),

  /**
   * Subscribe to per-package scan progress events.
   * @param {Function} callback - Called with { phase, current, total, packageName, partialResult }
   * @returns {Function} Unsubscribe function
   */
  onScanProgress: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('scan-progress', subscription);
    return () => ipcRenderer.removeListener('scan-progress', subscription);
  },

  // ============================================
  // DEPENDENCY UPDATES (F13)
  // ============================================

  /**
   * Scans direct dependencies of a project for available updates.
   * Progress events streamed via onDepUpdateProgress().
   * @param {string} projectPath - Absolute path to the project directory
   * @returns {Promise<{success: boolean, content?: UpdateCandidate[], error?: string}>}
   */
  scanDepUpdates: (projectPath, allowReset = false, options = {}) =>
    ipcRenderer.invoke('scan-dep-updates', projectPath, allowReset, options),

  /**
   * Applies selected dependency updates via npm install and commits locally.
   * @param {string} projectPath - Absolute path to the project directory
   * @param {Array<{name:string, fromVersion:string, toVersion:string}>} updates
   * @returns {Promise<{success: boolean, commitMessage?: string, error?: string}>}
   */
  applyDepUpdates: (projectPath, updates) =>
    ipcRenderer.invoke('apply-dep-updates', projectPath, updates),

  /**
   * Subscribe to per-package dep update scan progress events.
   * @param {Function} callback - Called with {current, total, packageName}
   * @returns {Function} Unsubscribe function
   */
  onDepUpdateProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('dep-update-progress', subscription);
    return () => ipcRenderer.removeListener('dep-update-progress', subscription);
  },

  // ============================================
  // LICENSE SCAN & SBOM (F8/F9)
  // ============================================

  /**
   * Scan all packages in a project for license information.
   * No paywall — available to all users.
   * @param {string} projectPath - Absolute path to the project directory
   * @returns {Promise<{ success: boolean, content?: LicenseScanResult, error?: string }>}
   */
  scanLicenses: (projectPath) => ipcRenderer.invoke('license:scan', projectPath),

  /**
   * Show a native save-file dialog for the chosen SBOM format.
   * @param {{ format: 'cyclonedx'|'spdx'|'csv' }} options
   * @returns {Promise<{ filePath: string|null, canceled: boolean, error?: string }>}
   */
  sbomGetSavePath: (options) => ipcRenderer.invoke('sbom:get-save-path', options),

  /**
   * Generate SBOM content and write it to outputPath.
   * @param {{ licenseResult: LicenseScanResult, format: string, outputPath: string }} params
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  sbomExport: (params) => ipcRenderer.invoke('sbom:export', params),

  // ============================================
  // LOGGING & EVENTS
  // ============================================

  /**
   * Subscribe to log messages from the backend
   * @param {Function} callback - Callback function(logData)
   * @returns {Function} Unsubscribe function
   */
  onLogMessage: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('log-message', subscription);

    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('log-message', subscription);
    };
  },

  /**
   * Subscribe to analysis progress updates
   * @param {Function} callback - Callback function(progressData)
   * @returns {Function} Unsubscribe function
   */
  onAnalysisProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('analysis-progress', subscription);

    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('analysis-progress', subscription);
    };
  },

  // ============================================
  // SHELL UTILITIES
  // ============================================

  /**
   * Open a URL in the system default browser.
   * @param {string} url - The URL to open externally
   * @returns {Promise<void>}
   */
  openExternal: (url) => shell.openExternal(url),

  // ============================================
  // ANALYTICS OPT-OUT (D)
  // ============================================

  /**
   * Set the analytics opt-out preference.
   * @param {boolean} value - true to opt out, false to opt in
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  setAnalyticsOptOut: (value) => ipcRenderer.invoke('set-analytics-opt-out', value),

  /**
   * Get the current analytics opt-out preference.
   * @returns {Promise<{ optOut: boolean }>}
   */
  getAnalyticsOptOut: () => ipcRenderer.invoke('get-analytics-opt-out'),

  // ============================================
  // APP INFO & DOCS (B)
  // ============================================

  /**
   * Returns the application version and name from the main process.
   * @returns {Promise<{ version: string, name: string }>}
   */
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  /**
   * Opens a local documentation file in the system default application.
   * Only 'PRIVACY_POLICY.md' and 'DISCLAIMER.md' are permitted.
   * @param {string} filename - Allowed document filename
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  openLocalDoc: (filename) => ipcRenderer.invoke('open-local-doc', filename),

  /**
   * Opens a save dialog and writes a license backup (.vsbak) file.
   * Only available when a valid license is active.
   * @returns {Promise<{ success: boolean, cancelled?: boolean, error?: string }>}
   */
  licenseBackup: () => ipcRenderer.invoke('license-backup'),

  /**
   * Opens an open dialog to select a .vsbak backup file and restores the license.
   * @returns {Promise<{ success: boolean, cancelled?: boolean, error?: string }>}
   */
  licenseRestore: () => ipcRenderer.invoke('license-restore'),

  // ============================================
  // SCAN CACHE
  // ============================================

  /**
   * Clear all scan cache entries across all sources and flush to disk synchronously.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  clearScanCache: () => ipcRenderer.invoke('cache:clear'),

  /**
   * Return per-source entry counts for the persistent scan result cache.
   * @returns {Promise<{ success: boolean, content?: { osv: number, nvd: number, 'github-advisory': number, 'cisa-kev': number }, error?: string }>}
   */
  getScanCacheStats: () => ipcRenderer.invoke('cache:getStats'),

  // ============================================
  // CREDENTIALS (Sprint 5 Feature B)
  // ============================================

  /**
   * Returns configured status + masked hint for all known credential sources.
   * NEVER returns the plaintext credential — only a boolean and last-4-char hint.
   * @returns {Promise<{ success: boolean, content?: Record<string, { configured: boolean, maskedHint: string|null }>, error?: string }>}
   */
  getCredentialStatus: () => ipcRenderer.invoke('credentials:getStatus'),

  /**
   * Stores a credential in the encrypted store.
   * Returns only a masked hint — the plaintext is never echoed back to the renderer.
   * @param {string} sourceId - Credential source identifier (e.g. 'github-advisory')
   * @param {string} plaintext - The credential value to store
   * @returns {Promise<{ success: boolean, maskedHint?: string, error?: string }>}
   */
  setCredential: (sourceId, plaintext) =>
    ipcRenderer.invoke('credentials:set', sourceId, plaintext),

  /**
   * Deletes a stored credential from the encrypted store.
   * @param {string} sourceId - Credential source identifier
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  deleteCredential: (sourceId) => ipcRenderer.invoke('credentials:delete', sourceId),

  // ============================================
  // SETTINGS (Sprint 5 Feature A)
  // ============================================

  /**
   * Retrieve persisted app settings (scanMode, enabledSources).
   * @returns {Promise<{ success: boolean, content?: { scanMode: string, enabledSources: string[] }, error?: string }>}
   */
  getSettings: () => ipcRenderer.invoke('settings:get'),

  /**
   * Persist app settings (scanMode, enabledSources).
   * @param {{ scanMode: string, enabledSources: string[] }} settings
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  // ============================================
  // DEPENDENCY PATH (Dep Path Modal)
  // ============================================

  /**
   * Retrieve dependency paths from root to a target package for the path modal.
   * @param {string} projectPath - Absolute path to the project directory
   * @param {string} packageName - Name of the vulnerable package
   * @returns {Promise<{ success: boolean, content?: string[][], error?: string }>}
   */
  getDependencyPaths: (projectPath, packageName) =>
    ipcRenderer.invoke('get-dependency-paths', projectPath, packageName),

  // ============================================
  // CANCEL SCAN (Sprint 5 Feature D)
  // ============================================

  /**
   * Abort the currently running scan-projects operation.
   * No-op if no scan is active (the main process checks _activeScanAbortController).
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
});

// Expose app version metadata
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});
