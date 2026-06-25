# Secure Store Hardening — Implementation Specification

**Document:** `specs/secure-store-hardening.md`
**Status:** APPROVED FOR IMPLEMENTATION
**Author:** Code Pathologist (Architect Review)
**Date:** 2026-06-23
**Target File:** [`src/main/utils/secure-store.js`](src/main/utils/secure-store.js)

---

## 0. Diagnosis Summary

The current [`secure-store.js`](src/main/utils/secure-store.js:1) is a 323-line case study in "works on my machine" engineering. The patient presents with:

1. **Non-atomic writes** — bare [`fs.writeFileSync`](src/main/utils/secure-store.js:184) that leaves a corrupted file on process crash mid-write
2. **Unstable encryption key** — [`_deriveEncryptionSecret()`](src/main/utils/secure-store.js:125) picks the "first physical MAC address" which changes with VPN adapters, docking stations, or network resets
3. **Zero concurrency protection** — CLI (`src/cli/`) and Electron GUI (`src/main/main.js`) can write simultaneously to the same `store.dat`
4. **All-or-nothing corruption recovery** — if one key (`"v"`) is corrupted, the entire store is either restored from snapshot or abandoned
5. **Useless error logging** — repeats the same error on every read of a corrupted key, forever, with no remediation

### Known Store Keys (from consumer analysis)

| Key                    | Module                                                                                  | Purpose                    | Sensitivity                          |
| ---------------------- | --------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------ |
| `v`                    | [`license.js`](src/main/modules/license.js:221)                                         | Encrypted license blob     | HIGH — loss = re-activation required |
| `k`                    | [`license.js`](src/main/modules/license.js:222)                                         | Private key (JSON)         | HIGH                                 |
| `p`                    | [`license.js`](src/main/modules/license.js:285)                                         | Public key (JSON)          | MEDIUM                               |
| `i`                    | [`license.js`](src/main/modules/license.js:169)                                         | Install timestamp          | LOW — can regenerate                 |
| `ao`                   | [`main.js`](src/main/main.js:1094) / [`analytics.js`](src/main/modules/analytics.js:40) | Analytics opt-out flag     | LOW                                  |
| `cred:nvd`             | [`constants.js`](src/main/config/constants.js:317)                                      | NVD API key                | MEDIUM                               |
| `cred:github-advisory` | [`constants.js`](src/main/config/constants.js:339)                                      | GitHub Advisory API token  | MEDIUM                               |
| `cred:*:hint`          | [`main.js`](src/main/main.js:1140)                                                      | Last 4 chars of credential | LOW                                  |
| `app:settings`         | [`main.js`](src/main/main.js:550)                                                       | User settings JSON string  | LOW — has defaults                   |

---

## 1. Atomic Writes (Replace bare `writeFileSync`)

### Problem

[`_write(data)`](src/main/utils/secure-store.js:181) at line 184 calls:

```javascript
fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
```

If the process crashes, the OS loses power, or Electron force-quits mid-write, `store.dat` contains partial JSON. The existing snapshot (created on line 183 via [`_createSnapshot`](src/main/utils/secure-store.js:80)) only helps if the _previous_ write succeeded — it does nothing for the _current_ in-progress write that caused corruption.

### Solution: Write-to-Temp-then-Rename

**Pattern:** Write to a temporary file in the same directory, then atomically rename over the target.

**Implementation in [`_write(data)`](src/main/utils/secure-store.js:181):**

```javascript
function _write(data) {
  _ensureDir(path.dirname(filePath));
  _createSnapshot(filePath);

  const payload = JSON.stringify(data);
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

  try {
    fs.writeFileSync(tmpPath, payload, 'utf8');
    // Validate what we just wrote is parseable before committing
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
  }

  _cleanupOldSnapshots();
}
```

### Edge Cases

| Case                                      | Behavior                                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Process crash before `renameSync`         | `store.dat` retains previous valid content; `.tmp.*` file is orphaned (harmless)                                                               |
| Process crash during `renameSync`         | On POSIX: atomic — either old or new. On Windows NTFS: `renameSync` is atomic for same-volume                                                  |
| Disk full during `writeFileSync(tmpPath)` | Exception thrown, temp file cleaned up, original untouched                                                                                     |
| Orphaned `.tmp.*` files from past crashes | Add cleanup in [`_resolveStoreDir()`](src/main/utils/secure-store.js:42) on startup — delete any `store.dat.tmp.*` files older than 60 seconds |

### Startup Cleanup Addition

Add to [`_resolveStoreDir()`](src/main/utils/secure-store.js:42) after line 61 (before `return`):

```javascript
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
```

### What NOT to Change

- Keep [`_createSnapshot()`](src/main/utils/secure-store.js:80) — the snapshot is still valuable as a second-level recovery (different from atomic write protection)
- Keep the existing snapshot validation (JSON.parse check on line 85)
- Keep [`_cleanupOldSnapshots()`](src/main/utils/secure-store.js:106) logic unchanged

---

## 2. Per-Key Corruption Recovery

### Problem

When [`storeGet(key)`](src/main/utils/secure-store.js:250) fails at line 257 with "Malformed UTF-8 data", it:

1. Logs the error
2. Returns `null`
3. **Does nothing to fix the corrupted key**

The next call to `storeGet(key)` hits the exact same error. This produces infinite error spam and never self-heals.

### Solution: Corrupted Key Quarantine and Reset

**New function: `_quarantineCorruptedKey(key, error)`**

When a `storeGet` fails with a decryption/parse error:

1. Log the corruption event with full context (see Section 3)
2. Attempt to remove ONLY the corrupted key from the raw storage (not through `secure-ls` which would fail again)
3. If removal succeeds, the next read returns `null` cleanly
4. If removal fails, flag the key in a module-level `Set` to suppress repeated error logs

**Implementation:**

```javascript
// Module-level: track keys that have been quarantined this session
const _quarantinedKeys = new Set();

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

function _quarantineCorruptedKey(key, error) {
  if (_quarantinedKeys.has(key)) return; // Already handled this session

  _quarantinedKeys.add(key);

  // Attempt direct removal from the file-level storage adapter
  // This bypasses secure-ls decryption (which is what's failing)
  try {
    const filePath = _resolveStoreFilePath();
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && key in parsed) {
      delete parsed[key];
      // Use atomic write pattern
      const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
      fs.writeFileSync(tmpPath, JSON.stringify(parsed), 'utf8');
      fs.renameSync(tmpPath, filePath);

      // Invalidate in-memory cache so _lsInstance picks up the change
      _lsInstance = null;

      console.warn(
        `[secure-store] QUARANTINE: Removed corrupted key "${key}" from store. ` +
          `Error was: ${error.message}. Key will return null on next read.`
      );
    }
  } catch (quarantineErr) {
    console.error(
      `[secure-store] QUARANTINE FAILED for key "${key}": ${quarantineErr.message}. ` +
        `Error will be suppressed for remainder of this session.`
    );
  }
}
```

**Modified [`storeGet(key)`](src/main/utils/secure-store.js:250):**

```javascript
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
      console.error(`[secure-store] storeGet error for key "${key}":`, err.message);
    }
    return null;
  }
}
```

### Edge Cases

| Case                                  | Behavior                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| License keys (`v`, `k`) corrupted     | Returns `null` → `checkLicense()` returns `{ valid: false }` → user must re-activate. This is correct — we cannot fabricate a license. |
| Settings (`app:settings`) corrupted   | Returns `null` → consumers already handle this with `raw ? JSON.parse(raw) : {}` defaults                                              |
| Install date (`i`) corrupted          | Returns `null` → [`initInstallDate()`](src/main/modules/license.js:169) re-creates it on next call                                     |
| Credential (`cred:*`) corrupted       | Returns `null` → user re-enters credential. Acceptable.                                                                                |
| Quarantine itself fails (file locked) | Key is added to `_quarantinedKeys` Set → error suppressed for session. Next app restart will retry.                                    |

### What NOT to Change

- Do NOT auto-populate corrupted keys with default values for `v` or `k` — these are cryptographic material that cannot be guessed
- Do NOT reset the entire store — only quarantine the specific failing key
- Keep [`storeGetAll()`](src/main/utils/secure-store.js:282) behavior (already skips individual failures)

---

## 3. Enhanced Error Logging

### Problem

Current logging at line 257:

```javascript
console.error(`[secure-store] storeGet error for key "${key}":`, err.message);
```

This tells you _what_ failed but not _why_, _when_ (in relation to other events), or _what to do about it_.

### Solution: Structured Corruption Log

**New function: `_logCorruption(level, key, error, action)`**

```javascript
/**
 * @param {'WARN'|'ERROR'|'FATAL'} level
 * @param {string} key - Store key that failed
 * @param {Error} error - Original error
 * @param {string} action - What was done about it
 */
function _logCorruption(level, key, error, action) {
  const timestamp = new Date().toISOString();
  const errorType = _classifyError(error);
  const storeFile = _resolveStoreFilePath();

  let fileSize = 'unknown';
  try {
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

  if (level === 'FATAL') {
    console.error(logLine);
  } else if (level === 'ERROR') {
    console.error(logLine);
  } else {
    console.warn(logLine);
  }
}

function _classifyError(err) {
  if (!err) return 'UNKNOWN';
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('malformed utf-8')) return 'DECRYPTION_UTF8_FAILURE';
  if (msg.includes('decrypt')) return 'DECRYPTION_GENERAL';
  if (msg.includes('unexpected token') || msg.includes('json')) return 'JSON_PARSE_FAILURE';
  if (msg.includes('enoent')) return 'FILE_NOT_FOUND';
  if (msg.includes('eacces') || msg.includes('eperm')) return 'PERMISSION_DENIED';
  if (msg.includes('enospc')) return 'DISK_FULL';
  if (err.code === 'EILSEQ') return 'ENCODING_ERROR';
  return 'UNKNOWN';
}
```

### Log Output Examples

```
[2026-06-23T12:35:00.123Z] [ERROR] [secure-store] key="v" error_type="DECRYPTION_UTF8_FAILURE" message="Malformed UTF-8 data" file_size=2048 bytes action="QUARANTINED_KEY"
[2026-06-23T12:35:00.125Z] [ERROR] [secure-store] key="k" error_type="DECRYPTION_UTF8_FAILURE" message="Malformed UTF-8 data" file_size=2048 bytes action="QUARANTINED_KEY"
[2026-06-23T12:35:01.000Z] [FATAL] [secure-store] key="*" error_type="JSON_PARSE_FAILURE" message="Unexpected token < in JSON at position 0" file_size=0 bytes action="RESTORED_FROM_SNAPSHOT"
```

### Integration Points

Replace all existing `console.error('[secure-store]...')` calls with `_logCorruption()`:

| Location                                                           | Current              | Replacement                                                    |
| ------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------- |
| [`storeGet` catch](src/main/utils/secure-store.js:257)             | `console.error(...)` | `_logCorruption('ERROR', key, err, action)`                    |
| [`storeSet` catch](src/main/utils/secure-store.js:268)             | `console.error(...)` | `_logCorruption('ERROR', key, err, 'WRITE_FAILED')`            |
| [`storeRemove` catch](src/main/utils/secure-store.js:278)          | `console.error(...)` | `_logCorruption('ERROR', key, err, 'REMOVE_FAILED')`           |
| [`_createSnapshot` catch](src/main/utils/secure-store.js:88)       | `console.error(...)` | `_logCorruption('WARN', '*', err, 'SNAPSHOT_CREATION_FAILED')` |
| [`_restoreFromSnapshot` catch](src/main/utils/secure-store.js:100) | `console.error(...)` | `_logCorruption('WARN', '*', err, 'SNAPSHOT_RESTORE_FAILED')`  |

---

## 4. File Locking / Single-Writer Guarantee

### Problem

The CLI (`src/cli/index.js`) and Electron GUI (`src/main/main.js`) both `require('./utils/secure-store')` and can run simultaneously. Two processes calling [`_write()`](src/main/utils/secure-store.js:181) at the same time will interleave writes, corrupting the file.

### Solution: Advisory File Lock via `proper-lockfile`

**Dependency to add:** `proper-lockfile` (npm package — cross-platform advisory file locking)

**Why not `fs-ext` or OS-level locks?** Because:

- `fs-ext` requires native compilation (Electron rebuild pain)
- OS-level locks behave differently on Windows vs POSIX
- `proper-lockfile` uses lockfile + stale detection (pure JS, zero native deps)

**Implementation:**

```javascript
const lockfile = require('proper-lockfile');

const LOCK_OPTIONS = {
  stale: 10000, // Consider lock stale after 10s (crash detection)
  retries: {
    retries: 3,
    minTimeout: 100,
    maxTimeout: 1000,
  },
};

function _writeWithLock(data) {
  const filePath = _resolveStoreFilePath();
  _ensureDir(path.dirname(filePath));

  // Ensure store.dat exists (lockfile requires existing file)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}', 'utf8');
  }

  let release;
  try {
    release = lockfile.lockSync(filePath, LOCK_OPTIONS);
  } catch (lockErr) {
    _logCorruption('ERROR', '*', lockErr, 'LOCK_ACQUISITION_FAILED');
    // Fallback: write anyway (better than losing data silently)
    // The atomic write pattern still protects against partial writes
  }

  try {
    _createSnapshot(filePath);
    const payload = JSON.stringify(data);
    const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

    fs.writeFileSync(tmpPath, payload, 'utf8');
    // Verify before commit
    const verification = fs.readFileSync(tmpPath, 'utf8');
    JSON.parse(verification);
    fs.renameSync(tmpPath, filePath);
    _cache = data;
    _cleanupOldSnapshots();
  } finally {
    if (release) {
      try {
        release();
      } catch {
        /* ignore */
      }
    }
  }
}
```

**Replace [`_write(data)`](src/main/utils/secure-store.js:181) body** with `_writeWithLock(data)` call.

### Edge Cases

| Case                               | Behavior                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lock already held by CLI           | GUI retries 3 times (100ms, 200ms, 1000ms) then falls back to unprotected atomic write                    |
| Process crashes while holding lock | `stale: 10000` — lock auto-expires after 10s                                                              |
| `proper-lockfile` not installed    | Graceful degradation: wrap `require('proper-lockfile')` in try/catch, fall back to lock-free atomic write |
| Read operations                    | Do NOT acquire lock for reads — only writes need protection                                               |

### Package.json Change

Add to `dependencies`:

```json
"proper-lockfile": "^4.1.2"
```

### Alternative (if no new dependency is acceptable)

If adding a dependency is rejected, implement a simple PID-based lockfile manually:

```javascript
function _acquireLock(filePath) {
  const lockPath = filePath + '.lock';
  const lockContent = JSON.stringify({ pid: process.pid, ts: Date.now() });

  try {
    // O_EXCL flag = fail if file already exists (atomic creation)
    fs.writeFileSync(lockPath, lockContent, { flag: 'wx' });
    return () => {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    };
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Check if stale (holder PID no longer running or older than 10s)
      try {
        const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (Date.now() - existing.ts > 10000) {
          fs.unlinkSync(lockPath);
          return _acquireLock(filePath); // Retry once
        }
      } catch {
        /* corrupt lock file — remove and retry */
        try {
          fs.unlinkSync(lockPath);
        } catch {}
        return _acquireLock(filePath);
      }
    }
    return null; // Could not acquire — proceed without lock
  }
}
```

---

## 5. Encryption Key Stability

### Problem

[`_deriveEncryptionSecret()`](src/main/utils/secure-store.js:125) iterates `os.networkInterfaces()` and picks the first non-internal, non-zero MAC address. This is:

- **Non-deterministic across boots** — interface enumeration order is not guaranteed
- **Unstable with VPN** — Cisco AnyConnect, WireGuard, etc. add virtual adapters that may sort first
- **Unstable with docking stations** — USB-C ethernet adapters appear/disappear
- **Different between CLI and GUI** — if network state differs when each process starts

When the derived key changes, the entire `store.dat` becomes unreadable (every key returns "Malformed UTF-8 data").

### Solution: Key Pinning with Migration Support

**Strategy:** Once an encryption key is derived successfully for the first time, persist a _key fingerprint_ in a separate, unencrypted file. On subsequent runs, if the derived key doesn't match the fingerprint, try known fallback keys.

**New file:** `<dataDir>/store.key-id` (plain text, contains the hex fingerprint of the working encryption key)

**Implementation:**

```javascript
const KEY_ID_FILENAME = 'store.key-id';

function _resolveKeyIdPath() {
  return path.join(_resolveStoreDir(), KEY_ID_FILENAME);
}

function _keyFingerprint(secretHex) {
  // Short fingerprint for comparison (first 16 chars of SHA-256 of the key)
  return crypto.createHash('sha256').update(secretHex).digest('hex').slice(0, 16);
}

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
    // Use the FIRST candidate anyway (store will need recovery).
    // Log prominently.
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

/**
 * Collects all candidate key materials in priority order.
 * Includes: all physical MACs (sorted by interface name for stability),
 * plus the static fallback.
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
```

### Migration from Current Behavior

On the FIRST run after this change:

1. No `store.key-id` file exists
2. `_deriveEncryptionSecret()` picks the first candidate (same as before for most users)
3. Pins the fingerprint to `store.key-id`
4. Future runs: if MAC order changes, the pinned fingerprint finds the correct key

For users who ALREADY have corruption (key already changed):

- The mismatch path triggers → attempts snapshot recovery
- If snapshot was written with the old key, it's also unreadable → graceful degradation (Section 7)

### What NOT to Change

- Do NOT change the encryption algorithm (AES via `secure-ls`)
- Do NOT change the `secure-ls` configuration options
- Do NOT store the actual encryption key on disk (only the fingerprint)
- The static fallback `'vs-fb-2024-xk'` must remain as the last-resort candidate

---

## 6. Separation of Concerns — Confirmation

### Assessment

The scan cache ([`src/main/modules/scanner/scan-cache.js`](src/main/modules/scanner/scan-cache.js:1)) is **already fully separate** from the secure store:

| Aspect              | Secure Store              | Scan Cache                    |
| ------------------- | ------------------------- | ----------------------------- |
| File location       | `<dataDir>/store.dat`     | `<dataDir>/scan-cache/*.json` |
| Encryption          | AES (secure-ls)           | None (plain JSON)             |
| Write pattern       | Synchronous, immediate    | Debounced (2s), per-source    |
| Corruption recovery | Snapshot restore          | Delete corrupt file           |
| Concurrency risk    | HIGH (shared single file) | LOW (per-source files)        |

### Verdict: NO CHANGES NEEDED for scan-cache separation.

The only potential issue is that both modules resolve their base directory via [`resolveDataDir()`](src/main/utils/resolve-data-dir.js:23), which is correct and intentional. They share a _parent directory_ but not a _data file_.

---

## 7. Graceful Degradation (Total Store Failure)

### Problem

If `store.dat` is completely unrecoverable (corrupted AND snapshot also corrupted AND key fingerprint mismatches), the current code enters a loop where:

- Every `storeGet()` call triggers `_getInstance()` which retries initialization
- Initialization re-reads the corrupted file
- Error is logged every time
- App never stabilizes

### Solution: Nuclear Reset with Prominent Logging

**New function: `_nuclearReset(reason)`**

When the store is determined to be completely unrecoverable:

1. Rename `store.dat` → `store.dat.corrupt.<timestamp>` (preserve for forensics)
2. Rename `store.dat.bak` → `store.dat.bak.corrupt.<timestamp>`
3. Delete `store.key-id` (force fresh key pinning)
4. Reset `_lsInstance = null` and `_cache = null`
5. Log a FATAL-level message explaining what happened
6. Next `_getInstance()` call creates a fresh, empty store

**Trigger conditions** (add to `_getInstance()`):

```javascript
// Track consecutive init failures
let _consecutiveInitFailures = 0;
const MAX_INIT_FAILURES = 3;

function _getInstance() {
  if (_lsInstance !== null) return _lsInstance;
  if (_initFailed) return null;

  try {
    // ... existing init logic ...
    _consecutiveInitFailures = 0; // Reset on success
    return _lsInstance;
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      _initFailed = true;
      return null;
    }

    _consecutiveInitFailures++;
    if (_consecutiveInitFailures >= MAX_INIT_FAILURES) {
      _nuclearReset(`${MAX_INIT_FAILURES} consecutive init failures. Last error: ${err.message}`);
      _consecutiveInitFailures = 0;
      // Retry once after reset
      try {
        // ... re-run init logic ...
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
```

**`_nuclearReset` implementation:**

```javascript
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
```

### What NOT to Change

- Do NOT auto-reset on the first failure (could lose data unnecessarily)
- Do NOT delete `.corrupt.*` files automatically — user/support needs them for diagnosis
- The trial store ([`src/main/utils/trial-store.js`](src/main/utils/trial-store.js:1)) is independent — do NOT touch it during nuclear reset

---

## 8. Implementation Checklist

### Files to Modify

| File                                                                 | Changes                                      |
| -------------------------------------------------------------------- | -------------------------------------------- |
| [`src/main/utils/secure-store.js`](src/main/utils/secure-store.js:1) | All changes described in Sections 1–5 and 7  |
| `package.json`                                                       | Add `proper-lockfile` dependency (Section 4) |

### Files to Create

| File                     | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `<dataDir>/store.key-id` | Created at runtime — encryption key fingerprint (Section 5) |

### New Exports (None)

The public API remains unchanged:

- `storeGet(key)` → `any | null`
- `storeSet(key, value)` → `void`
- `storeRemove(key)` → `void`
- `storeGetAll()` → `object`
- `storeClearSnapshots()` → `void`

No signature changes. All improvements are internal. Consumers do NOT need modification.

### New Internal Functions

| Function                                    | Purpose                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| `_isDecryptionError(err)`                   | Classify whether an error is a decryption/key mismatch issue |
| `_quarantineCorruptedKey(key, error)`       | Remove a single corrupted key from raw storage               |
| `_logCorruption(level, key, error, action)` | Structured error logging                                     |
| `_classifyError(err)`                       | Map error messages to error type codes                       |
| `_writeWithLock(data)`                      | Atomic write with advisory file locking                      |
| `_acquireLock(filePath)`                    | Manual lockfile implementation (if no dependency)            |
| `_nuclearReset(reason)`                     | Complete store reset for unrecoverable corruption            |
| `_collectCandidateKeys()`                   | Gather all MAC addresses + fallback in sorted order          |
| `_keyFingerprint(secretHex)`                | Derive short fingerprint for key comparison                  |
| `_resolveKeyIdPath()`                       | Path to key fingerprint file                                 |

### Module-Level State Additions

```javascript
const _quarantinedKeys = new Set();
let _consecutiveInitFailures = 0;
const MAX_INIT_FAILURES = 3;
const KEY_ID_FILENAME = 'store.key-id';
```

### Removed/Replaced

| Old                                        | New                                                    |
| ------------------------------------------ | ------------------------------------------------------ |
| Bare `fs.writeFileSync` in `_write()`      | Atomic write-to-temp-then-rename in `_writeWithLock()` |
| `_deriveEncryptionSecret()` (unstable MAC) | New version with key pinning + sorted candidates       |
| Simple `console.error` calls               | `_logCorruption()` structured logging                  |

---

## 9. Testing Requirements

### Unit Tests to Add/Modify

| Test                                             | Validates                                                    |
| ------------------------------------------------ | ------------------------------------------------------------ |
| Atomic write: kill process mid-write             | `store.dat` retains previous valid content                   |
| Atomic write: disk full simulation               | Original file untouched, temp cleaned up                     |
| Per-key quarantine: corrupt single key           | Only that key returns null; other keys still work            |
| Per-key quarantine: repeated reads of bad key    | Error logged ONCE, not on every call                         |
| Key stability: MAC address changes               | Pinned fingerprint finds correct key                         |
| Key stability: first run (no pin file)           | Creates `store.key-id` with correct fingerprint              |
| Nuclear reset: 3 consecutive failures            | Files renamed with `.corrupt` suffix, fresh store created    |
| File locking: two processes write simultaneously | No corruption (requires integration test with child_process) |
| Orphan cleanup: stale `.tmp.*` files             | Removed on startup if older than 60s                         |

### Manual Testing Scenarios

1. **VPN Toggle:** Start app → connect VPN → restart app → verify store still readable
2. **Kill -9 During Write:** Force-kill during `storeSet` → verify store integrity on restart
3. **CLI + GUI Simultaneous:** Run scan from CLI while GUI is open → verify no corruption
4. **Corrupt Single Key:** Manually edit `store.dat` to corrupt one encrypted value → verify only that key is lost

---

## 10. Risk Assessment

| Change             | Risk                                               | Mitigation                                                    |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| Atomic writes      | LOW — standard pattern, well-understood            | Verify-after-write adds safety net                            |
| File locking       | MEDIUM — `proper-lockfile` is a new dependency     | Graceful fallback if lock fails                               |
| Key pinning        | MEDIUM — migration from unpinned state             | First run pins existing key; no data loss for stable machines |
| Per-key quarantine | LOW — only triggers on confirmed decryption errors | Quarantine set clears on restart; aggressive but recoverable  |
| Nuclear reset      | HIGH (data loss by design)                         | Only after 3 consecutive failures; preserves corrupt files    |

---

## 11. Implementation Order

Execute in this exact sequence to minimize risk:

1. **Atomic writes** (Section 1) — immediate safety improvement, zero behavior change
2. **Enhanced logging** (Section 3) — visibility before further changes
3. **Per-key quarantine** (Section 2) — self-healing for the most common complaint
4. **Key stability** (Section 5) — prevents the root cause of multi-machine corruption
5. **File locking** (Section 4) — requires new dependency, test thoroughly
6. **Graceful degradation** (Section 7) — nuclear option, implement last

Each step should be a separate commit with its own tests passing before proceeding to the next.
