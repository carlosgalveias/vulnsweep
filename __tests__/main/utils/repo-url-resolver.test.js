'use strict';

// Mock https module
jest.mock('https', () => ({
  get: jest.fn(),
}));

const https = require('https');
const {
  parseGitHubUrl,
  resolveGitHubRepo,
  clearRepoCache,
  getRepoCacheSize,
} = require('../../../src/main/utils/repo-url-resolver');

/**
 * Helper to mock https.get with a JSON response body.
 */
function mockHttpsGet(statusCode, body) {
  https.get.mockImplementation((_url, _opts, cb) => {
    const res = {
      statusCode,
      on: jest.fn((event, handler) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify(body)));
        }
        if (event === 'end') {
          handler();
        }
      }),
      resume: jest.fn(),
    };
    cb(res);
    return { on: jest.fn(), destroy: jest.fn() };
  });
}

/**
 * Helper to mock https.get with an error.
 */
function mockHttpsGetError(errorMessage) {
  https.get.mockImplementation((_url, _opts, _cb) => {
    const req = {
      on: jest.fn((event, handler) => {
        if (event === 'error') {
          handler(new Error(errorMessage));
        }
      }),
      destroy: jest.fn(),
    };
    return req;
  });
}

describe('repo-url-resolver', () => {
  beforeEach(() => {
    clearRepoCache();
    jest.clearAllMocks();
  });

  describe('parseGitHubUrl()', () => {
    it('parses git+https://github.com/owner/repo.git', () => {
      const result = parseGitHubUrl('git+https://github.com/expressjs/morgan.git');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });

    it('parses https://github.com/owner/repo', () => {
      const result = parseGitHubUrl('https://github.com/expressjs/morgan');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });

    it('parses git://github.com/owner/repo.git', () => {
      const result = parseGitHubUrl('git://github.com/expressjs/morgan.git');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });

    it('parses git@github.com:owner/repo.git', () => {
      const result = parseGitHubUrl('git@github.com:expressjs/morgan.git');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });

    it('parses git@github.com:owner/repo (no .git suffix)', () => {
      const result = parseGitHubUrl('git@github.com:expressjs/morgan');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });

    it('parses github:owner/repo shorthand', () => {
      const result = parseGitHubUrl('github:expressjs/morgan');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });

    it('returns null for GitLab URLs', () => {
      const result = parseGitHubUrl('https://gitlab.com/owner/repo');
      expect(result).toBeNull();
    });

    it('returns null for Bitbucket URLs', () => {
      const result = parseGitHubUrl('https://bitbucket.org/owner/repo');
      expect(result).toBeNull();
    });

    it('returns null for null input', () => {
      expect(parseGitHubUrl(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseGitHubUrl(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseGitHubUrl('')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(parseGitHubUrl(123)).toBeNull();
    });

    it('handles URLs with trailing .git correctly', () => {
      const result = parseGitHubUrl('https://github.com/babel/babel.git');
      expect(result).toEqual({ owner: 'babel', repo: 'babel' });
    });

    it('handles scoped package repos (e.g. @babel/core → babel/babel)', () => {
      const result = parseGitHubUrl('git+https://github.com/babel/babel.git');
      expect(result).toEqual({ owner: 'babel', repo: 'babel' });
    });

    it('handles http:// protocol', () => {
      const result = parseGitHubUrl('http://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('returns null for github.com without owner/repo path', () => {
      const result = parseGitHubUrl('https://github.com');
      expect(result).toBeNull();
    });

    it('returns null for github.com with only owner', () => {
      const result = parseGitHubUrl('https://github.com/owner');
      expect(result).toBeNull();
    });
  });

  describe('resolveGitHubRepo()', () => {
    it('fetches and caches repo info from npm registry', async () => {
      mockHttpsGet(200, {
        name: 'morgan',
        repository: { type: 'git', url: 'git+https://github.com/expressjs/morgan.git' },
      });

      const result = await resolveGitHubRepo('morgan');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
      expect(getRepoCacheSize()).toBe(1);
    });

    it('returns cached result on second call (no HTTP)', async () => {
      mockHttpsGet(200, {
        name: 'morgan',
        repository: { type: 'git', url: 'git+https://github.com/expressjs/morgan.git' },
      });

      await resolveGitHubRepo('morgan');
      https.get.mockClear();

      const result = await resolveGitHubRepo('morgan');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
      expect(https.get).not.toHaveBeenCalled();
    });

    it('caches null for packages without repository field', async () => {
      mockHttpsGet(200, { name: 'no-repo-pkg' });

      const result = await resolveGitHubRepo('no-repo-pkg');
      expect(result).toBeNull();
      expect(getRepoCacheSize()).toBe(1);

      // Second call uses cache
      https.get.mockClear();
      const result2 = await resolveGitHubRepo('no-repo-pkg');
      expect(result2).toBeNull();
      expect(https.get).not.toHaveBeenCalled();
    });

    it('caches null for packages with non-GitHub repos', async () => {
      mockHttpsGet(200, {
        name: 'gitlab-pkg',
        repository: { type: 'git', url: 'https://gitlab.com/owner/repo.git' },
      });

      const result = await resolveGitHubRepo('gitlab-pkg');
      expect(result).toBeNull();
    });

    it('returns null on 404 from registry', async () => {
      https.get.mockImplementation((_url, _opts, cb) => {
        const res = {
          statusCode: 404,
          resume: jest.fn(),
          on: jest.fn(),
        };
        cb(res);
        return { on: jest.fn(), destroy: jest.fn() };
      });

      const result = await resolveGitHubRepo('nonexistent-pkg');
      expect(result).toBeNull();
    });

    it('returns null on network error (never throws)', async () => {
      mockHttpsGetError('ECONNREFUSED');

      const result = await resolveGitHubRepo('error-pkg');
      expect(result).toBeNull();
    });

    it('handles repository field as string (not object)', async () => {
      mockHttpsGet(200, {
        name: 'string-repo-pkg',
        repository: 'github:expressjs/morgan',
      });

      const result = await resolveGitHubRepo('string-repo-pkg');
      expect(result).toEqual({ owner: 'expressjs', repo: 'morgan' });
    });
  });

  describe('clearRepoCache()', () => {
    it('clears all cached entries', async () => {
      mockHttpsGet(200, {
        name: 'morgan',
        repository: { type: 'git', url: 'git+https://github.com/expressjs/morgan.git' },
      });

      await resolveGitHubRepo('morgan');
      expect(getRepoCacheSize()).toBe(1);

      clearRepoCache();
      expect(getRepoCacheSize()).toBe(0);
    });
  });

  describe('getRepoCacheSize()', () => {
    it('returns 0 when cache is empty', () => {
      expect(getRepoCacheSize()).toBe(0);
    });

    it('returns correct count after multiple lookups', async () => {
      mockHttpsGet(200, {
        name: 'pkg1',
        repository: { type: 'git', url: 'https://github.com/owner/pkg1' },
      });

      await resolveGitHubRepo('pkg1');

      mockHttpsGet(200, {
        name: 'pkg2',
        repository: { type: 'git', url: 'https://github.com/owner/pkg2' },
      });

      await resolveGitHubRepo('pkg2');
      expect(getRepoCacheSize()).toBe(2);
    });
  });
});
