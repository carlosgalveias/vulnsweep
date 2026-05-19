'use strict';
// Regression tests for npm-audit-source.js deduplication fix.
// Tests that the same advisory appearing in multiple via chains produces 1 SourceResult.

jest.mock('../../../src/main/modules/audit/commands/npm-audit', () => ({
  runNpmAudit: jest.fn(),
}));

const { runNpmAudit } = require('../../../src/main/modules/audit/commands/npm-audit');
const { query, clearCache } = require('../../../src/main/modules/scanner/sources/npm-audit-source');

function makeAuditResult(vulnerabilities) {
  return {
    success: true,
    content: {
      auditData: { vulnerabilities },
    },
  };
}

function makePkg(overrides) {
  const o = overrides || {};
  return {
    name: o.name || 'minimatch',
    version: o.version || '9.0.5',
    projectPath: o.projectPath || '/mock/project',
    resolved: null,
  };
}

describe('npm-audit-source deduplication regression tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  describe('Test 7: Same advisory in multiple via chains produces 1 SourceResult', () => {
    it('single advisory object in via produces exactly 1 SourceResult', async () => {
      const ghsaUrl = 'https://github.com/advisories/GHSA-f8q6-p94x-37v3';
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 1,
                name: 'minimatch',
                title: 'minimatch ReDoS',
                url: ghsaUrl,
                severity: 'high',
                range: '<9.0.5',
              },
            ],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: { name: 'minimatch', version: '9.0.5', isSemVerMajor: false },
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('npm-audit');
      expect(results[0].aliases).toContain('GHSA-F8Q6-P94X-37V3');
    });

    it('same advisory duplicated 2x in via array produces 1 SourceResult (dedup fix)', async () => {
      const ghsaUrl = 'https://github.com/advisories/GHSA-f8q6-p94x-37v3';
      const advisory = {
        source: 1,
        name: 'minimatch',
        title: 'minimatch ReDoS',
        url: ghsaUrl,
        severity: 'high',
        range: '<9.0.5',
      };
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [advisory, advisory],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: { name: 'minimatch', version: '9.0.5', isSemVerMajor: false },
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(1);
    });

    it('same advisory duplicated 3x in via array produces 1 SourceResult', async () => {
      const ghsaUrl = 'https://github.com/advisories/GHSA-f8q6-p94x-37v3';
      const adv = {
        source: 1,
        name: 'minimatch',
        title: 'ReDoS',
        url: ghsaUrl,
        severity: 'high',
        range: '<9.0.5',
      };
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [adv, adv, adv],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: true,
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(1);
    });

    it('two different advisories in via array produce 2 SourceResults', async () => {
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 1,
                title: 'Advisory A',
                url: 'https://github.com/advisories/GHSA-aaaa-1111-bbbb',
                severity: 'high',
                range: '<9.0.5',
              },
              {
                source: 2,
                title: 'Advisory B',
                url: 'https://github.com/advisories/GHSA-cccc-2222-dddd',
                severity: 'medium',
                range: '<9.0.5',
              },
            ],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: { name: 'minimatch', version: '9.0.5', isSemVerMajor: false },
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(2);
    });
  });

  describe('Test 8: String-only via entries are skipped', () => {
    it('string entries in via array produce no SourceResult', async () => {
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: ['some-parent-package', 'another-parent'],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: false,
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(0);
    });

    it('mix of string and object entries only creates SourceResults for object entries', async () => {
      const ghsaUrl = 'https://github.com/advisories/GHSA-zzzz-9999-yyyy';
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [
              'some-parent-package',
              {
                source: 5,
                name: 'minimatch',
                title: 'Real advisory',
                url: ghsaUrl,
                severity: 'high',
                range: '<9.0.5',
              },
            ],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: { name: 'minimatch', version: '9.0.5', isSemVerMajor: false },
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Real advisory');
    });
  });

  describe('Test 9: Edge cases — missing package, failed audit, no projectPath', () => {
    it('returns empty array when package is not in audit vulnerabilities', async () => {
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          'other-package': {
            name: 'other-package',
            severity: 'low',
            via: [],
            range: '*',
            nodes: [],
            fixAvailable: false,
          },
        })
      );
      const results = await query(makePkg({ name: 'minimatch' }));
      expect(results).toHaveLength(0);
    });

    it('returns empty array when audit result has success=false', async () => {
      runNpmAudit.mockResolvedValue({ success: false, error: 'audit failed' });
      const results = await query(makePkg());
      expect(results).toHaveLength(0);
    });

    it('returns empty array when pkg has no projectPath', async () => {
      const results = await query({ name: 'minimatch', version: '9.0.5', projectPath: null });
      expect(results).toHaveLength(0);
      expect(runNpmAudit).not.toHaveBeenCalled();
    });
  });

  describe('Test 10: SourceResult shape validation', () => {
    it('SourceResult has all expected fields', async () => {
      const ghsaUrl = 'https://github.com/advisories/GHSA-f8q6-p94x-37v3';
      runNpmAudit.mockResolvedValue(
        makeAuditResult({
          minimatch: {
            name: 'minimatch',
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 1,
                name: 'minimatch',
                title: 'minimatch ReDoS',
                url: ghsaUrl,
                severity: 'high',
                range: '<9.0.5',
              },
            ],
            range: '<9.0.5',
            nodes: ['node_modules/minimatch'],
            fixAvailable: { name: 'minimatch', version: '9.0.5', isSemVerMajor: false },
          },
        })
      );
      const results = await query(makePkg());
      expect(results).toHaveLength(1);
      const r = results[0];
      expect(r.sourceId).toBe('npm-audit');
      expect(r.packageName).toBe('minimatch');
      expect(r.packageVersion).toBe('9.0.5');
      expect(r.severity).toBe('high');
      expect(Array.isArray(r.cveIds)).toBe(true);
      expect(Array.isArray(r.aliases)).toBe(true);
      expect(r.title).toBe('minimatch ReDoS');
      expect(r.description).toBeNull();
      expect(r.fixedIn).toBe('9.0.5');
      expect(r.url).toBe(ghsaUrl);
      expect(r.cvssScore).toBeNull();
      expect(r.cisaKnownExploited).toBe(false);
      expect(r.rawData).toHaveProperty('via');
      expect(r.rawData).toHaveProperty('resolvesDependents');
    });
  });
});
