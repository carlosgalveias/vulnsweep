/* eslint-disable no-console */
'use strict';

/**
 * VulnSweep — Nuclear Data Reset
 *
 * Deletes ALL local data: databases, caches, secure store, license artifacts,
 * trial markers, enrichment caches, and backups. After running this script the
 * app is restored to a completely fresh state as if it was just installed.
 *
 * Targets:
 *   1. Secure store (store.dat + backup)
 *   2. .vsweep license marker file
 *   3. Scan-cache directory (5 sharded JSON files)
 *   4. Enrichment caches (userData + tmpdir fallbacks)
 *   5. Trial persistence store (ProgramData / Library / .local)
 *   6. Fallback secure store (~/.vsweep-store/)
 *   7. Temp scan-cache test dir
 *   8. Project ./tmp/ dev telemetry
 *
 * Usage:
 *   node scripts/nuke-all-data.js
 *
 * Idempotent — safe to run multiple times.
 * Uses ONLY Node.js built-in modules (fs, path, os, crypto).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const ELECTRON_USER_DATA = path.join(APPDATA, 'VulnSweep');

// --- Secure store ---
const STORE_DAT = path.join(ELECTRON_USER_DATA, 'store.dat');
const STORE_DAT_BAK = path.join(ELECTRON_USER_DATA, 'store.dat.bak');
const FALLBACK_STORE_DIR = path.join(HOME, '.vsweep-store');
const FALLBACK_STORE_DAT = path.join(FALLBACK_STORE_DIR, 'store.dat');

// --- Scan cache ---
const SCAN_CACHE_DIR = path.join(ELECTRON_USER_DATA, 'scan-cache');

// --- Enrichment caches ---
const ENRICHMENT_CACHE = path.join(ELECTRON_USER_DATA, 'enrichment-cache.json');
const CISA_KEV_CACHE = path.join(ELECTRON_USER_DATA, 'cisa-kev-cache.json');
const ENRICHMENT_CACHE_TMP = path.join(os.tmpdir(), 'vulnsweep-enrichment-cache.json');
const CISA_KEV_CACHE_TMP = path.join(os.tmpdir(), 'vulnsweep-cisa-kev-cache.json');

// --- Test scan-cache ---
const TMPDIR_SCAN_CACHE = path.join(os.tmpdir(), 'vulnsweep-scan-cache-test');

// --- Project ./tmp/ ---
const PROJECT_TMP_DIR = path.join(__dirname, '..', 'tmp');

// --- .vsweep license marker ---
function getVsweepFilePath() {
  switch (process.platform) {
    case 'win32':
      return path.join(HOME, 'AppData', 'Local', 'Microsoft', 'OneDrive', 'logs', '.vsweep');
    case 'darwin':
      return path.join(HOME, 'Library', 'Caches', 'com.apple.helpd', '.vsweep');
    case 'linux':
      return path.join(HOME, '.local', 'share', 'recently-used.xbel.d', '.vsweep');
    default:
      return path.join(HOME, '.config', '.vsweep');
  }
}

// --- Legacy .vsweep in userData ---
const VSWEEP_USERDATA = path.join(ELECTRON_USER_DATA, '.vsweep');

// --- Trial store ---
function getTrialStorePath() {
  // The trial store uses a sha256 hash of "vulnsweep-trial-store" truncated to 8 chars
  const hash = crypto
    .createHash('sha256')
    .update('vulnsweep-trial-store')
    .digest('hex')
    .slice(0, 8);

  switch (process.platform) {
    case 'win32': {
      const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      return path.join(programData, 'VulnSweep', hash);
    }
    case 'darwin':
      return path.join(HOME, 'Library', 'Application Support', 'VulnSweep', `${hash}.dat`);
    case 'linux':
      return path.join(HOME, '.local', 'share', 'vulnsweep', `${hash}.dat`);
    default:
      return path.join(HOME, '.vulnsweep', `${hash}.dat`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

let totalDeleted = 0;
let totalSkipped = 0;
let totalErrors = 0;

/**
 * Delete a single file. Logs outcome, never throws.
 */
function deleteFile(targetPath, label) {
  const suffix = label ? `  (${label})` : '';
  try {
    if (!fs.existsSync(targetPath)) {
      console.log(`  [SKIP]    Not found: ${targetPath}${suffix}`);
      totalSkipped++;
      return;
    }
    const stat = fs.statSync(targetPath);
    const size = humanBytes(stat.size);
    fs.unlinkSync(targetPath);
    console.log(`  [DELETED] ${targetPath}${suffix}  [${size}]`);
    totalDeleted++;
  } catch (err) {
    console.error(`  [ERROR]   Could not delete ${targetPath}${suffix}: ${err.message}`);
    totalErrors++;
  }
}

/**
 * Delete a directory and all its contents recursively. Logs outcome, never throws.
 */
function deleteDir(targetPath, label) {
  const suffix = label ? `  (${label})` : '';
  try {
    if (!fs.existsSync(targetPath)) {
      console.log(`  [SKIP]    Not found: ${targetPath}${suffix}`);
      totalSkipped++;
      return;
    }
    let count = 0;
    try {
      count = fs.readdirSync(targetPath).length;
    } catch {
      /* ignore */
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    console.log(`  [DELETED] ${targetPath}${suffix}  [${count} item(s)]`);
    totalDeleted++;
  } catch (err) {
    console.error(`  [ERROR]   Could not delete ${targetPath}${suffix}: ${err.message}`);
    totalErrors++;
  }
}

/**
 * Delete contents of a directory but keep the directory itself.
 */
function clearDir(dirPath, label) {
  const suffix = label ? `  (${label})` : '';
  try {
    if (!fs.existsSync(dirPath)) {
      console.log(`  [SKIP]    Not found: ${dirPath}${suffix}`);
      totalSkipped++;
      return;
    }
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      console.log(`  [SKIP]    Already empty: ${dirPath}${suffix}`);
      totalSkipped++;
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
        console.error(`  [ERROR]   Could not delete ${entryPath}: ${err.message}`);
        totalErrors++;
      }
    }
    console.log(`  [CLEARED] ${dirPath}${suffix}  [${deleted}/${entries.length} item(s)]`);
    totalDeleted++;
  } catch (err) {
    console.error(`  [ERROR]   Could not read ${dirPath}${suffix}: ${err.message}`);
    totalErrors++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('');
console.log('='.repeat(70));
console.log('  VulnSweep — NUCLEAR DATA RESET');
console.log('  Deleting ALL databases, caches, stores, and license artifacts');
console.log('='.repeat(70));
console.log(`  Timestamp : ${new Date().toISOString()}`);
console.log(`  Platform  : ${process.platform} (Node ${process.version})`);
console.log(`  userData  : ${ELECTRON_USER_DATA}`);
console.log('='.repeat(70));
console.log('');

// 1. Secure store
console.log('[1/8] Secure Store');
deleteFile(STORE_DAT, 'encrypted credentials + settings + license');
deleteFile(STORE_DAT_BAK, 'store backup/snapshot');
console.log('');

// 2. License marker (.vsweep)
console.log('[2/8] License Marker (.vsweep)');
deleteFile(getVsweepFilePath(), 'OS-specific .vsweep marker');
deleteFile(VSWEEP_USERDATA, 'userData .vsweep (legacy/migrated)');
console.log('');

// 3. Scan cache
console.log('[3/8] Scan Cache');
deleteDir(SCAN_CACHE_DIR, 'osv, nvd, github-advisory, cisa-kev, epss');
console.log('');

// 4. Enrichment caches
console.log('[4/8] Enrichment Caches');
deleteFile(ENRICHMENT_CACHE, 'enrichment-cache in userData');
deleteFile(CISA_KEV_CACHE, 'cisa-kev-cache in userData');
deleteFile(ENRICHMENT_CACHE_TMP, 'enrichment-cache in tmpdir');
deleteFile(CISA_KEV_CACHE_TMP, 'cisa-kev-cache in tmpdir');
console.log('');

// 5. Trial persistence store
console.log('[5/8] Trial Persistence Store');
const trialPath = getTrialStorePath();
deleteFile(trialPath, 'trial fixes counter + first-use timestamp');
// Also try to remove the parent dir if empty
try {
  const trialDir = path.dirname(trialPath);
  if (fs.existsSync(trialDir)) {
    const remaining = fs.readdirSync(trialDir);
    if (remaining.length === 0) {
      fs.rmdirSync(trialDir);
      console.log(`  [DELETED] ${trialDir}  (empty parent dir)`);
    }
  }
} catch {
  /* ignore */
}
console.log('');

// 6. Fallback secure store
console.log('[6/8] Fallback Secure Store (~/.vsweep-store/)');
deleteFile(FALLBACK_STORE_DAT, 'non-Electron fallback store.dat');
// Remove the directory if empty
try {
  if (fs.existsSync(FALLBACK_STORE_DIR)) {
    const remaining = fs.readdirSync(FALLBACK_STORE_DIR);
    if (remaining.length === 0) {
      fs.rmdirSync(FALLBACK_STORE_DIR);
      console.log(`  [DELETED] ${FALLBACK_STORE_DIR}  (empty dir)`);
    }
  }
} catch {
  /* ignore */
}
console.log('');

// 7. Temp scan-cache test dir
console.log('[7/8] Temp Scan-Cache Test Directory');
deleteDir(TMPDIR_SCAN_CACHE, 'unit-test scan cache');
console.log('');

// 8. Project ./tmp/ dev telemetry
console.log('[8/8] Project ./tmp/ Dev Telemetry');
clearDir(PROJECT_TMP_DIR, 'scan-telemetry JSON files');
console.log('');

// Summary
console.log('='.repeat(70));
console.log(`  DONE — deleted: ${totalDeleted}  skipped: ${totalSkipped}  errors: ${totalErrors}`);
if (totalErrors === 0) {
  console.log('  All data wiped successfully. App will start fresh on next launch.');
} else {
  console.log('  Some items could not be deleted. Check errors above.');
  console.log('  Try closing VulnSweep first, or run with elevated privileges.');
}
console.log('='.repeat(70));
console.log('');

process.exit(totalErrors > 0 ? 1 : 0);
