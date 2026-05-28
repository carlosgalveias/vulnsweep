'use strict';

const {
  normalizePackageName,
  extractCpeProduct,
  extractCpeVersion,
  cpeMatchesPackage,
  isVersionAffected,
  extractVersionRangeInfo,
  parseKeywordResponse,
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

describe('extractVersionRangeInfo()', () => {
  it('returns fixedIn from versionEndExcluding', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionEndExcluding: '4.17.5' }];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: '4.17.5',
      affectedVersionRange: '<4.17.5',
    });
  });
  it('returns fixedIn as next patch from versionEndIncluding', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionEndIncluding: '4.17.4' }];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: '4.17.5',
      affectedVersionRange: '<=4.17.4',
    });
  });
  it('returns null fixedIn when no upper bound', () => {
    const cpeMatches = [{ vulnerable: true, criteria: CPE_LODASH, versionStartIncluding: '4.0.0' }];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: null,
      affectedVersionRange: '>=4.0.0',
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
      affectedVersionRange: '>=4.0.0 <4.17.5',
    });
  });
  it('ignores CPE entries that do not match the package', () => {
    const cpeMatches = [
      { vulnerable: true, criteria: CPE_LANGSMITH, versionEndExcluding: '99.0.0' },
    ];
    expect(extractVersionRangeInfo('lodash', cpeMatches)).toEqual({
      fixedIn: null,
      affectedVersionRange: null,
    });
  });
  it('returns null both fields when no matching CPE entries', () => {
    expect(extractVersionRangeInfo('lodash', [])).toEqual({
      fixedIn: null,
      affectedVersionRange: null,
    });
  });
});

// ─── parseKeywordResponse() ───────────────────────────────────────────────────

function makeNvdResponse(cveId, descriptions, cpeMatches) {
  return {
    vulnerabilities: [
      {
        cve: {
          id: cveId,
          descriptions,
          metrics: {},
          weaknesses: [],
          configurations: cpeMatches ? [{ nodes: [{ cpeMatch: cpeMatches }] }] : [],
        },
      },
    ],
  };
}

describe('parseKeywordResponse()', () => {
  const CPE_LODASH_VULN = 'cpe:2.3:a:lodash:lodash:*:*:*:*:*:node.js:*:*';
  const CPE_LANGSMITH = 'cpe:2.3:a:langchain:langsmith_client:*:*:*:*:*:node.js:*:*';

  describe('CPE path (cpeMatches present)', () => {
    it('includes CVE when version is in affected range', () => {
      const json = makeNvdResponse(
        'CVE-2019-10744',
        [{ lang: 'en', value: 'Lodash prototype pollution via defaultsDeep.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN, versionEndExcluding: '4.17.5' }]
      );
      const results = parseKeywordResponse(json, 'lodash', '4.17.4');
      expect(results).toHaveLength(1);
      expect(results[0].cveId).toBe('CVE-2019-10744');
      expect(results[0].fixedIn).toBe('4.17.5');
      expect(results[0].affectedVersionRange).toBe('<4.17.5');
    });

    it('excludes CVE when version is above affected range', () => {
      const json = makeNvdResponse(
        'CVE-2019-10744',
        [{ lang: 'en', value: 'Lodash prototype pollution via defaultsDeep.' }],
        [{ vulnerable: true, criteria: CPE_LODASH_VULN, versionEndExcluding: '4.17.5' }]
      );
      const results = parseKeywordResponse(json, 'lodash', '4.18.1');
      expect(results).toHaveLength(0);
    });

    it('excludes CVE when CPE product does not match package name', () => {
      const json = makeNvdResponse(
        'CVE-2026-40190',
        [{ lang: 'en', value: 'LangSmith vulnerability affecting Node.js SDK.' }],
        [{ vulnerable: true, criteria: CPE_LANGSMITH, versionEndExcluding: '99.0.0' }]
      );
      // LangSmith CPE should NOT match lodash
      const results = parseKeywordResponse(json, 'lodash', '4.18.1');
      expect(results).toHaveLength(0);
    });
  });

  describe('No-CPE path (description-based fallback)', () => {
    it('includes CVE when description contains npm signals AND package name', () => {
      const json = makeNvdResponse(
        'CVE-2021-99999',
        [
          {
            lang: 'en',
            value: 'A vulnerability in lodash npm package allows prototype pollution.',
          },
        ],
        null
      );
      const results = parseKeywordResponse(json, 'lodash', '4.17.4');
      expect(results).toHaveLength(1);
      expect(results[0].cveId).toBe('CVE-2021-99999');
    });

    it('excludes CVE when description has npm signals but NOT the package name (false positive fix)', () => {
      // This is the LangSmith-type false positive: mentions node.js but not lodash
      const json = makeNvdResponse(
        'CVE-2026-40190',
        [
          {
            lang: 'en',
            value:
              'Improper access control in LangSmith Client for Node.js allows remote attackers to exfiltrate data.',
          },
        ],
        null
      );
      const results = parseKeywordResponse(json, 'lodash', '4.18.1');
      expect(results).toHaveLength(0);
    });

    it('excludes CVE when description has package name but NO npm signals', () => {
      const json = makeNvdResponse(
        'CVE-2025-11111',
        [
          {
            lang: 'en',
            value: 'A vulnerability in lodash allows arbitrary code execution on Windows.',
          },
        ],
        null
      );
      const results = parseKeywordResponse(json, 'lodash', '4.17.4');
      expect(results).toHaveLength(0);
    });

    it('excludes CVE when description is completely unrelated', () => {
      const json = makeNvdResponse(
        'CVE-2025-22222',
        [{ lang: 'en', value: 'Buffer overflow in FooBar Server 2.0 on Windows.' }],
        null
      );
      const results = parseKeywordResponse(json, 'lodash', '4.17.4');
      expect(results).toHaveLength(0);
    });

    it('is case-insensitive for package name matching', () => {
      const json = makeNvdResponse(
        'CVE-2021-88888',
        [
          {
            lang: 'en',
            value: 'Prototype pollution in Lodash npm package before version 4.17.21.',
          },
        ],
        null
      );
      const results = parseKeywordResponse(json, 'lodash', '4.17.4');
      expect(results).toHaveLength(1);
    });
  });

  describe('Input guards', () => {
    it('returns empty array for null input', () => {
      expect(parseKeywordResponse(null, 'lodash', '4.17.4')).toEqual([]);
    });
    it('returns empty array when vulnerabilities is missing', () => {
      expect(parseKeywordResponse({}, 'lodash', '4.17.4')).toEqual([]);
    });
    it('skips entries with invalid CVE IDs', () => {
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
      expect(parseKeywordResponse(json, 'lodash', '4.17.4')).toEqual([]);
    });
  });
});
