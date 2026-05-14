'use strict';

/**
 * Persistent trial store for VulnSweep.
 *
 * Stores trial usage data (fixes consumed, first-use timestamp) in a
 * hard-to-guess OS-level location that survives application uninstall/reinstall.
 *
 * Storage paths (platform-specific, AV-safe, survive app uninstall):
 *   Windows  → %PROGRAMDATA%\VulnSweep\{hash}
 *   macOS    → ~/Library/Application Support/VulnSweep/{hash}.dat
 *   Linux    → ~/.local/share/vulnsweep/{hash}.dat
 *
 * Where {hash} = first 8 hex chars of SHA-256(hostname + username).
 * This makes the path unique per machine but reproducible across reinstalls.
 *
 * File content is base64-encoded JSON:
 *   { "fc": <number>, "fd": <number|null> }
 *   fc = fixes consumed (starts at 0, max 10)
 *   fd = first-use timestamp in ms (set on first fix application)
 *
 * @module utils/trial-store
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_FREE_FIXES = 10;

/**
 * Computes a short, deterministic, machine-specific hash.
 * Uses hostname + OS username so it is reproducible across reinstalls
 * but unique per machine.
 * @returns {string} 8-character lowercase hex string
 */
function _machineHash() {
  const hostname = os.hostname() || 'host';
  let username = 'user';
  try {
    username = os.userInfo().username || 'user';
  } catch {
    // os.userInfo() can throw on some containers/CI environments
  }
  return crypto
    .createHash('sha256')
    .update(hostname + username)
    .digest('hex')
    .substring(0, 8);
}

/**
 * Returns the platform-specific directory and file path for the trial store.
 * Pure resolver — performs no filesystem I/O.
 * @returns {{ dir: string, filePath: string }}
 */
function _getTrialFilePath() {
  const hash = _machineHash();
  let dir, filename;

  if (process.platform === 'win32') {
    // %PROGRAMDATA% is machine-wide, hidden from normal users, survives per-user uninstall.
    // Used by countless legitimate apps (Dropbox, Adobe, etc.). Does not trigger AV.
    const programData = process.env.PROGRAMDATA || path.join('C:', 'ProgramData');
    dir = path.join(programData, 'VulnSweep');
    filename = `${hash}`;
  } else if (process.platform === 'darwin') {
    // ~/Library/Application Support is the Apple-conventional persistent app data location.
    // Survives app bundle deletion. Not inside the .app bundle or OS vendor directories.
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'VulnSweep');
    filename = `${hash}.dat`;
  } else {
    // XDG Base Directory standard. Survives package manager uninstall by convention.
    dir = path.join(os.homedir(), '.local', 'share', 'vulnsweep');
    filename = `${hash}.dat`;
  }

  return { dir, filePath: path.join(dir, filename) };
}

/**
 * Reads and decodes the raw trial file.
 * Returns null if the file is absent, unreadable, or malformed.
 * @returns {{ fc: number, fd: number | null } | null}
 */
function _readRaw() {
  const { filePath } = _getTrialFilePath();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Encodes and writes trial data to the persistent store file.
 * Creates the parent directory if it does not exist.
 * @param {{ fc: number, fd: number | null }} data
 * @returns {boolean} true on success, false on I/O error
 */
function _writeRaw(data) {
  const { dir, filePath } = _getTrialFilePath();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
    fs.writeFileSync(filePath, encoded, 'utf8');
    return true;
  } catch (err) {
    console.error('[trial-store] Failed to write trial data:', err.message);
    return false;
  }
}

/**
 * Reads trial data from the persistent store, returning defaults if the file
 * is absent or malformed. Does NOT write to disk.
 *
 * @returns {{ fixesConsumed: number, firstUseTimestamp: number | null }}
 */
function getTrialData() {
  const raw = _readRaw();
  if (!raw || typeof raw.fc !== 'number') {
    return { fixesConsumed: 0, firstUseTimestamp: null };
  }
  return {
    fixesConsumed: raw.fc,
    firstUseTimestamp: typeof raw.fd === 'number' ? raw.fd : null,
  };
}

/**
 * Increments the fixes-consumed counter by 1.
 * Sets firstUseTimestamp on the very first invocation.
 * Writes the updated data to the persistent store.
 *
 * @returns {{ fixesConsumed: number, firstUseTimestamp: number }}
 */
function incrementFixCount() {
  const data = getTrialData();
  const now = Date.now();
  const updated = {
    fc: data.fixesConsumed + 1,
    fd: data.firstUseTimestamp !== null ? data.firstUseTimestamp : now,
  };
  _writeRaw(updated);
  return {
    fixesConsumed: updated.fc,
    firstUseTimestamp: updated.fd,
  };
}

/**
 * Returns the current trial status, including days until price changes
 * sourced from the install-info logic already present in license.js.
 *
 * @returns {{
 *   fixesRemaining: number,
 *   fixesConsumed: number,
 *   daysUntilPriceChange: number,
 *   trialExhausted: boolean
 * }}
 */
function getTrialStatus() {
  const data = getTrialData();
  const fixesRemaining = Math.max(0, MAX_FREE_FIXES - data.fixesConsumed);
  const trialExhausted = fixesRemaining === 0;

  // Pull daysRemaining from the install-info logic in license.js.
  // We require() here (not at module top) to avoid a circular-dependency risk
  // and because license.js itself calls storeGet() which needs the Electron
  // app to be ready. By the time getTrialStatus() is called from an IPC
  // handler, app.whenReady() has already resolved.
  let daysUntilPriceChange = 30; // safe default
  try {
    const { getInstallInfo } = require('../modules/license');
    const info = getInstallInfo();
    daysUntilPriceChange = typeof info.daysRemaining === 'number' ? info.daysRemaining : 30;
  } catch (err) {
    console.warn(
      '[trial-store] Could not read install info for daysUntilPriceChange:',
      err.message
    );
  }

  return {
    fixesRemaining,
    fixesConsumed: data.fixesConsumed,
    daysUntilPriceChange,
    trialExhausted,
  };
}

module.exports = {
  getTrialData,
  incrementFixCount,
  getTrialStatus,
};
