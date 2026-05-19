'use strict';

/**
 * Tests for src/main/modules/scanner/result-aggregator.js
 * Uses synthetic SourceResult arrays — no HTTP mocks needed.
 * Uses jest.resetModules() + inline require pattern to allow jest.mock() interception.
 */

function makePkg(overrides) {
  return Object.assign(
    { name: 'lodash', version: '4.17.15', isDirect: true, isDevDep: false, lockfileDepth: 1 },
    overrides
  );
}

function makeSource(overrides) {
  return Object.assign(
    {
      sourceId: 'osv',
      packageName: 'lodash',
      packageVersion: '4.17.15',
      severity: 'high',
      cveIds: ['CVE-2021-23337'],
      aliases: ['GHSA-jf85-cpcp-j695'],
      title: 'Command Injection',
      description: null,
      fixedIn: '4.17.21',
      url: 'https://example.com',
      cvssScore: null,
      cvssVector: null,
      cisaKnownExploited: false,
      epssScore: null,
      epssPercentile: null,
      rawData: {},
    },
    overrides
  );
}

// Top-level jest.mock — hoisted by babel-jest so modules see the mock at load time.
jest.mock('../../../../src/main/modules/audit/strategies/fix-strategy', () => ({
  // Note: path resolves via result-aggregator.js require('../audit/strategies/fix-strategy')
  determineFixStrategy: jest.fn().mockResolvedValue({ type: 'upgrade', command: 'npm install' }),
  findParentPackage: jest.fn().mockReturnValue(null),
}));

jest.mock('../../../../src/main/modules/enrichment/severity-merger', () => ({
  mergeSeverity: jest.fn((npmSev, osvSev) => ({
    mergedSeverity: npmSev || osvSev || null,
    nvdCategory: null,
    severityDiscrepancy: false,
    discrepancyDetails: null,
  })),
}));

const {
  determineFixStrategy: determineFixStrategyMock,
} = require('../../../../src/main/modules/audit/strategies/fix-strategy');
const { aggregate } = require('../../../../src/main/modules/scanner/result-aggregator');
// Grab the mock reference so individual tests can override call-by-call behaviour.

describe('result-aggregator aggregate()', () => {
  const pkg = makePkg();

  it('returns empty vulnerabilities for empty allSourceResults', async () => {
    const result = await aggregate(pkg, []);
    expect(result.vulnerabilities).toEqual([]);
    expect(result.strategies).toEqual([]);
  });

  it('returns empty vulnerabilities for allSourceResults with empty arrays', async () => {
    const result = await aggregate(pkg, [[], []]);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('produces one UnifiedVulnerability from a single SourceResult', async () => {
    const result = await aggregate(pkg, [[makeSource()]]);
    expect(result.vulnerabilities).toHaveLength(1);
  });

  it('UnifiedVulnerability has renderer field names: package, installedVersion, patchedVersion', async () => {
    const result = await aggregate(pkg, [[makeSource()]]);
    const uv = result.vulnerabilities[0];
    expect(uv).toHaveProperty('package', 'lodash');
    expect(uv).toHaveProperty('installedVersion', '4.17.15');
    expect(uv).toHaveProperty('patchedVersion');
    expect(uv).not.toHaveProperty('packageName');
    expect(uv).not.toHaveProperty('packageVersion');
    expect(uv).not.toHaveProperty('fixedIn');
  });

  it('deduplicates two SourceResults with the same CVE ID into one UnifiedVulnerability', async () => {
    const s1 = makeSource({ sourceId: 'osv', cveIds: ['CVE-2021-23337'] });
    const s2 = makeSource({
      sourceId: 'npm-audit',
      cveIds: ['CVE-2021-23337'],
      rawData: { via: [] },
    });
    const result = await aggregate(pkg, [[s1], [s2]]);
    expect(result.vulnerabilities).toHaveLength(1);
  });

  it('merges SourceResults for the same package@version regardless of advisory IDs', async () => {
    // With the new package+version dedup key, two entries for the same lodash@4.17.15
    // are ALWAYS merged into one row; both GHSA aliases must appear in the merged row.
    const s1 = makeSource({ cveIds: [], aliases: ['GHSA-aaaa'] });
    const s2 = makeSource({ cveIds: [], aliases: ['GHSA-bbbb'] });
    const result = await aggregate(pkg, [[s1, s2]]);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].aliases).toContain('GHSA-aaaa');
    expect(result.vulnerabilities[0].aliases).toContain('GHSA-bbbb');
  });

  it('produces strategies array that is index-aligned with vulnerabilities', async () => {
    // Aggregate two DIFFERENT packages separately so each stays as its own row.
    const strategy1 = { type: 'upgrade', command: 'npm install lodash@4.17.21' };
    const strategy2 = { type: 'manual', command: null };

    determineFixStrategyMock
      .mockResolvedValueOnce(strategy1) // lodash scan
      .mockResolvedValueOnce(strategy2); // express scan

    const pkgA = makePkg({ name: 'lodash', version: '4.17.15' });
    const pkgB = makePkg({ name: 'express', version: '4.18.0' });
    const sA = makeSource({
      packageName: 'lodash',
      packageVersion: '4.17.15',
      cveIds: ['CVE-2021-23337'],
      aliases: [],
    });
    const sB = makeSource({
      packageName: 'express',
      packageVersion: '4.18.0',
      cveIds: ['CVE-2020-8203'],
      fixedIn: '4.18.1',
      aliases: [],
    });

    const [rA, rB] = await Promise.all([aggregate(pkgA, [[sA]]), aggregate(pkgB, [[sB]])]);

    // Each package scan: 1 vuln, 1 strategy slot, index-aligned
    expect(rA.strategies).toHaveLength(rA.vulnerabilities.length);
    expect(rB.strategies).toHaveLength(rB.vulnerabilities.length);
    expect(rA.strategies[0]).toBe(rA.vulnerabilities[0].strategy);
    expect(rB.strategies[0]).toBe(rB.vulnerabilities[0].strategy);
    expect(rA.strategies[0]).toEqual(strategy1);
    expect(rB.strategies[0]).toEqual(strategy2);
    expect(rA.strategies[0]).not.toBe(rB.strategies[0]);
  });

  it('patchedVersion is minimum semver when two sources give different fix versions', async () => {
    const s1 = makeSource({ sourceId: 'osv', cveIds: ['CVE-2021-23337'], fixedIn: '4.17.21' });
    const s2 = makeSource({
      sourceId: 'npm-audit',
      cveIds: ['CVE-2021-23337'],
      fixedIn: '4.17.20',
      rawData: {},
    });
    const result = await aggregate(pkg, [[s1], [s2]]);
    expect(result.vulnerabilities[0].patchedVersion).toBe('4.17.20');
  });

  it('cisaKnownExploited=true if any source has it set', async () => {
    const s1 = makeSource({ cveIds: ['CVE-2021-23337'], cisaKnownExploited: false });
    const s2 = makeSource({
      sourceId: 'cisa-kev',
      cveIds: ['CVE-2021-23337'],
      cisaKnownExploited: true,
    });
    const result = await aggregate(pkg, [[s1, s2]]);
    expect(result.vulnerabilities[0].cisaKnownExploited).toBe(true);
  });

  it('cisaKnownExploited=false when no source has it set', async () => {
    const result = await aggregate(pkg, [[makeSource({ cisaKnownExploited: false })]]);
    expect(result.vulnerabilities[0].cisaKnownExploited).toBe(false);
  });

  it('transitive CVE grouping: A/B/C scenario all in one group', async () => {
    const a = makeSource({ sourceId: 'osv', cveIds: ['CVE-2021-00001'], fixedIn: '2.0.0' });
    const b = makeSource({
      sourceId: 'npm-audit',
      cveIds: ['CVE-2021-00002'],
      fixedIn: '2.0.0',
      rawData: {},
    });
    const c = makeSource({
      sourceId: 'nvd',
      cveIds: ['CVE-2021-00001', 'CVE-2021-00002'],
      rawData: {},
    });
    const result = await aggregate(pkg, [[a, b, c]]);
    expect(result.vulnerabilities).toHaveLength(1);
  });

  it('PackageScanResult has required shape fields', async () => {
    const result = await aggregate(pkg, [[makeSource()]]);
    expect(result).toHaveProperty('package');
    expect(result).toHaveProperty('vulnerabilities');
    expect(result).toHaveProperty('strategies');
    expect(result).toHaveProperty('highestSeverity');
    expect(result).toHaveProperty('vulnCount');
    expect(result).toHaveProperty('fixableCount');
  });

  // -------------------------------------------------------------------------
  // Fix 1: NVD severity priority
  // -------------------------------------------------------------------------
  it('gives severity priority to NVD over other sources', async () => {
    // Use the real mergeSeverity implementation for this test only.
    // The module-level mock returns the first non-null arg, which would give 'moderate'
    // (npm wins). We temporarily replace it with the actual implementation so the
    // NVD CVSS score of 9.8 correctly maps to 'CRITICAL' and wins the merge.
    const { mergeSeverity: realMergeSeverity } = jest.requireActual(
      '../../../../src/main/modules/enrichment/severity-merger'
    );
    const {
      mergeSeverity: mergeSeverityMock,
    } = require('../../../../src/main/modules/enrichment/severity-merger');
    mergeSeverityMock.mockImplementationOnce(realMergeSeverity);

    // Arrange: npm-audit says 'moderate', OSV says 'high', NVD cvssScore=9.8 -> 'CRITICAL'
    const nvdResult = makeSource({
      sourceId: 'nvd',
      vulnId: 'CVE-2021-23337',
      severity: 'critical',
      cveIds: ['CVE-2021-23337'],
      aliases: [],
      fixedIn: '4.17.21',
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337',
      cvssScore: 9.8,
      cvssVector: null,
      rawData: {},
    });
    const osvResult = makeSource({
      sourceId: 'osv',
      vulnId: 'GHSA-p6mc-m468-83gw',
      severity: 'high',
      cveIds: ['CVE-2021-23337'],
      aliases: ['GHSA-p6mc-m468-83gw'],
      fixedIn: '4.17.21',
      url: 'https://osv.dev/...',
      cvssScore: null,
      rawData: {},
    });
    const npmResult = makeSource({
      sourceId: 'npm-audit',
      vulnId: 'CVE-2021-23337',
      severity: 'moderate',
      cveIds: ['CVE-2021-23337'],
      aliases: [],
      fixedIn: null,
      url: null,
      cvssScore: null,
      rawData: { strategy: null },
    });

    const testPkg = makePkg({ name: 'lodash', version: '4.17.20' });
    const result = await aggregate(testPkg, [[npmResult], [osvResult], [nvdResult]]);

    // The merged vulnerability should take NVD's 'CRITICAL' severity (lowercased to 'critical')
    expect(result.vulnerabilities[0].severity).toBe('critical');
    // CVSS data should come from NVD
    expect(result.vulnerabilities[0].cvssScore).toBe(9.8);
  });
});
