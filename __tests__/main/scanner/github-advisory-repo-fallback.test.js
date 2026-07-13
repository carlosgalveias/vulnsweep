'use strict';

// Mock the enrichment source
jest.mock('../../../src/main/modules/enrichment/sources/github-advisory-source', () => ({
  queryGitHubAdvisoryByPackage: jest.fn(),
  queryRepoLevelAdvisories: jest.fn(),
}));

// Mock repo-url-resolver
jest.mock('../../../src/main/utils/repo-url-resolver', () => ({
  resolveGitHubRepo: jest.fn(),
}));

// Mock constants - use a mutable object so we can toggle GITHUB_TOKEN per test
const mockConfig = { GITHUB_TOKEN: 'ghp_test_token_123' };
jest.mock('../../../src/main/config/constants', () => ({
  ENRICHMENT_CONFIG: new Proxy(
    {},
    {
      get(_, prop) {
        return mockConfig[prop];
      },
    }
  ),
}));

const {
  queryGitHubAdvisoryByPackage,
  queryRepoLevelAdvisories,
} = require('../../../src/main/modules/enrichment/sources/github-advisory-source');
const { query } = require('../../../src/main/modules/scanner/sources/github-advisory-source');
const { resolveGitHubRepo } = require('../../../src/main/utils/repo-url-resolver');
const repoAdvisoryFixture = require('../../fixtures/github-repo-advisory-response.json');

describe('github-advisory-source repo-level fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.GITHUB_TOKEN = 'ghp_test_token_123';
  });

  describe('when global query returns results', () => {
    const globalAdvisory = {
      ghsa_id: 'GHSA-xxxx-yyyy-zzzz',
      cve_id: 'CVE-2024-1234',
      severity: 'high',
      summary: 'Test vulnerability',
      html_url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
      vulnerabilities: [
        {
          package: { name: 'test-pkg', ecosystem: 'npm' },
          vulnerable_version_range: '>= 1.0.0, < 2.0.0',
          patched_versions: '>= 2.0.0',
          first_patched_version: { identifier: '2.0.0' },
        },
      ],
    };

    it('does NOT query repo-level endpoint', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([globalAdvisory]);

      await query({ name: 'test-pkg', version: '1.5.0' });

      expect(queryRepoLevelAdvisories).not.toHaveBeenCalled();
    });

    it('does NOT call resolveGitHubRepo()', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([globalAdvisory]);

      await query({ name: 'test-pkg', version: '1.5.0' });

      expect(resolveGitHubRepo).not.toHaveBeenCalled();
    });

    it('returns matched results from global query', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([globalAdvisory]);

      const results = await query({ name: 'test-pkg', version: '1.5.0' });

      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('github-advisory');
      expect(results[0].cveIds).toContain('CVE-2024-1234');
    });
  });

  describe('when global query returns [] and no GITHUB_TOKEN', () => {
    it('does NOT query repo-level endpoint', async () => {
      mockConfig.GITHUB_TOKEN = undefined;
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);

      await query({ name: 'morgan', version: '1.10.0' });

      expect(resolveGitHubRepo).not.toHaveBeenCalled();
      expect(queryRepoLevelAdvisories).not.toHaveBeenCalled();
    });

    it('returns []', async () => {
      mockConfig.GITHUB_TOKEN = undefined;
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });
  });

  describe('when global query returns [] and GITHUB_TOKEN is set', () => {
    beforeEach(() => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);
    });

    it('calls resolveGitHubRepo() for the package', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue([]);

      await query({ name: 'morgan', version: '1.10.0' });

      expect(resolveGitHubRepo).toHaveBeenCalledWith('morgan');
    });

    it('skips repo-level query if resolveGitHubRepo returns null', async () => {
      resolveGitHubRepo.mockResolvedValue(null);

      await query({ name: 'unknown-pkg', version: '1.0.0' });

      expect(queryRepoLevelAdvisories).not.toHaveBeenCalled();
    });

    it('queries repo-level endpoint with resolved owner/repo', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue(repoAdvisoryFixture);

      await query({ name: 'morgan', version: '1.10.0' });

      expect(queryRepoLevelAdvisories).toHaveBeenCalledWith('expressjs', 'morgan', undefined);
    });

    it('filters repo-level results by package name (monorepo safety)', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'express' });
      queryRepoLevelAdvisories.mockResolvedValue([
        {
          ghsa_id: 'GHSA-aaaa-bbbb-cccc',
          cve_id: null,
          severity: 'low',
          summary: 'Unrelated advisory for express',
          state: 'published',
          html_url: 'https://github.com/expressjs/express/security/advisories/GHSA-aaaa-bbbb-cccc',
          vulnerabilities: [
            {
              package: { name: 'express', ecosystem: 'npm' },
              vulnerable_version_range: '>= 4.0.0, < 4.18.0',
              patched_versions: '>= 4.18.0',
              first_patched_version: { identifier: '4.18.0' },
            },
          ],
        },
      ]);

      // Query for "morgan" but repo returns advisory for "express"
      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });

    it('applies isVersionAffectedByAdvisory() to repo-level results', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue(repoAdvisoryFixture);

      // Version 1.11.0 is NOT affected (patched)
      const results = await query({ name: 'morgan', version: '1.11.0' });

      expect(results).toEqual([]);
    });

    it('maps affected repo-level advisories to SourceResult format', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue(repoAdvisoryFixture);

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        sourceId: 'github-advisory',
        packageName: 'morgan',
        packageVersion: '1.10.0',
        severity: 'medium',
        cveIds: ['CVE-2026-5078'],
        aliases: ['GHSA-4vj7-5mj6-jm8m'],
        title: 'Morgan allows log injection via crafted request headers',
        description: null,
        url: 'https://github.com/expressjs/morgan/security/advisories/GHSA-4vj7-5mj6-jm8m',
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: false,
        epssScore: null,
        epssPercentile: null,
      });
      expect(results[0].rawData.github).toBeDefined();
    });

    it('extracts fixedIn from repo-level advisory patched_versions', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue(repoAdvisoryFixture);

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results[0].fixedIn).toBe('1.11.0');
    });

    it('drops a WITHDRAWN repo-level advisory (state field)', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      const withdrawn = [
        {
          ghsa_id: 'GHSA-reje-cted-xxxx',
          cve_id: null,
          severity: 'low',
          summary: 'REJECTED (not a vulnerability)',
          state: 'WITHDRAWN',
          html_url: 'https://github.com/expressjs/morgan/security/advisories/GHSA-reje-cted-xxxx',
          vulnerabilities: [
            {
              package: { name: 'morgan', ecosystem: 'npm' },
              vulnerable_version_range: '>= 1.0.0',
              patched_versions: '>= 2.0.0',
              first_patched_version: { identifier: '2.0.0' },
            },
          ],
        },
      ];
      queryRepoLevelAdvisories.mockResolvedValue(withdrawn);

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });

    it('drops a withdrawn repo-level advisory (withdrawn_at timestamp)', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      const withdrawn = [
        {
          ghsa_id: 'GHSA-with-drawn-yyyy',
          cve_id: null,
          severity: 'low',
          summary: 'Retracted finding',
          state: 'published',
          withdrawn_at: '2026-01-01T00:00:00Z',
          html_url: 'https://github.com/expressjs/morgan/security/advisories/GHSA-with-drawn-yyyy',
          vulnerabilities: [
            {
              package: { name: 'morgan', ecosystem: 'npm' },
              vulnerable_version_range: '>= 1.0.0',
              patched_versions: '>= 2.0.0',
              first_patched_version: { identifier: '2.0.0' },
            },
          ],
        },
      ];
      queryRepoLevelAdvisories.mockResolvedValue(withdrawn);

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });

    it('drops a GitHub-retracted advisory whose only signal is the summary text (express GHSA-pj86)', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'express' });
      const retracted = [
        {
          ghsa_id: 'GHSA-pj86-cfqh-vqx6',
          cve_id: 'CVE-2024-51999',
          severity: 'low',
          // GitHub keeps this at state:"published" / withdrawn_at:null in the
          // package-affected feed; the retraction only appears in the summary.
          summary:
            'REJECTED (not a vulnerability): improperly controlled modification of query properties in express',
          state: 'published',
          withdrawn_at: null,
          html_url: 'https://github.com/expressjs/express/security/advisories/GHSA-pj86-cfqh-vqx6',
          vulnerabilities: [
            {
              package: { name: 'express', ecosystem: 'npm' },
              vulnerable_version_range: '>= 4.0.0, < 5.0.0',
              patched_versions: '>= 5.0.0',
              first_patched_version: { identifier: '5.0.0' },
            },
          ],
        },
      ];
      queryRepoLevelAdvisories.mockResolvedValue(retracted);

      const results = await query({ name: 'express', version: '4.22.1' });

      expect(results).toEqual([]);
    });

    it('returns [] if repo-level query returns no matching advisories', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue([]);

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);
    });

    it('returns [] if resolveGitHubRepo throws', async () => {
      resolveGitHubRepo.mockRejectedValue(new Error('Network failure'));

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });

    it('returns [] if queryRepoLevelAdvisories fails', async () => {
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockRejectedValue(new Error('HTTP 500'));

      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toEqual([]);
    });

    it('returns [] for null/undefined pkg', async () => {
      const results = await query(null);
      expect(results).toEqual([]);
    });

    it('returns [] for pkg without name', async () => {
      const results = await query({ version: '1.0.0' });
      expect(results).toEqual([]);
    });

    it('returns [] for pkg without version', async () => {
      const results = await query({ name: 'morgan' });
      expect(results).toEqual([]);
    });
  });

  describe('when global returns advisories that do NOT match installed version', () => {
    // Simulates the morgan@1.10.1 scenario:
    // Global returns GHSA-gwg9-rgvj-4h5j (CVE-2019-5413, affects < 1.9.1)
    // but our version is 1.10.1 so it doesn't match → results empty → fallback fires
    const nonMatchingGlobalAdvisory = {
      ghsa_id: 'GHSA-gwg9-rgvj-4h5j',
      cve_id: 'CVE-2019-5413',
      severity: 'critical',
      summary: 'morgan Timing Attack',
      html_url: 'https://github.com/advisories/GHSA-gwg9-rgvj-4h5j',
      vulnerabilities: [
        {
          package: { name: 'morgan', ecosystem: 'npm' },
          vulnerable_version_range: '< 1.9.1',
          patched_versions: '>= 1.9.1',
          first_patched_version: { identifier: '1.9.1' },
        },
      ],
    };

    it('triggers repo-level fallback when global advisories exist but none match installed version', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([nonMatchingGlobalAdvisory]);
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue(repoAdvisoryFixture);

      const results = await query({ name: 'morgan', version: '1.10.1' });

      // Fallback should have been triggered
      expect(resolveGitHubRepo).toHaveBeenCalledWith('morgan');
      expect(queryRepoLevelAdvisories).toHaveBeenCalledWith('expressjs', 'morgan', undefined);
      // Repo-level advisory GHSA-4vj7-5mj6-jm8m affects >= 1.2.0, <= 1.10.1
      expect(results).toHaveLength(1);
      expect(results[0].aliases).toContain('GHSA-4vj7-5mj6-jm8m');
      expect(results[0].cveIds).toContain('CVE-2026-5078');
    });

    it('does NOT trigger fallback when global advisories match the installed version', async () => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([nonMatchingGlobalAdvisory]);

      // Version 1.8.0 IS affected by < 1.9.1 → results non-empty → no fallback
      const results = await query({ name: 'morgan', version: '1.8.0' });

      expect(resolveGitHubRepo).not.toHaveBeenCalled();
      expect(queryRepoLevelAdvisories).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].aliases).toContain('GHSA-gwg9-rgvj-4h5j');
    });

    it('does NOT trigger fallback without GITHUB_TOKEN even when no matches', async () => {
      mockConfig.GITHUB_TOKEN = undefined;
      queryGitHubAdvisoryByPackage.mockResolvedValue([nonMatchingGlobalAdvisory]);

      const results = await query({ name: 'morgan', version: '1.10.1' });

      expect(resolveGitHubRepo).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });
  });

  describe('integration: GHSA-4vj7-5mj6-jm8m (morgan)', () => {
    beforeEach(() => {
      queryGitHubAdvisoryByPackage.mockResolvedValue([]);
      resolveGitHubRepo.mockResolvedValue({ owner: 'expressjs', repo: 'morgan' });
      queryRepoLevelAdvisories.mockResolvedValue(repoAdvisoryFixture);
    });

    it('detects repo-level advisory for morgan@1.10.0', async () => {
      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results).toHaveLength(1);
      expect(results[0].aliases).toContain('GHSA-4vj7-5mj6-jm8m');
    });

    it('does NOT flag morgan@1.11.0 (patched)', async () => {
      const results = await query({ name: 'morgan', version: '1.11.0' });

      expect(results).toEqual([]);
    });

    it('includes correct GHSA ID, CVE ID, severity, fixedIn', async () => {
      const results = await query({ name: 'morgan', version: '1.10.0' });

      expect(results[0].cveIds).toEqual(['CVE-2026-5078']);
      expect(results[0].aliases).toEqual(['GHSA-4vj7-5mj6-jm8m']);
      expect(results[0].severity).toBe('medium');
      expect(results[0].fixedIn).toBe('1.11.0');
    });

    it('detects advisory for morgan@1.2.0 (lower bound)', async () => {
      const results = await query({ name: 'morgan', version: '1.2.0' });

      expect(results).toHaveLength(1);
    });

    it('does NOT flag morgan@1.1.0 (below vulnerable range)', async () => {
      const results = await query({ name: 'morgan', version: '1.1.0' });

      expect(results).toEqual([]);
    });
  });
});
