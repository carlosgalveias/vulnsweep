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
// EXPORTS
// ============================================

module.exports = {
  GIT_CONFIG,
  CACHE_CONFIG,
  API_CONFIG,
  UI_CONFIG,
};
