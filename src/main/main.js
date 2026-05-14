/* eslint-disable import/order */
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');

// Import backend modules
const { UI_CONFIG, PAYPAL_CONFIG } = require('./config/constants');
const audit = require('./modules/audit');
const { enrichVulnerabilities } = require('./modules/enrichment/cve-enricher');
const discovery = require('./modules/discovery');
const git = require('./modules/git');
const license = require('./modules/license');
const analytics = require('./modules/analytics');
// Initialize Aptabase analytics synchronously here — BEFORE app.whenReady().
// The SDK's initialize() checks app.isReady() and silently disables tracking if
// called after the app is already ready. Calling it here satisfies that contract.
// Events queued via trackEvent() before the SDK's internal async setup finishes
// are buffered by the SDK and flushed automatically once setup completes.
analytics.init();
const isDevelopment = process.env.NODE_ENV === 'development';
if (!isDevelopment) {
  Menu.setApplicationMenu(null);
}
// Imported at top level — pre-warm call happens inside app.whenReady() after
// app.getPath('userData') is available, ensuring the correct store path is used.
const { storeGet, storeSet } = require('./utils/secure-store');
const trialStore = require('./utils/trial-store');

// Keep a global reference of the window objects to avoid garbage collection
let mainWindow;
let splashWindow;

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
  splashWindow.webContents.on('did-finish-load', async () => {
    let isLicensed = false;
    try {
      const licStatus = await license.checkLicense();
      isLicensed = licStatus.isLicensed === true;
    } catch {
      // ignore — splash will just not show LICENSED badge
    }
    splashWindow.webContents.send('splash:data', {
      version: app.getVersion(),
      appName: app.getName(),
      isLicensed,
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

  // Named persistent session shared between main window and any PayPal popups.
  // This is required for PayPal's SDK capture flow: the buyer access token is stored
  // in the session after the login popup, and must be accessible by the main window.
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
      // Named partition so PayPal popups can share the same session/cookies
      partition: SESSION_PARTITION,
    },
  });

  // All window.open calls from the renderer are denied or redirected to the system browser.
  // Payment is handled via a dedicated managed BrowserWindow (open-payment-window IPC handler)
  // with its own isolated session — no popup sharing is needed.
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

    // Discover projects - returns Result object { success, data, message }
    const result = await discovery.discoverProjects(sanitized);

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

    analytics.trackEvent('repository_scanned', {
      repoCount: results.length,
      totalVulnerabilities: results.reduce((s, r) => s + (r.content?.summary?.total || 0), 0),
    });
    return { success: true, content: results };
  } catch (error) {
    console.error(`[IPC] analyze-projects error: ${error.message}`);
    sendLogMessage('error', `Batch analysis failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

/**
 * Handler: Apply fixes to a project
 *
 * Gate logic:
 *   1. If user is licensed → allow unconditionally.
 *   2. If unlicensed and trial exhausted (0 fixes remaining) → block with message.
 *   3. If unlicensed and trial not exhausted → allow, then increment fix counter.
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

    // --- Trial / license gate ---
    let isLicensed = false;
    try {
      const licStatus = await license.checkLicense();
      isLicensed = licStatus.isLicensed === true;
    } catch (licErr) {
      console.warn(
        '[IPC] apply-fixes: license check failed, treating as unlicensed:',
        licErr.message
      );
    }

    if (!isLicensed) {
      const trialStatus = trialStore.getTrialStatus();
      if (trialStatus.trialExhausted) {
        console.log('[IPC] apply-fixes: trial exhausted for unlicensed user.');
        sendLogMessage('warn', 'Free trial exhausted. Upgrade to apply more fixes.');
        return {
          success: false,
          trialExhausted: true,
          error: 'Free fixes exhausted. Please upgrade to continue applying fixes.',
        };
      }
    }
    // ----------------------------

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

    const _sevs = (strategies || []).map((s) => (s.severity || 'unknown').toLowerCase());
    const _sevOrder = ['critical', 'high', 'moderate', 'low', 'unknown'];
    const _topSev = _sevOrder.find((s) => _sevs.includes(s)) || 'unknown';
    analytics.trackEvent('vulnerability_fixed', { severity: _topSev, fixCount: strategies.length });
    return { success: true, content: result.content };
  } catch (error) {
    console.error(`[IPC] apply-fixes error: ${error.message}`);
    sendLogMessage('error', `Failed to apply fixes: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - ENRICHMENT (F1)
// ============================================

/**
 * Handler: Enrich an array of vulnerability objects with cross-source CVE data.
 * Streams per-vulnerability progress events back to the renderer via
 * 'enrichment-progress' push channel.
 *
 * Input:  { vulnerabilities: VulnObject[] }
 * Output: { success: boolean, content?: VulnObject[], error?: string }
 */
ipcMain.handle('enrich-vulnerabilities', async (event, vulnerabilities) => {
  try {
    if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
      return { success: true, content: [] };
    }

    console.log(
      `[IPC] enrich-vulnerabilities: enriching ${vulnerabilities.length} vulnerabilities`
    );
    sendLogMessage('info', `Enriching ${vulnerabilities.length} vulnerabilities with CVE data…`);

    const total = vulnerabilities.length;

    const enriched = await enrichVulnerabilities(
      vulnerabilities,
      (current, _total, packageName) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('enrichment-progress', { current, total, packageName });
        }
      }
    );

    sendLogMessage(
      'success',
      `CVE enrichment complete: ${enriched.length} vulnerabilities enriched`
    );
    return { success: true, content: enriched };
  } catch (err) {
    console.error(`[IPC] enrich-vulnerabilities error: ${err.message}`);
    sendLogMessage('error', `CVE enrichment failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

/**
 * Handler: Return current enrichment settings / status.
 */
ipcMain.handle('get-enrichment-settings', () => {
  const { ENRICHMENT_CONFIG } = require('./config/constants');
  return {
    success: true,
    content: {
      osvApiUrl: ENRICHMENT_CONFIG.OSV_API_URL,
      nvdApiUrl: ENRICHMENT_CONFIG.NVD_API_URL,
      githubAdvisoryApiUrl: ENRICHMENT_CONFIG.GITHUB_ADVISORY_API_URL,
      nvdRateLimitMs: ENRICHMENT_CONFIG.NVD_RATE_LIMIT_MS,
      nvdApiKeyConfigured: !!ENRICHMENT_CONFIG.NVD_API_KEY,
      timeoutMs: ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS,
      cacheTtlMs: ENRICHMENT_CONFIG.ENRICHMENT_CACHE_TTL_MS,
    },
  };
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
      const fs = require('fs');
      const path_ = require('path');
      let repos = [];
      try {
        const entries = await fs.promises.readdir(sanitized, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory());
        for (const d of dirs) {
          const rp = path_.join(sanitized, d.name);
          try {
            await fs.promises.access(path_.join(rp, 'package.json'));
            repos.push(rp);
          } catch {
            /* skip */
          }
        }
        if (repos.length === 0) repos = [sanitized]; // single-repo fallback
      } catch {
        repos = [sanitized];
      }
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

    const result = await scanDependencyUpdates(sanitized, progressCb);

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
    analytics.trackEvent('dependency_updated', { updateCount: updates.length });
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
    analytics.trackEvent('sbom_generated', { format });
    return { success: true };
  } catch (err) {
    console.error(`[IPC] sbom:export error: ${err.message}`);
    sendLogMessage('error', `SBOM export failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// ============================================
// IPC HANDLERS - TRIAL
// ============================================

/**
 * Handler: Increment the trial fix counter by one, called once per user-initiated
 * "Apply Fixes" operation (not per repository). Licensed users are silently skipped.
 */
ipcMain.handle('increment-trial-fix', async () => {
  try {
    const licStatus = await license.checkLicense();
    if (licStatus.isLicensed === true) return { success: true, skipped: true };
    const updated = trialStore.incrementFixCount();
    return { success: true, fixesConsumed: updated.fixesConsumed };
  } catch (err) {
    console.error('[IPC] increment-trial-fix error:', err.message);
    return { success: false, error: err.message };
  }
});

/**
 * Handler: Return current trial status (fixes remaining, days until price change, exhausted flag).
 * Called by the renderer on mount and after each fix application to keep the footer current.
 */
ipcMain.handle('get-trial-status', async () => {
  try {
    return trialStore.getTrialStatus();
  } catch (err) {
    console.error('[IPC] get-trial-status error:', err.message);
    // Safe fallback — show full quota so the UI never incorrectly blocks the user.
    return {
      fixesRemaining: 10,
      fixesConsumed: 0,
      daysUntilPriceChange: 30,
      trialExhausted: false,
    };
  }
});

// ============================================
// IPC HANDLERS - ANALYTICS (D)
// ============================================

ipcMain.handle('set-analytics-opt-out', (_event, value) => {
  try {
    storeSet('ao', value ? '1' : null);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-analytics-opt-out', () => {
  try {
    return { optOut: storeGet('ao') === '1' };
  } catch {
    return { optOut: false };
  }
});

// ============================================
// IPC HANDLERS - LICENSE
// ============================================

ipcMain.handle('get-commercial-status', async () => {
  try {
    return await license.checkLicense();
  } catch (err) {
    console.error('[IPC] get-commercial-status error:', err.message);
    // Fail closed: isCommercial:false means the renderer treats this as a free/community
    // build, showing no commercial UI. Safer than exposing monetization intent on error.
    return { isCommercial: false, isLicensed: false };
  }
});

ipcMain.handle('activate-license', async (event, paymentData) => {
  try {
    return await license.activateLicense(paymentData);
  } catch (err) {
    console.error('[IPC] activate-license error:', err.message);
    // Do NOT forward err.message to the renderer — it may contain internal file paths,
    // encryption details, or the hidden .vsweep marker path. Return a safe user message.
    return { success: false, error: 'License activation failed. Please try again.' };
  }
});

ipcMain.handle('get-install-info', () => {
  try {
    return license.getInstallInfo();
  } catch (err) {
    console.error('[IPC] get-install-info error:', err.message);
    // Use constants exported from license.js rather than duplicating magic numbers here.
    return license.getPromoDefaults();
  }
});

/**
 * Handler: Return active purchase price (promo vs full) and promo end date.
 * Used by BuyModal to display dynamic pricing without hardcoded constants.
 * @returns {{ price: number, isPromo: boolean, promoEndsAt: string|null }}
 */
ipcMain.handle('get-active-price', async () => {
  try {
    return license.getActivePrice();
  } catch (err) {
    console.error('[IPC] get-active-price error:', err.message);
    const { LICENSE_CONFIG } = require('./config/constants');
    return { price: LICENSE_CONFIG.PROMO_PRICE_EUR, isPromo: true, promoEndsAt: null };
  }
});

/**
 * Handler: Open a payment BrowserWindow pointing at the PayPal payment link.
 * Monitors navigation events; when the success URL is detected the window is
 * closed, generateLicense() is called, and the result is returned to the renderer.
 * If the user closes the window manually before payment completes, resolves with
 * { ok: false, cancelled: true }.
 */
ipcMain.handle('open-payment-window', async (_event, isPromo) => {
  return new Promise((resolve) => {
    const paymentUrl = isPromo ? PAYPAL_CONFIG.PAYMENT_URL_PROMO : PAYPAL_CONFIG.PAYMENT_URL_FULL;

    const paymentWin = new BrowserWindow({
      width: 800,
      height: 600,
      autoHideMenuBar: true,
      title: 'Complete Payment',
      parent: mainWindow || undefined,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Isolated session — completely separate from the main app session.
        // The permissive PayPal-scoped CSP is applied to this partition only.
        partition: 'payment-isolated',
      },
    });

    paymentWin.setMenuBarVisibility(false);
    paymentWin.loadURL(paymentUrl);

    let settled = false;

    /**
     * Checks whether `url` matches the configured PayPal success redirect.
     * @param {string} url
     * @returns {boolean}
     */
    function isSuccessUrl(url) {
      try {
        const parsed = new URL(url);
        return (
          parsed.hostname === PAYPAL_CONFIG.SUCCESS_HOST &&
          parsed.pathname.startsWith(PAYPAL_CONFIG.SUCCESS_PATH)
        );
      } catch {
        return false;
      }
    }

    /**
     * Shared handler for both did-navigate and did-navigate-in-page.
     * @param {Electron.Event} _event
     * @param {string} url
     */
    async function onNavigate(_event, url) {
      if (settled) return;
      if (!isSuccessUrl(url)) return;

      settled = true;
      console.log('[Payment] Success URL detected:', url);

      if (!paymentWin.isDestroyed()) {
        paymentWin.close();
      }

      const result = await license.generateLicense();
      if (result.ok) {
        analytics.trackEvent('paypal_purchase_success');
      }
      resolve(result);
    }

    paymentWin.webContents.on('did-navigate', onNavigate);
    paymentWin.webContents.on('did-navigate-in-page', onNavigate);

    // User closed the window without completing payment
    paymentWin.on('closed', () => {
      if (!settled) {
        settled = true;
        console.log('[Payment] Window closed by user before payment completed.');
        resolve({ ok: false, cancelled: true });
      }
    });
  });
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

/**
 * Handler: Create a license backup file (.vsbak) via save dialog.
 * Only available when a valid license is active — returns error if not licensed.
 * @returns {Promise<{ success: boolean, cancelled?: boolean, error?: string }>}
 */
ipcMain.handle('license-backup', async () => {
  try {
    const licCheck = await license.checkLicense();
    if (!licCheck.isLicensed) return { success: false, error: 'No valid license to backup' };
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save License Backup',
      defaultPath: 'vulnsweep-license.vsbak',
      filters: [{ name: 'VulnSweep Backup', extensions: ['vsbak'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true };
    return await license.createLicenseBackup(saveResult.filePath);
  } catch (err) {
    console.error('[IPC] license-backup error:', err.message);
    return { success: false, error: 'Backup failed. Please try again.' };
  }
});

/**
 * Handler: Restore a license from a .vsbak backup file via open dialog.
 * @returns {Promise<{ success: boolean, cancelled?: boolean, error?: string }>}
 */
ipcMain.handle('license-restore', async () => {
  try {
    const openResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore License Backup',
      filters: [{ name: 'VulnSweep Backup', extensions: ['vsbak'] }],
      properties: ['openFile'],
    });
    if (openResult.canceled || openResult.filePaths.length === 0)
      return { success: false, cancelled: true };
    return await license.restoreLicenseBackup(openResult.filePaths[0]);
  } catch (err) {
    console.error('[IPC] license-restore error:', err.message);
    return { success: false, error: 'Restore failed. Please try again.' };
  }
});

// ============================================
// APP LIFECYCLE
// ============================================

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Pre-warm the secure store now that app.getPath('userData') is available.
  // storeGet is imported at the top of this file; calling it here (post app.ready)
  // guarantees _getInstance() binds to the correct Electron userData path rather
  // than the ~/.vsweep-store fallback that would be used if called before app.ready.
  storeGet('_init'); // triggers lazy initialization while app is ready

  // analytics.init() is called at module top-level (before app.whenReady()) — see top of file.
  analytics.trackEvent('app_initialized');

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

  // Permissive CSP scoped to PayPal origins for the isolated payment window only.
  const paymentSession = session.fromPartition('payment-isolated');
  paymentSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self' https://www.paypal.com https://www.paypalobjects.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.paypal.com https://www.paypalobjects.com",
      "style-src 'self' 'unsafe-inline' https://www.paypal.com https://www.paypalobjects.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://www.paypal.com https://www.paypalobjects.com https://api.paypal.com",
      'frame-src https://www.paypal.com',
      "font-src 'self' data: https://www.paypalobjects.com",
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
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
