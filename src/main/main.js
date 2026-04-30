const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// Import backend modules
const { UI_CONFIG } = require('./config/constants');
const audit = require('./modules/audit');
const discovery = require('./modules/discovery');
const git = require('./modules/git');

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
    },
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
// APP LIFECYCLE
// ============================================

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
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
