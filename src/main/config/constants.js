/**
 * VulnSweep - Application Constants
 *
 * Centralized configuration for all magic numbers and constant values used throughout
 * the application. Organized by functional area for easy maintenance and configuration.
 *
 * @module config/constants
 */

// ============================================
// GIT CONFIGURATION
// ============================================

/**
 * Git operation constants for repository management
 * @namespace GIT_CONFIG
 */
const GIT_CONFIG = {
  /**
   * Maximum length for git commit messages (characters)
   * Prevents excessively long commit messages that could cause issues
   * @type {number}
   */
  MESSAGE_MAX_LENGTH: 500,

  /**
   * Maximum length for git branch names (characters)
   * Follows git best practices for branch name length
   * @type {number}
   */
  BRANCH_MAX_LENGTH: 255,

  /**
   * Default commit message used when none is provided
   * @type {string}
   */
  DEFAULT_COMMIT_MESSAGE: 'fix(security): update vulnerable dependencies',

  /**
   * Maximum number of retry attempts for GitHub Advisory API rate-limit errors.
   * On each attempt the request is retried after an exponential backoff delay.
   * The first attempt (attempt=0) is not a retry; retries are attempts 1..GITHUB_MAX_RETRIES.
   * @type {number}
   */
  GITHUB_MAX_RETRIES: 3,

  /**
   * Base delay for exponential backoff when GitHub rate-limits us (milliseconds).
   * Actual delay = GITHUB_RETRY_BASE_DELAY_MS * 2^attempt + jitter
   * @type {number}
   */
  GITHUB_RETRY_BASE_DELAY_MS: 2000,

  /**
   * Maximum backoff delay cap (milliseconds).
   * Prevents runaway wait times on high attempt numbers.
   * @type {number}
   */
  GITHUB_RETRY_MAX_DELAY_MS: 60000,

  /**
   * Maximum random jitter added to each backoff delay (milliseconds).
   * Jitter prevents thundering-herd when multiple instances retry simultaneously.
   * @type {number}
   */
  GITHUB_RETRY_JITTER_MS: 10000,
};

// ============================================
// CACHE CONFIGURATION
// ============================================

/**
 * Registry cache configuration for npm package data caching
 * @namespace CACHE_CONFIG
 */
const CACHE_CONFIG = {
  /**
   * Time-to-live for cached registry responses (milliseconds)
   * Default: 5 minutes (300,000 ms)
   * Balances data freshness with performance
   * @type {number}
   */
  TTL_MS: 5 * 60 * 1000,

  /**
   * TTL in seconds for easier readability (derived from TTL_MS)
   * @type {number}
   */
  get TTL_SECONDS() {
    return this.TTL_MS / 1000;
  },

  /**
   * TTL in minutes for easier readability (derived from TTL_MS)
   * @type {number}
   */
  get TTL_MINUTES() {
    return this.TTL_MS / (60 * 1000);
  },
};

// ============================================
// API CONFIGURATION
// ============================================

/**
 * API and external command execution configuration
 * @namespace API_CONFIG
 */
const API_CONFIG = {
  /**
   * Maximum buffer size for child process stdout/stderr (bytes)
   * Default: 10MB (10,485,760 bytes)
   * Prevents memory issues with large command outputs
   * @type {number}
   */
  MAX_BUFFER_BYTES: 10 * 1024 * 1024,

  /**
   * Timeout for npm registry commands (milliseconds)
   * Default: 10 seconds (10,000 ms)
   * Prevents hanging on slow or unresponsive registry
   * @type {number}
   */
  NPM_COMMAND_TIMEOUT_MS: 10000,

  /**
   * Timeout in seconds for easier readability (derived from NPM_COMMAND_TIMEOUT_MS)
   * @type {number}
   */
  get NPM_COMMAND_TIMEOUT_SECONDS() {
    return this.NPM_COMMAND_TIMEOUT_MS / 1000;
  },
};

// ============================================
// UI CONFIGURATION
// ============================================

/**
 * User interface configuration for Electron window
 * @namespace UI_CONFIG
 */
const UI_CONFIG = {
  /**
   * Main window width (pixels)
   * @type {number}
   */
  WINDOW_WIDTH: 1200,

  /**
   * Main window height (pixels)
   * @type {number}
   */
  WINDOW_HEIGHT: 800,

  /**
   * Vite development server port
   * Must match vite.config.js server configuration
   * @type {number}
   */
  VITE_DEV_PORT: 5173,
};

// ============================================
// PAYMENT CONFIGURATION
// ============================================

/**
 * PayPal payment link configuration for the "Success URL" payment flow.
 * The main process opens a BrowserWindow to PAYMENT_URL, then monitors
 * navigation events. When the URL matches SUCCESS_HOST + SUCCESS_PATH,
 * the window is closed and a license is generated automatically.
 * @namespace PAYPAL_CONFIG
 */
const PAYPAL_CONFIG = {
  /**
   * PayPal Payment Link URL for the promo price period.
   * @type {string}
   */
  PAYMENT_URL_PROMO: 'https://www.paypal.com/ncp/payment/TP9D9QU6VRGBQ',

  /**
   * PayPal Payment Link URL for the full (non-promo) price.
   * @type {string}
   */
  PAYMENT_URL_FULL: 'https://www.paypal.com/ncp/payment/UXDUB588356H4',

  /**
   * Hostname of the success/return URL configured in the PayPal payment link.
   * PayPal will redirect the buyer here after a successful payment.
   * @type {string}
   */
  SUCCESS_HOST: 'vulnsweep.app',

  /**
   * Path portion of the success/return URL.
   * @type {string}
   */
  SUCCESS_PATH: '/success',
};

// ============================================
// ENRICHMENT CONFIGURATION
// ============================================

/**
 * CVE enrichment configuration for cross-source vulnerability correlation.
 * Covers OSV.dev, NVD API v2, and GitHub Advisory Database integrations.
 * @namespace ENRICHMENT_CONFIG
 */
const ENRICHMENT_CONFIG = {
  /**
   * OSV.dev batch query endpoint
   * @type {string}
   */
  OSV_API_URL: 'https://api.osv.dev/v1/query',

  /**
   * NVD API v2 CVE lookup endpoint
   * @type {string}
   */
  NVD_API_URL: 'https://services.nvd.nist.gov/rest/json/cves/2.0',

  /**
   * GitHub Advisory REST API base endpoint.
   * Unauthenticated: 60 req/hr. Authenticated (GITHUB_TOKEN env var): 5,000 req/hr.
   * @type {string}
   */
  GITHUB_ADVISORY_API_URL: 'https://api.github.com/advisories',

  /**
   * Minimum delay between consecutive NVD API calls (milliseconds).
   * NVD free tier allows ~5 requests per 30 seconds without an API key.
   * 6 seconds between calls keeps us safely under that limit.
   * @type {number}
   */
  NVD_RATE_LIMIT_MS: 6000,

  /**
   * Optional NVD API key read from environment variable.
   * When set, NVD allows 50 req/30s instead of 5 req/30s.
   * @type {string|undefined}
   */
  get NVD_API_KEY() {
    return process.env.NVD_API_KEY || undefined;
  },

  /**
   * Optional GitHub Personal Access Token read from environment variable.
   * When set, GitHub API allows 5,000 req/hr instead of 60 req/hr (unauthenticated).
   * Generate at: https://github.com/settings/tokens (no scopes required for public data)
   * Returns undefined (not empty string) when the variable is absent or empty,
   * so callers can safely use it as a boolean guard.
   * @type {string|undefined}
   */
  get GITHUB_TOKEN() {
    return process.env.GITHUB_TOKEN || undefined;
  },

  /**
   * Per-request HTTP timeout for all enrichment API calls (milliseconds).
   * @type {number}
   */
  ENRICHMENT_TIMEOUT_MS: 15000,

  /**
   * In-process enrichment cache TTL (milliseconds).
   * Default: 30 minutes.
   * @type {number}
   */
  ENRICHMENT_CACHE_TTL_MS: 30 * 60 * 1000,

  /**
   * Disk-based enrichment cache TTL (milliseconds).
   * Longer TTL is appropriate for disk cache since CVE data rarely changes day-to-day.
   * Default: 24 hours.
   * @type {number}
   */
  DISK_CACHE_TTL_MS: 24 * 60 * 60 * 1000,

  /**
   * User-Agent header sent with all enrichment HTTP requests.
   * GitHub API requires a non-empty User-Agent; NVD recommends one.
   * @type {string}
   */
  USER_AGENT: 'VulnSweep/1.1.0 (https://github.com/vulnsweep)',

  /**
   * CISA Known Exploited Vulnerabilities catalog static JSON feed.
   * Cached to disk for DISK_CACHE_TTL_MS (24 h). Refreshed on first call after TTL expires.
   * @type {string}
   */
  CISA_KEV_URL:
    'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',

  /**
   * EPSS v3 API base URL. Append ?cve=CVE-XXXX-XXXXX for per-CVE exploit probability queries.
   * Returns epss score (0-1 float) and percentile (0-1 float).
   * @type {string}
   */
  EPSS_API_URL: 'https://api.first.org/data/v1/epss',
};

// ============================================
// LICENSE CONFIGURATION
// ============================================

/**
 * License pricing and duration constants for Feature A (Yearly Pricing).
 * @namespace LICENSE_CONFIG
 */
const LICENSE_CONFIG = {
  /**
   * Promotional price in EUR, active within the first PROMO_DAYS days of install.
   * @type {number}
   */
  PROMO_PRICE_EUR: 9.99,

  /**
   * Full price in EUR, active after the PROMO_DAYS window expires.
   * @type {number}
   */
  FULL_PRICE_EUR: 29.99,

  /**
   * Number of days from install during which the promo price is active.
   * @type {number}
   */
  PROMO_DAYS: 30,

  /**
   * Duration of a purchased license in days (365 = 1 year / annual license).
   * @type {number}
   */
  LICENSE_DURATION_DAYS: 365,
};

// ============================================
// DEPENDENCY UPDATES CONFIGURATION (F13)
// ============================================

/**
 * Dependency updates feature configuration (F13).
 * Controls npm registry access, version display limits, and HTTP timeouts.
 * @namespace DEP_UPDATES_CONFIG
 */
const DEP_UPDATES_CONFIG = {
  /**
   * npm registry URL. GET <REGISTRY_URL>/<pkgName> returns metadata with `versions` object.
   * @type {string}
   */
  REGISTRY_URL: 'https://registry.npmjs.org',

  /**
   * Max versions per package shown in UI dropdown. Newest N entries kept.
   * Prevents the dropdown from having hundreds of entries for active packages like `typescript`.
   * @type {number}
   */
  MAX_VERSIONS_SHOWN: 50,

  /**
   * Per-package HTTP timeout for registry fetches (ms).
   * @type {number}
   */
  FETCH_TIMEOUT_MS: 10000,
};

// ============================================
// SCAN CACHE CONFIGURATION (Sprint 3 cache layer)
// ============================================

/**
 * Persistent scan result cache configuration.
 * Controls TTLs per source, debounce timing, and the enabled flag.
 *
 * Security note: CISA KEV uses a 2 h TTL (not 24 h) because it tracks
 * vulnerabilities actively being exploited RIGHT NOW.  A stale "not in KEV"
 * answer that is up to 24 h old could cause VulnSweep to report a package as
 * safe when it is under active exploitation.
 *
 * @namespace SCAN_CACHE_CONFIG
 */
const SCAN_CACHE_CONFIG = {
  /** Master kill-switch. Set to false to bypass all cache reads and writes. */
  CACHE_ENABLED: true,

  /**
   * TTL per source in milliseconds.
   * Sources not listed here fall back to DEFAULT_TTL_MS.
   */
  TTL_BY_SOURCE: {
    osv: 24 * 60 * 60 * 1000, // 24 h — versioned entries change rarely
    nvd: 24 * 60 * 60 * 1000, // 24 h — CVSS data changes rarely
    'github-advisory': 24 * 60 * 60 * 1000, // 24 h — advisory metadata stable
    'cisa-kev': 2 * 60 * 60 * 1000, // 2 h  — actively exploited; MUST be fresh
  },

  /** Fallback TTL for any source not listed in TTL_BY_SOURCE. */
  DEFAULT_TTL_MS: 24 * 60 * 60 * 1000,

  /**
   * Debounce window for async disk writes (milliseconds).
   * After a set() call the dirty source is written after this delay,
   * unless another set() fires first and resets the timer.
   */
  SAVE_DEBOUNCE_MS: 2000,

  /**
   * Source IDs for which caching is active.
   * npm-audit is intentionally absent — it reads the lockfile and must run fresh.
   */
  CACHEABLE_SOURCES: ['osv', 'nvd', 'github-advisory', 'cisa-kev'],

  /** Hard invalidation threshold: entries older than this are deleted unconditionally. */
  HARD_INVALIDATE_AGE_MS: 365 * 24 * 60 * 60 * 1000, // 1 year

  /** Soft refresh threshold: entries older than this trigger a refresh attempt. */
  SOFT_REFRESH_AGE_MS: 30 * 24 * 60 * 60 * 1000, // 30 days

  /**
   * Maximum total number of entries across ALL sources before LRU eviction.
   * 22,000 packages x 4 sources = 88,000 max theoretical entries.
   * Setting a hard cap at 50,000 entries prevents unbounded disk growth.
   * Set to 0 to disable size-based eviction.
   */
  CACHE_MAX_ENTRIES: 50000,

  /**
   * Maximum total size in bytes across all cache files before eviction.
   * Default: 2 GB. Set to 0 to disable size-based eviction.
   */
  CACHE_MAX_SIZE_BYTES: 2 * 1024 * 1024 * 1024,

  /** Entries whose CVE publishedDate is within this window are treated as "recent"
   *  and trigger a soft-refresh attempt even if the cache entry itself is still fresh.
   *  Default: 3 months. */
  CVE_RECENT_AGE_MS: 90 * 24 * 60 * 60 * 1000, // 3 months in ms
};

// ============================================
// SCANNER CONFIGURATION (Sprint 3)
// ============================================

/**
 * Scanner orchestration configuration for the modular vulnerability scanner.
 * Controls which source plugins are active, concurrency limits, timeouts, and
 * the default scan mode used when no explicit mode is requested.
 * @namespace SCANNER_CONFIG
 */
const SCANNER_CONFIG = {
  /**
   * Which source plugins are active. Order determines display priority.
   * @type {string[]}
   */
  ENABLED_SOURCES: ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev'],

  /**
   * Max packages processed concurrently across all source plugins.
   * @type {number}
   */
  MAX_CONCURRENT_PACKAGES: 10,

  /**
   * Per-package timeout in milliseconds (applies to each source plugin call).
   * @type {number}
   */
  PER_PACKAGE_TIMEOUT_MS: 30000,

  /**
   * Pause between batches to avoid rate limiting (milliseconds).
   * @type {number}
   */
  BATCH_PAUSE_MS: 100,

  /**
   * Scan mode: 'fast' (npm-audit + osv only) or 'full' (all sources).
   * Unrecognized values fall back to 'fast' in scanner-orchestrator.js.
   * @type {string}
   */
  DEFAULT_SCAN_MODE: 'full',
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  GIT_CONFIG,
  CACHE_CONFIG,
  API_CONFIG,
  UI_CONFIG,
  PAYPAL_CONFIG,
  ENRICHMENT_CONFIG,
  DEP_UPDATES_CONFIG,
  LICENSE_CONFIG,
  SCANNER_CONFIG,
  SCAN_CACHE_CONFIG,
};
