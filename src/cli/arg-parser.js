'use strict';

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseArgs } = require('node:util');

/**
 * Allowed enum values for validated string options.
 * @type {Record<string, string[]>}
 */
const ENUM_VALUES = {
  type: ['audit', 'dependency'],
  format: ['cyclonedx', 'spdx', 'csv'],
  'fix-level': ['low', 'high'],
  'update-level': ['low', 'high'],
  threshold: ['none', 'critical', 'high', 'medium', 'low', 'any'],
  sources: ['fast', 'optimal', 'full'],
};

/**
 * parseArgs option definitions.
 * @see https://nodejs.org/api/util.html#utilparseargsconfig
 */
const OPTIONS_CONFIG = {
  dir: { type: 'string', short: 'd', default: process.cwd() },
  type: { type: 'string', short: 't', default: 'audit' },
  sources: { type: 'string', short: 'S', default: 'optimal' },
  output: { type: 'boolean', short: 'o', default: false },
  sbom: { type: 'string', short: 's' },
  format: { type: 'string', short: 'f', default: 'cyclonedx' },
  autofix: { type: 'boolean', short: 'a', default: false },
  'fix-level': { type: 'string', short: 'l', default: 'low' },
  'update-level': { type: 'string', short: 'u', default: 'low' },
  'report-dir': { type: 'string', short: 'r' },
  commit: { type: 'boolean', short: 'c', default: false },
  bump: { type: 'boolean', short: 'b', default: false },
  'allow-reset': { type: 'boolean', default: false },
  'remove-package-lock': { type: 'boolean', default: false },
  'remove-overrides': { type: 'boolean', default: false },
  threshold: { type: 'string', short: 'T', default: 'high' },
  quiet: { type: 'boolean', short: 'q', default: false },
  'no-color': { type: 'boolean', default: false },
  'github-token': { type: 'string' },
  'nvd-key': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'V', default: false },
};

/**
 * Validates enum option values against allowed lists.
 * @param {string} name - Option name (long form without dashes)
 * @param {string} value - The value provided by the user
 * @throws {Error} If the value is not in the allowed list
 */
function validateEnum(name, value) {
  const allowed = ENUM_VALUES[name];
  if (allowed && !allowed.includes(value)) {
    throw new Error(`Invalid value "${value}" for --${name}. Allowed: ${allowed.join(', ')}`);
  }
}

/**
 * Parses and validates CLI arguments.
 *
 * @param {string[]} argv - Arguments array (typically process.argv.slice(2))
 * @returns {object} Validated options object with defaults applied
 * @throws {Error} On validation failure with a descriptive message
 */
function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: OPTIONS_CONFIG,
    strict: true,
  });

  // Early exit for help/version
  if (values.help) {
    return { help: true };
  }

  if (values.version) {
    return { version: true };
  }

  // Validate enum values
  validateEnum('type', values.type);
  validateEnum('sources', values.sources);
  validateEnum('format', values.format);
  validateEnum('fix-level', values['fix-level']);
  validateEnum('update-level', values['update-level']);
  validateEnum('threshold', values.threshold);

  // Resolve and validate --dir
  let dirPath = resolve(values.dir);
  if (!existsSync(dirPath)) {
    // The user may have omitted a leading "/" on a Unix absolute path
    // (e.g. "mnt/c/Work" instead of "/mnt/c/Work").
    // Try prepending "/" to see if it resolves to a valid directory.
    const asAbsolute = resolve(`/${values.dir}`);
    if (existsSync(asAbsolute)) {
      dirPath = asAbsolute;
    } else {
      throw new Error(`Directory does not exist: "${dirPath}"`);
    }
  }
  values.dir = dirPath;

  return values;
}

module.exports = { parseCliArgs };
