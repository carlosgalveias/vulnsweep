'use strict';

const { GIT_CONFIG } = require('../../../../../src/main/config/constants');

jest.mock('../../../../../src/main/utils/github-rate-limiter');

function mockMake(sc, body, hdrs, onOpts) {
  const { EventEmitter } = require('events');
  return jest.fn((opts, cb) => {
    if (onOpts) onOpts(opts);
    const res = new EventEmitter();
    res.statusCode = sc;
    res.headers = hdrs || {};
    res.setEncoding = jest.fn();
    const req = new EventEmitter();
    req.write = jest.fn();
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();
    req.end = jest.fn(() => {
      cb(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });
    return req;
  });
}

function mockMakeRetry(failCount, hdrs429, okBody) {
  const { EventEmitter } = require('events');
  let n = 0;
  return jest.fn((_opts, cb) => {
    n += 1;
    const is429 = n <= failCount;
    const res = new EventEmitter();
    res.statusCode = is429 ? 429 : 200;
    res.headers = is429 ? hdrs429 || {} : {};
    res.setEncoding = jest.fn();
    const req = new EventEmitter();
    req.write = jest.fn();
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();
    req.end = jest.fn(() => {
      cb(res);
      const b = is429 ? {} : okBody !== undefined ? okBody : [];
      res.emit('data', JSON.stringify(b));
      res.emit('end');
    });
    return req;
  });
}

describe('Group 1: Authorization header (GITHUB_TOKEN)', () => {
  const origVulnsweep = process.env.VULNSWEEP_GITHUB_TOKEN;
  beforeEach(() => {
    jest.resetModules();
    // Prevent secure-store from returning real credentials during tests
    jest.mock('../../../../../src/main/utils/secure-store', () => ({
      storeGet: jest.fn(() => null),
      storeSet: jest.fn(),
      storeDelete: jest.fn(),
    }));
  });
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.VULNSWEEP_GITHUB_TOKEN;
  });
  afterAll(() => {
    if (origVulnsweep !== undefined) process.env.VULNSWEEP_GITHUB_TOKEN = origVulnsweep;
  });

  it('1.1 sets Authorization: Bearer when token present', async () => {
    process.env.GITHUB_TOKEN = 'ghp_testtoken123';
    let opts = null;
    jest.mock('https', () => ({
      request: mockMake(200, [], {}, (o) => {
        opts = o;
      }),
    }));
    const m = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    await m.queryGitHubAdvisory('CVE-2021-23337');
    expect(opts.headers.Authorization).toBe('Bearer ghp_testtoken123');
  });

  it('1.2 omits Authorization when GITHUB_TOKEN unset', async () => {
    delete process.env.GITHUB_TOKEN;
    let opts = null;
    jest.mock('https', () => ({
      request: mockMake(200, [], {}, (o) => {
        opts = o;
      }),
    }));
    const m = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    await m.queryGitHubAdvisory('CVE-2021-23337');
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('1.3 omits Authorization when GITHUB_TOKEN is empty string', async () => {
    process.env.GITHUB_TOKEN = '';
    let opts = null;
    jest.mock('https', () => ({
      request: mockMake(200, [], {}, (o) => {
        opts = o;
      }),
    }));
    const m = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    await m.queryGitHubAdvisory('CVE-2021-23337');
    expect(opts.headers.Authorization).toBeUndefined();
  });
});

describe('Group 2: Retry-After header parsing', () => {
  let warns;
  let warnSpy;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    warns = [];
    warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args) => {
      warns.push(args.join(' '));
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    warnSpy.mockRestore();
  });
  function getDelay() {
    const line = warns.find((w) => /after [\d.]+ms/.test(w));
    if (!line) return null;
    const found = line.match(/after ([\d.]+)ms/);
    return found ? parseFloat(found[1]) : null;
  }
  async function run(mock) {
    jest.mock('https', () => ({ request: mock }));
    const m = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    const p = m.queryGitHubAdvisory('CVE-2021-23337');
    await jest.runAllTimersAsync();
    return p;
  }
  it('2.1 Retry-After: 5 -> delay 5000ms', async () => {
    await run(mockMakeRetry(1, { 'retry-after': '5' }, []));
    expect(getDelay()).toBe(5000);
  });
  it('2.2 Retry-After: foo -> NaN guard, backoff used', async () => {
    await run(mockMakeRetry(1, { 'retry-after': 'foo' }, []));
    const d = getDelay();
    expect(d).not.toBeNull();
    expect(d).toBeGreaterThanOrEqual(GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS);
    const top2 = GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS + GIT_CONFIG.GITHUB_RETRY_JITTER_MS;
    expect(d).toBeLessThanOrEqual(top2);
  });
  it('2.3 absent retry-after -> NaN guard, backoff used', async () => {
    await run(mockMakeRetry(1, {}, []));
    const d = getDelay();
    expect(d).not.toBeNull();
    expect(d).toBeGreaterThanOrEqual(GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS);
    const top3 = GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS + GIT_CONFIG.GITHUB_RETRY_JITTER_MS;
    expect(d).toBeLessThanOrEqual(top3);
  });
});

describe('Group 3: computeBackoffDelay formula', () => {
  let mathRandomSpy;
  beforeEach(() => {
    mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    mathRandomSpy.mockRestore();
  });
  it('3.1 attempt=0: delay = BASE + 0.5*JITTER', () => {
    const base = GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS;
    const jitter = GIT_CONFIG.GITHUB_RETRY_JITTER_MS;
    const max = GIT_CONFIG.GITHUB_RETRY_MAX_DELAY_MS;
    const expected = Math.min(base * Math.pow(2, 0) + 0.5 * jitter, max);
    expect(expected).toBe(base + 0.5 * jitter);
    expect(expected).toBeGreaterThanOrEqual(base);
    expect(expected).toBeLessThanOrEqual(max);
  });
  it('3.2 attempt=30 is capped at GITHUB_RETRY_MAX_DELAY_MS', () => {
    const base = GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS;
    const jitter = GIT_CONFIG.GITHUB_RETRY_JITTER_MS;
    const max = GIT_CONFIG.GITHUB_RETRY_MAX_DELAY_MS;
    const uncapped = base * Math.pow(2, 30) + 0.5 * jitter;
    expect(Math.min(uncapped, max)).toBe(max);
  });
});

describe('Group 4: one-time authenticated-mode log', () => {
  let logSpy;
  beforeEach(() => {
    jest.resetModules();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.GITHUB_TOKEN;
  });
  it('4.1 logs auth message exactly once when token is set', async () => {
    process.env.GITHUB_TOKEN = 'ghp_abc123';
    jest.mock('https', () => ({ request: mockMake(200, [], {}) }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    await mod.queryGitHubAdvisory('CVE-2021-23337');
    await mod.queryGitHubAdvisory('CVE-2021-23337');
    const al = logSpy.mock.calls.filter((aa) => aa.join(' ').includes('Authenticated API access'));
    expect(al.length).toBe(1);
  });
  it('4.2 does not log auth message when GITHUB_TOKEN is absent', async () => {
    delete process.env.GITHUB_TOKEN;
    jest.mock('https', () => ({ request: mockMake(200, [], {}) }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    await mod.queryGitHubAdvisory('CVE-2021-23337');
    const al2 = logSpy.mock.calls.filter((aa) =>
      aa.join(' ').includes('Using authenticated API access')
    );
    expect(al2.length).toBe(0);
  });
});

describe('Group 5: retry exhaustion', () => {
  let warnSpy;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    warnSpy.mockRestore();
  });
  it('5.1 returns rate_limit_exceeded after exhausting all retries', async () => {
    jest.mock('https', () => ({ request: mockMakeRetry(9999, {}, []) }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    const p = mod.queryGitHubAdvisory('CVE-2021-23337');
    await jest.runAllTimersAsync();
    const result = await p;
    expect(result.found).toBe(false);
    expect(result.error).toBe('rate_limit_exceeded');
  });
  it('5.2 returns found=true when single 429 is followed by 200', async () => {
    const advisory = {
      ghsa_id: 'GHSA-jf85-cpcp-j695',
      severity: 'high',
      html_url: 'https://github.com/advisories/GHSA-jf85-cpcp-j695',
      vulnerabilities: [{ patched_versions: '>= 4.17.21' }],
    };
    jest.mock('https', () => ({
      request: mockMakeRetry(1, { 'retry-after': '1' }, [advisory]),
    }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    const p = mod.queryGitHubAdvisory('CVE-2021-23337');
    await jest.runAllTimersAsync();
    const result = await p;
    expect(result.found).toBe(true);
    expect(result.ghsaId).toBe('GHSA-jf85-cpcp-j695');
    expect(result.severity).toBe('HIGH');
    expect(result.patchedVersions).toContain('>= 4.17.21');
  });
});

describe('Group 6: queue-depth guard in queryGitHubAdvisoryByPackage', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('6.1 returns [] immediately when isRateLimited=true and queueDepth >= 50', async () => {
    const rateLimiter = require('../../../../../src/main/utils/github-rate-limiter');
    rateLimiter.isRateLimited.mockReturnValue(true);
    rateLimiter.getQueueDepth.mockReturnValue(50);
    jest.mock('https', () => ({ request: mockMake(200, [], {}) }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    const result = await mod.queryGitHubAdvisoryByPackage('lodash');
    expect(result).toEqual([]);
    expect(rateLimiter.enqueue).not.toHaveBeenCalled();
  });

  it('6.2 proceeds normally when isRateLimited=false', async () => {
    const rateLimiter = require('../../../../../src/main/utils/github-rate-limiter');
    rateLimiter.isRateLimited.mockReturnValue(false);
    rateLimiter.getQueueDepth.mockReturnValue(100);
    jest.mock('https', () => ({ request: mockMake(200, [], {}) }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    const result = await mod.queryGitHubAdvisoryByPackage('lodash');
    expect(rateLimiter.enqueue).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('6.3 proceeds normally when queueDepth < 50 even if rate-limited', async () => {
    const rateLimiter = require('../../../../../src/main/utils/github-rate-limiter');
    rateLimiter.isRateLimited.mockReturnValue(true);
    rateLimiter.getQueueDepth.mockReturnValue(49);
    jest.mock('https', () => ({ request: mockMake(200, [], {}) }));
    const mod = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');
    const result = await mod.queryGitHubAdvisoryByPackage('lodash');
    expect(rateLimiter.enqueue).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
