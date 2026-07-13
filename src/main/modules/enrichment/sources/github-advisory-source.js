'use strict';

/**
 * VulnSweep - GitHub Advisory Database Source Module
 *
 * Queries the GitHub Advisory REST API.
 * Authentication is optional: when ENRICHMENT_CONFIG.GITHUB_TOKEN is set
 * (checked via secure store first, then process.env.GITHUB_TOKEN — Feature B),
 * requests are authenticated (5,000 req/hr). Without it, unauthenticated
 * limits apply (60 req/hr).
 *
 * All HTTP requests are serialised through the singleton rate-limiter queue
 * (Feature C — src/main/utils/github-rate-limiter.js). When any request
 * receives a 429/403, it calls rateLimiter.setRateLimited() which causes ALL
 * pending queued requests to share a single backoff period — eliminating the
 * thundering-herd problem of independent per-request sleeps.
 *
 * Endpoint: GET https://api.github.com/advisories?cve_id=CVE-ID
 *        or: GET https://api.github.com/advisories/GHSA-ID
 *
 * GitHub API requires a User-Agent header (enforced by their servers).
 *
 * Return shape:
 * {
 *   found:           boolean,
 *   ghsaId:          string|null,
 *   severity:        string|null,
 *   patchedVersions: string[],
 *   url:             string|null,
 *   error?:          string
 * }
 */

const https = require('https');
const { ENRICHMENT_CONFIG, GIT_CONFIG } = require('../../../config/constants');
const rateLimiter = require('../../../utils/github-rate-limiter');

/** @type {boolean} Tracks whether the authenticated-mode startup log has been emitted. */
let _authLogEmitted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes exponential backoff delay with jitter.
 * @param {number} attempt - Zero-based attempt index (0 = first retry).
 * @returns {number} Delay in milliseconds, capped at GITHUB_RETRY_MAX_DELAY_MS.
 */
function computeBackoffDelay(attempt) {
  const exponential = GIT_CONFIG.GITHUB_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * GIT_CONFIG.GITHUB_RETRY_JITTER_MS;
  return Math.min(exponential + jitter, GIT_CONFIG.GITHUB_RETRY_MAX_DELAY_MS);
}

const MAX_REDIRECTS = 3;

function httpsGet(url, timeoutMs, signal, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request aborted'));
      return;
    }

    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': ENRICHMENT_CONFIG.USER_AGENT,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(ENRICHMENT_CONFIG.GITHUB_TOKEN
            ? { Authorization: `Bearer ${ENRICHMENT_CONFIG.GITHUB_TOKEN}` }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (signal?.aborted) {
            reject(new Error('Request aborted'));
            return;
          }
          // --- Handle HTTP redirects (301, 302, 307, 308) ---
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (_redirectCount >= MAX_REDIRECTS) {
              reject(new Error(`GitHub Advisory: too many redirects (max ${MAX_REDIRECTS})`));
              return;
            }
            const redirectUrl = new URL(res.headers.location, url).href;
            httpsGet(redirectUrl, timeoutMs, signal, _redirectCount + 1)
              .then(resolve)
              .catch(reject);
            return;
          }
          if (res.statusCode === 404) {
            resolve({ statusCode: res.statusCode, body: null });
            return;
          }
          if (res.statusCode === 429 || res.statusCode === 403) {
            const retryAfterHeader = res.headers['retry-after'];
            const err = new Error(`GitHub API rate limit: HTTP ${res.statusCode}`);
            err.isRateLimit = true;
            err.statusCode = res.statusCode;
            const parsedRetryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
            err.retryAfterMs = !Number.isNaN(parsedRetryAfter) ? parsedRetryAfter * 1000 : null;
            reject(err);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub Advisory HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error(`GitHub Advisory JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', (err) => {
      if (signal?.aborted) return;
      reject(err);
    });
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`GitHub Advisory timeout ${timeoutMs}ms`))
    );
    req.end();
  });
}

/**
 * Extract patched version strings from a GitHub advisory object.
 * GitHub REST advisories have a `vulnerabilities` array where each entry
 * contains `patched_versions` as a semver range string.
 * @param {Object} advisory
 * @returns {string[]}
 */
function extractPatchedVersions(advisory) {
  const versions = [];
  const vulns = advisory.vulnerabilities;
  if (!Array.isArray(vulns)) return versions;
  for (const v of vulns) {
    if (v.patched_versions && typeof v.patched_versions === 'string') {
      versions.push(v.patched_versions);
    }
  }
  return versions;
}

/**
 * Normalise a raw GitHub advisory object into our result shape.
 * @param {Object} advisory
 * @returns {{found: boolean, ghsaId: string|null, severity: string|null, patchedVersions: string[], url: string|null}}
 */
function normaliseAdvisory(advisory) {
  if (!advisory || typeof advisory !== 'object') {
    return { found: false, ghsaId: null, severity: null, patchedVersions: [], url: null };
  }
  return {
    found: true,
    ghsaId: advisory.ghsa_id || null,
    severity: advisory.severity ? advisory.severity.toUpperCase() : null,
    patchedVersions: extractPatchedVersions(advisory),
    url: advisory.html_url || advisory.url || null,
  };
}

async function queryGitHubAdvisory(id, signal) {
  if (ENRICHMENT_CONFIG.GITHUB_TOKEN && !_authLogEmitted) {
    _authLogEmitted = true;
    console.log('[GitHubAdvisory] Authenticated API access active (5,000 req/hr limit)');
  }

  const empty = { found: false, ghsaId: null, severity: null, patchedVersions: [], url: null };

  if (!id || typeof id !== 'string') {
    return { ...empty, error: 'Invalid or missing ID' };
  }

  const isCve = /^CVE-\d{4}-\d{4,}$/i.test(id);
  const isGhsa = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(id);

  if (!isCve && !isGhsa) {
    return { ...empty, error: 'ID must be a CVE or GHSA identifier' };
  }

  const url = isCve
    ? `${ENRICHMENT_CONFIG.GITHUB_ADVISORY_API_URL}?cve_id=${encodeURIComponent(id.toUpperCase())}`
    : `${ENRICHMENT_CONFIG.GITHUB_ADVISORY_API_URL}/${encodeURIComponent(id)}`;

  // Wrap the entire retry loop in enqueue() so all concurrent callers share
  // the same queue position and rate-limit state. When any queued request
  // triggers setRateLimited(), ALL pending requests wait together — one sleep,
  // not N independent sleeps (the thundering-herd fix).
  return rateLimiter.enqueue(async (sig) => {
    for (let attempt = 0; attempt <= GIT_CONFIG.GITHUB_MAX_RETRIES; attempt++) {
      if (sig?.aborted) {
        throw new Error('Request aborted');
      }

      try {
        const result = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS, sig);

        if (sig?.aborted) {
          throw new Error('Request aborted');
        }

        if (!result.body || result.statusCode === 404) {
          return empty;
        }

        // CVE search returns an array; GHSA direct lookup returns a single object
        if (Array.isArray(result.body)) {
          if (result.body.length === 0) return empty;
          return normaliseAdvisory(result.body[0]);
        }

        return normaliseAdvisory(result.body);
      } catch (err) {
        if (err.isRateLimit && attempt < GIT_CONFIG.GITHUB_MAX_RETRIES) {
          const delay = err.retryAfterMs != null ? err.retryAfterMs : computeBackoffDelay(attempt);
          // Signal the shared limiter so ALL queued requests wait together.
          // Any request already inside enqueue() that has not yet fired its
          // httpsGet() will pick up this _rateLimitedUntil value automatically.
          rateLimiter.setRateLimited(delay);
          console.warn(
            `[github] Rate limited (${err.statusCode || 429}), retry ${attempt + 1}/${GIT_CONFIG.GITHUB_MAX_RETRIES} after ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
        if (err.isRateLimit) {
          console.warn(
            `[github] Rate limit retries exhausted after ${GIT_CONFIG.GITHUB_MAX_RETRIES} attempts for ${id}`
          );
          return { ...empty, error: 'rate_limit_exceeded' };
        }
        console.warn(
          `[github-advisory-source] queryGitHubAdvisory error for ${id}: ${err.message}`
        );
        return { ...empty, error: err.message };
      }
    }
    // Exhausted all retries
    return { ...empty, error: 'rate_limit_exceeded' };
  }, signal);
}

/**
 * Queries GitHub Advisory API for all advisories affecting a specific npm package.
 * Uses the ?affects= parameter for package-level discovery — independent of OSV.
 *
 * Endpoint: GET https://api.github.com/advisories?ecosystem=npm&affects=<packageName>
 *
 * Returns raw advisory objects from the GitHub API. Each advisory has:
 *   - ghsa_id: string
 *   - cve_id: string|null
 *   - severity: string
 *   - summary: string
 *   - html_url: string
 *   - vulnerabilities[]: { package: { ecosystem, name }, vulnerable_version_range, patched_versions, ... }
 *
 * Rate limiting: uses the same rateLimiter.enqueue() mechanism — adds ONE API call per package.
 *
 * @param {string} packageName - npm package name
 * @param {AbortSignal} [signal] - Abort signal
 * @returns {Promise<object[]>} Array of raw advisory objects from GitHub API
 */
async function queryGitHubAdvisoryByPackage(packageName, signal) {
  if (!packageName || typeof packageName !== 'string') return [];

  // GUARD: If rate-limited and queue is deep, skip to prevent timeout starvation
  const MAX_QUEUE_DEPTH = 50;
  if (rateLimiter.isRateLimited() && rateLimiter.getQueueDepth() >= MAX_QUEUE_DEPTH) {
    console.warn(
      `[github-advisory-source] Skipping ${packageName}: rate-limited with queue depth ${rateLimiter.getQueueDepth()}`
    );
    return [];
  }

  if (ENRICHMENT_CONFIG.GITHUB_TOKEN && !_authLogEmitted) {
    _authLogEmitted = true;
    console.log('[GitHubAdvisory] Authenticated API access active (5,000 req/hr limit)');
  }

  const url = `${ENRICHMENT_CONFIG.GITHUB_ADVISORY_API_URL}?ecosystem=npm&per_page=100&affects=${encodeURIComponent(packageName)}`;

  return rateLimiter.enqueue(async (sig) => {
    for (let attempt = 0; attempt <= GIT_CONFIG.GITHUB_MAX_RETRIES; attempt++) {
      if (sig?.aborted) {
        throw new Error('Request aborted');
      }

      try {
        const result = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS, sig);

        if (sig?.aborted) {
          throw new Error('Request aborted');
        }

        if (!result.body || result.statusCode === 404) {
          return [];
        }

        // The ?affects= endpoint returns an array of advisory objects
        if (Array.isArray(result.body)) {
          return result.body;
        }

        return [];
      } catch (err) {
        if (err.isRateLimit && attempt < GIT_CONFIG.GITHUB_MAX_RETRIES) {
          const delay = err.retryAfterMs != null ? err.retryAfterMs : computeBackoffDelay(attempt);
          rateLimiter.setRateLimited(delay);
          console.warn(
            `[github] Rate limited (${err.statusCode || 429}), retry ${attempt + 1}/${GIT_CONFIG.GITHUB_MAX_RETRIES} after ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
        if (err.isRateLimit) {
          console.warn(
            `[github] Rate limit retries exhausted after ${GIT_CONFIG.GITHUB_MAX_RETRIES} attempts for package ${packageName}`
          );
          return [];
        }
        console.warn(
          `[github-advisory-source] queryGitHubAdvisoryByPackage error for ${packageName}: ${err.message}`
        );
        return [];
      }
    }
    return [];
  }, signal);
}

/**
 * Queries repo-level security advisories for a specific GitHub repository.
 * These are advisories created by repo maintainers that may NOT be in the
 * global GitHub Advisory Database yet.
 *
 * Endpoint: GET /repos/{owner}/{repo}/security-advisories
 * REQUIRES authentication (GITHUB_TOKEN). Returns 401 without it.
 *
 * Uses the same rateLimiter.enqueue() mechanism as all other GitHub API calls.
 *
 * @param {string} owner - GitHub repo owner (e.g. "expressjs")
 * @param {string} repo - GitHub repo name (e.g. "morgan")
 * @param {AbortSignal} [signal] - Abort signal
 * @returns {Promise<object[]>} Array of raw repo-level advisory objects (published only)
 */
async function queryRepoLevelAdvisories(owner, repo, signal) {
  // Soft gate (was a HARD gate): this endpoint requires authentication and
  // returns 401 without a token. Previously we silently returned [] when no
  // token was configured, which made scan results TOKEN-DEPENDENT — the same
  // project could show different vulnerability counts depending on config.
  // That is a reproducibility problem for a security tool. Now we always
  // attempt the call; without a token it 401s and we degrade gracefully to
  // [] (already handled below), so coverage is deterministic per config and
  // the orchestrator records the reduced coverage in result.metadata.
  if (!owner || !repo || typeof owner !== 'string' || typeof repo !== 'string') return [];

  // GUARD: If rate-limited and queue is deep, skip
  const MAX_QUEUE_DEPTH = 50;
  if (rateLimiter.isRateLimited() && rateLimiter.getQueueDepth() >= MAX_QUEUE_DEPTH) {
    console.warn(
      `[github-advisory-source] Skipping repo-level query for ${owner}/${repo}: rate-limited with queue depth ${rateLimiter.getQueueDepth()}`
    );
    return [];
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/security-advisories?per_page=100&state=published`;

  return rateLimiter.enqueue(async (sig) => {
    for (let attempt = 0; attempt <= GIT_CONFIG.GITHUB_MAX_RETRIES; attempt++) {
      if (sig?.aborted) {
        throw new Error('Request aborted');
      }

      try {
        const result = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS, sig);

        if (sig?.aborted) {
          throw new Error('Request aborted');
        }

        // 404 = repo not found or no security advisories feature enabled
        if (!result.body || result.statusCode === 404) {
          return [];
        }

        // Response is an array of advisory objects
        if (Array.isArray(result.body)) {
          // Double-filter by state === 'published' (belt-and-suspenders;
          // the query param should handle it but the API docs are ambiguous)
          return result.body.filter((adv) => adv.state === 'published');
        }

        return [];
      } catch (err) {
        if (err.isRateLimit && attempt < GIT_CONFIG.GITHUB_MAX_RETRIES) {
          const delay = err.retryAfterMs != null ? err.retryAfterMs : computeBackoffDelay(attempt);
          rateLimiter.setRateLimited(delay);
          console.warn(
            `[github] Rate limited (${err.statusCode || 429}), retry ${attempt + 1}/${GIT_CONFIG.GITHUB_MAX_RETRIES} after ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
        if (err.isRateLimit) {
          console.warn(`[github] Rate limit retries exhausted for repo ${owner}/${repo}`);
          return [];
        }
        console.warn(
          `[github-advisory-source] queryRepoLevelAdvisories error for ${owner}/${repo}: ${err.message}`
        );
        return [];
      }
    }
    return [];
  }, signal);
}

module.exports = { queryGitHubAdvisory, queryGitHubAdvisoryByPackage, queryRepoLevelAdvisories };
