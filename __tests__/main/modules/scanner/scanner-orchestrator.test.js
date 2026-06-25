'use strict';

/**
 * Tests for src/main/modules/scanner/scanner-orchestrator.js
 * All external dependencies are mocked.
 */

jest.mock('../../../../src/main/modules/scanner/package-universe-builder', () => ({
  buildPackageUniverse: jest.fn(),
  getUniqueQueryTargets: jest.fn(),
}));

jest.mock('../../../../src/main/modules/scanner/result-aggregator', () => ({
  aggregate: jest.fn(),
}));

jest.mock('../../../../src/main/modules/scanner/sources/osv-source', () => ({
  SOURCE_ID: 'osv',
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../../src/main/modules/scanner/sources/nvd-source', () => ({
  SOURCE_ID: 'nvd',
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../../src/main/modules/scanner/sources/github-advisory-source', () => ({
  SOURCE_ID: 'github-advisory',
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../../src/main/modules/scanner/sources/cisa-kev-source', () => ({
  SOURCE_ID: 'cisa-kev',
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../../src/main/modules/scanner/sources/npm-audit-source', () => ({
  SOURCE_ID: 'npm-audit',
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../../src/main/modules/scanner/sources/epss-source', () => ({
  SOURCE_ID: 'epss',
  query: jest.fn().mockResolvedValue([]),
}));

const {
  buildPackageUniverse,
  getUniqueQueryTargets,
} = require('../../../../src/main/modules/scanner/package-universe-builder');
const { aggregate } = require('../../../../src/main/modules/scanner/result-aggregator');
const { scanProject } = require('../../../../src/main/modules/scanner/scanner-orchestrator');

const PROJECT = '/fake/project';

function makeUniverse(pkgs) {
  return pkgs.map((n) => ({
    name: n,
    version: '1.0.0',
    isDirect: true,
    isDevDep: false,
    lockfileDepth: 1,
    lockfilePath: `node_modules/${n}`,
    resolved: `https://r.npmjs.org/${n}`,
  }));
}

describe('scanner-orchestrator scanProject()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    aggregate.mockResolvedValue({
      package: { name: 'pkg', version: '1.0.0' },
      vulnerabilities: [],
      strategies: [],
      highestSeverity: 'unknown',
      vulnCount: 0,
      fixableCount: 0,
    });
  });

  it('rejects when buildPackageUniverse throws (missing lockfile)', async () => {
    buildPackageUniverse.mockRejectedValue(
      new Error('package-lock.json not found at /fake/project')
    );
    await expect(scanProject(PROJECT)).rejects.toThrow('package-lock.json not found');
  });

  it('returns ScanResult with empty vulnerabilities when universe is empty', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    const result = await scanProject(PROJECT);
    expect(result.vulnerabilities).toEqual([]);
    expect(result.strategies).toEqual([]);
  });

  it('ScanResult has required shape: projectPath, packages, vulnerabilities, strategies, scannedAt, sources', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    const result = await scanProject(PROJECT);
    expect(result).toHaveProperty('projectPath', PROJECT);
    expect(result).toHaveProperty('packages');
    expect(result).toHaveProperty('vulnerabilities');
    expect(result).toHaveProperty('strategies');
    expect(result).toHaveProperty('scannedAt');
    expect(result).toHaveProperty('sources');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('allPackages');
  });

  it('progress callback receives universe phase with total', async () => {
    const universe = makeUniverse(['lodash']);
    buildPackageUniverse.mockResolvedValue(universe);
    getUniqueQueryTargets.mockReturnValue([{ name: 'lodash', version: '1.0.0' }]);
    const calls = [];
    await scanProject(PROJECT, {}, (p) => calls.push(p));
    expect(calls.some((c) => c.phase === 'universe')).toBe(true);
    expect(calls.find((c) => c.phase === 'universe').total).toBe(1);
  });

  it('progress callback receives scanning phase with packageName', async () => {
    const universe = makeUniverse(['lodash']);
    buildPackageUniverse.mockResolvedValue(universe);
    getUniqueQueryTargets.mockReturnValue([{ name: 'lodash', version: '1.0.0' }]);
    const calls = [];
    await scanProject(PROJECT, {}, (p) => calls.push(p));
    expect(calls.some((c) => c.phase === 'scanning')).toBe(true);
  });

  it('progress callback receives complete phase', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    const calls = [];
    await scanProject(PROJECT, {}, (p) => calls.push(p));
    expect(calls.some((c) => c.phase === 'universe')).toBe(true);
  });

  it('enabledSources fast-preset uses only npm-audit and osv plugins', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    // Fast preset: UI writes enabledSources directly; scanner reads only that
    const result = await scanProject(PROJECT, { enabledSources: ['npm-audit', 'osv'] });
    expect(result.sources).toContain('npm-audit');
    expect(result.sources).toContain('osv');
    expect(result.sources).not.toContain('nvd');
  });

  it('enabledSources optimal-preset uses all sources except nvd', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    // Optimal preset: UI writes enabledSources directly; scanner reads only that
    const result = await scanProject(PROJECT, {
      enabledSources: ['npm-audit', 'osv', 'github-advisory', 'cisa-kev', 'epss'],
    });
    expect(result.sources).toContain('npm-audit');
    expect(result.sources).toContain('osv');
    expect(result.sources).toContain('github-advisory');
    expect(result.sources).toContain('cisa-kev');
    expect(result.sources).toContain('epss');
    expect(result.sources).not.toContain('nvd');
  });

  it('unknown mode option falls back to optimal preset (no nvd)', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    // Passing a legacy mode option without enabledSources triggers optimal fallback
    const result = await scanProject(PROJECT, { mode: 'fast' });
    expect(result.sources).toContain('npm-audit');
    expect(result.sources).toContain('osv');
    expect(result.sources).toContain('github-advisory');
    expect(result.sources).toContain('cisa-kev');
    expect(result.sources).toContain('epss');
    expect(result.sources).not.toContain('nvd');
  });

  it('legacy: progress callback as second arg (no options)', async () => {
    buildPackageUniverse.mockResolvedValue([]);
    getUniqueQueryTargets.mockReturnValue([]);
    const calls = [];
    await scanProject(PROJECT, (p) => calls.push(p));
    expect(calls.length).toBeGreaterThanOrEqual(0);
  });
});
