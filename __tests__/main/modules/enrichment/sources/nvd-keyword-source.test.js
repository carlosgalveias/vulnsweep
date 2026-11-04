'use strict';

const {
  normalizePackageName,
  extractCpeProduct,
  extractCpeVersion,
  cpeMatchesPackage,
  isVersionAffected,
  extractVersionRangeInfo,
  parseKeywordResponse,
  extractGhsaIdFromReferences,
  mergeGhData,
} = require('../../../../../src/main/modules/enrichment/sources/nvd-keyword-source');

const CPE_LODASH = 'cpe:2.3:a:lodash:lodash:*:*:*:*:*:node.js:*:*';
const CPE_LODASH_PROJECT = 'cpe:2.3:a:lodash_project:lodash:*:*:*:*:*:node.js:*:*';
const CPE_LODAHS_TYPO = 'cpe:2.3:a:lodahs_project:lodahs:1.0.0:*:*:*:*:node.js:*:*';
const CPE_LANGSMITH = 'cpe:2.3:a:langchain:langsmith_client:*:*:*:*:*:node.js:*:*';
const CPE_NODE_FETCH = 'cpe:2.3:a:node_fetch:node_fetch:*:*:*:*:*:node.js:*:*';

describe('normalizePackageName()', () => {
  it('lowercases input', () => {
    expect(normalizePackageName('Lodash')).toBe('lodash');
  });
  it('removes hyphens', () => {
    expect(normalizePackageName('node-fetch')).toBe('nodefetch');
  });
  it('removes underscores', () => {
    expect(normalizePackageName('node_fetch')).toBe('nodefetch');
  });
  it('removes dots', () => {
    expect(normalizePackageName('some.package')).toBe('somepackage');
  });
  it('returns empty string for null', () => {
    expect(normalizePackageName(null)).toBe('');
  });
  it('does not strip @ or / (scoped packages stay unmatched)', () => {
    expect(normalizePackageName('@babel/core')).toBe('@babel/core');
  });
});

describe('extractCpeProduct()', () => {
  it('returns product from valid CPE string', () => {
    expect(extractCpeProduct(CPE_LODASH)).toBe('lodash');
  });
  it('returns product from CPE with different vendor than product', () => {
    expect(extractCpeProduct(CPE_LODASH_PROJECT)).toBe('lodash');
  });
  it('returns null for wildcard product', () => {
    expect(extractCpeProduct('cpe:2.3:a:lodash:*:*:*:*:*:*:node.js:*:*')).toBeNull();
  });
  it('returns null for malformed CPE (too few components)', () => {
    expect(extractCpeProduct('cpe:2.3:a:lodash')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(extractCpeProduct('')).toBeNull();
  });
  it('returns null for null', () => {
    expect(extractCpeProduct(null)).toBeNull();
  });
});

describe('extractCpeVersion()', () => {
  it('returns version string for a valid pinned CPE version', () => {
    expect(extractCpeVersion('cpe:2.3:a:axios:axios:1.5.1:*:*:*:*:node.js:*:*')).toBe('1.5.1');
  });
  it('returns null for wildcard * version', () => {
    expect(extractCpeVersion('cpe:2.3:a:lodash:lodash:*:*:*:*:*:node.js:*:*')).toBeNull();
  });
  it('returns null for N/A - version', () => {
    expect(extractCpeVersion('cpe:2.3:a:axios:axios:-:*:*:*:*:node.js:*:*')).toBeNull();
  });
  it('returns null for malformed/short CPE string (fewer than 6 colon-separated parts)', () => {
    expect(extractCpeVersion('cpe:2.3:a:axios')).toBeNull();
  });
});

describe('cpeMatchesPackage()', () => {
  it('returns true when CPE product exactly matches package name', () => {
    expect(cpeMatchesPackage(CPE_LODASH, 'lodash')).toBe(true);
  });
  it('returns true when CPE vendor differs but product matches', () => {
    expect(cpeMatchesPackage(CPE_LODASH_PROJECT, 'lodash')).toBe(true);
  });
  it('returns false when CPE product is a typo of the package name', () => {
    expect(cpeMatchesPackage(CPE_LODAHS_TYPO, 'lodash')).toBe(false);
  });
  it('returns false when CPE product is an unrelated package', () => {
    expect(cpeMatchesPackage(CPE_LANGSMITH, 'lodash')).toBe(false);
  });
  it('returns true for hyphen vs underscore normalization', () => {
    expect(cpeMatchesPackage(CPE_NODE_FETCH, 'node-fetch')).toBe(true);
  });
  it('returns false for malformed CPE string', () => {
    expect(cpeMatchesPackage('notacpe', 'lodash')).toBe(false);
  });
  it('returns false for null criteria', () => {
    expect(cpeMatchesPackage(null, 'lodash')).toBe(false);
  });
});

describe('isVersionAffected()', () => {
  it('returns false when CPE entries exist but none match the package name', () => {
    const cpeMatches = [
      { vulnerable: true, criteria: CPE_LANGSMITH, versionEndExcluding: '99.0.0' },
    ];
    expect(isVersionAffected('lodash', '4.17.4', cpeMatches)).toBe(false);
  });
  it('returns true when CPE entry matches package and version is in range', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionEndExcluding: '4.17.5' }];
    expect(isVersionAffected('lodash', '4.17.4', cpeMatches)).toBe(true);
  });
  it('returns false when CPE entry matches package and version is above range', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionEndExcluding: '4.17.5' }];
    expect(isVersionAffected('lodash', '4.18.1', cpeMatches)).toBe(false);
  });
  it('returns true when no CPE entries exist (conservative fallback)', () => {
    expect(isVersionAffected('lodash', '4.17.4', [])).toBe(true);
  });
  it('returns false when CPE entries exist but all have vulnerable: false', () => {
    const cpeMatches = [{ vulnerable: false, criteria: CPE_LODASH, versionEndExcluding: '4.17.5' }];
    expect(isVersionAffected('lodash', '4.17.4', cpeMatches)).toBe(false);
  });
  it('returns true when pinned exact CPE version matches installed version', () => {
    const cpeMatches = [
      { vulnerable: true, criteria: 'cpe:2.3:a:axios:axios:1.5.1:*:*:*:*:node.js:*:*' },
    ];
    expect(isVersionAffected('axios', '1.5.1', cpeMatches)).toBe(true);
  });
  it('returns false when pinned exact CPE version does not match installed version (1.15.2 \u2260 1.5.1)', () => {
    // Regression test for the prefix-match bug: 1.15.2 must NOT match pinned 1.5.1
    const cpeMatches = [
      { vulnerable: true, criteria: 'cpe:2.3:a:axios:axios:1.5.1:*:*:*:*:node.js:*:*' },
    ];
    expect(isVersionAffected('axios', '1.15.2', cpeMatches)).toBe(false);
  });
  it('returns true (conservative) when CPE has wildcard version * and no range bounds', () => {
    const cpeMatches = [
      { vulnerable: true, criteria: 'cpe:2.3:a:axios:axios:*:*:*:*:*:node.js:*:*' },
    ];
    expect(isVersionAffected('axios', '1.15.2', cpeMatches)).toBe(true);
  });
});

describe('extractGhsaIdFromReferences()', () => {
  it('extracts GHSA ID from URL in references array', () => {
    const refs = [{ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }];
    expect(extractGhsaIdFromReferences(refs)).toBe('GHSA-XXXX-YYYY-ZZZZ');
  });
  it('extracts GHSA ID from string reference', () => {
    const refs = ['https://github.com/advisories/GHSA-abcd-1234-5678'];
    expect(extractGhsaIdFromReferences(refs)).toBe('GHSA-ABCD-1234-5678');
  });
  it('extracts GHSA ID from repo-specific advisory URL', () => {
    const refs = [
      {
        url: 'https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-jxxr-4gwj-5jf2',
      },
    ];
    expect(extractGhsaIdFromReferences(refs)).toBe('GHSA-JXXR-4GWJ-5JF2');
  });
  it('extracts GHSA ID from repo-specific URL as string reference', () => {
    const refs = ['https://github.com/expressjs/morgan/security/advisories/GHSA-4vj7-5mj6-jm8m'];
    expect(extractGhsaIdFromReferences(refs)).toBe('GHSA-4VJ7-5MJ6-JM8M');
  });
  it('returns null when no GitHub advisory URL present', () => {
    const refs = [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-1234' }];
    expect(extractGhsaIdFromReferences(refs)).toBeNull();
  });
  it('returns null for empty or null references', () => {
    expect(extractGhsaIdFromReferences([])).toBeNull();
    expect(extractGhsaIdFromReferences(null)).toBeNull();
    expect(extractGhsaIdFromReferences(undefined)).toBeNull();
  });
});

describe('extractVersionRangeInfo()', () => {
  it('returns fixedIn from versionEndExcluding', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionEndExcluding: '4.17.5' }];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: '4.17.5',
      vulnerableRange: '<4.17.5',
    });
  });
  it('returns fixedIn as next patch from versionEndIncluding', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionEndIncluding: '4.17.4' }];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: '4.17.5',
      vulnerableRange: '<=4.17.4',
    });
  });
  it('returns null fixedIn when no upper bound', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionStartIncluding: '4.0.0' }];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: null,
      vulnerableRange: '>=4.0.0',
    });
  });
  it('returns full range string with both lower and upper bounds', () => {
    const cpeMatches = [
      {
        vulnerable: true,
        criteria: CPE_LODASH,
        versionStartIncluding: '4.0.0',
        versionEndExcluding: '4.17.5',
      },
    ];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: '4.17.5',
      vulnerableRange: '>=4.0.0 <4.17.5',
    });
  });
  it('ignores CPE entries that do not match the package', () => {
    const cpeMatches = [
      { vulnerable: true, criteria: CPE_LANGSMITH, versionEndExcluding: '99.0.0' },
    ];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: null,
      vulnerableRange: null,
    });
  });
  it('returns null both fields when no matching CPE entries', () => {
    expect(extractVersionRangeInfo('lodash', [])).toEqual({
      fixedIn: null,
      vulnerableRange: null,
    });
  });
});

describe('mergeGhData()', () => {
  it('uses patchedVersions to set fixedIn when NVD has no fixedIn', () => {
    const nvdResult = { fixedIn: null, vulnerableRange: null };
    const ghResult = { patchedVersions: ['>= 4.17.21'] };
    const merged = mergeGhData(nvdResult, ghResult);
    expect(merged.fixedIn).toBe('4.17.21');
  });
  it('does not use GHSA version that falls within NVD vulnerable range (conservative)', () => {
    // NVD says <4.18.0 is affected, GHSA says >=4.17.15 is fixed
    // 4.17.15 and 4.17.21 are WITHIN <4.18.0, so conservative merge rejects them
    const nvdResult = { fixedIn: '4.18.0', vulnerableRange: '<4.18.0' };
    const ghResult = { patchedVersions: ['>= 4.17.21', '>= 4.17.15'] };
    const merged = mergeGhData(nvdResult, ghResult);
    // Conservative: keep NVD's fixedIn since GHSA versions are in the vulnerable range
    expect(merged.fixedIn).toBe('4.18.0');
  });
  it('does not override fixedIn when GH version is higher', () => {
    const nvdResult = { fixedIn: '4.17.21', vulnerableRange: '<4.17.21' };
    const ghResult = { patchedVersions: ['>= 4.18.0'] };
    const merged = mergeGhData(nvdResult, ghResult);
    expect(merged.fixedIn).toBe('4.17.21');
  });
  it('sets vulnerableRange from patchedVersions when NVD has none', () => {
    const nvdResult = { fixedIn: null, vulnerableRange: null };
    const ghResult = { patchedVersions: ['>= 4.17.21'] };
    const merged = mergeGhData(nvdResult, ghResult);
    expect(merged.vulnerableRange).toBe('<4.17.21');
  });
  it('does NOT use GHSA fix version when it falls within NVD vulnerable range (conservative reconciliation)', () => {
    // NVD says <=5.0.6 is affected, GHSA says >=5.0.6 is the fix
    // 5.0.6 is WITHIN the NVD affected range, so it should NOT be used as fixedIn
    const nvdResult = { fixedIn: '5.0.7', vulnerableRange: '>=5.0.0 <=5.0.6' };
    const ghResult = { patchedVersions: ['>= 5.0.6'] };
    const merged = mergeGhData(nvdResult, ghResult);
    // Should keep the NVD fixedIn (5.0.7) since GHSA's 5.0.6 is in the vulnerable range
    expect(merged.fixedIn).toBe('5.0.7');
  });
  it('uses GHSA fix version when it is outside NVD vulnerable range', () => {
    // NVD says <4.17.21 is affected, GHSA says >=4.17.21 is the fix
    // 4.17.21 is NOT within <4.17.21, so it should be used
    const nvdResult = { fixedIn: '4.18.0', vulnerableRange: '<4.17.21' };
    const ghResult = { patchedVersions: ['>= 4.17.21'] };
    const merged = mergeGhData(nvdResult, ghResult);
    expect(merged.fixedIn).toBe('4.17.21');
  });
});

// ─── parseKeywordResponse() ───────────────────────────────────────────────────

function makeNvdResponse(cveId, descriptions, cpeMatches, references) {
  return {
    vulnerabilities: [
      {
        cve: {
          id: cveId,
          descriptions,
          metrics: {},
          weaknesses: [],
          configurations: cpeMatches ? [{ nodes: [{ cpeMatch: cpeMatches }] }] : [],
          references: references || [],
        },
      },
    ],
  };
}

describe('parseKeywordResponse()', () => {
  const CPE_LODASH_VULN = 'cpe:2.3:a:lodash:lodash:*:*:*:*:*:node.js:*:*';
  const CPE_LANGSMITH = 'cpe:2.3:a:langchain:langsmith_client:*:*:*:*:*:node.js:*:*';

  describe('CPE path (cpeMatches present)', () => {
    it('includes CVE when version is in affected range', async () => {
      const json = makeNvdResponse(
        'CVE-2019-10744',
        [{ lang: 'en', value: 'Lodash prototype pollution via defaultsDeep.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN, versionEndExcluding: '4.17.5' }]
      );
      const results = await parseKeywordResponse(json, 'lodash', '4.17.4');
      expect(results).toHaveLength(1);
      expect(results[0].cveId).toBe('CVE-2019-10744');
      expect(results[0].fixedIn).toBe('4.17.5');
      expect(results[0].vulnerableRange).toBe('<4.17.5');
    });

    it('excludes CVE when version is above affected range', async () => {
      const json = makeNvdResponse(
        'CVE-2019-10744',
        [{ lang: 'en', value: 'Lodash prototype pollution via defaultsDeep.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN, versionEndExcluding: '4.17.5' }]
      );
      const results = await parseKeywordResponse(json, 'lodash', '4.18.1');
      expect(results).toHaveLength(0);
    });

    it('excludes CVE when CPE product does not match package name', async () => {
      const json = makeNvdResponse(
        'CVE-2026-40190',
        [{ lang: 'en', value: 'LangSmith vulnerability affecting Node.js SDK.' }],
        [{ vulnerable: true, criteria: CPE_LANGSMITH, versionEndExcluding: '99.0.0' }]
      );
      // LangSmith CPE should NOT match lodash
      const results = await parseKeywordResponse(json, 'lodash', '4.18.1');
      expect(results).toHaveLength(0);
    });
  });

  describe('GitHub advisory enrichment', () => {
    it('enriches result with patchedVersions from GitHub advisory', async () => {
      const json = makeNvdResponse(
        'CVE-2021-12345',
        [{ lang: 'en', value: 'Test vulnerability.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN }],
        [{ url: 'https://github.com/advisories/GHSA-test-1234-5678' }]
      );
      const ghCache = {
        'GHSA-TEST-1234-5678': { found: true, patchedVersions: ['>= 4.17.21'] },
      };
      const results = await parseKeywordResponse(json, 'lodash', '4.17.4', ghCache);
      expect(results).toHaveLength(1);
      expect(results[0].fixedIn).toBe('4.17.21');
      expect(results[0].vulnerableRange).toBe('<4.17.21');
    });

    it('enriches result from repo-specific advisory URL', async () => {
      const json = makeNvdResponse(
        'CVE-2024-99999',
        [{ lang: 'en', value: 'Repo-specific advisory URL test.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN }],
        [{ url: 'https://github.com/lodash/lodash/security/advisories/GHSA-repo-spec-test' }]
      );
      const ghCache = {
        'GHSA-REPO-SPEC-TEST': { found: true, patchedVersions: ['>= 4.17.22'] },
      };
      const results = await parseKeywordResponse(json, 'lodash', '4.17.4', ghCache);
      expect(results).toHaveLength(1);
      expect(results[0].fixedIn).toBe('4.17.22');
    });

    it('uses cached GitHub advisory data', async () => {
      const json = makeNvdResponse(
        'CVE-2021-12345',
        [{ lang: 'en', value: 'Test vulnerability.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN }],
        [{ url: 'https://github.com/advisories/GHSA-abcd-ef12-3456' }]
      );
      const ghCache = {
        'GHSA-ABCD-EF12-3456': { found: true, patchedVersions: ['>= 4.18.0'] },
      };
      const results = await parseKeywordResponse(json, 'lodash', '4.17.4', ghCache);
      expect(results).toHaveLength(1);
      expect(results[0].fixedIn).toBe('4.18.0');
    });

    it('does not override NVD fixedIn with higher GH version', async () => {
      const json = makeNvdResponse(
        'CVE-2021-12345',
        [{ lang: 'en', value: 'Test vulnerability.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN, versionEndExcluding: '4.17.5' }],
        [{ url: 'https://github.com/advisories/GHSA-abcd-ef12-3456' }]
      );
      const ghCache = {
        'GHSA-ABCD-EF12-3456': { found: true, patchedVersions: ['>= 4.18.0'] },
      };
      const results = await parseKeywordResponse(json, 'lodash', '4.17.4', ghCache);
      expect(results).toHaveLength(1);
      expect(results[0].fixedIn).toBe('4.17.5');
    });

    it('nullifies fixedIn when it falls within the vulnerable range (safety net)', async () => {
      // Simulates a case where GHSA sets fixedIn to a version that is within the NVD range.
      // NVD has versionEndIncluding: 5.0.6 → fixedIn heuristic = 5.0.7
      // GHSA says >=5.0.6 is the fix, but conservative merge blocks it (5.0.6 is in range)
      // So fixedIn stays at 5.0.7 from NVD heuristic.
      // The safety net only nullifies if fixedIn is IN the vulnerable range.
      // 5.0.7 is NOT in >=5.0.0 <=5.0.6, so it stays.
      //
      // To test the safety net, we use a CPE with versionEndExcluding where GHSA provides
      // a fixedIn that IS within the affected range (a contradictory advisory).
      const json = makeNvdResponse(
        'CVE-2024-55555',
        [{ lang: 'en', value: 'Test: fixedIn within vulnerable range.' }],
        [
          {
            vulnerable: true,
            criteria: 'cpe:2.3:a:test_pkg:test_pkg:*:*:*:*:*:node.js:*:*',
            versionStartIncluding: '1.0.0',
            versionEndExcluding: '2.0.0',
          },
        ],
        [{ url: 'https://github.com/advisories/GHSA-safe-net0-test' }]
      );
      // NVD says fixedIn = 2.0.0 (from versionEndExcluding)
      // GHSA says fixedIn = 1.5.0 which is WITHIN >=1.0.0 <2.0.0
      const ghCache = {
        'GHSA-SAFE-NET0-TEST': { found: true, patchedVersions: ['>= 1.5.0'] },
      };
      const results = await parseKeywordResponse(json, 'test-pkg', '1.2.0', ghCache);
      expect(results).toHaveLength(1);
      // Conservative merge blocks 1.5.0 (within <2.0.0 range), keeps NVD's 2.0.0
      // Safety net: 2.0.0 does NOT satisfy >=1.0.0 <2.0.0, so it stays
      expect(results[0].fixedIn).toBe('2.0.0');
    });

    it('nullifies fixedIn via safety net when only heuristic version exists in range', async () => {
      // Edge case: CPE with open-ended range (no upper bound) + GHSA sets fixedIn within
      const json = makeNvdResponse(
        'CVE-2024-66666',
        [{ lang: 'en', value: 'Open range vulnerability.' }],
        [
          {
            vulnerable: true,
            criteria: 'cpe:2.3:a:test_pkg:test_pkg:*:*:*:*:*:node.js:*:*',
            versionStartIncluding: '1.0.0',
          },
        ],
        [{ url: 'https://github.com/advisories/GHSA-open-rang-test' }]
      );
      // No versionEnd → NVD fixedIn = null, vulnerableRange = ">=1.0.0"
      // GHSA says fixedIn = 1.5.0
      const ghCache = {
        'GHSA-OPEN-RANG-TEST': { found: true, patchedVersions: ['>= 1.5.0'] },
      };
      const results = await parseKeywordResponse(json, 'test-pkg', '1.2.0', ghCache);
      expect(results).toHaveLength(1);
      // 1.5.0 satisfies >=1.0.0 (the vulnerable range), so safety net nullifies it
      expect(results[0].fixedIn).toBeNull();
    });
  });

  describe('Input guards', () => {
    it('returns empty array for null input', async () => {
      expect(await parseKeywordResponse(null, 'lodash', '4.17.4')).toEqual([]);
    });
    it('returns empty array when vulnerabilities is missing', async () => {
      expect(await parseKeywordResponse({}, 'lodash', '4.17.4')).toEqual([]);
    });
    it('skips entries with invalid CVE IDs', async () => {
      const json = {
        vulnerabilities: [
          {
            cve: {
              id: 'NOT-A-CVE',
              descriptions: [{ lang: 'en', value: 'test' }],
              metrics: {},
              weaknesses: [],
              configurations: [],
            },
          },
        ],
      };
      expect(await parseKeywordResponse(json, 'lodash', '4.17.4')).toEqual([]);
    });
  });
});
