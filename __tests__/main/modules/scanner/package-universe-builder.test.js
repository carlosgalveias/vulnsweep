'use strict';

const {
  buildPackageUniverse,
  getUniqueQueryTargets,
} = require('../../../../src/main/modules/scanner/package-universe-builder');
const fixturePackageLock = require('../../../fixtures/package-lock.json');

// Jest hoists jest.mock() factories; variables accessed inside must be prefixed 'mock'
const mockFsState = {
  lockfileContent: null,
  pkgJsonContent: null,
  lockfileError: null,
  pkgJsonError: null,
};

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn((filePath) => {
        if (filePath.endsWith('package-lock.json')) {
          if (mockFsState.lockfileError) return Promise.reject(mockFsState.lockfileError);
          if (mockFsState.lockfileContent !== null)
            return Promise.resolve(mockFsState.lockfileContent);
          return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
        }
        if (filePath.endsWith('package.json')) {
          if (mockFsState.pkgJsonError) return Promise.reject(mockFsState.pkgJsonError);
          if (mockFsState.pkgJsonContent !== null)
            return Promise.resolve(mockFsState.pkgJsonContent);
          return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
        }
        return Promise.reject(new Error(`Unexpected readFile: ${filePath}`));
      }),
    },
  };
});

function setLockfile(c) {
  mockFsState.lockfileContent = typeof c === 'string' ? c : JSON.stringify(c);
  mockFsState.lockfileError = null;
}
function setLockfileError(e) {
  mockFsState.lockfileContent = null;
  mockFsState.lockfileError = e;
}
function _setPkgJson(c) {
  mockFsState.pkgJsonContent = typeof c === 'string' ? c : JSON.stringify(c);
  mockFsState.pkgJsonError = null;
}
function setPkgJsonError(e) {
  mockFsState.pkgJsonContent = null;
  mockFsState.pkgJsonError = e;
}
function clearAll() {
  mockFsState.lockfileContent = null;
  mockFsState.pkgJsonContent = null;
  mockFsState.lockfileError = null;
  mockFsState.pkgJsonError = null;
}

const PROJECT = '/fake/project';

function makeScopedLockfileV2() {
  const pkgs = {};
  pkgs[''] = { dependencies: {} };
  pkgs['']['dependencies']['@babel/core'] = '^7.0.0';
  pkgs['node_modules/@babel/core'] = { version: '7.21.0', resolved: 'https://r.npmjs.org/a' };
  return { lockfileVersion: 2, packages: pkgs };
}

function makeDevLockfileV2() {
  const pkgs = {};
  pkgs[''] = { devDependencies: { eslint: '^8.0.0' } };
  pkgs['node_modules/eslint'] = { version: '8.1.0', resolved: 'https://r.npmjs.org/e', dev: true };
  return { lockfileVersion: 2, packages: pkgs };
}

describe('package-universe-builder', () => {
  beforeEach(() => clearAll());

  describe('buildPackageUniverse() v2 fixture', () => {
    beforeEach(() => setLockfile(fixturePackageLock));

    it('returns non-empty array', async () => {
      expect((await buildPackageUniverse(PROJECT)).length).toBeGreaterThan(0);
    });

    it('lodash version 4.17.15', async () => {
      const u = await buildPackageUniverse(PROJECT);
      expect(u.find((p) => p.name === 'lodash').version).toBe('4.17.15');
    });

    it('lodash isDirect=true', async () => {
      const u = await buildPackageUniverse(PROJECT);
      expect(u.find((p) => p.name === 'lodash').isDirect).toBe(true);
    });

    it('ajv isDirect=false (transitive)', async () => {
      const u = await buildPackageUniverse(PROJECT);
      expect(u.find((p) => p.name === 'ajv').isDirect).toBe(false);
    });

    it('lodash isDevDep=false', async () => {
      const u = await buildPackageUniverse(PROJECT);
      expect(u.find((p) => p.name === 'lodash').isDevDep).toBe(false);
    });

    it('depth-1 lockfileDepth=1', async () => {
      const u = await buildPackageUniverse(PROJECT);
      expect(u.find((p) => p.name === 'lodash').lockfileDepth).toBe(1);
    });

    it('all packages have required fields', async () => {
      for (const p of await buildPackageUniverse(PROJECT)) {
        expect(typeof p.name).toBe('string');
        expect(typeof p.version).toBe('string');
        expect(typeof p.isDirect).toBe('boolean');
        expect(typeof p.isDevDep).toBe('boolean');
        expect(typeof p.lockfileDepth).toBe('number');
        expect(typeof p.lockfilePath).toBe('string');
      }
    });

    it('skips root entry', async () => {
      expect((await buildPackageUniverse(PROJECT)).every((p) => p.name !== '')).toBe(true);
    });

    it('lodash appears once (packages map wins)', async () => {
      expect((await buildPackageUniverse(PROJECT)).filter((p) => p.name === 'lodash')).toHaveLength(
        1
      );
    });

    it('marks nested package isDirect=false even when its name matches a direct dep', async () => {
      // v2 lockfile: 'lodash' is a direct dep at depth 1 AND also nested inside 'some-lib'
      // at depth 2 (node_modules/some-lib/node_modules/lodash).
      // Only the depth-1 entry should have isDirect=true; the depth-2 entry must be false.
      const lockfileContent = {
        lockfileVersion: 2,
        packages: {
          '': {
            dependencies: { lodash: '^4.17.21', 'some-lib': '^1.0.0' },
          },
          'node_modules/lodash': {
            version: '4.17.21',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          },
          'node_modules/some-lib': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/some-lib/-/some-lib-1.0.0.tgz',
          },
          // Same package name 'lodash' but nested at depth 2 — must NOT inherit isDirect
          'node_modules/some-lib/node_modules/lodash': {
            version: '4.16.0',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.16.0.tgz',
          },
        },
      };
      setLockfile(lockfileContent);

      const universe = await buildPackageUniverse(PROJECT);

      // Depth-1 entry is a direct dep
      const directLodash = universe.find((p) => p.name === 'lodash' && p.lockfileDepth === 1);
      expect(directLodash).toBeDefined();
      expect(directLodash.isDirect).toBe(true);

      // Depth-2 nested entry shares the name but must NOT be isDirect
      const nestedLodash = universe.find((p) => p.name === 'lodash' && p.lockfileDepth === 2);
      expect(nestedLodash).toBeDefined();
      expect(nestedLodash.isDirect).toBe(false);
    });
  });

  describe('buildPackageUniverse() scoped packages', () => {
    it('extracts @babel/core name correctly', async () => {
      setLockfile(makeScopedLockfileV2());
      const babel = (await buildPackageUniverse(PROJECT)).find((p) => p.name === '@babel/core');
      expect(babel).toBeDefined();
      expect(babel.version).toBe('7.21.0');
    });

    it('scoped direct dep isDirect=true', async () => {
      setLockfile(makeScopedLockfileV2());
      const babel = (await buildPackageUniverse(PROJECT)).find((p) => p.name === '@babel/core');
      expect(babel.isDirect).toBe(true);
    });
  });

  describe('buildPackageUniverse() dev dep detection', () => {
    it('marks dev:true entry as isDevDep=true', async () => {
      setLockfile(makeDevLockfileV2());
      const eslint = (await buildPackageUniverse(PROJECT)).find((p) => p.name === 'eslint');
      expect(eslint.isDevDep).toBe(true);
    });
  });

  describe('buildPackageUniverse() empty packages map', () => {
    it('returns [] when packages map has only root entry', async () => {
      const lf = { lockfileVersion: 2, packages: {} };
      lf.packages[''] = {};
      setLockfile(lf);
      expect(await buildPackageUniverse(PROJECT)).toEqual([]);
    });
  });

  describe('buildPackageUniverse() error handling', () => {
    it('throws when package-lock.json is missing (ENOENT)', async () => {
      setLockfileError(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      await expect(buildPackageUniverse(PROJECT)).rejects.toThrow('package-lock.json not found');
    });

    it('throws on malformed lockfile JSON', async () => {
      const badJson = '{not valid json:::';
      setLockfile(badJson);
      await expect(buildPackageUniverse(PROJECT)).rejects.toThrow(/invalid JSON/i);
    });

    it('throws on malformed package.json (not ENOENT)', async () => {
      setLockfile({ lockfileVersion: 1, dependencies: { lodash: { version: '4.0.0' } } });
      const badPkgErr = new Error('invalid JSON: x');
      setPkgJsonError(badPkgErr);
      await expect(buildPackageUniverse(PROJECT)).rejects.toThrow(/invalid JSON/i);
    });

    it('falls through gracefully when package.json is missing (ENOENT)', async () => {
      setLockfile({ lockfileVersion: 1, dependencies: { lodash: { version: '4.0.0' } } });
      setPkgJsonError(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const u = await buildPackageUniverse(PROJECT);
      expect(u).toHaveLength(1);
      expect(u[0].isDirect).toBe(false);
    });
  });

  describe('getUniqueQueryTargets()', () => {
    it('deduplicates same name+version appearing multiple times', () => {
      const universe = [
        { name: 'lodash', version: '4.17.15' },
        { name: 'lodash', version: '4.17.15' },
        { name: 'express', version: '4.17.1' },
      ];
      const targets = getUniqueQueryTargets(universe);
      expect(targets).toHaveLength(2);
      expect(targets.map((t) => t.name)).toContain('lodash');
      expect(targets.map((t) => t.name)).toContain('express');
    });

    it('keeps different versions of the same package as separate targets', () => {
      const universe = [
        { name: 'lodash', version: '4.17.15' },
        { name: 'lodash', version: '3.10.1' },
      ];
      expect(getUniqueQueryTargets(universe)).toHaveLength(2);
    });

    it('returns [] for empty universe', () => {
      expect(getUniqueQueryTargets([])).toEqual([]);
    });

    it('each target has only name and version', () => {
      const universe = [{ name: 'x', version: '1.0.0', isDirect: true, extra: 'foo' }];
      const targets = getUniqueQueryTargets(universe);
      expect(targets[0]).toEqual({ name: 'x', version: '1.0.0' });
    });
  });
});
