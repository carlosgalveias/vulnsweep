const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');

// Import backend modules
const { UI_CONFIG } = require('./config/constants');
const scanTelemetry = require('./utils/scan-telemetry');
const scanCache = require('./modules/scanner/scan-cache');
const audit = require('./modules/audit');
const discovery = require('./modules/discovery');
const git = require('./modules/git');
const isDevelopment = process.env.NODE_ENV === 'development';

// ── ASAR Integrity Self-Check ───────────────────────────────────────────────
// Build-time injected hashes of preload scripts. The placeholder values are
// replaced by build-main.js AFTER obfuscation with actual SHA-256 digests.
const _PRELOAD_HASH = '{{PRELOAD_INTEGRITY_HASH}}';
const _SPLASH_HASH = '{{SPLASH_INTEGRITY_HASH}}';

/**
 * Verifies preload script integrity against build-time embedded hashes.
 * @returns {string} Integrity token (first 8 chars of combined hash)
 */
function _verifyAsarIntegrity() {
  if (isDevelopment) return 'dev_bypass';
  try {
    const crypto = require('crypto');
    const fs = require('fs');
    const preloadPath = path.join(__dirname, 'preload', 'preload.js');
    const splashPath = path.join(__dirname, 'preload', 'splash-preload.js');
    const h1 = crypto.createHash('sha256').update(fs.readFileSync(preloadPath)).digest('hex');
    const h2 = crypto.createHash('sha256').update(fs.readFileSync(splashPath)).digest('hex');
    if (h1 !== _PRELOAD_HASH || h2 !== _SPLASH_HASH) {
      setTimeout(() => app.quit(), 150 + Math.random() * 500);
      return '';
    }
    return (h1 + h2).substring(0, 8);
  } catch {
    setTimeout(() => app.quit(), 200 + Math.random() * 400);
    return '';
  }
}
const _integrityToken = _verifyAsarIntegrity();

if (!isDevelopment) {
  Menu.setApplicationMenu(null);
}
// Imported at top level — pre-warm call happens inside app.whenReady() after
// app.getPath('userData') is available, ensuring the correct store path is used.
const { storeGet, storeSet, storeRemove } = require('./utils/secure-store');

// ============================================
// CREDENTIALS (Sprint 5 Feature B)
// Allowlist of source IDs that may have credentials stored.
// Add new sources here as they are integrated.
// ============================================
const ALLOWED_CREDENTIAL_SOURCES = new Set(['github-advisory', 'nvd']);

// Keep a global reference of the window objects to avoid garbage collection
let mainWindow;
let splashWindow;

// ============================================
// CANCEL SCAN (Sprint 5 Feature D)
// Holds the AbortController for the currently active scan-projects invocation.
// Set at the start of each scan, cleared in the finally block (or on cancel).
// ============================================
/** @type {AbortController|null} */
let _activeScanAbortController = null;

/**
 * Sends a log message to the renderer process
 * @param {string} level - Log level: 'info', 'warn', 'error', 'success'
 * @param {string} message - Log message
 */
function sendLogMessage(level, message) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('log-message', {
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }
}

/**
 * Retrieves a stored credential for internal main-process use ONLY.
 * This function is intentionally NOT registered as an IPC handler and NOT exported.
 * The renderer process has no path to invoke it — by design.
 * Prefixed with _ to satisfy no-unused-vars (called from scanner modules, not this file).
 *
 * @param {string} sourceId - Credential source identifier (e.g. 'github-advisory')
 * @returns {string|null} Decrypted credential value, or null if not set
 */
function _getCredential(sourceId) {
  try {
    return storeGet(`cred:${sourceId}`) || null;
  } catch {
    return null;
  }
}

/**
 * Intercept console methods to stream logs to renderer
 */
function setupLogStreaming() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    originalLog.apply(console, args);
    const message = args.join(' ').replace(/\s+/g, ' ').trim();
    if (message) {
      sendLogMessage('info', message);
    }
  };

  console.warn = (...args) => {
    originalWarn.apply(console, args);
    const message = args.join(' ').replace(/\s+/g, ' ').trim();
    if (message) {
      sendLogMessage('warn', message);
    }
  };

  console.error = (...args) => {
    originalError.apply(console, args);
    const message = args.join(' ').replace(/\s+/g, ' ').trim();
    if (message) {
      sendLogMessage('error', message);
    }
  };
}

/**
 * Validates and sanitizes a file path to prevent directory traversal
 * @param {string} inputPath - User-provided path
 * @returns {string} Normalized absolute path
 */
function sanitizePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Invalid path provided');
  }

  // Normalize and resolve to absolute path
  const normalized = path.normalize(inputPath);
  const resolved = path.resolve(normalized);

  return resolved;
}

/**
 * Creates the splash screen window
 */
function createSplashWindow() {
  // Determine if running in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!isDevelopment) {
    Menu.setApplicationMenu(null);
  }
  splashWindow = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload', 'splash-preload.js'),
      // Disable DevTools in production builds
      devTools: isDevelopment,
    },
  });

  // In production, load from dist-renderer; in development, load from src
  // Note: __dirname is always 'dist-main' because package.json main points to dist-main/main.js
  const splashPath = isDevelopment
    ? path.join(__dirname, '../src/renderer/splash.html')
    : path.join(__dirname, '../dist-renderer/splash.html');

  splashWindow.loadFile(splashPath);

  // Send version data to splash screen via IPC after page loads
  splashWindow.webContents.on('did-finish-load', () => {
    splashWindow.webContents.send('splash:data', {
      version: app.getVersion(),
      appName: app.getName(),
    });
  });

  // Remove menu bar from splash window
  splashWindow.setMenuBarVisibility(false);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });

  return splashWindow;
}

/**
 * Creates the main application window
 */
function createWindow() {
  // Determine if running in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Icon path: in dev mode use project assets, in production use built assets
  const iconPath = isDevelopment
    ? path.join(__dirname, '../../assets/mini_logo.png')
    : path.join(__dirname, '../dist-renderer/assets/mini_logo.png');

  // Named persistent session for the app windows; the CSP below is registered on it.
  const SESSION_PARTITION = 'persist:vulnsweep';

  // Create the browser window with security settings
  mainWindow = new BrowserWindow({
    width: UI_CONFIG.WINDOW_WIDTH,
    height: UI_CONFIG.WINDOW_HEIGHT,
    icon: iconPath,
    webPreferences: {
      // Enable context isolation for security
      contextIsolation: true,
      // Disable Node integration in renderer for security
      nodeIntegration: false,
      // Enable sandbox for additional security
      sandbox: true,
      // Preload script for IPC communication
      preload: path.join(__dirname, 'preload', 'preload.js'),
      // Disable DevTools in production builds (prevents F12, Ctrl+Shift+I, etc.)
      devTools: isDevelopment,
      // Named partition that the window CSP is registered on
      partition: SESSION_PARTITION,
    },
  });

  // All window.open calls from the renderer are redirected to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // In development, load from Vite dev server
  // In production, load from built files
  if (isDevelopment) {
    mainWindow.loadURL(`http://localhost:${UI_CONFIG.VITE_DEV_PORT}`);
    // Open DevTools automatically in development
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Setup log streaming after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    setupLogStreaming();
    console.log('[IPC] Log streaming initialized');
  });
}

// ============================================
// IPC HANDLERS - PROJECT DISCOVERY
// ============================================

/**
 * Handler: Open folder selection dialog
 */
ipcMain.handle('select-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Projects Directory',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, content: null };
    }

    const selectedPath = result.filePaths[0];
    console.log(`[IPC] Folder selected: ${selectedPath}`);

    return { success: true, content: selectedPath };
  } catch (error) {
    console.error(`[IPC] select-folder error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Handler: Discover Node.js projects in base directory
 */
ipcMain.handle('discover-projects', async (event, basePath) => {
  try {
    console.log(`[IPC] Discovering projects in: ${basePath}`);

    // Validate and sanitize path
    const sanitized = sanitizePath(basePath);

    // Read recursive setting from stored settings
    let recursive = false;
    try {
      const raw = storeGet('app:settings');
      const saved = raw ? JSON.parse(raw) : {};
      recursive = saved.recursive === true;
    } catch {
      /* use default */
    }

    // Discover projects - returns Result object { success, data, message }
    const result = await discovery.discoverProjects(sanitized, { recursive, ignore: [] });

    // Check if discovery failed
    if (!result.success) {
      console.error(`[IPC] discover-projects error: ${result.error}`);
      sendLogMessage('error', `Discovery failed: ${result.error}`);
      return { success: false, error: result.error };
    }

    // Unwrap the Result object and return just the projects array
    console.log(`[IPC] Found ${result.content.length} projects`);
    sendLogMessage('success', `Discovered ${result.content.length} Node.js projects`);

    return { success: true, content: result.content };
  } catch (error) {
    console.error(`[IPC] discover-projects error: ${error.message}`);
    sendLogMessage('error', `Discovery failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - GIT OPERATIONS
// ============================================

/**
 * Handler: Prepare repository (reset + pull + optional cleanup)
 */
ipcMain.handle('prepare-repository', async (event, projectPath, allowReset, options = {}) => {
  try {
    const { removePackageLock = false, removeOverrides = false } = options;
    console.log(
      `[IPC] Preparing repository: ${projectPath}, allowReset: ${allowReset}, removePackageLock: ${removePackageLock}, removeOverrides: ${removeOverrides}`
    );

    // Validate and sanitize path
    const sanitized = sanitizePath(projectPath);

    // Prepare repository (reset -> pull -> removeOverrides -> removePackageLock+node_modules)
    const result = await git.prepareRepository(sanitized, allowReset, {
      removePackageLock,
      removeOverrides,
    });
    if (result.success) {
      sendLogMessage('success', `Repository prepared: ${path.basename(sanitized)}`);
    } else {
      sendLogMessage('error', `Failed to prepare repository: ${result.error}`);
    }

    return { success: result.success, content: result, error: result.error };
  } catch (error) {
    console.error(`[IPC] prepare-repository error: ${error.message}`);
    sendLogMessage('error', `Git preparation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Handler: Commit and push changes
 */
ipcMain.handle('commit-and-push', async (event, projectPath, messageOrOptions) => {
  try {
    console.log(`[IPC] Committing and pushing: ${projectPath}`);

    // Validate and sanitize path
    const sanitized = sanitizePath(projectPath);

    // Handle both old string format and new object format
    let commitOptions;
    if (typeof messageOrOptions === 'string') {
      // Legacy format: just a message string
      commitOptions = messageOrOptions || 'fix(security): update vulnerable dependencies';
    } else if (typeof messageOrOptions === 'object' && messageOrOptions !== null) {
      // New format: object with message and vulnerabilities
      commitOptions = {
        message: messageOrOptions.message || 'fix(security): update vulnerable dependencies',
        vulnerabilities: messageOrOptions.vulnerabilities || [],
      };
    } else {
      // Default fallback
      commitOptions = 'fix(security): update vulnerable dependencies';
    }

    // Commit and push
    const result = await git.commitAndPush(sanitized, commitOptions);

    if (result.success) {
      sendLogMessage('success', `Changes committed and pushed: ${path.basename(sanitized)}`);
    } else {
      sendLogMessage('error', `Failed to commit/push: ${result.error}`);
    }

    return { success: result.success, content: result, error: result.error };
  } catch (error) {
    console.error(`[IPC] commit-and-push error: ${error.message}`);
    sendLogMessage('error', `Git commit/push failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - AUDIT OPERATIONS
// ============================================

/**
 * Handler: Analyze single project
 */
ipcMain.handle('analyze-project', async (event, projectPath) => {
  try {
    console.log(`[IPC] Analyzing project: ${projectPath}`);
    sendLogMessage('info', `Analyzing ${path.basename(projectPath)}...`);

    // Validate and sanitize path
    const sanitized = sanitizePath(projectPath);

    // Analyze project
    const result = await audit.analyzeProject(sanitized);

    if (result.success) {
      const summary = result.content?.summary || {};
      sendLogMessage(
        'success',
        `Analysis complete: ${summary.total || 0} vulnerabilities found (${summary.fixable || 0} fixable)`
      );
    } else {
      sendLogMessage('error', `Analysis failed: ${result.error}`);
    }

    return { success: result.success, content: result, error: result.error };
  } catch (error) {
    console.error(`[IPC] analyze-project error: ${error.message}`);
    sendLogMessage('error', `Analysis failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Handler: Analyze multiple projects with progress updates
 */
ipcMain.handle('analyze-projects', async (event, projectPaths, allowReset = false) => {
  try {
    console.log(`[IPC] Analyzing ${projectPaths.length} projects (allowReset: ${allowReset})`);
    sendLogMessage('info', `Starting analysis of ${projectPaths.length} projects...`);

    if (!Array.isArray(projectPaths) || projectPaths.length === 0) {
      return { success: false, error: 'Invalid project paths array' };
    }

    // Clear registry cache once at the start of scan session
    // This ensures fresh data for each user-initiated scan while preserving
    // cache hits across all projects in the same session
    audit.clearCache();

    const results = [];
    const total = projectPaths.length;

    for (let i = 0; i < total; i++) {
      const projectPath = projectPaths[i];
      const projectName = path.basename(projectPath);

      // Send progress update
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('analysis-progress', {
          current: i + 1,
          total,
          projectName,
          projectPath,
        });
      }

      console.log(`[IPC] Analyzing project ${i + 1}/${total}: ${projectName}`);
      sendLogMessage('info', `[${i + 1}/${total}] Analyzing ${projectName}...`);

      try {
        // Validate and sanitize path
        const sanitized = sanitizePath(projectPath);

        // Analyze project
        const result = await audit.analyzeProject(sanitized, allowReset);
        results.push(result);

        if (result.success) {
          const summary = result.content?.summary || {};
          sendLogMessage(
            'success',
            `[${i + 1}/${total}] ${projectName}: ${summary.total || 0} vulnerabilities (${summary.fixable || 0} fixable)`
          );
        } else {
          sendLogMessage('error', `[${i + 1}/${total}] ${projectName}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[IPC] Error analyzing ${projectName}: ${error.message}`);
        sendLogMessage('error', `[${i + 1}/${total}] ${projectName}: ${error.message}`);
        results.push({
          success: false,
          projectPath,
          error: error.message,
          vulnerabilities: [],
          strategies: [],
          summary: { total: 0, fixable: 0 },
        });
      }
    }

    sendLogMessage('success', `Batch analysis complete: ${results.length} projects analyzed`);
    return { success: true, content: results };
  } catch (error) {
    console.error(`[IPC] analyze-projects error: ${error.message}`);
    sendLogMessage('error', `Batch analysis failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - SCANNER (Sprint 3)
// ============================================

/**
 * Handler: Scan a single project for vulnerabilities using the modular scanner pipeline.
 * Streams per-package progress events via 'scan-progress' push channel.
 *
 * @param {string} projectPath - Absolute path to the project directory
 * @returns {Promise<{ success: boolean, content?: ScanResult, error?: string }>}
 */
ipcMain.handle('scan-project', async (_event, projectPath) => {
  try {
    const sanitized = sanitizePath(projectPath);
    const { scanProject } = require('./modules/scanner/scanner-orchestrator');
    // Read persisted settings and pass to scanner
    const scanOptions = {};
    try {
      const raw = storeGet('app:settings');
      const saved = raw ? JSON.parse(raw) : {};
      if (Array.isArray(saved.enabledSources) && saved.enabledSources.length > 0) {
        scanOptions.enabledSources = saved.enabledSources;
      }
    } catch {
      /* use defaults */
    }
    const result = await scanProject(sanitized, scanOptions, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-progress', progress);
      }
    });
    return { success: true, content: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Handler: Scan multiple projects sequentially, emitting analysis-progress between projects.
 * Streams per-package progress events via 'scan-progress' push channel.
 *
 * @param {string[]} projectPaths - Array of absolute project paths
 * @param {boolean} [allowReset] - Unused parameter kept for API symmetry with analyze-projects
 * @returns {Promise<{ success: boolean, content?: ScanResult[], error?: string }>}
 */
ipcMain.handle('scan-projects', async (_event, projectPaths, _allowReset) => {
  if (!Array.isArray(projectPaths) || projectPaths.length === 0) {
    return { success: false, error: 'Invalid project paths array' };
  }

  // [dev-telemetry] Log that telemetry is active for this batch scan
  if (scanTelemetry.isEnabled()) {
    console.log(
      `[scan-telemetry] Dev mode active — timing data will be written to tmp/ after each repo scan (${projectPaths.length} repo(s) queued)`
    );
  }

  // Create an AbortController for this scan session so the scan:cancel handler
  // can stop the loop between project iterations without leaving it running.
  // Use globalThis.AbortController so the ESLint no-undef rule (which doesn't
  // include Node.js 15+ globals by default) does not flag this call.
  const scanAbortController = new globalThis.AbortController();
  _activeScanAbortController = scanAbortController;
  const { signal } = scanAbortController;

  try {
    const { scanProject } = require('./modules/scanner/scanner-orchestrator');
    // Read persisted settings once for the entire batch scan
    const scanOptions = { signal };
    try {
      const raw = storeGet('app:settings');
      const saved = raw ? JSON.parse(raw) : {};
      if (Array.isArray(saved.enabledSources) && saved.enabledSources.length > 0) {
        scanOptions.enabledSources = saved.enabledSources;
      }
    } catch {
      /* use defaults */
    }
    const results = [];
    for (let i = 0; i < projectPaths.length; i++) {
      // Check for cancellation before processing each project
      if (signal.aborted) {
        console.log(`[scan-projects] Scan cancelled before project ${i + 1}`);
        return { success: false, cancelled: true };
      }
      try {
        const sanitized = sanitizePath(projectPaths[i]);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('analysis-progress', {
            current: i + 1,
            total: projectPaths.length,
          });
        }
        const result = await scanProject(sanitized, scanOptions, (progress) => {
          if (signal.aborted) return; // drop progress events after cancel
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scan-progress', progress);
          }
        });
        // Re-check after each project completes in case cancel arrived mid-scan
        if (signal.aborted) {
          return { success: false, cancelled: true };
        }
        results.push({ success: true, projectPath: projectPaths[i], content: result });
      } catch (err) {
        if (signal.aborted) return { success: false, cancelled: true };
        results.push({ success: false, projectPath: projectPaths[i], error: err.message });
      }
    }
    // Emit a single batch-level sentinel after ALL repositories have been scanned.
    // The renderer's onScanProgress handler responds to this phase (not the per-repo
    // 'complete' phase) to show "Finalizing results..." at the correct moment —
    // once all repos are truly done, not after each individual repo completes.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan-progress', {
        phase: 'batch-complete',
        total: projectPaths.length,
      });
    }
    return { success: true, content: results };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Always clear the controller reference when the scan ends (normal or cancelled).
    // This ensures scan:cancel cannot call .abort() on a stale controller.
    _activeScanAbortController = null;
  }
});

// ============================================
// IPC HANDLERS - CANCEL SCAN (Sprint 5 Feature D)
// ============================================

/**
 * Handler: Abort the currently running scan-projects operation.
 * Signals the active AbortController so the project iteration loop exits cleanly.
 * Also resets the GitHub rate-limiter queue to prevent a cancelled scan's
 * rate-limit backoff from blocking the next scan session.
 *
 * @returns {{ success: boolean, error?: string }}
 */
ipcMain.handle('scan:cancel', () => {
  try {
    if (_activeScanAbortController) {
      _activeScanAbortController.abort();
      _activeScanAbortController = null;
      console.log('[IPC] scan:cancel — abort signal sent');
    }
    // Reset the rate-limiter queue so queued GitHub requests from the cancelled
    // scan do not continue executing or block the next scan session.
    const rateLimiter = require('./utils/github-rate-limiter');
    rateLimiter.resetQueue();
    return { success: true };
  } catch (err) {
    console.error('[IPC] scan:cancel error:', err.message);
    return { success: false, error: err.message };
  }
});

/**
 * Handler: Return current scanner configuration.
 * @returns {Promise<{ success: boolean, content?: object }>}
 */
ipcMain.handle('get-scan-settings', async () => {
  const { SCANNER_CONFIG } = require('./config/constants');
  return { success: true, content: SCANNER_CONFIG };
});

/**
 * Handler: Apply fixes to a project.
 */
ipcMain.handle('apply-fixes', async (event, projectPath, strategies, options = {}) => {
  // Support legacy callers that passed bumpVersion as a plain boolean
  const bumpVersion =
    typeof options === 'boolean'
      ? options
      : options && options.bumpVersion !== undefined
        ? options.bumpVersion
        : true;
  try {
    console.log(`[IPC] Applying fixes to: ${projectPath}`);
    sendLogMessage('info', `Applying fixes to ${path.basename(projectPath)}...`);

    // Validate and sanitize path
    const sanitized = sanitizePath(projectPath);

    // Validate strategies
    if (!Array.isArray(strategies)) {
      return { success: false, error: 'Invalid strategies array' };
    }

    // Apply fixes - returns Result object { success, data, message }
    const result = await audit.applyFixes(sanitized, strategies, bumpVersion);

    // Check if fixes failed
    if (!result.success) {
      console.error(`[IPC] apply-fixes error: ${result.error}`);
      sendLogMessage('error', `Failed to apply fixes: ${result.error}`);
      return { success: false, error: result.error };
    }

    // Unwrap the Result object and return just the fix data
    sendLogMessage(
      'success',
      `Fixes applied: ${result.content?.applied?.length || 0} changes, ${result.content?.resolved?.length || 0} resolved`
    );

    return { success: true, content: result.content };
  } catch (error) {
    console.error(`[IPC] apply-fixes error: ${error.message}`);
    sendLogMessage('error', `Failed to apply fixes: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - DEPENDENCY UPDATES (F13)
// ============================================

/**
 * Handler: Scan direct dependencies of a project for available updates.
 * Streams per-package progress events via 'dep-update-progress' push channel.
 *
 * Input:  projectPath: string
 * Output: { success: boolean, content?: UpdateCandidate[], error?: string }
 */
ipcMain.handle('scan-dep-updates', async (event, projectPath, allowReset = false, options = {}) => {
  const { removeOverrides = false, removePackageLock = false } = options;
  try {
    console.log(
      `[IPC] scan-dep-updates: ${projectPath}, allowReset: ${allowReset}, removeOverrides: ${removeOverrides}, removePackageLock: ${removePackageLock}`
    );
    sendLogMessage('info', `Scanning dependency updates for ${path.basename(projectPath)}...`);

    const sanitized = sanitizePath(projectPath);

    const { scanDependencyUpdates } = require('./modules/dep-updates/dep-updates-scanner');

    // Read recursive setting from stored settings
    let recursive = false;
    try {
      const raw = storeGet('app:settings');
      const saved = raw ? JSON.parse(raw) : {};
      recursive = saved.recursive === true;
    } catch {
      /* use default */
    }

    const progressCb = ({ current, total, repoName, packageName }) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('dep-update-progress', {
          current,
          total,
          repoName,
          packageName,
        });
      }
    };

    // Mirror audit scan: run git prepare (reset+pull+removeOverrides+removePackageLock)
    // per repo whenever any prep option is active.
    if (allowReset || removeOverrides || removePackageLock) {
      const discovery = require('./modules/discovery');
      const prepDiscovery = await discovery.discoverProjects(sanitized, { recursive });
      const repos =
        prepDiscovery.success && prepDiscovery.content.length > 0
          ? prepDiscovery.content.map((p) => p.path)
          : [sanitized];

      for (const repoPath of repos) {
        sendLogMessage('info', `Preparing repository: ${path.basename(repoPath)}...`);
        try {
          await git.prepareRepository(repoPath, allowReset, { removeOverrides, removePackageLock });
        } catch (prepErr) {
          sendLogMessage(
            'warn',
            `Git prepare failed for ${path.basename(repoPath)}: ${prepErr.message}`
          );
        }
      }
    }

    const result = await scanDependencyUpdates(sanitized, progressCb, { recursive });

    if (!result.success) {
      console.error(`[IPC] scan-dep-updates error: ${result.error}`);
      sendLogMessage('error', `Dependency scan failed: ${result.error}`);
      return { success: false, error: result.error };
    }

    const totalCandidates = result.content.reduce((sum, r) => sum + r.candidates.length, 0);
    sendLogMessage(
      'success',
      `Found ${totalCandidates} packages with available updates across ${result.content.length} repo(s)`
    );
    return { success: true, content: result.content };
  } catch (error) {
    console.error(`[IPC] scan-dep-updates error: ${error.message}`);
    sendLogMessage('error', `Dependency scan failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Handler: Apply selected dependency updates via npm install and commit locally.
 *
 * Input:  projectPath: string, updates: ApplyUpdate[]
 * Output: { success: boolean, commitMessage?: string, error?: string }
 */
ipcMain.handle('apply-dep-updates', async (event, projectPath, updates) => {
  try {
    console.log(`[IPC] apply-dep-updates: ${projectPath}, ${updates.length} updates`);
    sendLogMessage('info', `Applying ${updates.length} dependency update(s)...`);

    const sanitized = sanitizePath(projectPath);

    if (!Array.isArray(updates) || updates.length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    const { applyUpdates } = require('./modules/dep-updates/dep-updates-scanner');

    const result = await applyUpdates(sanitized, updates);

    if (!result.success) {
      console.error(`[IPC] apply-dep-updates error: ${result.error}`);
      sendLogMessage('error', `Dependency update failed: ${result.error}`);
      return { success: false, error: result.error };
    }

    const commitMessage = result.content.commitMessage || 'updates applied';
    sendLogMessage('success', `Dependency updates applied: ${commitMessage}`);
    return { success: true, commitMessage };
  } catch (error) {
    console.error(`[IPC] apply-dep-updates error: ${error.message}`);
    sendLogMessage('error', `Dependency update failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - LICENSE SCAN & SBOM (F8/F9)
// ============================================

ipcMain.handle('license:scan', async (event, projectPath) => {
  try {
    console.log(`[IPC] license:scan: ${projectPath}`);
    sendLogMessage('info', `Scanning licenses for ${path.basename(projectPath)}...`);

    const sanitized = sanitizePath(projectPath);
    const { scanLicenses } = require('./modules/license-scanner');
    const result = await scanLicenses(sanitized);

    sendLogMessage('success', `License scan complete: ${result.stats.total} packages found`);
    return { success: true, content: result };
  } catch (err) {
    console.error(`[IPC] license:scan error: ${err.message}`);
    sendLogMessage('error', `License scan failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sbom:get-save-path', async (event, { format }) => {
  try {
    const EXT = { cyclonedx: 'json', spdx: 'json', csv: 'csv' };
    const LABEL = { cyclonedx: 'CycloneDX JSON', spdx: 'SPDX JSON', csv: 'CSV' };
    const ext = EXT[format] || 'json';
    const label = LABEL[format] || 'SBOM';

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save SBOM File',
      defaultPath: `sbom.${ext}`,
      filters: [
        { name: label, extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    return { filePath: result.filePath || null, canceled: result.canceled };
  } catch (err) {
    console.error(`[IPC] sbom:get-save-path error: ${err.message}`);
    return { filePath: null, canceled: true, error: err.message };
  }
});

/**
 * Derive a human-readable document name from an array of scanned project paths.
 *
 * Rules:
 *   - 0 paths  → 'scan'
 *   - 1 path   → basename of that path (preserves existing single-repo behaviour)
 *   - N paths  → basename of the deepest common ancestor directory, or
 *                'multi-repo-scan' when paths share no common ancestor segment
 *
 * @param {string[]} paths - Absolute project paths
 * @returns {string}
 */
function deriveDocumentName(paths) {
  if (!paths || paths.length === 0) return 'scan';
  if (paths.length === 1) return path.basename(paths[0]);

  const parts = paths.map((p) => p.split(path.sep));
  const minLen = Math.min(...parts.map((p) => p.length));
  const common = [];
  for (let i = 0; i < minLen; i++) {
    if (parts.every((p) => p[i] === parts[0][i])) {
      common.push(parts[0][i]);
    } else {
      break;
    }
  }
  return common.length > 0 ? common[common.length - 1] : 'multi-repo-scan';
}

ipcMain.handle('sbom:export', async (event, { licenseResult, format, outputPath }) => {
  try {
    // Validate outputPath is an absolute path (provided by OS dialog, not user input)
    if (!outputPath || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
      return { success: false, error: 'Invalid output path' };
    }

    console.log(`[IPC] sbom:export format=${format} path=${outputPath}`);
    sendLogMessage('info', `Exporting SBOM (${format}) to ${path.basename(outputPath)}...`);

    const { generateSbom } = require('./modules/sbom-generator');

    // Derive a document name that correctly represents all scanned repositories.
    // licenseResult.projectPaths (added in the renderer merge step) contains every
    // path that contributed to this merged result. For a single-repo scan it falls
    // back to the legacy licenseResult.projectPath so behaviour is unchanged.
    const allPaths = licenseResult.projectPaths || [licenseResult.projectPath];
    const documentName = deriveDocumentName(allPaths);

    // Read the version from the first project's package.json (best-effort).
    let projectVersion = '0.0.0';
    try {
      const pkgJson = JSON.parse(
        require('fs').readFileSync(path.join(licenseResult.projectPath, 'package.json'), 'utf8')
      );
      projectVersion = pkgJson.version || '0.0.0';
    } catch {
      /* use default version */
    }

    const projectMeta = {
      name: documentName,
      version: projectVersion,
      toolVersion: app.getVersion(),
    };

    const content = generateSbom(licenseResult, format, projectMeta);
    await require('fs').promises.writeFile(outputPath, content, 'utf8');

    sendLogMessage('success', `SBOM exported: ${path.basename(outputPath)}`);
    return { success: true };
  } catch (err) {
    console.error(`[IPC] sbom:export error: ${err.message}`);
    sendLogMessage('error', `SBOM export failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// ============================================
// IPC HANDLERS - CREDENTIALS (Sprint 5 Feature B)
// Security contract:
//   - credentials:set   → stores encrypted credential, returns masked hint only
//   - credentials:delete → removes credential, returns ok
//   - credentials:getStatus → returns configured boolean + masked hint; NEVER plaintext
//   - getCredential() internal function is the ONLY read path for plaintext
// ============================================

/**
 * Handler: Store an encrypted credential for a known source.
 * Returns only a masked hint — the plaintext is never echoed back.
 *
 * @param {string} sourceId - Must be in ALLOWED_CREDENTIAL_SOURCES
 * @param {string} plaintext - The credential value (e.g. GitHub PAT)
 * @returns {{ success: boolean, maskedHint?: string, error?: string }}
 */
ipcMain.handle('credentials:set', (_event, sourceId, plaintext) => {
  try {
    if (!ALLOWED_CREDENTIAL_SOURCES.has(sourceId)) {
      return { success: false, error: 'Unknown source' };
    }
    if (!plaintext || typeof plaintext !== 'string' || !plaintext.trim()) {
      return { success: false, error: 'Invalid credential value' };
    }
    if (plaintext.length > 500) {
      return { success: false, error: 'Credential value too long' };
    }
    const trimmed = plaintext.trim();
    const maskedHint = trimmed.slice(-4);
    storeSet(`cred:${sourceId}`, trimmed);
    storeSet(`cred:${sourceId}:hint`, maskedHint);
    return { success: true, maskedHint };
  } catch (err) {
    console.error('[IPC] credentials:set error:', err.message);
    return { success: false, error: 'Failed to save credential' };
  }
});

/**
 * Handler: Delete a stored credential and its hint.
 *
 * @param {string} sourceId - Must be in ALLOWED_CREDENTIAL_SOURCES
 * @returns {{ success: boolean, error?: string }}
 */
ipcMain.handle('credentials:delete', (_event, sourceId) => {
  try {
    if (!ALLOWED_CREDENTIAL_SOURCES.has(sourceId)) {
      return { success: false, error: 'Unknown source' };
    }
    storeRemove(`cred:${sourceId}`);
    storeRemove(`cred:${sourceId}:hint`);
    return { success: true };
  } catch (err) {
    console.error('[IPC] credentials:delete error:', err.message);
    return { success: false, error: 'Failed to delete credential' };
  }
});

/**
 * Handler: Return configured status and masked hint for all known sources.
 * NEVER returns the plaintext credential — only a boolean and the last-4-char hint.
 *
 * @returns {{ success: boolean, content?: Record<string, { configured: boolean, maskedHint: string|null }>, error?: string }}
 */
ipcMain.handle('credentials:getStatus', () => {
  try {
    const content = {};
    for (const sourceId of ALLOWED_CREDENTIAL_SOURCES) {
      const value = storeGet(`cred:${sourceId}`);
      const hint = storeGet(`cred:${sourceId}:hint`);
      content[sourceId] = {
        configured: Boolean(value && value.trim()),
        maskedHint: hint || null,
      };
    }
    return { success: true, content };
  } catch (err) {
    console.error('[IPC] credentials:getStatus error:', err.message);
    return { success: false, error: err.message };
  }
});

// ============================================
// IPC HANDLERS - SETTINGS (Sprint 5 Feature A)
// ============================================

const VALID_SETTING_SOURCES = new Set([
  'npm-audit',
  'osv',
  'nvd',
  'github-advisory',
  'cisa-kev',
  'epss',
]);

/**
 * Handler: Retrieve persisted app settings.
 * Returns defaults if no settings have been saved yet or JSON is corrupt.
 * @returns {{ success: boolean, content?: { scanMode: string, enabledSources: string[] } }}
 */
ipcMain.handle('settings:get', () => {
  try {
    const raw = storeGet('app:settings');
    const parsed = raw ? JSON.parse(raw) : {};
    return { success: true, content: parsed };
  } catch (err) {
    console.error('[IPC] settings:get error:', err.message);
    return { success: true, content: {} }; // safe default — caller uses DEFAULTS
  }
});

/**
 * Handler: Persist app settings.
 * Validates enabledSources and boolean scan option fields before writing.
 * Enforces npm-audit as always-present in enabledSources.
 * Silently passes through unknown keys (e.g. legacy scanMode) for backward compatibility.
 * @param {{ scanMode?: string, enabledSources?: string[], allowReset?: boolean,
 *           bumpVersion?: boolean, removePackageLock?: boolean, removeOverrides?: boolean }} settingsObj
 * @returns {{ success: boolean, error?: string }}
 */
ipcMain.handle('settings:set', (_event, settingsObj) => {
  try {
    if (!settingsObj || typeof settingsObj !== 'object' || Array.isArray(settingsObj)) {
      return { success: false, error: 'Invalid settings object' };
    }
    if (settingsObj.enabledSources !== undefined) {
      if (!Array.isArray(settingsObj.enabledSources)) {
        return { success: false, error: 'enabledSources must be an array' };
      }
      if (settingsObj.enabledSources.length === 0) {
        return { success: false, error: 'At least one source must be enabled' };
      }
      for (const s of settingsObj.enabledSources) {
        if (!VALID_SETTING_SOURCES.has(s)) {
          return { success: false, error: `Unknown source: ${s}` };
        }
      }
      // Enforce npm-audit as always present
      if (!settingsObj.enabledSources.includes('npm-audit')) {
        settingsObj = {
          ...settingsObj,
          enabledSources: ['npm-audit', ...settingsObj.enabledSources],
        };
      }
    }
    const BOOLEAN_SETTING_KEYS = [
      'allowReset',
      'bumpVersion',
      'removePackageLock',
      'removeOverrides',
      'recursive',
    ];
    for (const key of BOOLEAN_SETTING_KEYS) {
      if (key in settingsObj && typeof settingsObj[key] !== 'boolean') {
        return { success: false, error: `${key} must be a boolean` };
      }
    }
    storeSet('app:settings', JSON.stringify(settingsObj));
    return { success: true };
  } catch (err) {
    console.error('[IPC] settings:set error:', err.message);
    return { success: false, error: 'Failed to save settings' };
  }
});

// ============================================
// IPC HANDLERS - APP INFO (B)
// ============================================

/**
 * Handler: Return app version and name.
 * Used by the About tab to display the current application version.
 * @returns {{ version: string, name: string }}
 */
ipcMain.handle('get-app-version', () => ({
  version: app.getVersion(),
  name: app.getName(),
}));

/**
 * Handler: Open a local documentation file in the system default application.
 * Only PRIVACY_POLICY.md and DISCLAIMER.md are permitted — all other filenames
 * are rejected with an error to prevent path traversal.
 * @param {string} filename - One of the allowed document filenames
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
const ALLOWED_DOCS = ['PRIVACY_POLICY.md', 'DISCLAIMER.md'];
ipcMain.handle('open-local-doc', async (_event, filename) => {
  if (!ALLOWED_DOCS.includes(filename)) {
    return { success: false, error: 'Document not allowed' };
  }
  try {
    const docPath = path.join(app.getAppPath(), filename);
    await shell.openPath(docPath);
    return { success: true };
  } catch (err) {
    console.error(`[IPC] open-local-doc error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// ============================================
// APP LIFECYCLE
// ============================================

// ============================================
// IPC HANDLERS - SCAN CACHE
// ============================================

/**
 * Handler: Return per-source entry counts for the scan result cache.
 * Used by the renderer to display cache statistics in the settings UI.
 * @returns {{ success: boolean, content?: object }}
 */
ipcMain.handle('cache:getStats', () => {
  try {
    return { success: true, content: scanCache.getStats() };
  } catch (err) {
    console.error('[IPC] cache:getStats error:', err.message);
    return { success: false, error: err.message };
  }
});

/**
 * Handler: Clear all scan cache entries and synchronously flush to disk.
 * @returns {{ success: boolean }}
 */
ipcMain.handle('cache:clear', () => {
  try {
    scanCache.clearAll();
    return { success: true };
  } catch (err) {
    console.error('[IPC] cache:clear error:', err.message);
    return { success: false, error: err.message };
  }
});

// ============================================
// IPC HANDLER - DEPENDENCY PATH (Dep Path Modal)
// ============================================

/**
 * Handler: Retrieve dependency paths from root to a target package.
 * Used by the Dependency Path Modal in the renderer.
 *
 * @param {string} projectPath - Absolute path to the project directory
 * @param {string} packageName - Name of the vulnerable package
 * @returns {Promise<{ success: boolean, content?: string[][], error?: string }>}
 */
ipcMain.handle('get-dependency-paths', async (_event, projectPath, packageName) => {
  try {
    if (
      !projectPath ||
      typeof projectPath !== 'string' ||
      !packageName ||
      typeof packageName !== 'string'
    ) {
      return { success: false, error: 'Missing or invalid projectPath/packageName' };
    }
    const sanitized = sanitizePath(projectPath);
    const { buildDependencyPaths } = require('./modules/scanner/package-universe-builder');
    const paths = await buildDependencyPaths(sanitized, packageName);
    return { success: true, content: paths };
  } catch (err) {
    console.error('[IPC] get-dependency-paths error:', err.message);
    return { success: false, error: err.message };
  }
});

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Pre-warm the secure store now that app.getPath('userData') is available.
  // storeGet is imported at the top of this file; calling it here (post app.ready)
  // guarantees _getInstance() binds to the correct Electron userData path rather
  // than the ~/.vsweep-store fallback that would be used if called before app.ready.
  storeGet('_init'); // triggers lazy initialization while app is ready

  // Reclaims encrypted key ao, the opt-out flag of the analytics feature that no
  // longer exists. Unconditional: the old handler also stored a literal null,
  // which storeGet reports exactly like an absent key. storeRemove is idempotent,
  // so a clean install pays one atomic rewrite (~3 ms) at startup.
  storeRemove('ao');

  // Pre-load the persistent scan cache now that app.getPath('userData') is available.
  // This warms all 4 per-source Maps before the first scanProject() call so the
  // first scan is never slower than subsequent ones.
  try {
    scanCache.load();
  } catch (err) {
    console.warn('[main] scan cache pre-load failed (non-fatal):', err.message);
  }

  const { session } = require('electron');

  // CSP for the main application window and splash screen.
  // In production: strict policy — no external resources, no inline scripts, no network.
  // In development: relaxed policy to allow Vite HMR inline preamble and WebSocket.
  const mainSession = session.fromPartition('persist:vulnsweep');
  mainSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDevelopment
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
          "font-src 'self'",
          "connect-src 'self' ws://localhost:* http://localhost:*",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; ')
      : [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob:",
          "font-src 'self'",
          "connect-src 'none'",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; ');
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // Create splash screen first
  createSplashWindow();

  // After 5 seconds, show main window and close splash
  setTimeout(() => {
    createWindow();

    // Close splash window after main window is created
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
  }, 5000);

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Deferred integrity re-check (defense-in-depth)
  setTimeout(
    () => {
      _verifyAsarIntegrity();
    },
    30000 + Math.random() * 15000
  );
});

// Quit when all windows are closed, except on macOS
// Flush the scan cache before the process exits so any pending debounced writes
// are committed to disk. flushAndClose() cancels all timers and calls the
// synchronous writeFileSync path, completing before the process shuts down.
app.on('before-quit', () => {
  try {
    scanCache.flushAndClose();
  } catch (err) {
    console.warn('[main] scan cache flush on quit failed (non-fatal):', err.message);
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Periodic integrity heartbeat — random interval to defeat pattern analysis
setInterval(
  () => {
    _verifyAsarIntegrity();
  },
  300000 + Math.random() * 120000
);
