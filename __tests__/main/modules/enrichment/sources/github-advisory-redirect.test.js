'use strict';

const https = require('https');
const { PassThrough } = require('stream');

jest.mock('https');
jest.mock('../../../../../src/main/utils/github-rate-limiter', () => ({
  enqueue: (fn, signal) => fn(signal),
  setRateLimited: jest.fn(),
  isRateLimited: () => false,
  getQueueDepth: () => 0,
}));

jest.mock('../../../../../src/main/config/constants', () => ({
  ENRICHMENT_CONFIG: {
    GITHUB_TOKEN: 'ghp_test',
    USER_AGENT: 'VulnSweep-Test',
    GITHUB_ADVISORY_API_URL: 'https://api.github.com/advisories',
    ENRICHMENT_TIMEOUT_MS: 5000,
  },
  GIT_CONFIG: {
    GITHUB_MAX_RETRIES: 2,
    GITHUB_RETRY_BASE_DELAY_MS: 100,
    GITHUB_RETRY_JITTER_MS: 50,
    GITHUB_RETRY_MAX_DELAY_MS: 1000,
  },
}));

const {
  queryRepoLevelAdvisories,
} = require('../../../../../src/main/modules/enrichment/sources/github-advisory-source');

function mockHttpsResponse(statusCode, body, headers = {}) {
  const response = new PassThrough();
  response.statusCode = statusCode;
  response.headers = headers;

  const req = new PassThrough();
  req.setTimeout = jest.fn();
  req.destroy = jest.fn();
  req.end = jest.fn(() => {
    process.nextTick(() => {
      const callback = https.request.mock.calls[https.request.mock.calls.length - 1][1];
      callback(response);
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });

  https.request.mockReturnValueOnce(req);
  return req;
}

describe('httpsGet redirect handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('follows a 301 redirect and resolves with final response', async () => {
    mockHttpsResponse(301, '{"message":"Moved Permanently"}', {
      location:
        'https://api.github.com/repositories/8507859/security-advisories?per_page=100&state=published',
    });
    mockHttpsResponse(200, JSON.stringify([]), {});

    const result = await queryRepoLevelAdvisories('dcodeIO', 'protobuf.js');
    expect(result).toEqual([]);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it('follows a 302 redirect', async () => {
    mockHttpsResponse(302, '', {
      location:
        'https://api.github.com/repositories/12345/security-advisories?per_page=100&state=published',
    });
    mockHttpsResponse(200, JSON.stringify([]), {});

    const result = await queryRepoLevelAdvisories('old-owner', 'some-repo');
    expect(result).toEqual([]);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it('rejects after MAX_REDIRECTS exceeded', async () => {
    for (let i = 0; i < 4; i++) {
      mockHttpsResponse(301, '', {
        location: `https://api.github.com/redirect-${i}`,
      });
    }

    const result = await queryRepoLevelAdvisories('loop', 'forever');
    expect(result).toEqual([]);
  });

  it('treats redirect with no Location header as generic HTTP error', async () => {
    mockHttpsResponse(301, '{"message":"no location"}', {});

    const result = await queryRepoLevelAdvisories('broken', 'redirect');
    expect(result).toEqual([]);
  });
});
