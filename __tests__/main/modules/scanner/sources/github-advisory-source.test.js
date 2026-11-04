'use strict';

jest.mock('../../../../../src/main/modules/enrichment/sources/github-advisory-source', () => ({
  queryGitHubAdvisoryByPackage: jest.fn(),
}));

const {
  queryGitHubAdvisoryByPackage,
} = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
const {
  query,
  SOURCE_ID,
  isVersionAffectedByAdvisory,
  extractFixedInFromAdvisory,
  inferFixedInFromRange,
} = require('../../../../../src/main/modules/scanner/sources/github-advisory-source');

describe('github-advisory-source (scanner)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SOURCE_ID', () => {
    it('should be "github-advisory"', () => {
      expect(SOURCE_ID).toBe('github-advisory');
    });
  });

  describe('isVersionAffectedByAdvisory()', () => {
    const makeAdvisory = (vulns) => ({ vulnerabilities: vulns });

    it('returns true when installed version is within vulnerable range', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'morgan' },
          vulnerable_version_range: '>= 1.0.0, < 1.10.2',
          patched_versions: '>= 1.10.2',
        },
      ]);
      expect(isVersionAffectedByAdvisory('1.10.1', advisory, 'morgan')).toBe(true);
    });

    it('returns false when installed version is above vulnerable range', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'morgan' },
          vulnerable_version_range: '>= 1.0.0, < 1.10.2',
          patched_versions: '>= 1.10.2',
        },
      ]);
      expect(isVersionAffectedByAdvisory('1.10.2', advisory, 'morgan')).toBe(false);
    });

    it('returns false when advisory targets a different package name', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'express' },
          vulnerable_version_range: '>= 1.0.0, < 5.0.0',
          patched_versions: '>= 5.0.0',
        },
      ]);
      expect(isVersionAffectedByAdvisory('4.0.0', advisory, 'morgan')).toBe(false);
    });

    it('returns false when advisory targets a different ecosystem', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'pip', name: 'morgan' },
          vulnerable_version_range: '>= 1.0.0, < 2.0.0',
          patched_versions: '>= 2.0.0',
        },
      ]);
      expect(isVersionAffectedByAdvisory('1.5.0', advisory, 'morgan')).toBe(false);
    });

    it('returns false when advisory has no vulnerabilities array', () => {
      expect(isVersionAffectedByAdvisory('1.0.0', {}, 'morgan')).toBe(false);
      expect(isVersionAffectedByAdvisory('1.0.0', null, 'morgan')).toBe(false);
    });

    it('handles multiple vulnerability entries (multi-package advisory)', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'express' },
          vulnerable_version_range: '>= 4.0.0, < 4.18.0',
          patched_versions: '>= 4.18.0',
        },
        {
          package: { ecosystem: 'npm', name: 'morgan' },
          vulnerable_version_range: '>= 1.0.0, < 1.10.2',
          patched_versions: '>= 1.10.2',
        },
      ]);
      expect(isVersionAffectedByAdvisory('1.10.1', advisory, 'morgan')).toBe(true);
      expect(isVersionAffectedByAdvisory('1.10.2', advisory, 'morgan')).toBe(false);
    });

    it('handles <= range in vulnerable_version_range', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'brace-expansion' },
          vulnerable_version_range: '>= 5.0.0, <= 5.0.6',
          patched_versions: '>= 5.0.7',
        },
      ]);
      expect(isVersionAffectedByAdvisory('5.0.6', advisory, 'brace-expansion')).toBe(true);
      expect(isVersionAffectedByAdvisory('5.0.7', advisory, 'brace-expansion')).toBe(false);
    });
  });

  describe('extractFixedInFromAdvisory()', () => {
    const makeAdvisory = (vulns) => ({ vulnerabilities: vulns });

    it('extracts patched version for the target package', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'morgan' },
          vulnerable_version_range: '>= 1.0.0, < 1.10.2',
          patched_versions: '>= 1.10.2',
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'morgan', '1.10.1')).toBe('1.10.2');
    });

    it('returns null when no patched_versions for target package', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'other-pkg' },
          vulnerable_version_range: '>= 1.0.0, < 2.0.0',
          patched_versions: '>= 2.0.0',
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'morgan', '1.5.0')).toBeNull();
    });

    it('returns null for null advisory', () => {
      expect(extractFixedInFromAdvisory(null, 'morgan', '1.0.0')).toBeNull();
    });

    it('picks fix version from the branch matching the installed version (multi-branch)', () => {
      // Advisory covers two branches: 3.x and 4.x
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'lodash' },
          vulnerable_version_range: '>= 4.0.0, < 4.17.21',
          patched_versions: '>= 4.17.21',
        },
        {
          package: { ecosystem: 'npm', name: 'lodash' },
          vulnerable_version_range: '>= 3.0.0, < 3.10.2',
          patched_versions: '>= 3.10.2',
        },
      ]);
      // User on 4.x should get 4.17.21, NOT 3.10.2
      expect(extractFixedInFromAdvisory(advisory, 'lodash', '4.15.0')).toBe('4.17.21');
      // User on 3.x should get 3.10.2
      expect(extractFixedInFromAdvisory(advisory, 'lodash', '3.5.0')).toBe('3.10.2');
    });

    it('picks the earliest fix when installed version matches multiple entries in same branch', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'express' },
          vulnerable_version_range: '>= 4.0.0, < 4.18.0',
          patched_versions: '>= 4.18.0',
        },
        {
          package: { ecosystem: 'npm', name: 'express' },
          vulnerable_version_range: '>= 4.0.0, < 4.17.3',
          patched_versions: '>= 4.17.3',
        },
      ]);
      // User on 4.10.0 matches both ranges, should get the earlier fix
      expect(extractFixedInFromAdvisory(advisory, 'express', '4.10.0')).toBe('4.17.3');
    });
    it('infers fixedIn from vulnerable_version_range when patched_versions is undefined', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'uuid' },
          vulnerable_version_range: '< 14.0.0',
          // patched_versions intentionally omitted
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'uuid', '11.1.1')).toBe('14.0.0');
    });

    it('infers fixedIn from multi-constraint range when patched_versions is null', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'foo' },
          vulnerable_version_range: '>= 1.0.0, < 2.3.1',
          patched_versions: null,
          first_patched_version: null,
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'foo', '1.5.0')).toBe('2.3.1');
    });

    it('returns null when range has only inclusive upper bound', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'bar' },
          vulnerable_version_range: '<= 13.9.9',
          patched_versions: undefined,
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'bar', '13.0.0')).toBeNull();
    });

    it('prefers patched_versions over range inference', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'baz' },
          vulnerable_version_range: '< 14.0.0',
          patched_versions: '>= 12.0.1',
        },
      ]);
      // patched_versions says 12.0.1, range says 14.0.0 — patched_versions wins
      expect(extractFixedInFromAdvisory(advisory, 'baz', '11.0.0')).toBe('12.0.1');
    });

    it('uses first_patched_version as intermediate fallback (object form)', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'qux' },
          vulnerable_version_range: '< 5.0.0',
          patched_versions: undefined,
          first_patched_version: { identifier: '5.0.0' },
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'qux', '4.0.0')).toBe('5.0.0');
    });

    it('uses first_patched_version as intermediate fallback (string form)', () => {
      const advisory = makeAdvisory([
        {
          package: { ecosystem: 'npm', name: 'qux' },
          vulnerable_version_range: '< 5.0.0',
          patched_versions: undefined,
          first_patched_version: '5.0.0',
        },
      ]);
      expect(extractFixedInFromAdvisory(advisory, 'qux', '4.0.0')).toBe('5.0.0');
    });
  });

  describe('inferFixedInFromRange()', () => {
    it('extracts version from simple exclusive upper bound "< X.Y.Z"', () => {
      expect(inferFixedInFromRange('< 14.0.0')).toBe('14.0.0');
    });

    it('extracts version from multi-constraint range', () => {
      expect(inferFixedInFromRange('>= 1.0.0, < 2.3.1')).toBe('2.3.1');
    });

    it('returns null for inclusive upper bound "<= X.Y.Z"', () => {
      expect(inferFixedInFromRange('<= 13.9.9')).toBeNull();
    });

    it('returns null when no upper bound exists', () => {
      expect(inferFixedInFromRange('>= 1.0.0')).toBeNull();
    });

    it('returns null for null/undefined/empty input', () => {
      expect(inferFixedInFromRange(null)).toBeNull();
      expect(inferFixedInFromRange(undefined)).toBeNull();
      expect(inferFixedInFromRange('')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(inferFixedInFromRange(42)).toBeNull();
      expect(inferFixedInFromRange({})).toBeNull();
    });

    it('handles pre-release versions', () => {
      expect(inferFixedInFromRange('< 2.0.0-rc.1')).toBe('2.0.0-rc.1');
    });

    it('handles extra whitespace', () => {
      expect(inferFixedInFromRange('<   3.0.0  ')).toBe('3.0.0');
    });
  });

  describe('query()', () => {
    it('returns empty array for null/invalid pkg', async () => {
      expect(await query(null)).toEqual([]);
      expect(await query({})).toEqual([]);
      expect(await query({ name: 'foo' })).toEqual([]);
    });

    it('returns empty array when API returns no advisories', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);
      const result = await query({ name: 'safe-pkg', version: '1.0.0' });
      expect(result).toEqual([]);
      expect(queryGitHubAdvisoryByPackage).toHaveBeenCalledWith('safe-pkg', undefined);
    });

    it('returns results for affected packages', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([
        {
          ghsa_id: 'GHSA-4vj7-5mj6-jm8m',
          cve_id: 'CVE-2024-12345',
          severity: 'high',
          summary: 'Morgan vulnerability',
          html_url: 'https://github.com/advisories/GHSA-4vj7-5mj6-jm8m',
          vulnerabilities: [
            {
              package: { ecosystem: 'npm', name: 'morgan' },
              vulnerable_version_range: '>= 1.0.0, < 1.10.2',
              patched_versions: '>= 1.10.2',
            },
          ],
        },
      ]);

      const result = await query({ name: 'morgan', version: '1.10.1' });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourceId: 'github-advisory',
        packageName: 'morgan',
        packageVersion: '1.10.1',
        severity: 'high',
        cveIds: ['CVE-2024-12345'],
        aliases: ['GHSA-4vj7-5mj6-jm8m'],
        title: 'Morgan vulnerability',
        fixedIn: '1.10.2',
        url: 'https://github.com/advisories/GHSA-4vj7-5mj6-jm8m',
      });
    });

    it('filters out advisories where version is not affected', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([
        {
          ghsa_id: 'GHSA-4vj7-5mj6-jm8m',
          cve_id: 'CVE-2024-12345',
          severity: 'high',
          summary: 'Morgan vulnerability',
          html_url: 'https://github.com/advisories/GHSA-4vj7-5mj6-jm8m',
          vulnerabilities: [
            {
              package: { ecosystem: 'npm', name: 'morgan' },
              vulnerable_version_range: '>= 1.0.0, < 1.10.2',
              patched_versions: '>= 1.10.2',
            },
          ],
        },
      ]);

      // Version 1.10.2 is patched, not affected
      const result = await query({ name: 'morgan', version: '1.10.2' });
      expect(result).toHaveLength(0);
    });

    it('returns results with GHSA ID in aliases when no CVE', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([
        {
          ghsa_id: 'GHSA-abcd-1234-5678',
          cve_id: null,
          severity: 'medium',
          summary: 'Test advisory no CVE',
          html_url: 'https://github.com/advisories/GHSA-abcd-1234-5678',
          vulnerabilities: [
            {
              package: { ecosystem: 'npm', name: 'test-pkg' },
              vulnerable_version_range: '< 2.0.0',
              patched_versions: '>= 2.0.0',
            },
          ],
        },
      ]);

      const result = await query({ name: 'test-pkg', version: '1.5.0' });
      expect(result).toHaveLength(1);
      expect(result[0].cveIds).toEqual([]);
      expect(result[0].aliases).toEqual(['GHSA-abcd-1234-5678']);
    });

    it('returns empty array on API error (graceful degradation)', async () => {
      queryGitHubAdvisoryByPackage.mockRejectedValue(new Error('Network error'));
      const result = await query({ name: 'morgan', version: '1.10.1' });
      expect(result).toEqual([]);
    });

    it('passes signal through to the enrichment API', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);
      const signal = new AbortController().signal;
      await query({ name: 'morgan', version: '1.10.1' }, signal);
      expect(queryGitHubAdvisoryByPackage).toHaveBeenCalledWith('morgan', signal);
    });
  });
});
