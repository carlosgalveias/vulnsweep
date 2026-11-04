'use strict';

const {
  normalizeAdvisoryUrl,
  buildAliasUrls,
} = require('../../../src/main/modules/scanner/result-aggregator');

const AXIOS = { owner: 'axios', repo: 'axios' };

describe('advisory URL repo-aware normalization', () => {
  describe('normalizeAdvisoryUrl', () => {
    it('rewrites a global GHSA URL to the home-repo path when repo known', () => {
      expect(normalizeAdvisoryUrl('https://github.com/advisories/GHSA-pmv8-rq9r-6j72', AXIOS)).toBe(
        'https://github.com/axios/axios/security/advisories/GHSA-pmv8-rq9r-6j72'
      );
    });

    it('keeps a global GHSA URL when repo is unknown', () => {
      expect(normalizeAdvisoryUrl('https://github.com/advisories/GHSA-pmv8-rq9r-6j72', null)).toBe(
        'https://github.com/advisories/GHSA-pmv8-rq9r-6j72'
      );
    });

    it('does not touch an already-repo-level GHSA URL', () => {
      const url = 'https://github.com/axios/axios/security/advisories/GHSA-pmv8-rq9r-6j72';
      expect(normalizeAdvisoryUrl(url, AXIOS)).toBe(url);
    });

    it('does not touch NVD / other URLs', () => {
      const u = 'https://nvd.nist.gov/vuln/detail/CVE-2024-1234';
      expect(normalizeAdvisoryUrl(u, AXIOS)).toBe(u);
    });

    it('returns null for null/empty input', () => {
      expect(normalizeAdvisoryUrl(null, AXIOS)).toBeNull();
      expect(normalizeAdvisoryUrl('', AXIOS)).toBeNull();
    });
  });

  describe('buildAliasUrls', () => {
    it('builds home-repo URLs for every GHSA alias', () => {
      expect(
        buildAliasUrls(['GHSA-pmv8-rq9r-6j72', 'GHSA-xj6q-8x83-jv6g', 'GHSA-f4gw-2p7v-4548'], AXIOS)
      ).toEqual([
        'https://github.com/axios/axios/security/advisories/GHSA-pmv8-rq9r-6j72',
        'https://github.com/axios/axios/security/advisories/GHSA-xj6q-8x83-jv6g',
        'https://github.com/axios/axios/security/advisories/GHSA-f4gw-2p7v-4548',
      ]);
    });

    it('falls back to global path when repo unknown', () => {
      expect(buildAliasUrls(['GHSA-pmv8-rq9r-6j72'], null)).toEqual([
        'https://github.com/advisories/GHSA-pmv8-rq9r-6j72',
      ]);
    });

    it('ignores non-GHSA ids and de-dupes', () => {
      expect(
        buildAliasUrls(['GHSA-pmv8-rq9r-6j72', 'CVE-2024-1234', 'GHSA-pmv8-rq9r-6j72'], AXIOS)
      ).toEqual(['https://github.com/axios/axios/security/advisories/GHSA-pmv8-rq9r-6j72']);
    });

    it('returns [] for empty/non-array input', () => {
      expect(buildAliasUrls([], AXIOS)).toEqual([]);
      expect(buildAliasUrls(null, AXIOS)).toEqual([]);
    });
  });
});
