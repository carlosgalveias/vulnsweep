'use strict';

/**
 * Tests for secure-store hardening features:
 * - Atomic writes (write-to-temp-then-rename)
 * - Per-key corruption quarantine
 * - Nuclear reset after consecutive failures
 * - Lockfile creation/cleanup
 * - Structured logging
 * - Key pinning (encryption key stability)
 *
 * @module __tests__/main/utils/secure-store.test
 */

const path = require('path');

// ─── Mock State ─────────────────────────────────────────────────────────────

let mockFileSystem = {};
let mockSecureLsStorage = {};
let mockSecureLsGetError = null;

// ─── FS Mock ────────────────────────────────────────────────────────────────

jest.mock('fs', () => {
  const mockPath = require('path');
  return {
    existsSync: jest.fn((p) => p in mockFileSystem),
    readFileSync: jest.fn((p) => {
      if (!(p in mockFileSystem)) {
        const e = new Error(`ENOENT: no such file or directory, open '${p}'`);
        e.code = 'ENOENT';
        throw e;
      }
      return mockFileSystem[p];
    }),
    writeFileSync: jest.fn((p, d, opts) => {
      if (opts && typeof opts === 'object' && opts.flag === 'wx') {
        if (p in mockFileSystem) {
          const e = new Error('EEXIST');
          e.code = 'EEXIST';
          throw e;
        }
      }
      mockFileSystem[p] = d;
    }),
    renameSync: jest.fn((s, d) => {
      if (!(s in mockFileSystem)) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      mockFileSystem[d] = mockFileSystem[s];
      delete mockFileSystem[s];
    }),
    unlinkSync: jest.fn((p) => {
      delete mockFileSystem[p];
    }),
    copyFileSync: jest.fn((s, d) => {
      if (!(s in mockFileSystem)) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      mockFileSystem[d] = mockFileSystem[s];
    }),
    mkdirSync: jest.fn(),
    statSync: jest.fn((p) => {
      if (!(p in mockFileSystem)) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      return { size: (mockFileSystem[p] || '').length, mtimeMs: Date.now() - 120000 };
    }),
    readdirSync: jest.fn((dir) => {
      const nd = dir.replace(/[\\/]+$/, '');
      const files = [];
      for (const k of Object.keys(mockFileSystem)) {
        if (mockPath.dirname(k) === nd) files.push(mockPath.basename(k));
      }
      return files;
    }),
  };
});

// ─── OS Mock ────────────────────────────────────────────────────────────────

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => 'C:\\mock\\home'),
  networkInterfaces: jest.fn(() => ({
    Ethernet: [
      { mac: 'aa:bb:cc:dd:ee:ff', internal: false, family: 'IPv4', address: '192.168.1.1' },
    ],
    'Wi-Fi': [
      { mac: '11:22:33:44:55:66', internal: false, family: 'IPv4', address: '192.168.1.2' },
    ],
    lo: [{ mac: '00:00:00:00:00:00', internal: true, family: 'IPv4', address: '127.0.0.1' }],
  })),
}));

// ─── Path constants ─────────────────────────────────────────────────────────

const MOCK_DATA_DIR = path.join('C:', 'mock', 'appdata');
const STORE_FILE = path.join(MOCK_DATA_DIR, 'store.dat');
const SNAPSHOT_FILE = path.join(MOCK_DATA_DIR, 'store.dat.bak');
const KEY_ID_FILE = path.join(MOCK_DATA_DIR, 'store.key-id');

jest.mock('../../../src/main/utils/resolve-data-dir', () => ({
  resolveDataDir: () => require('path').join('C:', 'mock', 'appdata'),
}));

// ─── secure-ls Mock (uses global for constructor error) ─────────────────────

jest.mock('secure-ls', () => ({
  default: class MockSecureLS {
    constructor(opts) {
      if (global.__mockSecureLsCtorError) throw global.__mockSecureLsCtorError;
      this._storage = opts.storage;
    }
    get(key) {
      if (mockSecureLsGetError && mockSecureLsGetError.key === key)
        throw mockSecureLsGetError.error;
      return mockSecureLsStorage[key] ?? null;
    }
    set(key, value) {
      mockSecureLsStorage[key] = value;
      this._storage.setItem(key, JSON.stringify({ data: value }));
    }
    remove(key) {
      delete mockSecureLsStorage[key];
      this._storage.removeItem(key);
    }
    getAllKeys() {
      return Object.keys(mockSecureLsStorage);
    }
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadFreshModule() {
  jest.resetModules();
  jest.mock('fs');
  jest.mock('os');
  jest.mock('../../../src/main/utils/resolve-data-dir');
  jest.mock('secure-ls');
  return require('../../../src/main/utils/secure-store');
}

// ─── Test Suites ────────────────────────────────────────────────────────────

describe('secure-store hardening', () => {
  let store;

  beforeEach(() => {
    mockFileSystem = {};
    mockSecureLsStorage = {};
    mockSecureLsGetError = null;
    global.__mockSecureLsCtorError = null;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    store = loadFreshModule();
  });

  afterEach(() => {
    global.__mockSecureLsCtorError = null;
    jest.restoreAllMocks();
  });

  describe('Public API basics', () => {
    it('storeGet returns null for non-existent key', () => {
      expect(store.storeGet('nonexistent')).toBeNull();
    });

    it('storeSet and storeGet round-trip', () => {
      store.storeSet('testKey', 'testValue');
      expect(store.storeGet('testKey')).toBe('testValue');
    });

    it('storeRemove removes a key', () => {
      store.storeSet('removeMe', 'value');
      store.storeRemove('removeMe');
      expect(store.storeGet('removeMe')).toBeNull();
    });

    it('storeGetAll returns all stored keys', () => {
      mockSecureLsStorage = { a: 1, b: 2, c: 3 };
      expect(store.storeGetAll()).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('storeClearSnapshots removes snapshot file', () => {
      mockFileSystem[SNAPSHOT_FILE] = '{}';
      store.storeClearSnapshots();
      expect(SNAPSHOT_FILE in mockFileSystem).toBe(false);
    });
  });

  describe('Atomic Writes', () => {
    it('writes to a temp file before renaming to target', () => {
      const fs = require('fs');
      store.storeSet('atomicKey', 'atomicValue');

      const tmpWriteCalls = fs.writeFileSync.mock.calls.filter(
        ([p]) => typeof p === 'string' && p.includes('store.dat.tmp.')
      );
      expect(tmpWriteCalls.length).toBeGreaterThan(0);

      const renameCalls = fs.renameSync.mock.calls.filter(
        ([src, dest]) =>
          typeof src === 'string' && src.includes('store.dat.tmp.') && dest === STORE_FILE
      );
      expect(renameCalls.length).toBeGreaterThan(0);
    });

    it('verifies written data is parseable before committing', () => {
      const fs = require('fs');
      store.storeSet('verifyKey', { nested: 'object' });

      const readCalls = fs.readFileSync.mock.calls.filter(
        ([p]) => typeof p === 'string' && p.includes('store.dat.tmp.')
      );
      expect(readCalls.length).toBeGreaterThan(0);
    });

    it('cleans orphaned temp files older than 60s on startup', () => {
      const oldTmpFile = path.join(MOCK_DATA_DIR, 'store.dat.tmp.12345.1000');
      mockFileSystem[oldTmpFile] = '{}';

      const freshStore = loadFreshModule();
      freshStore.storeGet('any');

      expect(oldTmpFile in mockFileSystem).toBe(false);
    });
  });

  describe('Advisory File Locking', () => {
    it('creates lockfile during write', () => {
      const fs = require('fs');
      store.storeSet('lockTest', 'value');

      const lockWriteCalls = fs.writeFileSync.mock.calls.filter(
        ([p, , opts]) =>
          typeof p === 'string' &&
          p.endsWith('.lock') &&
          opts &&
          typeof opts === 'object' &&
          opts.flag === 'wx'
      );
      expect(lockWriteCalls.length).toBeGreaterThan(0);
    });

    it('removes lockfile after successful write', () => {
      store.storeSet('lockCleanup', 'value');
      const lockPath = `${STORE_FILE}.lock`;
      expect(lockPath in mockFileSystem).toBe(false);
    });

    it('handles stale lock gracefully (removes and retries)', () => {
      const lockPath = `${STORE_FILE}.lock`;
      mockFileSystem[lockPath] = JSON.stringify({ pid: 99999, ts: Date.now() - 20000 });
      store.storeSet('staleLock', 'value');
      expect(store.storeGet('staleLock')).toBe('value');
    });

    it('proceeds without lock if lock acquisition fails', () => {
      const lockPath = `${STORE_FILE}.lock`;
      mockFileSystem[lockPath] = JSON.stringify({ pid: 99999, ts: Date.now() });
      store.storeSet('noLock', 'value');
      expect(store.storeGet('noLock')).toBe('value');
    });
  });

  describe('Per-Key Corruption Recovery (Quarantine)', () => {
    it('returns null for quarantined key without throwing', () => {
      mockSecureLsStorage = { good: 'value', bad: 'encrypted' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ good: 'enc_good', bad: 'enc_bad' });
      mockSecureLsGetError = { key: 'bad', error: new Error('Malformed UTF-8 data') };

      expect(store.storeGet('bad')).toBeNull();
    });

    it('quarantined key returns null on subsequent reads without re-logging', () => {
      mockSecureLsStorage = { bad: 'encrypted' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ bad: 'enc_bad' });
      mockSecureLsGetError = { key: 'bad', error: new Error('Malformed UTF-8 data') };

      store.storeGet('bad');
      const firstCount = jest.mocked(console.error).mock.calls.length;

      store.storeGet('bad');
      const secondCount = jest.mocked(console.error).mock.calls.length;

      expect(secondCount).toBe(firstCount);
    });

    it('does not affect other keys when one is quarantined', () => {
      mockSecureLsStorage = { good: 'goodValue', bad: 'encrypted' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ good: 'enc_good', bad: 'enc_bad' });
      mockSecureLsGetError = { key: 'bad', error: new Error('Malformed UTF-8 data') };

      store.storeGet('bad');
      mockSecureLsGetError = null;
      expect(store.storeGet('good')).toBe('goodValue');
    });

    it('removes corrupted key from raw file storage', () => {
      mockSecureLsStorage = { good: 'value', corrupt: 'encrypted' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ good: 'enc_good', corrupt: 'enc_corrupt' });
      mockSecureLsGetError = { key: 'corrupt', error: new Error('Malformed UTF-8 data') };

      store.storeGet('corrupt');

      const finalContent = JSON.parse(mockFileSystem[STORE_FILE] || '{}');
      expect(finalContent).not.toHaveProperty('corrupt');
      expect(finalContent).toHaveProperty('good');
    });

    it('storeSet clears quarantine for a key', () => {
      mockSecureLsStorage = { bad: 'encrypted' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ bad: 'enc_bad' });
      mockSecureLsGetError = { key: 'bad', error: new Error('Malformed UTF-8 data') };

      store.storeGet('bad');
      expect(store.storeGet('bad')).toBeNull();

      mockSecureLsGetError = null;
      store.storeSet('bad', 'newValue');
      expect(store.storeGet('bad')).toBe('newValue');
    });

    it('storeGetAll skips quarantined keys', () => {
      mockSecureLsStorage = { good: 'goodVal', bad: 'encrypted' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ good: 'enc_good', bad: 'enc_bad' });
      mockSecureLsGetError = { key: 'bad', error: new Error('Malformed UTF-8 data') };

      store.storeGet('bad');
      mockSecureLsGetError = null;

      const all = store.storeGetAll();
      expect(all).toHaveProperty('good', 'goodVal');
      expect(all).not.toHaveProperty('bad');
    });
  });

  describe('Nuclear Reset', () => {
    it('triggers after 3 consecutive init failures and logs NUCLEAR RESET', () => {
      global.__mockSecureLsCtorError = new Error('Simulated init failure');
      mockFileSystem[STORE_FILE] = '{"data": "corrupt"}';
      mockFileSystem[SNAPSHOT_FILE] = '{"old": "backup"}';

      const freshStore = loadFreshModule();
      freshStore.storeGet('a');
      freshStore.storeGet('b');
      freshStore.storeGet('c');

      const fatalLogs = jest
        .mocked(console.error)
        .mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('NUCLEAR RESET'));
      expect(fatalLogs.length).toBeGreaterThan(0);
    });

    it('preserves corrupt files with .corrupt suffix for forensics', () => {
      global.__mockSecureLsCtorError = new Error('Persistent corruption');
      mockFileSystem[STORE_FILE] = '{"broken": true}';
      mockFileSystem[SNAPSHOT_FILE] = '{"old_backup": true}';

      const freshStore = loadFreshModule();
      freshStore.storeGet('x');
      freshStore.storeGet('y');
      freshStore.storeGet('z');

      const corruptFiles = Object.keys(mockFileSystem).filter((k) => k.includes('.corrupt.'));
      expect(corruptFiles.length).toBeGreaterThan(0);
    });

    it('after nuclear reset with persistent error, store returns null permanently', () => {
      global.__mockSecureLsCtorError = new Error('Init failure');

      const freshStore = loadFreshModule();
      freshStore.storeGet('a');
      freshStore.storeGet('b');
      freshStore.storeGet('c');

      expect(freshStore.storeGet('anyKey')).toBeNull();
    });

    it('after nuclear reset with cleared error, store recovers', () => {
      global.__mockSecureLsCtorError = new Error('Init failure');

      const freshStore = loadFreshModule();
      freshStore.storeGet('a');
      freshStore.storeGet('b');

      global.__mockSecureLsCtorError = null;
      freshStore.storeGet('c');

      freshStore.storeSet('newKey', 'newValue');
      expect(freshStore.storeGet('newKey')).toBe('newValue');
    });
  });

  describe('Encryption Key Stability (Key Pinning)', () => {
    it('creates store.key-id file on first initialization', () => {
      store.storeGet('trigger-init');

      const keyIdEntries = Object.entries(mockFileSystem).filter(([k]) =>
        k.endsWith('store.key-id')
      );
      expect(keyIdEntries.length).toBe(1);
      expect(keyIdEntries[0][1]).toMatch(/^[a-f0-9]{16}$/);
    });

    it('uses pinned fingerprint to find matching key on subsequent runs', () => {
      store.storeGet('init');
      const keyIdEntries = Object.entries(mockFileSystem).filter(([k]) =>
        k.endsWith('store.key-id')
      );
      const pinnedFingerprint = keyIdEntries[0][1];

      const freshStore = loadFreshModule();
      freshStore.storeGet('second-init');

      const keyIdEntries2 = Object.entries(mockFileSystem).filter(([k]) =>
        k.endsWith('store.key-id')
      );
      expect(keyIdEntries2[0][1]).toBe(pinnedFingerprint);
    });

    it('logs warning when pinned fingerprint does not match any candidate', () => {
      mockFileSystem[KEY_ID_FILE] = 'deadbeef12345678';

      const freshStore = loadFreshModule();
      freshStore.storeGet('mismatch');

      const mismatchLogs = jest
        .mocked(console.error)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('fingerprint mismatch')
        );
      expect(mismatchLogs.length).toBeGreaterThan(0);
    });

    it('sorts interface names for deterministic key derivation', () => {
      store.storeGet('init1');
      const keyIdEntries1 = Object.entries(mockFileSystem).filter(([k]) =>
        k.endsWith('store.key-id')
      );
      const fingerprint1 = keyIdEntries1[0][1];

      for (const k of Object.keys(mockFileSystem)) {
        if (k.endsWith('store.key-id')) delete mockFileSystem[k];
      }

      const store2 = loadFreshModule();
      store2.storeGet('init2');
      const keyIdEntries2 = Object.entries(mockFileSystem).filter(([k]) =>
        k.endsWith('store.key-id')
      );
      const fingerprint2 = keyIdEntries2[0][1];

      expect(fingerprint1).toBe(fingerprint2);
    });
  });

  describe('Structured Logging', () => {
    it('logs with timestamp, level, key, error_type, and action for decryption errors', () => {
      mockSecureLsStorage = { corrupt: 'data' };
      mockFileSystem[STORE_FILE] = JSON.stringify({ corrupt: 'enc_data' });
      mockSecureLsGetError = { key: 'corrupt', error: new Error('Malformed UTF-8 data') };

      store.storeGet('corrupt');

      const structuredLogs = jest
        .mocked(console.error)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('[secure-store]') &&
            msg.includes('key="corrupt"')
        );

      expect(structuredLogs.length).toBeGreaterThan(0);
      const logLine = structuredLogs[0][0];
      expect(logLine).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
      expect(logLine).toMatch(/\[ERROR\]/);
      expect(logLine).toContain('key="corrupt"');
      expect(logLine).toContain('error_type="DECRYPTION_UTF8_FAILURE"');
      expect(logLine).toContain('action="QUARANTINED_KEY"');
    });

    it('classifies non-decryption errors with READ_FAILED action', () => {
      const ioError = new Error('EACCES: permission denied');
      ioError.code = 'EACCES';
      mockSecureLsGetError = { key: 'test', error: ioError };
      mockSecureLsStorage = { test: 'val' };

      store.storeGet('test');

      const readFailLogs = jest
        .mocked(console.error)
        .mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('READ_FAILED'));
      expect(readFailLogs.length).toBeGreaterThan(0);
    });

    it('includes file_size in structured log output', () => {
      mockSecureLsStorage = { test: 'val' };
      const storeContent = JSON.stringify({ test: 'enc_data' });
      mockFileSystem[STORE_FILE] = storeContent;
      mockSecureLsGetError = { key: 'test', error: new Error('Connection timeout') };

      store.storeGet('test');

      const logs = jest
        .mocked(console.error)
        .mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('file_size='));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0][0]).toContain(`file_size=${storeContent.length} bytes`);
    });
  });
});
