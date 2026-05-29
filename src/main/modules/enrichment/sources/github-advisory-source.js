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

function httpsGet(url, timeoutMs, signal) {
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

module.exports = { queryGitHubAdvisory };
