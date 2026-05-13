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
   * Opens a managed payment BrowserWindow pointing at the PayPal payment link.
   * Resolves when the user completes payment (success URL detected) or closes
   * the window without paying.
   * @returns {Promise<{ ok: true, key: string } | { ok: false, cancelled?: true, error?: string }>}
   */
  openPaymentWindow: (isPromo) => ipcRenderer.invoke('open-payment-window', isPromo),

  // ============================================
  // ENRICHMENT (F1)
  // ============================================

  /**
   * Enrich an array of vulnerability objects with cross-source CVE data
   * (OSV.dev, NVD API v2, GitHub Advisory Database).
   * Progress events are streamed via onEnrichmentProgress().
   *
   * @param {Array} vulnerabilities - Array of vulnerability objects
   * @returns {Promise<{ success: boolean, content?: Array, error?: string }>}
   */
  enrichVulnerabilities: (vulnerabilities) =>
    ipcRenderer.invoke('enrich-vulnerabilities', vulnerabilities),

  /**
   * Retrieve current enrichment configuration / status from the main process.
   * @returns {Promise<{ success: boolean, content?: Object }>}
   */
  getEnrichmentSettings: () => ipcRenderer.invoke('get-enrichment-settings'),

  /**
   * Subscribe to per-vulnerability enrichment progress events.
   * @param {Function} callback - Called with { current, total, packageName }
   * @returns {Function} Unsubscribe function
   */
  onEnrichmentProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('enrichment-progress', subscription);
    return () => ipcRenderer.removeListener('enrichment-progress', subscription);
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
  scanDepUpdates: (projectPath) => ipcRenderer.invoke('scan-dep-updates', projectPath),

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
});

// Expose app version metadata
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});
