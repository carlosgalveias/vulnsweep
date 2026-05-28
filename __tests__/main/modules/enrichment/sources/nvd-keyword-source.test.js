'use strict';

const {
  normalizePackageName,
  extractCpeProduct,
  cpeMatchesPackage,
  isVersionAffected,
  extractVersionRangeInfo,
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
