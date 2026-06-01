'use strict';

/**
 * Cross-platform encrypted key-value store for VulnSweep main process.
 * File-backed AES-encrypted store powered by secure-ls.
 *
 * Store file : Electron userData/store.dat
 * Fallback   : ~/.vsweep-store/store.dat  (non-Electron / CI)
 *
 * Encryption key: SHA-256(first physical MAC address).
 *
 * All exports are synchronous.
 *
 * @module utils/secure-store
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const _SNAPSHOT_RETENTION_COUNT = 1;

let _storeDirCache = null;
let _storeDirResolved = false;
let _secretCache = null;
let _lsInstance = null;
// Set true ONLY for permanent failures (MODULE_NOT_FOUND for secure-ls).
// Transient I/O errors leave this false so subsequent calls can retry.
let _initFailed = false;

/**
 * Resolves the store directory. Three cases:
 *   (a) Non-Electron: require('electron') throws -> homedir fallback cached permanently.
 *   (b) Electron pre-ready: app.getPath unavailable -> transient homedir fallback,
 *       _storeDirResolved stays false so the next call retries.
 *   (c) Electron post-ready: getPath succeeds -> userData path cached permanently.
 * Pre-warming storeGet() inside app.whenReady() ensures case (c) is always hit
 * before _lsInstance is first created.
 * @returns {string}
 */
function _resolveStoreDir() {
  if (_storeDirResolved) return _storeDirCache;
  try {
    const electron = require('electron');
    const app = (electron && electron.app) || null;
    if (app && typeof app.getPath === 'function') {
      const userDataPath = app.getPath('userData');
      _storeDirCache = userDataPath;
      _storeDirResolved = true;
      return _storeDirCache;
    }
    // Electron loaded but app not ready — return transient fallback WITHOUT caching
    // so the next call retries once app.getPath is available.
    return path.join(os.homedir(), '.vsweep-store');
  } catch {
    // Non-Electron environment. Cache permanently.
    _storeDirCache = path.join(os.homedir(), '.vsweep-store');
    _storeDirResolved = true;
    return _storeDirCache;
  }
}

function _resolveStoreFilePath() {
  return path.join(_resolveStoreDir(), 'store.dat');
}

function _resolveSnapshotFilePath() {
  return path.join(_resolveStoreDir(), 'store.dat.bak');
}

function _snapshotExists() {
  try {
    return fs.existsSync(_resolveSnapshotFilePath());
  } catch {
    return false;
  }
}

function _createSnapshot(filePath) {
  try {
    const snapshotPath = _resolveSnapshotFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      JSON.parse(raw);
      fs.copyFileSync(filePath, snapshotPath);
    }
  } catch (err) {
    console.error('[secure-store] Failed to create snapshot:', err.message);
  }
}

function _restoreFromSnapshot(filePath) {
  try {
    const snapshotPath = _resolveSnapshotFilePath();
    if (fs.existsSync(snapshotPath)) {
      fs.copyFileSync(snapshotPath, filePath);
      return true;
    }
  } catch (err) {
    console.error('[secure-store] Failed to restore from snapshot:', err.message);
  }
  return false;
}

function _cleanupOldSnapshots() {
  if (_SNAPSHOT_RETENTION_COUNT === 0) {
    try {
      const snapshotPath = _resolveSnapshotFilePath();
      if (fs.existsSync(snapshotPath)) {
        fs.unlinkSync(snapshotPath);
      }
    } catch (err) {
      console.error('[secure-store] Failed to cleanup old snapshots:', err.message);
    }
  }
}

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function _deriveEncryptionSecret() {
  if (_secretCache !== null) return _secretCache;
  let rawMaterial = 'vs-fb-2024-xk';
  try {
    const ifaces = os.networkInterfaces();
    outer: for (const ifaceName of Object.keys(ifaces)) {
      const addresses = ifaces[ifaceName];
      if (!Array.isArray(addresses)) continue;
      for (const addr of addresses) {
        if (addr.internal === true) continue;
        if (!addr.mac || addr.mac === '00:00:00:00:00:00') continue;
        rawMaterial = addr.mac;
        break outer;
      }
    }
  } catch {
    // fall through to static fallback
  }
  _secretCache = crypto.createHash('sha256').update(rawMaterial).digest('hex');
  return _secretCache;
}

function _buildFileStorageAdapter(filePath) {
  let _cache = null;
  let _initializedWithSnapshot = false;

  function _read() {
    if (_cache !== null) return _cache;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      _cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      return _cache;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (!_initializedWithSnapshot && _snapshotExists()) {
          if (_restoreFromSnapshot(filePath)) {
            return _read();
          }
        }
        _cache = {};
        return _cache;
      }
      if (
        (err instanceof SyntaxError || err.code === 'EINVAL' || err.code === 'EILSEQ') &&
        !_initializedWithSnapshot
      ) {
        if (_restoreFromSnapshot(filePath)) {
          _initializedWithSnapshot = true;
          return _read();
        }
      }
      throw err;
    }
  }

  function _write(data) {
    _ensureDir(path.dirname(filePath));
    _createSnapshot(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
    _cache = data;
    _cleanupOldSnapshots();
  }

  return {
    getItem(key) {
      const data = _read();
      const val = data[key];
      return val !== undefined ? val : null;
    },
    setItem(key, value) {
      const data = _read();
      data[key] = value;
      _write(data);
    },
    removeItem(key) {
      const data = _read();
      delete data[key];
      _write(data);
    },
  };
}

/**
 * Returns the singleton SecureLS instance, creating it on first call.
 *
 * FIX (CRITICAL-1): The original implementation permanently set _initFailed=true
 * for ALL errors, including transient I/O failures that would self-resolve on retry.
 * This meant a single bad init (locked file, first-boot race) silenced the store
 * for the entire process lifetime. Fixed: only MODULE_NOT_FOUND is permanent.
 * All other errors leave _lsInstance=null so the next call retries.
 *
 * @returns {object|null} SecureLS instance, or null if permanently unavailable.
 */
function _getInstance() {
  if (_lsInstance !== null) return _lsInstance;
  if (_initFailed) return null;

  try {
    const SecureLS = require('secure-ls').default;
    const filePath = _resolveStoreFilePath();
    const secret = _deriveEncryptionSecret();
    _ensureDir(path.dirname(filePath));
    const adapter = _buildFileStorageAdapter(filePath);
    _lsInstance = new SecureLS({
      encodingType: 'AES',
      isCompression: false,
      encryptionSecret: secret,
      storage: adapter,
    });
    return _lsInstance;
  } catch (err) {
    // Permanent failure: secure-ls is not installed. No point retrying.
    if (err && err.code === 'MODULE_NOT_FOUND') {
      console.error('[secure-store] secure-ls module not found. Store permanently disabled.');
      _initFailed = true;
      return null;
    }
    // Transient failure (I/O error, JSON parse error, constructor error).
    // Do NOT set _initFailed — leave _lsInstance=null so the next call retries.
    console.error('[secure-store] Failed to initialise SecureLS (will retry):', err.message);
    return null;
  }
}

function storeGet(key) {
  try {
    const ls = _getInstance();
    if (!ls) return null;
    const val = ls.get(key);
    return val !== undefined && val !== null && val !== '' ? val : null;
  } catch (err) {
    console.error(`[secure-store] storeGet error for key "${key}":`, err.message);
    return null;
  }
}

function storeSet(key, value) {
  try {
    const ls = _getInstance();
    if (!ls) return;
    ls.set(key, value);
  } catch (err) {
    console.error(`[secure-store] storeSet error for key "${key}":`, err.message);
  }
}

function storeRemove(key) {
  try {
    const ls = _getInstance();
    if (!ls) return;
    ls.remove(key);
  } catch (err) {
    console.error(`[secure-store] storeRemove error for key "${key}":`, err.message);
  }
}

function storeGetAll() {
  try {
    const ls = _getInstance();
    if (!ls) return {};
    const keys = ls.getAllKeys() || [];
    const result = {};
    for (const key of keys) {
      try {
        const val = ls.get(key);
        if (val !== undefined && val !== null && val !== '') {
          result[key] = val;
        }
      } catch {
        // skip individual key read errors
      }
    }
    return result;
  } catch (err) {
    console.error('[secure-store] storeGetAll error:', err.message);
    return {};
  }
}

function storeClearSnapshots() {
  try {
    const snapshotPath = _resolveSnapshotFilePath();
    if (fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
    }
  } catch (err) {
    console.error('[secure-store] storeClearSnapshots error:', err.message);
  }
}

module.exports = {
  storeGet,
  storeSet,
  storeRemove,
  storeGetAll,
  storeClearSnapshots,
};
