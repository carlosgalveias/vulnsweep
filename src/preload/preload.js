const { contextBridge, ipcRenderer } = require('electron');

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
  prepareRepository: (projectPath, allowReset) =>
    ipcRenderer.invoke('prepare-repository', projectPath, allowReset),

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
   * @returns {Promise<Object>} { success: boolean, content?: object, error?: string }
   */
  applyFixes: (projectPath, strategies, bumpVersion) =>
    ipcRenderer.invoke('apply-fixes', projectPath, strategies, bumpVersion),

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
});

// Expose app version metadata
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});
