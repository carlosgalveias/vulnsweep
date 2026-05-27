'use strict';

/**
 * Tests for src/main/modules/enrichment/sources/nvd-keyword-source.js
 *
 * Mocking strategy:
 *  - https module is mocked to control HTTP responses
 *  - nvd-source enrichment module is partially mocked:
 *      enqueueNvd: calls fn() immediately (no queueing)
 *      scoreToCvssCategory: real implementation used
 */

jest.mock('https');
jest.mock('../../../../../src/main/modules/enrichment/sources/nvd-source', () => ({
  enqueueNvd: jest.fn((fn) => fn()),
  scoreToCvssCategory: jest.requireActual(
    '../../../../../src/main/modules/enrichment/sources/nvd-source'
  ).scoreToCvssCategory,
}));

const { EventEmitter } = require('events');
const https = require('https');
const {
  queryNvdKeyword,
} = require('../../../../../src/main/modules/enrichment/sources/nvd-keyword-source');
const fixture = require('../../../../fixtures/nvd-keyword-response.json');

// ─── HTTP mock helpers ────────────────────────────────────────────────────────

/**
 * Creates a minimal mock of https.request that simulates a successful 200 response
 * with the provided JSON body.
 */
function mockHttpsSuccess(jsonBody) {
  https.request.mockImplementation((options, callback) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.setEncoding = jest.fn();

    const req = new EventEmitter();
    req.end = jest.fn(() => {
      callback(res);
      res.emit('data', JSON.stringify(jsonBody));
      res.emit('end');
    });
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();

    return req;
  });
}

/**
 * Creates a mock that returns a specific HTTP status code with optional body.
 */
function mockHttpsStatus(statusCode, body = '') {
  https.request.mockImplementation((options, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.setEncoding = jest.fn();

    const req = new EventEmitter();
    req.end = jest.fn(() => {
      callback(res);
      if (body) res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      res.emit('end');
    });
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();

    return req;
  });
}

/**
 * Creates a mock that rejects the request with a network error.
 */
function mockHttpsError(message) {
  https.request.mockImplementation((_options, _callback) => {
    const req = new EventEmitter();
    req.end = jest.fn(() => {
      req.emit('error', new Error(message));
    });
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();
    return req;
  });
}

// ─── Reset mocks before each test ─────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Group: queryNvdKeyword(pkg) input guards ─────────────────────────────────

describe('queryNvdKeyword() input guards', () => {
  it('1. returns [] for null pkg', async () => {
    const result = await queryNvdKeyword(null);
    expect(result).toEqual([]);
  });

  it('2. returns [] for pkg missing name', async () => {
    const result = await queryNvdKeyword({ version: '1.0.0' });
    expect(result).toEqual([]);
  });

  it('3. returns [] for pkg missing version', async () => {
    const result = await queryNvdKeyword({ name: 'postcss-selector-parser' });
    expect(result).toEqual([]);
  });

  it('4. does NOT call httpsGet when input guard fires', async () => {
    await queryNvdKeyword(null);
    expect(https.request).not.toHaveBeenCalled();
  });
});

// ─── Group: npm ecosystem filter ──────────────────────────────────────────────

describe('npm ecosystem filter', () => {
  const pkg = {
    name: 'postcss-selector-parser',
    version: '7.1.0',
    resolved:
      'https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-7.1.0.tgz',
  };

  it('5. returns result for CVE with "npm package" in description (entry 1 from fixture)', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results.some((r) => r.cveId === 'CVE-2026-9358')).toBe(true);
  });

  it('6. does NOT return result for CVE with no npm signals in description (entry 2 from fixture)', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results.some((r) => r.cveId === 'CVE-2020-99999')).toBe(false);
  });

  it('7. with fixture: returns exactly 1 result (only the npm-relevant CVE)', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results).toHaveLength(1);
    expect(results[0].cveId).toBe('CVE-2026-9358');
  });
});

// ─── Group: CVSS 4.0 priority ─────────────────────────────────────────────────

describe('CVSS 4.0 priority', () => {
  const pkg = {
    name: 'postcss-selector-parser',
    version: '7.1.0',
    resolved:
      'https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-7.1.0.tgz',
  };

  it('8. when fixture entry has both cvssMetricV40 (2.1) and cvssMetricV31 (4.3), cvssScore MUST be 2.1', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0].cvssScore).toBe(2.1);
  });

  it('9. result cvssVector must be the V4.0 vector string', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0].cvssVector).toBe(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N'
    );
  });

  it('10. result cvssCategory must be "LOW" for score 2.1', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0].cvssCategory).toBe('LOW');
  });
});

// ─── Group: version filtering with CPE data ───────────────────────────────────

describe('version filtering with CPE data', () => {
  function makeFixtureWithCpe(cpeBounds) {
    return {
      vulnerabilities: [
        {
          cve: {
            id: 'CVE-2026-9358',
            descriptions: [
              { lang: 'en', value: 'A vulnerability in the npm package postcss-selector-parser.' },
            ],
            metrics: {
              cvssMetricV31: [
                {
                  source: 'nvd@nist.gov',
                  type: 'Primary',
                  cvssData: {
                    version: '3.1',
                    vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:L',
                    baseScore: 4.3,
                    baseSeverity: 'MEDIUM',
                  },
                },
              ],
            },
            weaknesses: [],
            configurations: [
              {
                nodes: [
                  {
                    operator: 'OR',
                    negate: false,
                    cpeMatch: [
                      {
                        vulnerable: true,
                        criteria: 'cpe:2.3:a:postcss:postcss-selector-parser:*:*:*:*:*:node.js:*:*',
                        ...cpeBounds,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    };
  }

  const pkgBase = { name: 'pkg', version: '1.0.0', resolved: 'https://r.example.com' };

  it('11. version 7.1.0 against versionEndIncluding 7.1.1 returns the CVE', async () => {
    mockHttpsSuccess(makeFixtureWithCpe({ versionEndIncluding: '7.1.1' }));
    const results = await queryNvdKeyword({ ...pkgBase, version: '7.1.0' });
    expect(results).toHaveLength(1);
  });

  it('12. version 7.1.2 against versionEndIncluding 7.1.1 does NOT return the CVE', async () => {
    mockHttpsSuccess(makeFixtureWithCpe({ versionEndIncluding: '7.1.1' }));
    const results = await queryNvdKeyword({ ...pkgBase, version: '7.1.2' });
    expect(results).toHaveLength(0);
  });

  it('13. version 7.1.1 against versionEndIncluding 7.1.1 returns the CVE (inclusive boundary)', async () => {
    mockHttpsSuccess(makeFixtureWithCpe({ versionEndIncluding: '7.1.1' }));
    const results = await queryNvdKeyword({ ...pkgBase, version: '7.1.1' });
    expect(results).toHaveLength(1);
  });

  it('14. version 7.1.1 against versionEndExcluding 7.1.1 does NOT return the CVE (exclusive)', async () => {
    mockHttpsSuccess(makeFixtureWithCpe({ versionEndExcluding: '7.1.1' }));
    const results = await queryNvdKeyword({ ...pkgBase, version: '7.1.1' });
    expect(results).toHaveLength(0);
  });

  it('15. when cpeMatches is empty and npm filter passes: CVE IS included (conservative)', async () => {
    const noConfigFixture = {
      vulnerabilities: [
        {
          cve: {
            id: 'CVE-2026-9358',
            descriptions: [
              { lang: 'en', value: 'Affects the npm package postcss-selector-parser.' },
            ],
            metrics: {},
            weaknesses: [],
            configurations: [],
          },
        },
      ],
    };
    mockHttpsSuccess(noConfigFixture);
    const results = await queryNvdKeyword({ ...pkgBase, version: '1.0.0' });
    expect(results).toHaveLength(1);
  });

  it('16. versionStartIncluding lower bound: version below start is excluded', async () => {
    mockHttpsSuccess(
      makeFixtureWithCpe({ versionStartIncluding: '5.0.0', versionEndIncluding: '8.0.0' })
    );
    const results = await queryNvdKeyword({ ...pkgBase, version: '4.9.9' });
    expect(results).toHaveLength(0);
  });

  it('17. versionStartExcluding lower bound: version equal to start is excluded (exclusive)', async () => {
    mockHttpsSuccess(
      makeFixtureWithCpe({ versionStartExcluding: '5.0.0', versionEndIncluding: '8.0.0' })
    );
    const results = await queryNvdKeyword({ ...pkgBase, version: '5.0.0' });
    expect(results).toHaveLength(0);
  });
});

// ─── Group: result shape ──────────────────────────────────────────────────────

describe('result shape', () => {
  const pkg = {
    name: 'postcss-selector-parser',
    version: '7.1.0',
    resolved:
      'https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-7.1.0.tgz',
  };

  it('18. result object has all required fields', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0]).toHaveProperty('cveId');
    expect(results[0]).toHaveProperty('cvssScore');
    expect(results[0]).toHaveProperty('cvssVector');
    expect(results[0]).toHaveProperty('cvssCategory');
    expect(results[0]).toHaveProperty('cweIds');
    expect(results[0]).toHaveProperty('url');
    expect(results[0]).toHaveProperty('description');
  });

  it('19. cweIds array contains "CWE-674" from fixture', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0].cweIds).toContain('CWE-674');
  });

  it('20. url is "https://nvd.nist.gov/vuln/detail/CVE-2026-9358"', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0].url).toBe('https://nvd.nist.gov/vuln/detail/CVE-2026-9358');
  });

  it('21. description contains the fixture description string', async () => {
    mockHttpsSuccess(fixture);
    const results = await queryNvdKeyword(pkg);
    expect(results[0].description).toContain('postcss-selector-parser npm package up to 7.1.1');
  });
});

// ─── Group: HTTP and retry behavior ──────────────────────────────────────────

describe('HTTP and retry behavior', () => {
  const pkg = {
    name: 'postcss-selector-parser',
    version: '7.1.0',
    resolved:
      'https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-7.1.0.tgz',
  };

  it('22. when httpsGet returns null (404 simulation): returns []', async () => {
    mockHttpsStatus(404);
    const results = await queryNvdKeyword(pkg);
    expect(results).toEqual([]);
  });

  it('23. when httpsGet returns empty vulnerabilities array: returns []', async () => {
    mockHttpsSuccess({ resultsPerPage: 0, startIndex: 0, totalResults: 0, vulnerabilities: [] });
    const results = await queryNvdKeyword(pkg);
    expect(results).toEqual([]);
  });

  it('24. never throws — errors are caught and return []', async () => {
    mockHttpsError('Connection refused');
    await expect(queryNvdKeyword(pkg)).resolves.toEqual([]);
  });
});
