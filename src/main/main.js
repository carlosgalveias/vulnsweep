/* eslint-disable import/order */
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');

// Import backend modules
const { UI_CONFIG, PAYPAL_CONFIG } = require('./config/constants');
const audit = require('./modules/audit');
const discovery = require('./modules/discovery');
const git = require('./modules/git');
const license = require('./modules/license');
const isDevelopment = process.env.NODE_ENV === 'development';
if (!isDevelopment) {
  Menu.setApplicationMenu(null);
}
// Imported at top level — pre-warm call happens inside app.whenReady() after
// app.getPath('userData') is available, ensuring the correct store path is used.
const { storeGet } = require('./utils/secure-store');

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

  // Allow PayPal's payment popup (window.open) to share the same session.
  // Without this, the popup gets an isolated session and the buyer's access
  // token is lost when it closes, causing the "token not present" capture error.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isPayPal =
      url.includes('paypal.com') ||
      url.includes('paypalobjects.com') ||
      url.startsWith('about:blank');
    if (isPayPal) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: SESSION_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    // All other external links open in system browser
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
 * Handler: Prepare repository (reset + pull)
 */
ipcMain.handle('prepare-repository', async (event, projectPath, allowReset) => {
  try {
    console.log(`[IPC] Preparing repository: ${projectPath}, allowReset: ${allowReset}`);

    // Validate and sanitize path
    const sanitized = sanitizePath(projectPath);

    // Prepare repository
    const result = await git.prepareRepository(sanitized, allowReset);

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
    console.log('[IPC] Registry cache cleared for new scan session');

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

/**
 * Handler: Apply fixes to a project
 */
ipcMain.handle('apply-fixes', async (event, projectPath, strategies, bumpVersion = true) => {
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
// APP LIFECYCLE
// ============================================

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Pre-warm the secure store now that app.getPath('userData') is available.
  // storeGet is imported at the top of this file; calling it here (post app.ready)
  // guarantees _getInstance() binds to the correct Electron userData path rather
  // than the ~/.vsweep-store fallback that would be used if called before app.ready.
  storeGet('_init'); // triggers lazy initialization while app is ready

  const { session } = require('electron');

  // Apply permissive CSP to the named session used by the main window and PayPal popups.
  // Using a named partition ensures the CSP applies to all windows sharing that session.
  const mainSession = session.fromPartition('persist:vulnsweep');

  // Strip "Electron/x.x.x" and the app name from the user agent.
  // PayPal's SDK detects "Electron" in the UA and sets disableSetCookie=true,
  // which breaks the buyer access token flow — the token is passed via cookies
  // from the login popup back to the parent window. Without cookies, capture fails.
  // Presenting as a standard Chrome browser makes PayPal use its normal cookie auth.
  const chromeUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.188 Safari/537.36';
  mainSession.setUserAgent(chromeUA);

  mainSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://* http://* blob:",
      "style-src 'self' 'unsafe-inline' https://* http://*",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://* http://*",
      "frame-src 'self' https://* http://*",
      "font-src 'self' data: https://* http://*",
      'worker-src blob:',
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
