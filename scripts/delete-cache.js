'use strict';

/**
 * VulnSweep - Cache Deletion Script
 *
 * Deletes all known VulnSweep cache locations so the next scan fetches
 * fresh vulnerability data instead of serving stale cached results.
 *
 * Cache locations targeted:
 *   1. Electron userData scan-cache dir:
 *        %APPDATA%\VulnSweep\scan-cache\
 *      Five per-source sharded JSON files (osv, nvd, github-advisory,
 *      cisa-kev, epss) written by src/main/modules/scanner/scan-cache.js
 *
 *   2. Electron userData secure-store:
 *        %APPDATA%\VulnSweep\store.dat
 *      Holds encrypted credentials + settings. Skipped by default.
 *      Set env var DELETE_SECURE_STORE=1 to also wipe this file.
 *
 *   3. Fallback secure-store (non-Electron path):
 *        ~\.vsweep-store\store.dat
 *      Same caveat — skipped unless DELETE_SECURE_STORE=1.
 *
 *   4. os.tmpdir() test scan-cache (used when Electron is unavailable):
 *        %TEMP%\vulnsweep-scan-cache-test\
 *
 *   5. Project ./tmp/ directory contents:
 *        scan-telemetry-*.json files (written in dev mode only)
 *
 * Usage:
 *   node scripts/delete-cache.js
 *   DELETE_SECURE_STORE=1 node scripts/delete-cache.js
 *
 * Idempotent — safe to run multiple times.
 * Uses ONLY Node.js built-in modules (fs, path, os).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const ELECTRON_USER_DATA = path.join(APPDATA, 'VulnSweep');

const SCAN_CACHE_DIR = path.join(ELECTRON_USER_DATA, 'scan-cache');
const SECURE_STORE_FILE = path.join(ELECTRON_USER_DATA, 'store.dat');
const FALLBACK_SECURE_STORE_FILE = path.join(os.homedir(), '.vsweep-store', 'store.dat');
const TMPDIR_SCAN_CACHE = path.join(os.tmpdir(), 'vulnsweep-scan-cache-test');
const PROJECT_TMP_DIR = path.join(__dirname, '..', 'tmp');

const DELETE_SECURE_STORE = process.env.DELETE_SECURE_STORE === '1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format byte count as a compact human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function humanBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------------------
// Core deletion utilities
// ---------------------------------------------------------------------------

/**
 * Delete a single file or entire directory tree.
 * Logs the outcome; never throws — all errors are caught and reported.
 *
 * @param {string} targetPath - Absolute path to delete
 * @param {string} [label]    - Optional label for log output
 */
function deleteItem(targetPath, label) {
  const suffix = label ? `  (${label})` : '';
  try {
    if (!fs.existsSync(targetPath)) {
      console.log(`[SKIP]         Not found: ${targetPath}${suffix}`);
      return;
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      let count = 0;
      try {
        count = fs.readdirSync(targetPath).length;
      } catch {
        /* ignore */
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
      console.log(`[DELETED dir]  ${targetPath}${suffix}  [${count} item(s)]`);
    } else {
      const size = humanBytes(stat.size);
      fs.unlinkSync(targetPath);
      console.log(`[DELETED file] ${targetPath}${suffix}  [${size}]`);
    }
  } catch (err) {
    console.error(`[ERROR]        Could not delete ${targetPath}${suffix}: ${err.message}`);
  }
}

/**
 * Delete only the *contents* of a directory, leaving the directory itself.
 * Useful for ./tmp/ so the folder stays but telemetry JSON files are removed.
 *
 * @param {string} dirPath - Absolute path to the directory to empty
 * @param {string} [label]
 */
function deleteDirectoryContents(dirPath, label) {
  const suffix = label ? `  (${label})` : '';
  try {
    if (!fs.existsSync(dirPath)) {
      console.log(`[SKIP]         Not found: ${dirPath}${suffix}`);
      return;
    }
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      console.log(`[SKIP]         Already empty: ${dirPath}${suffix}`);
      return;
    }
    let deleted = 0;
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const s = fs.statSync(entryPath);
        if (s.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
        deleted++;
      } catch (err) {
        console.error(`[ERROR]        Could not delete ${entryPath}: ${err.message}`);
      }
    }
    console.log(
      `[CLEARED dir]  ${dirPath}${suffix}  [${deleted}/${entries.length} item(s) removed]`
    );
  } catch (err) {
    console.error(`[ERROR]        Could not read directory ${dirPath}${suffix}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main cleanup sequence
// ---------------------------------------------------------------------------

console.log('='.repeat(70));
console.log('VulnSweep Cache Cleanup');
console.log(`Timestamp : ${new Date().toISOString()}`);
console.log(`Platform  : ${process.platform}  (Node ${process.version})`);
console.log(`APPDATA   : ${APPDATA}`);
if (DELETE_SECURE_STORE) {
  console.log('NOTE      : DELETE_SECURE_STORE=1 — store.dat will also be wiped');
}
console.log('='.repeat(70));
console.log();

// 1. Primary scan-cache directory (5 sharded source JSON files)
console.log('--- [1/5] Electron userData scan-cache (primary) ---');
deleteItem(SCAN_CACHE_DIR, 'scan-cache shards');
console.log();

// 2. Encrypted settings/credentials store (opt-in only)
console.log('--- [2/5] Electron userData secure-store ---');
if (DELETE_SECURE_STORE) {
  deleteItem(SECURE_STORE_FILE, 'encrypted credentials + settings');
} else {
  console.log(`[SKIP]         ${SECURE_STORE_FILE}  (run with DELETE_SECURE_STORE=1 to wipe)`);
}
console.log();

// 3. Fallback secure-store (~/.vsweep-store/store.dat)
console.log('--- [3/5] Fallback secure-store (~/.vsweep-store/) ---');
if (DELETE_SECURE_STORE) {
  deleteItem(FALLBACK_SECURE_STORE_FILE, 'fallback store.dat');
} else {
  console.log(
    `[SKIP]         ${FALLBACK_SECURE_STORE_FILE}  (run with DELETE_SECURE_STORE=1 to wipe)`
  );
}
console.log();

// 4. os.tmpdir() test scan-cache (non-Electron / unit-test path)
console.log('--- [4/5] os.tmpdir() test scan-cache ---');
deleteItem(TMPDIR_SCAN_CACHE, 'vulnsweep-scan-cache-test');
console.log();

// 5. Project ./tmp/ directory contents (scan-telemetry dev JSON files)
console.log('--- [5/5] Project ./tmp/ directory contents ---');
deleteDirectoryContents(PROJECT_TMP_DIR, 'scan-telemetry JSON files');
console.log();

// Done
console.log('='.repeat(70));
console.log('Cache cleanup complete.');
console.log('Run the VulnSweep app to rebuild the cache with fresh scan data.');
console.log('='.repeat(70));
