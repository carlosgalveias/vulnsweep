'use strict';

/**
 * Tests for src/main/modules/scanner/sources/nvd-source.js
 *
 * Mocking strategy:
 *  - nvd-keyword-source enrichment module is fully mocked
 *  - queryNvdKeyword is a jest.fn() that returns controlled hit arrays
 */

jest.mock('../../../../../src/main/modules/enrichment/sources/nvd-keyword-source', () => ({
  queryNvdKeyword: jest.fn(),
}));

const {
  queryNvdKeyword,
} = require('../../../../../src/main/modules/enrichment/sources/nvd-keyword-source');
const { query, SOURCE_ID } = require('../../../../../src/main/modules/scanner/sources/nvd-source');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePkg(overrides) {
  return Object.assign(
    {
      name: 'postcss-selector-parser',
      version: '7.1.0',
      resolved:
        'https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-7.1.0.tgz',
    },
    overrides
  );
}

function makeHit(overrides) {
  return Object.assign(
    {
      cveId: 'CVE-2026-9358',
      cvssScore: 2.1,
      cvssVector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N',
      cvssCategory: 'LOW',
      cweIds: ['CWE-674'],
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-9358',
      description: 'A vulnerability was found in postcss-selector-parser npm package up to 7.1.1.',
      fixedIn: null,
      vulnerableRange: null,
    },
    overrides
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Group: input guards ──────────────────────────────────────────────────────

describe('query() input guards', () => {
  it('1. returns [] for null pkg', async () => {
    const result = await query(null);
    expect(result).toEqual([]);
  });

  it('2. returns [] for pkg with no version', async () => {
    const result = await query(makePkg({ version: undefined }));
    expect(result).toEqual([]);
  });

  it('3. returns [] for pkg with resolved: null (git/local package)', async () => {
    const result = await query(makePkg({ resolved: null }));
    expect(result).toEqual([]);
  });

  it('4. does NOT call queryNvdKeyword when input guard fires', async () => {
    await query(null);
    expect(queryNvdKeyword).not.toHaveBeenCalled();
  });
});

// ─── Group: SOURCE_ID ─────────────────────────────────────────────────────────

describe('SOURCE_ID', () => {
  it('5. SOURCE_ID is "nvd"', () => {
    expect(SOURCE_ID).toBe('nvd');
  });
});

// ─── Group: normal operation ──────────────────────────────────────────────────

describe('query() normal operation', () => {
  it('6. returns [] when queryNvdKeyword returns []', async () => {
    queryNvdKeyword.mockResolvedValue([]);
    const result = await query(makePkg());
    expect(result).toEqual([]);
  });

  it('7. returns [] when queryNvdKeyword returns null', async () => {
    queryNvdKeyword.mockResolvedValue(null);
    const result = await query(makePkg());
    expect(result).toEqual([]);
  });

  it('8. returns 1 SourceResult when queryNvdKeyword returns 1 hit', async () => {
    queryNvdKeyword.mockResolvedValue([makeHit()]);
    const result = await query(makePkg());
    expect(result).toHaveLength(1);
  });
});

// ─── Group: SourceResult shape ────────────────────────────────────────────────

describe('SourceResult shape', () => {
  let result;

  beforeEach(async () => {
    queryNvdKeyword.mockResolvedValue([makeHit()]);
    const results = await query(makePkg());
    result = results[0];
  });

  it('9.  sourceId is "nvd"', () => {
    expect(result.sourceId).toBe('nvd');
  });

  it('10. packageName is pkg.name', () => {
    expect(result.packageName).toBe('postcss-selector-parser');
  });

  it('11. packageVersion is pkg.version', () => {
    expect(result.packageVersion).toBe('7.1.0');
  });

  it('12. cveIds is ["CVE-2026-9358"] when hit has cveId: "CVE-2026-9358"', () => {
    expect(result.cveIds).toEqual(['CVE-2026-9358']);
  });

  it('13. aliases is always []', () => {
    expect(result.aliases).toEqual([]);
  });

  it('14. cisaKnownExploited is always false', () => {
    expect(result.cisaKnownExploited).toBe(false);
  });

  it('15. epssScore is always null', () => {
    expect(result.epssScore).toBeNull();
  });

  it('16. epssPercentile is always null', () => {
    expect(result.epssPercentile).toBeNull();
  });

  it('17a. fixedIn is propagated from hit when hit.fixedIn is a string', async () => {
    queryNvdKeyword.mockResolvedValue([makeHit({ fixedIn: '4.17.5' })]);
    const results = await query(makePkg());
    expect(results[0].fixedIn).toBe('4.17.5');
  });

  it('17b. fixedIn is null when hit.fixedIn is null', async () => {
    queryNvdKeyword.mockResolvedValue([makeHit({ fixedIn: null })]);
    const results = await query(makePkg());
    expect(results[0].fixedIn).toBeNull();
  });

  it('17c. vulnerableRange is propagated from hit into rawData.nvd', async () => {
    queryNvdKeyword.mockResolvedValue([
      makeHit({ fixedIn: '4.17.5', vulnerableRange: '>=4.0.0 <4.17.5' }),
    ]);
    const results = await query(makePkg());
    expect(results[0].rawData.nvd.vulnerableRange).toBe('>=4.0.0 <4.17.5');
  });

  it('17d. vulnerableRange is null in rawData when hit carries no range', async () => {
    queryNvdKeyword.mockResolvedValue([makeHit({ vulnerableRange: null })]);
    const results = await query(makePkg());
    expect(results[0].rawData.nvd.vulnerableRange).toBeNull();
  });

  it('17e. vulnerableRange is propagated from hit when hit.vulnerableRange is a string', async () => {
    queryNvdKeyword.mockResolvedValue([
      makeHit({ fixedIn: '4.17.5', vulnerableRange: '>=4.0.0 <4.17.5' }),
    ]);
    const results = await query(makePkg());
    expect(results[0].vulnerableRange).toBe('>=4.0.0 <4.17.5');
  });

  it('17f. vulnerableRange is null when hit.vulnerableRange is null', async () => {
    queryNvdKeyword.mockResolvedValue([makeHit({ vulnerableRange: null })]);
    const results = await query(makePkg());
    expect(results[0].vulnerableRange).toBeNull();
  });

  it('18. rawData is { nvd: hit }', async () => {
    const hit = makeHit();
    queryNvdKeyword.mockResolvedValue([hit]);
    const results = await query(makePkg());
    expect(results[0].rawData).toEqual({ nvd: hit });
  });
});

// ─── Group: severity mapping ──────────────────────────────────────────────────

describe('severity mapping via severityFromCvssCategory()', () => {
  async function querySeverity(cvssCategory) {
    queryNvdKeyword.mockResolvedValue([makeHit({ cvssCategory })]);
    const results = await query(makePkg());
    return results[0].severity;
  }

  it('19. CRITICAL -> "critical"', async () => {
    expect(await querySeverity('CRITICAL')).toBe('critical');
  });

  it('20. HIGH -> "high"', async () => {
    expect(await querySeverity('HIGH')).toBe('high');
  });

  it('21. MEDIUM -> "moderate" (NOT "medium")', async () => {
    expect(await querySeverity('MEDIUM')).toBe('moderate');
  });

  it('22. LOW -> "low"', async () => {
    expect(await querySeverity('LOW')).toBe('low');
  });

  it('23. null -> "unknown"', async () => {
    expect(await querySeverity(null)).toBe('unknown');
  });
});

// ─── Group: error handling ────────────────────────────────────────────────────

describe('query() error handling', () => {
  it('24. when queryNvdKeyword throws: returns [] without propagating the error', async () => {
    queryNvdKeyword.mockRejectedValue(new Error('Network failure'));
    const result = await query(makePkg());
    expect(result).toEqual([]);
  });

  it('25. never throws under any input condition', async () => {
    queryNvdKeyword.mockRejectedValue(new Error('Unexpected error'));
    await expect(query(makePkg())).resolves.toBeDefined();
  });
});
