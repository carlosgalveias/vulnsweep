'use strict';

const {
  buildPackageUniverse,
  parseOverridesMap,
} = require('../../../../src/main/modules/scanner/package-universe-builder');

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
function clearAll() {
  mockFsState.lockfileContent = null;
  mockFsState.pkgJsonContent = null;
  mockFsState.lockfileError = null;
  mockFsState.pkgJsonError = null;
}

const PROJECT = '/test/project';

describe('parseOverridesMap', () => {
  it('parses npm: protocol override with scoped package and version', () => {
    const result = parseOverridesMap({
      request: 'npm:@cypress/request@3.0.0',
    });
    expect(result).toEqual({
      request: { resolvedName: '@cypress/request', resolvedVersion: '3.0.0' },
    });
  });

  it('parses npm: protocol override without version', () => {
    const result = parseOverridesMap({
      'node-gyp': 'npm:@mapbox/node-gyp',
    });
    expect(result).toEqual({
      'node-gyp': { resolvedName: '@mapbox/node-gyp', resolvedVersion: null },
    });
  });

  it('parses npm: protocol override with unscoped package', () => {
    const result = parseOverridesMap({
      'base-encryption': 'npm:common-encryption@^3.1.1',
    });
    expect(result).toEqual({
      'base-encryption': { resolvedName: 'common-encryption', resolvedVersion: '^3.1.1' },
    });
  });

  it('ignores simple version pin overrides (no name change)', () => {
    const result = parseOverridesMap({
      cookiejar: '2.1.4',
    });
    expect(result).toEqual({});
  });

  it('ignores nested object overrides', () => {
    const result = parseOverridesMap({
      foo: { bar: '1.0.0' },
    });
    expect(result).toEqual({});
  });

  it('returns empty object for null/undefined input', () => {
    expect(parseOverridesMap(null)).toEqual({});
    expect(parseOverridesMap(undefined)).toEqual({});
  });

  it('handles mixed overrides correctly', () => {
    const result = parseOverridesMap({
      request: 'npm:@cypress/request@3.0.0',
      cookiejar: '2.1.4',
      'node-gyp': 'npm:@mapbox/node-gyp',
      nested: { thing: '1.0.0' },
    });
    expect(result).toEqual({
      request: { resolvedName: '@cypress/request', resolvedVersion: '3.0.0' },
      'node-gyp': { resolvedName: '@mapbox/node-gyp', resolvedVersion: null },
    });
  });
});

describe('buildPackageUniverse with overrides', () => {
  beforeEach(() => clearAll());

  it('remaps npm: protocol override to real package name (v3 lockfile)', async () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0',
          dependencies: { 'babel-traverse': 'npm:@babel/traverse@^7.23.2' },
          overrides: { 'babel-traverse': 'npm:@babel/traverse@^7.23.2' },
        },
        'node_modules/babel-traverse': {
          name: '@babel/traverse',
          version: '7.29.7',
          resolved: 'https://registry.npmjs.org/@babel/traverse/-/traverse-7.29.7.tgz',
        },
      },
    };
    setLockfile(lockfile);

    const universe = await buildPackageUniverse(PROJECT);
    const pkg = universe.find((p) => p.lockfilePath === 'node_modules/babel-traverse');

    expect(pkg).toBeDefined();
    expect(pkg.name).toBe('@babel/traverse');
    expect(pkg.originalName).toBe('babel-traverse');
    expect(pkg.version).toBe('7.29.7');
    expect(pkg.isDirect).toBe(true);
  });

  it('uses overridesMap as fallback when entry.name is missing', async () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0',
          dependencies: { request: '^2.88.0' },
          overrides: { request: 'npm:@cypress/request@3.0.0' },
        },
        'node_modules/request': {
          // No 'name' field - edge case
          version: '3.0.0',
          resolved: 'https://registry.npmjs.org/@cypress/request/-/request-3.0.0.tgz',
        },
      },
    };
    setLockfile(lockfile);

    const universe = await buildPackageUniverse(PROJECT);
    const pkg = universe.find((p) => p.lockfilePath === 'node_modules/request');

    expect(pkg).toBeDefined();
    expect(pkg.name).toBe('@cypress/request');
    expect(pkg.originalName).toBe('request');
  });

  it('does not remap simple version pin overrides', async () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0',
          dependencies: { cookiejar: '^2.0.0' },
          overrides: { cookiejar: '2.1.4' },
        },
        'node_modules/cookiejar': {
          version: '2.1.4',
          resolved: 'https://registry.npmjs.org/cookiejar/-/cookiejar-2.1.4.tgz',
        },
      },
    };
    setLockfile(lockfile);

    const universe = await buildPackageUniverse(PROJECT);
    const pkg = universe.find((p) => p.lockfilePath === 'node_modules/cookiejar');

    expect(pkg).toBeDefined();
    expect(pkg.name).toBe('cookiejar');
    expect(pkg.originalName).toBeUndefined();
  });

  it('marks override target as direct dependency', async () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0',
          dependencies: { request: 'npm:@cypress/request@3.0.0' },
          overrides: { request: 'npm:@cypress/request@3.0.0' },
        },
        'node_modules/request': {
          name: '@cypress/request',
          version: '3.0.0',
          resolved: 'https://registry.npmjs.org/@cypress/request/-/request-3.0.0.tgz',
        },
      },
    };
    setLockfile(lockfile);

    const universe = await buildPackageUniverse(PROJECT);
    const pkg = universe.find((p) => p.name === '@cypress/request');

    expect(pkg).toBeDefined();
    expect(pkg.isDirect).toBe(true);
  });

  it('handles v1 lockfile with overrides via package.json', async () => {
    const lockfile = {
      lockfileVersion: 1,
      dependencies: {
        request: {
          version: '3.0.0',
          resolved: 'https://registry.npmjs.org/@cypress/request/-/request-3.0.0.tgz',
        },
      },
    };
    setLockfile(lockfile);

    // For v1, package.json is read from disk
    mockFsState.pkgJsonContent = JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      dependencies: { request: 'npm:@cypress/request@3.0.0' },
      overrides: { request: 'npm:@cypress/request@3.0.0' },
    });

    const universe = await buildPackageUniverse(PROJECT);
    const pkg = universe.find((p) => p.lockfilePath === 'node_modules/request');

    expect(pkg).toBeDefined();
    expect(pkg.name).toBe('@cypress/request');
    expect(pkg.originalName).toBe('request');
    expect(pkg.isDirect).toBe(true);
  });
});
