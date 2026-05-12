'use strict';

/**
 * VulnSweep - GitHub Advisory Database Source Module
 *
 * Queries the public GitHub Advisory REST API (no auth required for public advisories).
 * Endpoint: GET https://api.github.com/advisories?cve_id=<CVE-ID>
 *        or: GET https://api.github.com/advisories/<GHSA-ID>
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
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
}

const GH_BACKOFF_BASE_MS = 2000;
const GH_MAX_RETRIES = 3;

function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
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
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve({ statusCode: res.statusCode, body: null });
            return;
          }
          if (res.statusCode === 429 || res.statusCode === 403) {
            const err = new Error(`GitHub Advisory rate-limited (${res.statusCode})`);
            err.isRateLimit = true;
            err.statusCode = res.statusCode;
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
    req.on('error', reject);
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

/**
 * Query GitHub Advisory Database by CVE ID or GHSA ID.
 *
 * When a CVE ID is provided, GET /advisories?cve_id=<id> returns an array;
 * we use the first result.
 * When a GHSA ID is provided, GET /advisories/<ghsa-id> returns a single object.
 *
 * @param {string} id  - CVE ID ("CVE-YYYY-NNNNN") or GHSA ID ("GHSA-xxxx-xxxx-xxxx")
 * @returns {Promise<{found: boolean, ghsaId: string|null, severity: string|null, patchedVersions: string[], url: string|null, error?: string}>}
 */
async function queryGitHubAdvisory(id) {
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

  for (let attempt = 0; attempt <= GH_MAX_RETRIES; attempt++) {
    try {
      const result = await httpsGet(url, ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS);

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
      if (err.isRateLimit && attempt < GH_MAX_RETRIES) {
        const delay = backoffDelay(GH_BACKOFF_BASE_MS, attempt);
        console.warn(
          `[github] Rate limited (${err.statusCode || 429}), retry ${
            attempt + 1
          }/${GH_MAX_RETRIES} after ${delay}ms`
        );
        await sleep(delay);
        continue;
      }
      if (err.isRateLimit) {
        console.warn(`[github] Rate limit exceeded after ${GH_MAX_RETRIES} retries for ${id}`);
        return { ...empty, error: 'rate_limit_exceeded' };
      }
      console.warn(`[github-advisory-source] queryGitHubAdvisory error for ${id}: ${err.message}`);
      return { ...empty, error: err.message };
    }
  }
  // Exhausted retries
  return { ...empty, error: 'rate_limit_exceeded' };
}

module.exports = { queryGitHubAdvisory };
