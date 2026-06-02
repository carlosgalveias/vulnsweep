'use strict';

/**
 * Shared utility functions for VulnSweep CLI modules.
 *
 * @module cli/utils
 */

/**
 * Extracts update candidates from the raw dep-updates-scanner array format.
 * The scanner returns an array of repo objects, each with a `candidates` array.
 *
 * @param {Array} arr - Raw scanner result array
 * @returns {Array} Flattened array of update objects
 */
function extractUpdatesFromArray(arr) {
  const updates = [];
  for (const item of arr) {
    if (item && Array.isArray(item.candidates)) {
      for (const candidate of item.candidates) {
        updates.push(candidate);
      }
    } else if (item && item.name) {
      // Already a flat update object
      updates.push(item);
    }
  }
  return updates;
}

module.exports = { extractUpdatesFromArray };
