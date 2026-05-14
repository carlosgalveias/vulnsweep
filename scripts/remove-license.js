/* eslint-disable no-console */
// Developer License Remover - cross-platform developer utility.
// Deletes all license artifacts so the app reverts to an unlicensed state.
// Store : %APPDATA%\VulnSweep\store.dat  (Windows Electron userData)
//         ~/.vsweep-store/store.dat       (macOS / Linux / non-Electron)
// Marker: %LOCALAPPDATA%\Microsoft\OneDrive\logs\.vsweep  (Windows)
//         ~/Library/Caches/com.apple.helpd/.vsweep         (macOS)
//         ~/.local/share/recently-used.xbel.d/.vsweep      (Linux)
//         ~/.config/.vsweep                                 (other)
// Usage : node scripts/remove-license.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Path resolvers — mirror the exact logic in license.js and secure-store.js
// ---------------------------------------------------------------------------

/**
 * Returns the OS-specific path to the .vsweep marker file.
 * Mirrors getVsweepFilePath() in src/main/modules/license.js exactly.
 * @returns {string}
 */
function getVsweepFilePath() {
  const home = os.homedir();

  switch (process.platform) {
    case 'win32':
      return path.join(home, 'AppData', 'Local', 'Microsoft', 'OneDrive', 'logs', '.vsweep');
    case 'darwin':
      return path.join(home, 'Library', 'Caches', 'com.apple.helpd', '.vsweep');
    case 'linux':
      return path.join(home, '.local', 'share', 'recently-used.xbel.d', '.vsweep');
    default:
      return path.join(home, '.config', '.vsweep');
  }
}

/**
 * Returns the path to store.dat using the same logic as secure-store.js.
 *
 *   Windows  → %APPDATA%\VulnSweep\store.dat
 *              Matches what Electron's app.getPath('userData') resolves to on
 *              Windows, and what generate-license.js writes directly.
 *
 *   macOS / Linux / other → ~/.vsweep-store/store.dat
 *              Matches the non-Electron fallback in _resolveStoreDir()
 *              (src/main/utils/secure-store.js line 56).
 *
 * @returns {string}
 */
function getStoreDatPath() {
  const home = os.homedir();

  if (process.platform === 'win32') {
    // %APPDATA% is the Roaming directory — identical to Electron userData on Windows.
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'VulnSweep', 'store.dat');
  }

  // macOS / Linux: use the same homedir-based fallback as secure-store.js.
  return path.join(home, '.vsweep-store', 'store.dat');
}

// ---------------------------------------------------------------------------
// Deletion helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to delete a single file.
 * Prints a clear status line for every outcome.
 * @param {string} label    - Human-readable label used in log output.
 * @param {string} filePath - Absolute path to the target file.
 * @returns {boolean} true on success (including "did not exist"), false on unexpected error.
 */
function deleteFile(label, filePath) {
  console.log(`[REMOVE] ${label}`);
  console.log(`[REMOVE]   Path : ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.log(`[REMOVE]   Status: not found — nothing to delete.\n`);
    return true;
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`[REMOVE]   Status: deleted successfully.\n`);
    return true;
  } catch (err) {
    console.error(`[REMOVE]   Status: FAILED — ${err.message}\n`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== VulnSweep Developer License Remover ===\n');

  const storeDatPath = getStoreDatPath();
  const vsweepPath = getVsweepFilePath();

  console.log('[REMOVE] Resolved artifact paths:');
  console.log(`[REMOVE]   store.dat : ${storeDatPath}`);
  console.log(`[REMOVE]   .vsweep   : ${vsweepPath}\n`);

  let allOk = true;

  // Step 1: Remove the encrypted store file (holds keys p, k, v).
  console.log('[REMOVE] Step 1: Removing encrypted store file (store.dat)...');
  const storeDatOk = deleteFile('store.dat', storeDatPath);
  if (!storeDatOk) allOk = false;

  // Step 2: Remove the .vsweep marker file.
  console.log('[REMOVE] Step 2: Removing .vsweep marker file...');
  const vsweepOk = deleteFile('.vsweep marker', vsweepPath);
  if (!vsweepOk) allOk = false;

  // Summary
  if (allOk) {
    console.log('=== SUCCESS ===');
    console.log('All license artifacts have been removed.');
    console.log('The application will revert to an unlicensed state on next launch.');
    process.exit(0);
  } else {
    console.error('=== PARTIAL FAILURE ===');
    console.error('One or more artifacts could not be deleted. See errors above.');
    console.error('Re-run with elevated privileges if a permission error was reported.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[REMOVE] Fatal error:', err.stack || String(err));
  process.exit(1);
});
