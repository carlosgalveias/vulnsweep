'use strict';

/**
 * Cross-platform encrypted key-value store for VulnSweep main process.
 * File-backed AES-encrypted store powered by secure-ls.
 *
 * Store file : Electron userData/store.dat
 * Fallback   : ~/.vsweep-store/store.dat  (non-Electron / CI)
 *
 * Encryption key: SHA-256(first physical MAC address) with key pinning.
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
const KEY_ID_FILENAME = 'store.key-id';
const MAX_INIT_FAILURES = 3;
const LOCK_STALE_MS = 10000;

let _storeDirCache = null;
let _storeDirResolved = false;
let _secretCache = null;
let _lsInstance = null;
// Set true ONLY for permanent failures (MODULE_NOT_FOUND for secure-ls).
// Transient I/O errors leave this false so subsequent calls can retry.
let _initFailed = false;
let _consecutiveInitFailures = 0;

/** @type {Set<string>} Keys quarantined this session (decryption failures) */
const _quarantinedKeys = new Set();

// ─── Structured Logging ─────────────────────────────────────────────────────

/**
 * Classify an error into a structured error type code.
 * @param {Error|null} err
 * @returns {string}
 */
function _classifyError(err) {
  if (!err) return 'UNKNOWN';
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('malformed utf-8')) return 'DECRYPTION_UTF8_FAILURE';
  if (msg.includes('decrypt') || msg.includes('bad decrypt')) return 'DECRYPTION_GENERAL';
  if (msg.includes('invalid iv')) return 'DECRYPTION_GENERAL';
  if (msg.includes('wrong final block')) return 'DECRYPTION_GENERAL';
  if (msg.includes('unexpected token') || msg.includes('json')) return 'JSON_PARSE_FAILURE';
  if (msg.includes('enoent')) return 'FILE_NOT_FOUND';
  if (msg.includes('eacces') || msg.includes('eperm')) return 'PERMISSION_DENIED';
  if (msg.includes('enospc')) return 'DISK_FULL';
  if (err.code === 'EILSEQ') return 'ENCODING_ERROR';
  return 'UNKNOWN';
}

/**
 * Structured corruption/error log.
 * @param {'WARN'|'ERROR'|'FATAL'} level
 * @param {string} key - Store key that failed ('*' for store-wide)
 * @param {Error} error - Original error
 * @param {string} action - What was done about it
 */
function _logCorruption(level, key, error, action) {
  const timestamp = new Date().toISOString();
  const errorType = _classifyError(error);

  let fileSize = 'unknown';
  try {
    const storeFile = _resolveStoreFilePath();
    const stat = fs.statSync(storeFile);
    fileSize = `${stat.size} bytes`;
  } catch {
    /* ignore */
  }

  const logLine = [
    `[${timestamp}]`,
    `[${level}]`,
    `[secure-store]`,
    `key="${key}"`,
    `error_type="${errorType}"`,
    `message="${error.message}"`,
    `file_size=${fileSize}`,
    `action="${action}"`,
  ].join(' ');

  if (level === 'FATAL' || level === 'ERROR') {
    console.error(logLine);
  } else {
    console.warn(logLine);
  }
}

// ─── Decryption Error Detection ─────────────────────────────────────────────

/**
 * Determine if an error is caused by decryption/key mismatch.
 * @param {Error|null} err
 * @returns {boolean}
 */
function _isDecryptionError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('malformed utf-8') ||
    msg.includes('malformed') ||
    msg.includes('decrypt') ||
    msg.includes('invalid iv') ||
    msg.includes('bad decrypt') ||
    msg.includes('wrong final block')
  );
}

// ─── Directory & Path Resolution ────────────────────────────────────────────

/**
 * Resolves the store directory. Three cases:
 *   (a) Non-Electron: require('electron') throws -> homedir fallback cached permanently.
 *   (b) Electron pre-ready: app.getPath unavailable -> transient homedir fallback,
 *       _storeDirResolved stays false so the next call retries.
 *   (c) Electron post-ready: getPath succeeds -> userData path cached permanently.
 * @returns {string}
 */
function _resolveStoreDir() {
  if (_storeDirResolved) return _storeDirCache;
  const { resolveDataDir } = require('./resolve-data-dir');
  _storeDirCache = resolveDataDir();
  _storeDirResolved = true;

  // Migration: if old ~/.vsweep-store/store.dat exists but the new location
  // does NOT have store.dat, copy the old file over. Do NOT delete the old file.
  const oldStoreFile = path.join(os.homedir(), '.vsweep-store', 'store.dat');
  const newStoreFile = path.join(_storeDirCache, 'store.dat');
  try {
    if (fs.existsSync(oldStoreFile) && !fs.existsSync(newStoreFile)) {
      fs.mkdirSync(_storeDirCache, { recursive: true });
      fs.copyFileSync(oldStoreFile, newStoreFile);
    }
  } catch {
    /* migration is best-effort */
  }

  // Cleanup orphaned temp files from crashed writes
  try {
    const dir = _storeDirCache;
    const files = fs.readdirSync(dir);
    const now = Date.now();
    for (const f of files) {
      if (f.startsWith('store.dat.tmp.')) {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > 60000) {
          fs.unlinkSync(fullPath);
        }
      }
    }
  } catch {
    /* best-effort cleanup */
  }

  return _storeDirCache;
}

function _resolveStoreFilePath() {
  return path.join(_resolveStoreDir(), 'store.dat');
}

function _resolveSnapshotFilePath() {
  return path.join(_resolveStoreDir(), 'store.dat.bak');
}

function _resolveKeyIdPath() {
  return path.join(_resolveStoreDir(), KEY_ID_FILENAME);
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
    _logCorruption('WARN', '*', err, 'SNAPSHOT_CREATION_FAILED');
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
    _logCorruption('WARN', '*', err, 'SNAPSHOT_RESTORE_FAILED');
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

// ─── Advisory File Locking ──────────────────────────────────────────────────

/**
 * Acquire a PID-based advisory lock on the store file.
 * @param {string} filePath - The store file path to lock
 * @returns {Function|null} Release function, or null if lock could not be acquired
 */
function _acquireLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const lockContent = JSON.stringify({ pid: process.pid, ts: Date.now() });

  try {
    // O_EXCL flag = fail if file already exists (atomic creation)
    fs.writeFileSync(lockPath, lockContent, { flag: 'wx' });
    return () => {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    };
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Check if stale (holder PID no longer running or older than LOCK_STALE_MS)
      try {
        const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (Date.now() - existing.ts > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          return _acquireLock(filePath); // Retry once
        }
      } catch {
        // Corrupt lock file — remove and retry
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        return _acquireLock(filePath);
      }
    }
    return null; // Could not acquire — proceed without lock
  }
}

// ─── Encryption Key Stability (Key Pinning) ─────────────────────────────────

/**
 * Derive a short fingerprint for key comparison.
 * @param {string} secretHex - The hex-encoded encryption secret
 * @returns {string} First 16 chars of SHA-256 of the key
 */
function _keyFingerprint(secretHex) {
  return crypto.createHash('sha256').update(secretHex).digest('hex').slice(0, 16);
}

/**
 * Collects all candidate key materials in priority order.
 * Includes: all physical MACs (sorted by interface name for stability),
 * plus the static fallback.
 * @returns {string[]}
 */
function _collectCandidateKeys() {
  const candidates = [];
  try {
    const ifaces = os.networkInterfaces();
    // Sort interface names for deterministic ordering
    const sortedNames = Object.keys(ifaces).sort();
    for (const ifaceName of sortedNames) {
      const addresses = ifaces[ifaceName];
      if (!Array.isArray(addresses)) continue;
      for (const addr of addresses) {
        if (addr.internal === true) continue;
        if (!addr.mac || addr.mac === '00:00:00:00:00:00') continue;
        if (!candidates.includes(addr.mac)) {
          candidates.push(addr.mac);
        }
      }
    }
  } catch {
    /* fall through */
  }
  candidates.push('vs-fb-2024-xk'); // Static fallback always last
  return candidates;
}

/**
 * Derive encryption secret with key pinning support.
 * On first run, pins the key fingerprint to disk.
 * On subsequent runs, finds the candidate matching the pinned fingerprint.
 * @returns {string} Hex-encoded encryption secret
 */
function _deriveEncryptionSecret() {
  if (_secretCache !== null) return _secretCache;

  const candidateKeys = _collectCandidateKeys();
  const keyIdPath = _resolveKeyIdPath();

  // If we have a pinned key fingerprint, find the matching candidate
  let pinnedFingerprint = null;
  try {
    pinnedFingerprint = fs.readFileSync(keyIdPath, 'utf8').trim();
  } catch {
    /* no pinned key yet */
  }

  if (pinnedFingerprint) {
    // Try to find a candidate that matches the pinned fingerprint
    for (const candidate of candidateKeys) {
      const secret = crypto.createHash('sha256').update(candidate).digest('hex');
      if (_keyFingerprint(secret) === pinnedFingerprint) {
        _secretCache = secret;
        return _secretCache;
      }
    }
    // No candidate matches — the store is likely unreadable.
    console.error(
      '[secure-store] WARNING: Encryption key fingerprint mismatch. ' +
        'The MAC address used to encrypt this store is no longer available. ' +
        `Pinned fingerprint: ${pinnedFingerprint}. ` +
        'Store data may be unreadable. Will attempt recovery from snapshot.'
    );
  }

  // First run or fingerprint mismatch fallback: use first available key
  const rawMaterial = candidateKeys[0] || 'vs-fb-2024-xk';
  _secretCache = crypto.createHash('sha256').update(rawMaterial).digest('hex');

  // Pin this key for future runs
  try {
    _ensureDir(path.dirname(keyIdPath));
    fs.writeFileSync(keyIdPath, _keyFingerprint(_secretCache), 'utf8');
  } catch {
    /* best-effort */
  }

  return _secretCache;
}

// ─── File Storage Adapter (Atomic Writes + Locking) ─────────────────────────

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

    const payload = JSON.stringify(data);
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

    // Acquire advisory lock
    const release = _acquireLock(filePath);

    try {
      fs.writeFileSync(tmpPath, payload, 'utf8');
      // Verify what we just wrote is parseable before committing
      const verification = fs.readFileSync(tmpPath, 'utf8');
      JSON.parse(verification);
      // Atomic rename (same filesystem guaranteed — same directory)
      fs.renameSync(tmpPath, filePath);
      _cache = data;
    } catch (err) {
      // Clean up failed temp file
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      if (release) release();
    }

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

// ─── Per-Key Corruption Recovery (Quarantine) ───────────────────────────────

/**
 * Remove a single corrupted key from raw storage (bypasses secure-ls decryption).
 * @param {string} key - The key to quarantine
 * @param {Error} error - The original decryption error
 */
function _quarantineCorruptedKey(key, error) {
  if (_quarantinedKeys.has(key)) return; // Already handled this session

  _quarantinedKeys.add(key);
  _logCorruption('ERROR', key, error, 'QUARANTINED_KEY');

  // Attempt direct removal from the file-level storage
  try {
    const filePath = _resolveStoreFilePath();
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && key in parsed) {
      delete parsed[key];
      // Use atomic write pattern
      const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
      const release = _acquireLock(filePath);
      try {
        fs.writeFileSync(tmpPath, JSON.stringify(parsed), 'utf8');
        fs.renameSync(tmpPath, filePath);
      } catch (writeErr) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        throw writeErr;
      } finally {
        if (release) release();
      }

      // Invalidate in-memory instance so it picks up the change
      _lsInstance = null;
    }
  } catch (quarantineErr) {
    console.error(
      `[secure-store] QUARANTINE FAILED for key "${key}": ${quarantineErr.message}. ` +
        'Error will be suppressed for remainder of this session.'
    );
  }
}

// ─── Nuclear Reset (Graceful Degradation) ───────────────────────────────────

/**
 * Complete store reset for unrecoverable corruption.
 * Preserves corrupt files for forensics, then starts fresh.
 * @param {string} reason - Why the reset was triggered
 */
function _nuclearReset(reason) {
  const timestamp = Date.now();
  const storeFile = _resolveStoreFilePath();
  const snapshotFile = _resolveSnapshotFilePath();
  const keyIdFile = _resolveKeyIdPath();

  console.error('='.repeat(80));
  console.error('[secure-store] FATAL: NUCLEAR RESET TRIGGERED');
  console.error(`[secure-store] Reason: ${reason}`);
  console.error('[secure-store] All stored credentials, license data, and settings are LOST.');
  console.error('[secure-store] Corrupt files preserved with .corrupt suffix for forensics.');
  console.error('='.repeat(80));

  const suffix = `.corrupt.${timestamp}`;

  try {
    if (fs.existsSync(storeFile)) fs.renameSync(storeFile, storeFile + suffix);
  } catch {
    /* best-effort */
  }

  try {
    if (fs.existsSync(snapshotFile)) fs.renameSync(snapshotFile, snapshotFile + suffix);
  } catch {
    /* best-effort */
  }

  try {
    if (fs.existsSync(keyIdFile)) fs.unlinkSync(keyIdFile);
  } catch {
    /* best-effort */
  }

  // Clear all in-memory state
  _lsInstance = null;
  _secretCache = null;
  _quarantinedKeys.clear();
}

// ─── Singleton Instance Management ──────────────────────────────────────────

/**
 * Returns the singleton SecureLS instance, creating it on first call.
 *
 * FIX (CRITICAL-1): The original implementation permanently set _initFailed=true
 * for ALL errors, including transient I/O failures that would self-resolve on retry.
 * This meant a single bad init (locked file, first-boot race) silenced the store
 * for the entire process lifetime. Fixed: only MODULE_NOT_FOUND is permanent.
 * All other errors leave _lsInstance=null so the next call retries.
 *
 * After MAX_INIT_FAILURES consecutive failures, triggers nuclear reset.
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
    _consecutiveInitFailures = 0; // Reset on success
    return _lsInstance;
  } catch (err) {
    // Permanent failure: secure-ls is not installed. No point retrying.
    if (err && err.code === 'MODULE_NOT_FOUND') {
      console.error('[secure-store] secure-ls module not found. Store permanently disabled.');
      _initFailed = true;
      return null;
    }

    _consecutiveInitFailures++;

    if (_consecutiveInitFailures >= MAX_INIT_FAILURES) {
      _nuclearReset(`${MAX_INIT_FAILURES} consecutive init failures. Last error: ${err.message}`);
      _consecutiveInitFailures = 0;

      // Retry once after reset
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
      } catch (resetErr) {
        _logCorruption('FATAL', '*', resetErr, 'NUCLEAR_RESET_ALSO_FAILED');
        _initFailed = true;
        return null;
      }
    }

    _logCorruption(
      'ERROR',
      '*',
      err,
      `INIT_FAILED_${_consecutiveInitFailures}/${MAX_INIT_FAILURES}`
    );
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

function storeGet(key) {
  try {
    if (_quarantinedKeys.has(key)) return null; // Don't re-attempt known-bad keys

    const ls = _getInstance();
    if (!ls) return null;
    const val = ls.get(key);
    return val !== undefined && val !== null && val !== '' ? val : null;
  } catch (err) {
    if (_isDecryptionError(err)) {
      _quarantineCorruptedKey(key, err);
    } else {
      _logCorruption('ERROR', key, err, 'READ_FAILED');
    }
    return null;
  }
}

function storeSet(key, value) {
  try {
    const ls = _getInstance();
    if (!ls) return;
    ls.set(key, value);
    // If key was previously quarantined, it's now overwritten — clear quarantine
    _quarantinedKeys.delete(key);
  } catch (err) {
    _logCorruption('ERROR', key, err, 'WRITE_FAILED');
  }
}

function storeRemove(key) {
  try {
    const ls = _getInstance();
    if (!ls) return;
    ls.remove(key);
    _quarantinedKeys.delete(key);
  } catch (err) {
    _logCorruption('ERROR', key, err, 'REMOVE_FAILED');
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
        if (_quarantinedKeys.has(key)) continue; // Skip quarantined keys
        const val = ls.get(key);
        if (val !== undefined && val !== null && val !== '') {
          result[key] = val;
        }
      } catch (err) {
        if (_isDecryptionError(err)) {
          _quarantineCorruptedKey(key, err);
        }
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
