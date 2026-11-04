'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'vulnsweep';

let _cached = null;

/**
 * Resolves the shared VulnSweep data directory.
 * Priority:
 *   1. VULNSWEEP_DATA_DIR environment variable (explicit override)
 *   2. Electron app.getPath('userData') (when in Electron after app.ready)
 *   3. Platform conventional path (matches what Electron resolves to):
 *      - Windows: path.join(process.env.APPDATA, 'vulnsweep')
 *      - macOS:   path.join(os.homedir(), 'Library', 'Application Support', 'vulnsweep')
 *      - Linux:   path.join(os.homedir(), '.config', 'vulnsweep')
 *
 * @returns {string} Absolute path to the VulnSweep data directory
 */
function resolveDataDir() {
  if (_cached) return _cached;

  // Priority 1: Explicit env var override
  if (process.env.VULNSWEEP_DATA_DIR) {
    _cached = process.env.VULNSWEEP_DATA_DIR;
    _ensureDir(_cached);
    return _cached;
  }

  // Priority 2: Electron app.getPath('userData')
  try {
    const { app } = require('electron');
    if (app && app.isReady && app.isReady()) {
      _cached = app.getPath('userData');
      _ensureDir(_cached);
      return _cached;
    }
  } catch {
    /* Not in Electron context */
  }

  // Priority 3: Platform conventional path (same as Electron would use)
  const platform = process.platform;
  if (platform === 'win32') {
    _cached = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      APP_NAME
    );
  } else if (platform === 'darwin') {
    _cached = path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  } else {
    _cached = path.join(os.homedir(), '.config', APP_NAME);
  }

  _ensureDir(_cached);
  return _cached;
}

/**
 * Ensures the directory exists, creating it recursively if necessary.
 * @param {string} dir - Directory path to ensure
 */
function _ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Reset the cached directory path. For testing only.
 */
function _resetCache() {
  _cached = null;
}

module.exports = { resolveDataDir, _resetCache };
