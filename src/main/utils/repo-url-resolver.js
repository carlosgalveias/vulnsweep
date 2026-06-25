'use strict';

const https = require('https');
const { DEP_UPDATES_CONFIG } = require('../config/constants');

/**
 * In-memory cache: packageName → { owner, repo } | null
 * Persists for the lifetime of the process (single scan session).
 * Null entries are cached to avoid repeated failed lookups.
 * @type {Map<string, {owner: string, repo: string} | null>}
 */
const _repoCache = new Map();

/**
 * Known GitHub URL patterns from npm registry's repository.url field:
 *   - "git+https://github.com/owner/repo.git"
 *   - "https://github.com/owner/repo"
 *   - "git://github.com/owner/repo.git"
 *   - "git@github.com:owner/repo.git"
 *   - "github:owner/repo"
 *
 * @param {string} repoUrl - Raw repository.url from npm registry
 * @returns {{owner: string, repo: string} | null}
 */
function parseGitHubUrl(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') return null;

  // Normalize: remove trailing .git, strip git+ prefix, strip git:// prefix
  let url = repoUrl.trim();

  // Handle shorthand "github:owner/repo"
  const shorthandMatch = url.match(/^github:([^/]+)\/([^/]+)$/i);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2].replace(/\.git$/, '') };
  }

  // Handle SSH format "git@github.com:owner/repo.git"
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // Handle HTTPS/git+https/git:// formats
  // Strip prefixes: "git+https://", "git://", "https://", "http://"
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://');

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;

    // pathname = "/owner/repo" or "/owner/repo.git"
    const parts = parsed.pathname
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    if (parts.length < 2) return null;

    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

/**
 * Fetches the repository.url field from npm registry metadata for a package.
 * Uses GET /<package> with Accept: application/json. The top-level
 * `repository` field is always present at the packument root level.
 *
 * @param {string} packageName
 * @returns {Promise<{owner: string, repo: string} | null>}
 */
async function fetchRepoFromRegistry(packageName) {
  return new Promise((resolve) => {
    const url = `${DEP_UPDATES_CONFIG.REGISTRY_URL}/${encodeURIComponent(packageName)}`;

    const req = https.get(
      url,
      {
        timeout: 5000,
        headers: {
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode === 404 || res.statusCode >= 400) {
          res.resume(); // drain
          resolve(null);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const repoField = body.repository;
            if (!repoField) {
              resolve(null);
              return;
            }
            // repository can be string or { type, url, directory }
            const repoUrl = typeof repoField === 'string' ? repoField : repoField.url;
            resolve(parseGitHubUrl(repoUrl));
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Resolve an npm package name to its GitHub owner/repo.
 * Results are cached in-memory (Map) for the scan session lifetime.
 *
 * @param {string} packageName - npm package name (e.g. "morgan", "@babel/core")
 * @returns {Promise<{owner: string, repo: string} | null>}
 */
async function resolveGitHubRepo(packageName) {
  if (_repoCache.has(packageName)) {
    return _repoCache.get(packageName);
  }

  const result = await fetchRepoFromRegistry(packageName);
  _repoCache.set(packageName, result);
  return result;
}

/**
 * Clear the in-memory repo cache. Call on scan reset/cancel.
 */
function clearRepoCache() {
  _repoCache.clear();
}

/**
 * Get cache size for telemetry/debugging.
 * @returns {number}
 */
function getRepoCacheSize() {
  return _repoCache.size;
}

module.exports = {
  resolveGitHubRepo,
  parseGitHubUrl,
  clearRepoCache,
  getRepoCacheSize,
  // Exported for testing only:
  _fetchRepoFromRegistry: fetchRepoFromRegistry,
};
