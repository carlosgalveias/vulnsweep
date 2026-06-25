# Specification: Repo-Level GitHub Advisory Fallback

**Author:** Code Pathologist  
**Date:** 2026-06-25  
**Status:** Draft  
**Affected Files:**

- `src/main/modules/enrichment/sources/github-advisory-source.js` (new export)
- `src/main/modules/scanner/sources/github-advisory-source.js` (fallback integration)
- `src/main/config/constants.js` (no changes needed — `GITHUB_TOKEN` already exists)
- `src/main/utils/github-rate-limiter.js` (no changes needed — reuse existing)

---

## 1. Problem Statement

Advisory **GHSA-4vj7-5mj6-jm8m** for `morgan` exists exclusively as a _repo-level security advisory_ on `expressjs/morgan`. The global GitHub Advisory Database endpoint (`GET /advisories?ecosystem=npm&affects=morgan`) returns zero results for it because the advisory has not been promoted/accepted into the global database yet.

Our scanner's [`query()`](src/main/modules/scanner/sources/github-advisory-source.js:217) function calls [`queryGitHubAdvisoryByPackage()`](src/main/modules/enrichment/sources/github-advisory-source.js:265) which hits ONLY the global endpoint. When it returns `[]`, we shrug and move on. This is the architectural equivalent of checking only one ear for hearing loss and declaring the patient fine.

---

## 2. Solution Architecture

### 2.1 Decision Flow

```
query(pkg, signal)
  │
  ├─► queryGitHubAdvisoryByPackage(pkg.name, signal)  [EXISTING — global DB]
  │     │
  │     ├─► results.length > 0 → process as normal (existing path)
  │     │
  │     └─► results.length === 0
  │           │
  │           ├─► GITHUB_TOKEN configured?  ───── NO ──► return []
  │           │       │
  │           │      YES
  │           │       │
  │           ├─► resolveGitHubRepo(pkg.name) ── null ──► return []
  │           │       │
  │           │     {owner, repo}
  │           │       │
  │           └─► queryRepoLevelAdvisories(owner, repo, signal)
  │                   │
  │                   └─► Filter by: state==='published', ecosystem==='npm',
  │                       package.name === pkg.name
  │                       │
  │                       └─► Apply isVersionAffectedByAdvisory() + map to SourceResult
```

### 2.2 Key Constraints

| Constraint                                    | Rationale                                                             |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Fallback ONLY when global returns 0 results   | Avoids redundant API calls; global DB is authoritative when populated |
| Token REQUIRED                                | Repo-level endpoint returns 401 without auth                          |
| Single npm registry call per package (cached) | Rate-limit discipline; same package → same repo always                |
| Reuse existing `rateLimiter.enqueue()`        | All GitHub API calls must flow through the singleton queue            |
| Filter `state === 'published'` only           | Draft/withdrawn advisories are noise                                  |

---

## 3. Detailed Design

### 3.1 New Module: `src/main/utils/repo-url-resolver.js`

This module resolves an npm package name to its GitHub `{owner, repo}` tuple by querying the npm registry metadata. Results are cached in-memory for the duration of a scan session.

```javascript
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
 * Uses the abbreviated metadata endpoint (Accept: application/vnd.npm.install-v1+json)
 * — wait, no. The abbreviated metadata does NOT include repository. We need the full
 * document but only the repository field. Use the ?fields=repository query... which
 * npm registry does not support. Fine. Fetch the full packument, parse repository.url.
 *
 * Actually, the optimal approach: GET /<package>/latest which returns the latest
 * version's manifest INCLUDING repository field, and is much smaller than the full
 * packument for packages with hundreds of versions.
 *
 * CORRECTION: npm registry does not have a /latest sub-path that returns repo info
 * reliably. The correct approach is GET /<package> (full packument) and read
 * body.repository.url. For packages with many versions this can be large, but we
 * only need to parse the top-level repository field.
 *
 * FINAL DECISION: Use GET /<package> with Accept: application/json. The top-level
 * `repository` field is always present at the packument root level regardless of
 * version count. We abort reading after finding it... actually no, JSON streaming
 * isn't worth the complexity. Just fetch the whole thing; it's cached anyway.
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
        timeout: 10000,
        headers: {
          Accept: 'application/json',
          // Request only top-level fields to reduce payload
          // npm registry supports the "application/vnd.npm.install-v1+json" accept
          // but that strips repository. So we use full JSON.
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
```

### 3.2 New Function in `src/main/modules/enrichment/sources/github-advisory-source.js`

Add a new exported function: `queryRepoLevelAdvisories(owner, repo, signal)`

**Location:** After [`queryGitHubAdvisoryByPackage()`](src/main/modules/enrichment/sources/github-advisory-source.js:265), before the `module.exports`.

```javascript
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
  // Hard gate: this endpoint REQUIRES authentication
  if (!ENRICHMENT_CONFIG.GITHUB_TOKEN) return [];

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
```

**Updated `module.exports`:**

```javascript
module.exports = { queryGitHubAdvisory, queryGitHubAdvisoryByPackage, queryRepoLevelAdvisories };
```

### 3.3 Modified `query()` in `src/main/modules/scanner/sources/github-advisory-source.js`

The existing [`query()`](src/main/modules/scanner/sources/github-advisory-source.js:217) function is modified to add the fallback path after the global query returns empty.

**Changes:**

1. Import the new `queryRepoLevelAdvisories` alongside existing import
2. Import `resolveGitHubRepo` from the new utility module
3. Import `ENRICHMENT_CONFIG` for the token check
4. Add fallback logic after line 223

```javascript
'use strict';

const semver = require('semver');
const {
  queryGitHubAdvisoryByPackage,
  queryRepoLevelAdvisories, // ← NEW
} = require('../../enrichment/sources/github-advisory-source');
const { resolveGitHubRepo } = require('../../utils/repo-url-resolver'); // ← NEW
const { ENRICHMENT_CONFIG } = require('../../../config/constants'); // ← NEW

const SOURCE_ID = 'github-advisory';

// ... (isVersionAffectedByAdvisory, inferFixedInFromRange, extractFixedInFromAdvisory unchanged)

/**
 * Queries the GitHub Advisory Database directly by package name for independent
 * vulnerability discovery. Now includes a FALLBACK to repo-level advisories
 * when the global database returns zero results.
 *
 * Fallback fires ONLY when:
 *   1. Global query returned 0 advisories
 *   2. GITHUB_TOKEN is configured (repo-level endpoint requires auth)
 *   3. Package resolves to a GitHub repository URL
 *
 * @param {object} pkg - PackageDescriptor
 * @param {string} pkg.name - Package name
 * @param {string} pkg.version - Exact installed version
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<SourceResult[]>}
 */
async function query(pkg, signal) {
  if (!pkg || !pkg.name || !pkg.version) return [];

  try {
    // ─── PHASE 1: Global Advisory DB (existing behavior) ───
    let advisories = await queryGitHubAdvisoryByPackage(pkg.name, signal);

    // ─── PHASE 2: Repo-level fallback ───
    if ((!advisories || advisories.length === 0) && ENRICHMENT_CONFIG.GITHUB_TOKEN) {
      const repoInfo = await resolveGitHubRepo(pkg.name);
      if (repoInfo) {
        const repoAdvisories = await queryRepoLevelAdvisories(
          repoInfo.owner,
          repoInfo.repo,
          signal
        );
        // Filter repo-level advisories to only those affecting this specific package
        // (a repo may contain advisories for multiple packages in a monorepo)
        if (repoAdvisories && repoAdvisories.length > 0) {
          advisories = repoAdvisories.filter((adv) => {
            if (!Array.isArray(adv.vulnerabilities)) return false;
            return adv.vulnerabilities.some(
              (v) => v.package && v.package.ecosystem === 'npm' && v.package.name === pkg.name
            );
          });
        }
      }
    }

    if (!advisories || advisories.length === 0) return [];

    // ─── PHASE 3: Version matching and result mapping (unchanged) ───
    const results = [];
    for (const advisory of advisories) {
      if (!isVersionAffectedByAdvisory(pkg.version, advisory, pkg.name)) continue;

      const ghsaId = advisory.ghsa_id || null;
      const cveId = advisory.cve_id || null;
      const cveIds = cveId ? [cveId] : [];
      const aliases = ghsaId ? [ghsaId] : [];
      const fixedIn = extractFixedInFromAdvisory(advisory, pkg.name, pkg.version);

      results.push({
        sourceId: SOURCE_ID,
        packageName: pkg.name,
        packageVersion: pkg.version,
        severity: (advisory.severity || 'unknown').toLowerCase(),
        cveIds,
        aliases,
        title: advisory.summary || '',
        description: null,
        fixedIn,
        url: advisory.html_url || null,
        cvssScore: null,
        cvssVector: null,
        cisaKnownExploited: false,
        epssScore: null,
        epssPercentile: null,
        rawData: { github: advisory },
      });
    }

    return results;
  } catch (err) {
    console.warn(
      `[scanner/github-advisory-source] query error for ${pkg.name}@${pkg.version}: ${err.message}`
    );
    return [];
  }
}
```

---

## 4. API Response Shape Reference

The repo-level endpoint (`GET /repos/{owner}/{repo}/security-advisories`) returns objects with this structure (relevant fields):

```json
{
  "ghsa_id": "GHSA-4vj7-5mj6-jm8m",
  "cve_id": "CVE-2026-5078",
  "severity": "medium",
  "summary": "Morgan allows log injection via crafted request headers",
  "state": "published",
  "html_url": "https://github.com/expressjs/morgan/security/advisories/GHSA-4vj7-5mj6-jm8m",
  "vulnerabilities": [
    {
      "package": {
        "name": "morgan",
        "ecosystem": "npm"
      },
      "vulnerable_version_range": ">= 1.2.0, <= 1.10.1",
      "patched_versions": ">= 1.11.0",
      "first_patched_version": { "identifier": "1.11.0" }
    }
  ]
}
```

This is structurally identical to global advisory objects, meaning our existing [`isVersionAffectedByAdvisory()`](src/main/modules/scanner/sources/github-advisory-source.js:23) and [`extractFixedInFromAdvisory()`](src/main/modules/scanner/sources/github-advisory-source.js:105) functions work without modification. The only difference: repo-level advisories have a `state` field that can be `"draft"`, `"published"`, or `"withdrawn"`.

---

## 5. Edge Cases and Failure Modes

| Scenario                                                                    | Behavior                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No `GITHUB_TOKEN` configured                                                | Fallback path is never entered; zero additional API calls                                      |
| Package has no `repository.url` in npm registry                             | `resolveGitHubRepo()` returns null; fallback skipped                                           |
| Repository URL points to non-GitHub host (GitLab, Bitbucket)                | `parseGitHubUrl()` returns null; fallback skipped                                              |
| Repo-level endpoint returns 404 (repo doesn't exist or feature not enabled) | `queryRepoLevelAdvisories()` returns `[]`                                                      |
| Repo-level endpoint returns 401 (token invalid/expired)                     | Treated as non-rate-limit error; logs warning, returns `[]`                                    |
| Repo has advisories for OTHER packages (monorepo)                           | Filtered by `package.name === pkg.name` before version matching                                |
| Advisory has `state: "draft"` or `state: "withdrawn"`                       | Filtered out by `?state=published` query param AND client-side filter                          |
| npm registry is unreachable                                                 | `fetchRepoFromRegistry()` resolves to null (never throws); cached as null                      |
| Same package queried multiple times in one scan                             | npm registry called only once; subsequent calls hit `_repoCache`                               |
| Rate limiter queue is saturated (depth >= 50)                               | Repo-level query is skipped entirely (same guard as global query)                              |
| `AbortSignal` fired mid-flight                                              | Propagated through `rateLimiter.enqueue()` → throws → caught by outer try/catch → returns `[]` |

---

## 6. Performance Impact Analysis

| Metric                                             | Before     | After (worst case)                                         |
| -------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| API calls per package (global hit)                 | 1 (global) | 1 (global) — no change                                     |
| API calls per package (global miss, token present) | 1 (global) | 1 (global) + 1 (npm registry, cached) + 1 (repo-level) = 3 |
| API calls per package (global miss, no token)      | 1 (global) | 1 (global) — no change                                     |
| npm registry calls (10 packages, same repo)        | 0          | 1 (cached after first)                                     |
| Additional latency (fallback path)                 | 0          | ~200-500ms (npm registry) + ~200-500ms (repo-level)        |

The fallback ONLY fires for packages with zero global advisories. For a typical scan where most packages have no advisories at all, this means the fallback fires for the majority of packages. However:

- The npm registry lookup is **cached** — for `n` packages from the same repo, only 1 registry call is made
- The repo-level advisory endpoint returns **all** advisories for the repo in one call — but we make one call per package (because different packages may map to different repos)

**Optimization opportunity (future):** Batch packages by resolved repo and make one repo-level call per unique `{owner, repo}`, then distribute results across matching packages. This is NOT in scope for v1 but the architecture supports it cleanly.

---

## 7. File Change Summary

### 7.1 New File: `src/main/utils/repo-url-resolver.js`

Complete implementation as specified in §3.1 above.

**Exports:**

- `resolveGitHubRepo(packageName)` → `Promise<{owner, repo} | null>`
- `parseGitHubUrl(repoUrl)` → `{owner, repo} | null`
- `clearRepoCache()` → `void`
- `getRepoCacheSize()` → `number`
- `_fetchRepoFromRegistry(packageName)` → `Promise<{owner, repo} | null>` (test hook)

### 7.2 Modified: `src/main/modules/enrichment/sources/github-advisory-source.js`

| Line       | Change                                                        |
| ---------- | ------------------------------------------------------------- |
| After L331 | Add `queryRepoLevelAdvisories()` function (~60 lines)         |
| L333       | Update `module.exports` to include `queryRepoLevelAdvisories` |

### 7.3 Modified: `src/main/modules/scanner/sources/github-advisory-source.js`

| Line     | Change                                                                    |
| -------- | ------------------------------------------------------------------------- |
| L4       | Destructure `queryRepoLevelAdvisories` from enrichment source import      |
| After L4 | Add `require('../../utils/repo-url-resolver')` import                     |
| After L4 | Add `require('../../../config/constants')` import for `ENRICHMENT_CONFIG` |
| L217-263 | Replace `query()` with new implementation including fallback (§3.3)       |

### 7.4 No Changes Required

- `src/main/utils/github-rate-limiter.js` — reused as-is via `rateLimiter.enqueue()`
- `src/main/config/constants.js` — `GITHUB_TOKEN` getter already exists and is sufficient
- `src/main/utils/registry-cache.js` — NOT reused; the new `_repoCache` Map in `repo-url-resolver.js` is simpler and purpose-built (no TTL needed for a single-scan-session cache)

---

## 8. Test Requirements

### 8.1 New Test File: `__tests__/main/utils/repo-url-resolver.test.js`

```javascript
describe('repo-url-resolver', () => {
  describe('parseGitHubUrl()', () => {
    it('parses git+https://github.com/owner/repo.git', ...);
    it('parses https://github.com/owner/repo', ...);
    it('parses git://github.com/owner/repo.git', ...);
    it('parses git@github.com:owner/repo.git', ...);
    it('parses github:owner/repo shorthand', ...);
    it('returns null for GitLab URLs', ...);
    it('returns null for Bitbucket URLs', ...);
    it('returns null for null/undefined/empty input', ...);
    it('handles URLs with trailing slashes', ...);
    it('handles scoped package repos (e.g. @babel/core → babel/babel)', ...);
  });

  describe('resolveGitHubRepo()', () => {
    it('fetches and caches repo info from npm registry', ...);
    it('returns cached result on second call (no HTTP)', ...);
    it('caches null for packages without repository field', ...);
    it('caches null for packages with non-GitHub repos', ...);
    it('returns null on network error (never throws)', ...);
    it('returns null on 404 from registry', ...);
    it('handles repository field as string (not object)', ...);
  });

  describe('clearRepoCache()', () => {
    it('clears all cached entries', ...);
  });
});
```

### 8.2 New Test File: `__tests__/main/scanner/github-advisory-repo-fallback.test.js`

```javascript
describe('github-advisory-source repo-level fallback', () => {
  describe('when global query returns results', () => {
    it('does NOT query repo-level endpoint', ...);
    it('does NOT call resolveGitHubRepo()', ...);
  });

  describe('when global query returns [] and no GITHUB_TOKEN', () => {
    it('does NOT query repo-level endpoint', ...);
    it('returns []', ...);
  });

  describe('when global query returns [] and GITHUB_TOKEN is set', () => {
    it('calls resolveGitHubRepo() for the package', ...);
    it('skips repo-level query if resolveGitHubRepo returns null', ...);
    it('queries repo-level endpoint with resolved owner/repo', ...);
    it('filters repo-level results by package name (monorepo safety)', ...);
    it('filters repo-level results by state === published', ...);
    it('applies isVersionAffectedByAdvisory() to repo-level results', ...);
    it('maps affected repo-level advisories to SourceResult format', ...);
    it('extracts fixedIn from repo-level advisory patched_versions', ...);
    it('returns [] if repo-level query returns no matching advisories', ...);
  });

  describe('error handling', () => {
    it('returns [] if resolveGitHubRepo throws (should not happen)', ...);
    it('returns [] if queryRepoLevelAdvisories fails', ...);
    it('logs warning on failure without crashing', ...);
  });

  describe('integration: GHSA-4vj7-5mj6-jm8m (morgan)', () => {
    it('detects repo-level advisory for morgan@1.10.0', ...);
    it('does NOT flag morgan@1.11.0 (patched)', ...);
    it('includes correct GHSA ID, CVE ID, severity, fixedIn', ...);
  });
});
```

### 8.3 Modified Test: `__tests__/main/modules/enrichment/sources/github-advisory-source.test.js` (if exists)

Add tests for the new `queryRepoLevelAdvisories()` export:

```javascript
describe('queryRepoLevelAdvisories()', () => {
  it('returns [] when GITHUB_TOKEN is not set', ...);
  it('returns [] for invalid owner/repo', ...);
  it('returns published advisories from repo endpoint', ...);
  it('filters out draft/withdrawn advisories', ...);
  it('uses rateLimiter.enqueue() for HTTP serialization', ...);
  it('handles 404 gracefully (returns [])', ...);
  it('handles rate-limit (429) with retry', ...);
  it('respects AbortSignal', ...);
  it('skips when queue depth >= 50', ...);
});
```

### 8.4 New Fixture: `__tests__/fixtures/github-repo-advisory-response.json`

```json
[
  {
    "ghsa_id": "GHSA-4vj7-5mj6-jm8m",
    "cve_id": "CVE-2026-5078",
    "severity": "medium",
    "summary": "Morgan allows log injection via crafted request headers",
    "state": "published",
    "html_url": "https://github.com/expressjs/morgan/security/advisories/GHSA-4vj7-5mj6-jm8m",
    "vulnerabilities": [
      {
        "package": {
          "name": "morgan",
          "ecosystem": "npm"
        },
        "vulnerable_version_range": ">= 1.2.0, <= 1.10.1",
        "patched_versions": ">= 1.11.0",
        "first_patched_version": { "identifier": "1.11.0" }
      }
    ]
  }
]
```

### 8.5 New Fixture: `__tests__/fixtures/npm-registry-morgan.json`

```json
{
  "name": "morgan",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/expressjs/morgan.git"
  }
}
```

---

## 9. Integration Points

### 9.1 Scan Cancel (Feature D)

When a scan is cancelled, [`rateLimiter.resetQueue()`](src/main/utils/github-rate-limiter.js:138) is already called. Additionally, the new `clearRepoCache()` should be called to release memory:

```javascript
// In the scan:cancel IPC handler (already exists):
const { clearRepoCache } = require('./utils/repo-url-resolver');
// ... existing cancel logic ...
clearRepoCache();
```

### 9.2 Deduplication (Result Aggregator)

The existing `result-aggregator.js` groups results by advisory ID using transitive merging on CVE IDs AND GHSA IDs. Repo-level advisories produce `SourceResult` objects with the same `sourceId: 'github-advisory'`, so if the same advisory later appears in the global DB, deduplication handles it automatically. No changes needed.

### 9.3 Telemetry

The existing scan telemetry can optionally track repo-level fallback hits. This is a future enhancement; no changes needed for v1.

---

## 10. Security Considerations

| Concern                          | Mitigation                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token leakage in logs            | `ENRICHMENT_CONFIG.GITHUB_TOKEN` is never logged; only passed in `Authorization` header                                                                       |
| SSRF via crafted repository.url  | `parseGitHubUrl()` validates `hostname === 'github.com'`; URL is constructed server-side from registry response, not user input                               |
| Cache poisoning via npm registry | Low risk; attacker would need to compromise the package's npm metadata. The resolver only reads `repository.url` which is set by package maintainers          |
| Token scope escalation           | Repo-level advisory endpoint requires only `read` access to public repo security advisories; no additional scopes needed beyond what the global endpoint uses |

---

## 11. Rollout Strategy

1. **Feature flag:** The fallback is naturally gated behind `ENRICHMENT_CONFIG.GITHUB_TOKEN`. Users without a token see zero behavior change.
2. **Opt-out (future):** If needed, add a `VULNSWEEP_SKIP_REPO_ADVISORIES=1` env var check at the top of the fallback block. Not implemented in v1 since the feature is already token-gated.
3. **Monitoring:** The `console.warn` logs in the fallback path provide visibility. A future telemetry event (`repo-level-fallback-hit`) can be added to `scan-telemetry.js`.

---

## 12. Verdict

The existing architecture is—against all odds—well-structured enough that this feature slots in with minimal surgery. The key insight: the global and repo-level advisory endpoints return _structurally identical_ objects, so all downstream processing (`isVersionAffectedByAdvisory`, `extractFixedInFromAdvisory`, result mapping) works unchanged. The only new complexity is the npm registry lookup, which is a well-understood HTTP call that caches trivially.

Total new code: ~150 lines (resolver module) + ~60 lines (enrichment function) + ~15 lines (scanner integration) = **~225 lines of production code**.

Total new test code: ~200 lines across 3 test files.

No existing tests should break. No existing behavior changes when `GITHUB_TOKEN` is absent.
