'use strict';

/**
 * Shared source preset definitions.
 * Single source of truth for both CLI and UI.
 */

const SOURCE_PRESETS = {
  fast: ['npm-audit', 'osv'],
  optimal: ['npm-audit', 'osv', 'github-advisory', 'cisa-kev', 'epss'],
  full: ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'],
};

/**
 * Per-preset timeout values in milliseconds.
 */
const PRESET_TIMEOUTS = {
  fast: 15000,
  optimal: 30000,
  full: 60000,
};

/**
 * All available source identifiers.
 */
const ALL_SOURCES = ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'];

module.exports = { SOURCE_PRESETS, PRESET_TIMEOUTS, ALL_SOURCES };
