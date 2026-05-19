'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({ app: { getPath: () => require('os').tmpdir() } }), {
  virtual: true,
});

const CONSTANTS_PATH = path.resolve(__dirname, '../../../../src/main/config/constants');
const SCAN_CACHE_PATH = path.resolve(__dirname, '../../../../src/main/modules/scanner/scan-cache');

const TWO_H = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

function makeTmpDir() {
  const dir = path.join(
    os.tmpdir(),
    `sc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function freshCache() {
  jest.resetModules();
  jest.mock('electron', () => ({ app: { getPath: () => require('os').tmpdir() } }), {
    virtual: true,
  });
  return require(SCAN_CACHE_PATH);
}

function getConfig() {
  return require(CONSTANTS_PATH).SCAN_CACHE_CONFIG;
}

afterEach(() => {
  // Cancel any pending debounce timers so Jest can exit cleanly
  try {
    const cache = require(SCAN_CACHE_PATH);
    cache.flushAndClose();
  } catch {
    /* ignore if module not loaded */
  }
});

// ============================================================================
describe('scan-cache buildKey()', () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  test('plain package produces name@version', () => {
    expect(cache.buildKey('express', '4.18.2')).toBe('express@4.18.2');
  });

  test('scoped @babel/core is percent-encoded', () => {
    expect(cache.buildKey('@babel/core', '7.0.0')).toBe('%40babel%2Fcore@7.0.0');
  });

  test('scoped @types/node is percent-encoded', () => {
    expect(cache.buildKey('@types/node', '20.0.0')).toBe('%40types%2Fnode@20.0.0');
  });
});

// ============================================================================
describe('scan-cache load() with no files', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('all Maps empty, no error thrown', () => {
    expect(() => cache.load(tmpDir)).not.toThrow();
    const cfg = getConfig();
    for (const sourceId of cfg.CACHEABLE_SOURCES) {
      expect(cache.getSize(sourceId)).toBe(0);
    }
  });
});

// ============================================================================
describe('scan-cache load() with one valid file', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('osv Map populated; others remain empty', () => {
    const entries = { 'express@4.18.2': { timestamp: Date.now(), results: [{ id: 'VULN-1' }] } };
    fs.writeFileSync(path.join(tmpDir, 'osv-cache.json'), JSON.stringify({ version: 1, entries }));
    cache.load(tmpDir);
    expect(cache.getSize('osv')).toBe(1);
    expect(cache.getSize('nvd')).toBe(0);
    expect(cache.getSize('github-advisory')).toBe(0);
    expect(cache.getSize('cisa-kev')).toBe(0);
  });
});

// ============================================================================
describe('scan-cache load() with corrupt JSON', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('corrupt osv does not affect nvd', () => {
    const nvdEntries = { 'lodash@4.17.21': { timestamp: Date.now(), results: [] } };
    fs.writeFileSync(
      path.join(tmpDir, 'nvd-cache.json'),
      JSON.stringify({ version: 1, entries: nvdEntries })
    );
    fs.writeFileSync(path.join(tmpDir, 'osv-cache.json'), 'NOT_JSON!!!');
    expect(() => cache.load(tmpDir)).not.toThrow();
    expect(cache.getSize('osv')).toBe(0);
    expect(cache.getSize('nvd')).toBe(1);
  });

  test('corrupt file is deleted after load', () => {
    const osvFile = path.join(tmpDir, 'osv-cache.json');
    fs.writeFileSync(osvFile, '{bad json');
    cache.load(tmpDir);
    expect(fs.existsSync(osvFile)).toBe(false);
  });
});

// ============================================================================
// ============================================================================
describe('scan-cache isValid() TTL', () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  test('returns false for expired entry over 24h old for osv', () => {
    const key = cache.buildKey('express', '4.18.2');
    cache._caches['osv'].set(key, { timestamp: Date.now() - TWENTY_FOUR_H - 1000, results: [] });
    expect(cache.isValid('osv', key)).toBe(false);
  });

  test('returns true for fresh entry within 24h TTL for osv', () => {
    const key = cache.buildKey('express', '4.18.2');
    cache._caches['osv'].set(key, { timestamp: Date.now() - 60000, results: [] });
    expect(cache.isValid('osv', key)).toBe(true);
  });

  test('cisa-kev entry just over 2h old is invalid', () => {
    const key = cache.buildKey('log4j', '2.14.1');
    cache._caches['cisa-kev'].set(key, { timestamp: Date.now() - TWO_H - 1000, results: [] });
    expect(cache.isValid('cisa-kev', key)).toBe(false);
  });

  test('cisa-kev entry under 2h old is valid', () => {
    const key = cache.buildKey('log4j', '2.14.1');
    cache._caches['cisa-kev'].set(key, { timestamp: Date.now() - 3000, results: [] });
    expect(cache.isValid('cisa-kev', key)).toBe(true);
  });

  test('config TTL_BY_SOURCE osv is 24h', () => {
    expect(getConfig().TTL_BY_SOURCE['osv']).toBe(TWENTY_FOUR_H);
  });

  test('config TTL_BY_SOURCE cisa-kev is 2h not 24h', () => {
    expect(getConfig().TTL_BY_SOURCE['cisa-kev']).toBe(TWO_H);
  });
});

// ============================================================================
describe('scan-cache set() dirty flag isolation', () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  test('setting osv only marks osv dirty', () => {
    cache.set('osv', 'express@4.18.2', []);
    expect(cache._dirty['osv']).toBe(true);
    expect(cache._dirty['nvd']).toBe(false);
    expect(cache._dirty['github-advisory']).toBe(false);
    expect(cache._dirty['cisa-kev']).toBe(false);
  });

  test('setting nvd only marks nvd dirty', () => {
    cache.set('nvd', 'lodash@4.17.21', []);
    expect(cache._dirty['nvd']).toBe(true);
    expect(cache._dirty['osv']).toBe(false);
  });
});

// ============================================================================
describe('scan-cache save() only writes dirty sources', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('only dirty source file is written', () => {
    cache.set('osv', 'express@4.18.2', [{ id: 'OSV-1' }]);
    cache.save(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'osv-cache.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'nvd-cache.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'cisa-kev-cache.json'))).toBe(false);
  });
});

// ============================================================================
describe('scan-cache getSize()', () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  test('returns 0 for empty source', () => {
    expect(cache.getSize('osv')).toBe(0);
  });

  test('returns correct count after set()', () => {
    cache.set('osv', cache.buildKey('express', '4.18.2'), []);
    cache.set('osv', cache.buildKey('lodash', '4.17.21'), []);
    expect(cache.getSize('osv')).toBe(2);
  });

  test('returns 0 for unknown sourceId', () => {
    expect(cache.getSize('unknown-source')).toBe(0);
  });
});

// ============================================================================
describe('scan-cache flushAndClose()', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('cancels pending timers and saves dirty sources', () => {
    cache.set('osv', cache.buildKey('express', '4.18.2'), []);
    expect(cache._saveTimers['osv']).not.toBeNull();
    cache.flushAndClose();
    expect(cache._saveTimers['osv']).toBeNull();
  });
});

// ============================================================================
describe('scan-cache load() path injection via cacheDir param', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('load(customDir) reads from the specified directory', () => {
    const entries = { 'chalk@5.0.0': { timestamp: Date.now(), results: [] } };
    fs.writeFileSync(
      path.join(tmpDir, 'github-advisory-cache.json'),
      JSON.stringify({ version: 1, entries })
    );
    cache.load(tmpDir);
    expect(cache.getSize('github-advisory')).toBe(1);
    expect(cache.getSize('osv')).toBe(0);
  });
});

// ============================================================================
describe('scan-cache get() / set() round-trip', () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  test('get returns stored results after set', () => {
    const results = [{ id: 'OSV-2023-001', severity: 'high' }];
    cache.set('osv', cache.buildKey('express', '4.18.2'), results);
    expect(cache.get('osv', cache.buildKey('express', '4.18.2'))).toEqual(results);
  });

  test('get returns undefined for unknown key', () => {
    expect(cache.get('osv', 'nonexistent@1.0.0')).toBeUndefined();
  });
});

// ============================================================================
describe('scan-cache clearAll()', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('clears all source caches and marks all dirty', () => {
    cache.load(tmpDir);

    cache.set('osv', cache.buildKey('lodash', '4.17.21'), [{ sourceId: 'osv' }]);
    cache.set('nvd', cache.buildKey('express', '4.18.0'), [{ sourceId: 'nvd' }]);

    expect(cache.getSize('osv')).toBe(1);
    expect(cache.getSize('nvd')).toBe(1);

    cache.clearAll(tmpDir);

    expect(cache.getSize('osv')).toBe(0);
    expect(cache.getSize('nvd')).toBe(0);
    expect(cache.getSize('github-advisory')).toBe(0);
    expect(cache.getSize('cisa-kev')).toBe(0);
  });

  test('clearAll writes empty cache files to disk', () => {
    cache.load(tmpDir);
    cache.set('osv', cache.buildKey('lodash', '4.17.21'), []);

    cache.clearAll(tmpDir);

    const osvFile = require('path').join(tmpDir, 'osv-cache.json');
    expect(require('fs').existsSync(osvFile)).toBe(true);
    const parsed = JSON.parse(require('fs').readFileSync(osvFile, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.entries)).toHaveLength(0);
  });
});

// ============================================================================
describe('scan-cache getStats()', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('returns entry counts per source and total', () => {
    cache.load(tmpDir);

    cache.set('osv', cache.buildKey('lodash', '4.17.21'), []);
    cache.set('osv', cache.buildKey('express', '4.18.0'), []);
    cache.set('nvd', cache.buildKey('lodash', '4.17.21'), []);

    const stats = cache.getStats();

    expect(stats.osv.count).toBe(2);
    expect(stats.nvd.count).toBe(1);
    expect(stats['github-advisory'].count).toBe(0);
    expect(stats['cisa-kev'].count).toBe(0);
  });

  test('returns zero counts for all sources when cache is empty', () => {
    const stats = cache.getStats();
    const cfg = getConfig();
    for (const sourceId of cfg.CACHEABLE_SOURCES) {
      expect(stats[sourceId].count).toBe(0);
    }
  });
});

// ============================================================================
describe('scan-cache clear(sourceId)', () => {
  let cache, tmpDir;
  beforeEach(() => {
    cache = freshCache();
    tmpDir = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmpDir));

  test('clears only the specified source cache', () => {
    cache.load(tmpDir);

    cache.set('osv', cache.buildKey('lodash', '4.17.21'), []);
    cache.set('osv', cache.buildKey('express', '4.18.0'), []);
    cache.set('nvd', cache.buildKey('lodash', '4.17.21'), []);

    expect(cache.getSize('osv')).toBe(2);
    expect(cache.getSize('nvd')).toBe(1);

    cache.clear('osv');

    expect(cache.getSize('osv')).toBe(0);
    expect(cache.getSize('nvd')).toBe(1);
  });

  test('marks only the cleared source dirty', () => {
    cache.load(tmpDir);
    cache.set('osv', cache.buildKey('express', '4.18.0'), []);
    cache.set('nvd', cache.buildKey('lodash', '4.17.21'), []);

    // Flush dirty state so we start from a clean baseline
    cache.save(tmpDir);
    // After save, both are clean — but set() marks them dirty; re-load to reset
    const cache2 = freshCache();
    cache2.load(tmpDir);

    // Now manually inject entries and check clear() isolation
    cache2._caches['osv'].set('test@1.0.0', { timestamp: Date.now(), results: [] });
    cache2._dirty['osv'] = false;
    cache2._dirty['nvd'] = false;

    cache2.clear('osv');

    expect(cache2._dirty['osv']).toBe(true);
    expect(cache2._dirty['nvd']).toBe(false);
  });

  test('clear() on unknown sourceId does not throw', () => {
    expect(() => cache.clear('nonexistent-source')).not.toThrow();
  });
});
