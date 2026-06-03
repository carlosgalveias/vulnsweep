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

/**
 * Pad text to a target width with the given alignment.
 * @param {string} text
 * @param {number} width
 * @param {'left'|'center'} align
 * @returns {string}
 */
function padContent(text, width, align) {
  const gap = width - text.length;
  if (gap <= 0) return text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

/**
 * Build a dynamic-width ASCII box around content rows.
 * @param {Array<{text: string, align?: 'left'|'center', separator?: boolean}>} rows
 * @param {{minWidth?: number, borderStyle?: 'double'|'single'}} options
 * @returns {string}
 */
function buildBox(rows, { minWidth = 40, borderStyle = 'double' } = {}) {
  // Compute max content width from all non-separator rows
  const contentWidths = rows.filter((r) => !r.separator).map((r) => r.text.length);
  const maxContentWidth = Math.max(minWidth, ...contentWidths);

  // Border characters
  const borders =
    borderStyle === 'double'
      ? { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', ml: '╠', mr: '╣' }
      : { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', ml: '├', mr: '┤' };

  const output = [];
  output.push(`${borders.tl}${borders.h.repeat(maxContentWidth)}${borders.tr}`);

  for (const row of rows) {
    if (row.separator) {
      output.push(`${borders.ml}${borders.h.repeat(maxContentWidth)}${borders.mr}`);
      continue;
    }
    const padded = padContent(row.text, maxContentWidth, row.align || 'left');
    output.push(`${borders.v}${padded}${borders.v}`);
  }

  output.push(`${borders.bl}${borders.h.repeat(maxContentWidth)}${borders.br}`);
  return output.join('\n');
}

module.exports = { extractUpdatesFromArray, buildBox };
