'use strict';
// Regression tests for result-aggregator.js deduplication (3-pass pipeline).
// deduplicateVulnerabilities() is NOT exported; tested indirectly via aggregate().

jest.mock('../../../src/main/modules/audit/strategies/fix-strategy', () => ({
  determineFixStrategy: jest.fn().mockResolvedValue({
    type: 'NO_FIX',
    package: 'unknown',
    currentVersion: '0.0.0',
    targetVersion: null,
    riskLevel: 'N/A',
    reason: 'mocked',
  }),
}));
jest.mock('../../../src/main/modules/enrichment/severity-merger', () => ({
  mergeSeverity: jest.fn((npmSev) => ({
    mergedSeverity: npmSev || 'UNKNOWN',
    nvdCategory: null,
    severityDiscrepancy: false,
    discrepancyDetails: null,
  })),
}));

const { determineFixStrategy } = require('../../../src/main/modules/audit/strategies/fix-strategy');
const { mergeSeverity } = require('../../../src/main/modules/enrichment/severity-merger');
const { aggregate } = require('../../../src/main/modules/scanner/result-aggregator');

function sr(o) {
  const sev = o.severity || 'high';
  const url = o.url || 'https://github.com/advisories/GHSA-abcd-1234-efgh';
  return {
    sourceId: o.sourceId || 'npm-audit',
    packageName: o.packageName || 'minimatch',
    packageVersion: o.packageVersion || '9.0.5',
    severity: sev,
    cveIds: o.cveIds || [],
    aliases: o.aliases || [],
    title: o.title || 'Test advisory',
    description: null,
    fixedIn: o.fixedIn || null,
    url,
    vulnerableRange: o.vulnerableRange || '<=9.0.4',
    cvssScore: o.cvssScore || null,
    cvssVector: null,
    cisaKnownExploited: false,
    epssScore: null,
    epssPercentile: null,
    rawData: o.rawData || {
      via: { title: o.title || 'Test advisory', url, severity: sev },
      resolvesDependents: [],
      isPromotedDependent: false,
    },
  };
}

function mkp(o) {
  o = o || {};
  return {
    name: o.name || 'minimatch',
    version: o.version || '9.0.5',
    isDirect: o.isDirect !== undefined ? o.isDirect : true,
    isDevDep: false,
    lockfileDepth: 1,
    projectPath: '/mock/project',
  };
}

describe('result-aggregator deduplication regression tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mergeSeverity.mockImplementation((npmSev) => ({
      mergedSeverity: npmSev || 'UNKNOWN',
      nvdCategory: null,
      severityDiscrepancy: false,
      discrepancyDetails: null,
    }));
    determineFixStrategy.mockResolvedValue({
      type: 'NO_FIX',
      package: 'minimatch',
      currentVersion: '9.0.5',
      targetVersion: null,
      riskLevel: 'N/A',
      reason: 'mocked',
    });
  });

  describe('Test 1: Same CVE from 3 sources collapses to 1 row', () => {
    it('3 SourceResults sharing same CVE produce exactly 1 UnifiedVulnerability', async () => {
      const cve = 'CVE-2023-28155';
      const results = [
        sr({ sourceId: 'osv', cveIds: [cve], aliases: ['GHSA-abcd-1234-efgh'] }),
        sr({ sourceId: 'github-advisory', cveIds: [cve], aliases: ['GHSA-abcd-1234-efgh'] }),
        sr({ sourceId: 'nvd', cveIds: [cve], aliases: [], cvssScore: 7.5 }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
      expect(result.vulnerabilities).toHaveLength(1);
      const v = result.vulnerabilities[0];
      expect(v.cveIds).toContain(cve);
      expect(v.sources).toContain('osv');
      expect(v.sources).toContain('github-advisory');
      expect(v.sources).toContain('nvd');
    });
    it('same CVE reported 3x by same source still produces 1 row', async () => {
      const cve = 'CVE-2023-99999';
      const results = [
        sr({ sourceId: 'osv', cveIds: [cve] }),
        sr({ sourceId: 'osv', cveIds: [cve] }),
        sr({ sourceId: 'osv', cveIds: [cve] }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
    });
  });

  describe('Test 2: Same GHSA via multiple npm-audit chains collapses to 1 row', () => {
    it('2 SourceResults sharing same GHSA alias produce 1 UnifiedVulnerability', async () => {
      const ghsa = 'GHSA-wxyz-5678-abcd';
      const ghsaUrl = 'https://github.com/advisories/GHSA-wxyz-5678-abcd';
      const results = [
        sr({ sourceId: 'npm-audit', cveIds: [], aliases: [ghsa], url: ghsaUrl }),
        sr({ sourceId: 'npm-audit', cveIds: [], aliases: [ghsa], url: ghsaUrl }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
      expect(result.vulnerabilities[0].aliases).toContain(ghsa);
    });
    it('npm-audit GHSA-only entry merges with github-advisory that has same GHSA + CVE', async () => {
      const ghsa = 'GHSA-abcd-9999-zzzz';
      const cve = 'CVE-2022-12345';
      const results = [
        sr({ sourceId: 'npm-audit', cveIds: [], aliases: [ghsa] }),
        sr({ sourceId: 'github-advisory', cveIds: [cve], aliases: [ghsa] }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
      const v = result.vulnerabilities[0];
      expect(v.sources).toContain('npm-audit');
      expect(v.sources).toContain('github-advisory');
      expect(v.cveIds).toContain(cve);
      expect(v.aliases).toContain(ghsa);
    });
  });

  describe('Test 3: No-ID entries for the same package@version are merged into the advisory-keyed entry', () => {
    it('no-ID entry for same package@version is merged into the advisory-keyed row (1 row total)', async () => {
      const cve = 'CVE-2023-55555';
      const noIdRaw = {
        via: { title: 'Unnamed', severity: 'medium' },
        resolvesDependents: [],
        isPromotedDependent: false,
      };
      const results = [
        sr({ sourceId: 'osv', cveIds: [cve], aliases: [] }),
        sr({
          sourceId: 'npm-audit',
          cveIds: [],
          aliases: [],
          url: null,
          title: 'Unnamed',
          rawData: noIdRaw,
        }),
      ];
      const result = await aggregate(mkp(), [results]);
      // With the new package+version key, the no-ID entry is absorbed into the
      // advisory-keyed entry for the same package@version — 1 row in the UI.
      expect(result.vulnCount).toBe(1);
      const merged = result.vulnerabilities[0];
      expect(merged.cveIds).toContain(cve);
      expect(merged.sources).toContain('osv');
    });
  });

  describe('Test 4: Different packages or versions are NOT collapsed', () => {
    it('same CVE on minimatch@9.0.5 and minimatch@3.1.2 produces 2 separate rows', async () => {
      const cve = 'CVE-2022-44444';
      const [r9, r3] = await Promise.all([
        aggregate(mkp({ name: 'minimatch', version: '9.0.5' }), [
          [sr({ packageName: 'minimatch', packageVersion: '9.0.5', cveIds: [cve] })],
        ]),
        aggregate(mkp({ name: 'minimatch', version: '3.1.2' }), [
          [sr({ packageName: 'minimatch', packageVersion: '3.1.2', cveIds: [cve] })],
        ]),
      ]);
      expect(r9.vulnCount).toBe(1);
      expect(r3.vulnCount).toBe(1);
      expect(r9.vulnerabilities[0].installedVersion).toBe('9.0.5');
      expect(r3.vulnerabilities[0].installedVersion).toBe('3.1.2');
    });
    it('two different packages with same CVE each get their own row', async () => {
      const cve = 'CVE-2023-77777';
      const [rA, rB] = await Promise.all([
        aggregate(mkp({ name: 'pkg-alpha', version: '1.0.0' }), [
          [sr({ packageName: 'pkg-alpha', packageVersion: '1.0.0', cveIds: [cve] })],
        ]),
        aggregate(mkp({ name: 'pkg-beta', version: '2.0.0' }), [
          [sr({ packageName: 'pkg-beta', packageVersion: '2.0.0', cveIds: [cve] })],
        ]),
      ]);
      expect(rA.vulnerabilities[0].package).toBe('pkg-alpha');
      expect(rB.vulnerabilities[0].package).toBe('pkg-beta');
    });
  });

  describe('Test 5: Merge preserves highest severity', () => {
    it('merged result carries HIGH when npm-audit reports high for merged group', async () => {
      // When two SourceResults share the same CVE they merge in Pass 1 into ONE group.
      // mergeGroup calls mergeSeverity ONCE with the npm-audit severity from that group.
      // Configure mock to return 'high' for that single call.
      const cve = 'CVE-2023-88888';
      mergeSeverity.mockImplementationOnce(() => ({
        mergedSeverity: 'high',
        nvdCategory: null,
        severityDiscrepancy: false,
        discrepancyDetails: null,
      }));
      const results = [
        sr({ sourceId: 'npm-audit', cveIds: [cve], severity: 'high' }),
        sr({ sourceId: 'osv', cveIds: [cve], severity: 'medium' }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
      expect(result.vulnerabilities[0].severity).toBe('high');
    });
    it('highestSeverity is critical when 3 distinct packages have medium, high, and critical severity', async () => {
      // Aggregate 3 DIFFERENT packages so each stays as its own row.
      // Each separate aggregate() call triggers one mergeSeverity call.
      mergeSeverity
        .mockImplementationOnce(() => ({
          mergedSeverity: 'medium',
          nvdCategory: null,
          severityDiscrepancy: false,
          discrepancyDetails: null,
        }))
        .mockImplementationOnce(() => ({
          mergedSeverity: 'high',
          nvdCategory: null,
          severityDiscrepancy: false,
          discrepancyDetails: null,
        }))
        .mockImplementationOnce(() => ({
          mergedSeverity: 'critical',
          nvdCategory: null,
          severityDiscrepancy: false,
          discrepancyDetails: null,
        }));
      const [rA, rB, rC] = await Promise.all([
        aggregate(mkp({ name: 'pkg-a', version: '1.0.0' }), [
          [sr({ packageName: 'pkg-a', cveIds: ['CVE-2023-11111'], severity: 'medium' })],
        ]),
        aggregate(mkp({ name: 'pkg-b', version: '2.0.0' }), [
          [sr({ packageName: 'pkg-b', cveIds: ['CVE-2023-22222'], severity: 'high' })],
        ]),
        aggregate(mkp({ name: 'pkg-c', version: '3.0.0' }), [
          [sr({ packageName: 'pkg-c', cveIds: ['CVE-2023-33333'], severity: 'critical' })],
        ]),
      ]);
      expect(rA.vulnCount).toBe(1);
      expect(rB.vulnCount).toBe(1);
      expect(rC.vulnCount).toBe(1);
      expect(rA.highestSeverity).toBe('medium');
      expect(rB.highestSeverity).toBe('high');
      expect(rC.highestSeverity).toBe('critical');
    });
  });

  describe('Test 6: deduplicateVulnerabilities tested via aggregate pipeline', () => {
    it('aggregate returns vulnCount matching vulnerabilities array length after dedup', async () => {
      const cve = 'CVE-2024-10001';
      const results = [
        sr({ sourceId: 'osv', cveIds: [cve] }),
        sr({ sourceId: 'github-advisory', cveIds: [cve] }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(result.vulnerabilities.length);
      expect(result.vulnCount).toBe(1);
    });
    it('aggregate with no source results returns 0 vulns', async () => {
      const result = await aggregate(mkp(), [[]]);
      expect(result.vulnCount).toBe(0);
      expect(result.vulnerabilities).toHaveLength(0);
      expect(result.highestSeverity).toBe('unknown');
    });
    it('highestSeverity reflects the most severe vulnerability after dedup', async () => {
      mergeSeverity
        .mockImplementationOnce(() => ({
          mergedSeverity: 'low',
          nvdCategory: null,
          severityDiscrepancy: false,
          discrepancyDetails: null,
        }))
        .mockImplementationOnce(() => ({
          mergedSeverity: 'critical',
          nvdCategory: null,
          severityDiscrepancy: false,
          discrepancyDetails: null,
        }));
      const results = [
        sr({ sourceId: 'npm-audit', cveIds: ['CVE-2024-00001'], severity: 'low' }),
        sr({ sourceId: 'nvd', cveIds: ['CVE-2024-00002'], severity: 'critical' }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.highestSeverity).toBe('critical');
    });
  });

  describe('Test 7: Same package@version with different CVEs merges into one row', () => {
    it('two entries for minimatch@9.0.5 with different CVEs collapse to 1 row with both CVEs', async () => {
      const cveA = 'CVE-2024-55001';
      const cveB = 'CVE-2024-55002';
      // Simulate what happens when npm-audit reports the same package twice from
      // different dependency chains, each tagged with a different CVE ID.
      // With the new package+version key both entries must merge into one UI row.
      const results = [
        sr({ sourceId: 'npm-audit', cveIds: [cveA], aliases: [] }),
        sr({ sourceId: 'npm-audit', cveIds: [cveB], aliases: [] }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
      const merged = result.vulnerabilities[0];
      expect(merged.package).toBe('minimatch');
      expect(merged.installedVersion).toBe('9.0.5');
      expect(merged.cveIds).toContain(cveA);
      expect(merged.cveIds).toContain(cveB);
    });

    it('three entries for same package@version (mixed CVE + no-ID) collapse to 1 row', async () => {
      const cveA = 'CVE-2024-66001';
      const cveB = 'CVE-2024-66002';
      const noIdRaw = {
        via: { title: 'Anon', severity: 'low' },
        resolvesDependents: [],
        isPromotedDependent: false,
      };
      const results = [
        sr({ sourceId: 'npm-audit', cveIds: [cveA], aliases: [] }),
        sr({ sourceId: 'osv', cveIds: [cveB], aliases: [] }),
        sr({
          sourceId: 'npm-audit',
          cveIds: [],
          aliases: [],
          url: null,
          title: 'Anon',
          rawData: noIdRaw,
        }),
      ];
      const result = await aggregate(mkp(), [results]);
      expect(result.vulnCount).toBe(1);
      const merged = result.vulnerabilities[0];
      expect(merged.cveIds).toContain(cveA);
      expect(merged.cveIds).toContain(cveB);
    });
  });
});
