'use strict';

/**
 * License Scanner Module (F9)
 *
 * Scans all packages declared in a project's package-lock.json for
 * SPDX license information and classifies each into a risk tier.
 *
 * F9 license-compliance module.
 */

const fs = require('fs');
const path = require('path');

// ============================================
// SPDX Normalisation Map
// ============================================

/** @type {Record<string, string>} */
const SPDX_NORM_MAP = {
  // === Apache ===
  'apache-2.0': 'Apache-2.0',
  'apache 2.0': 'Apache-2.0',
  apache2: 'Apache-2.0',
  'apache-2': 'Apache-2.0',
  'apache 2': 'Apache-2.0',
  'apache license 2.0': 'Apache-2.0',
  'apache license, version 2.0': 'Apache-2.0',
  'apache license version 2.0': 'Apache-2.0',
  'apache software license 2.0': 'Apache-2.0',
  'apache-1.1': 'Apache-1.1',
  'apache 1.1': 'Apache-1.1',

  // === MIT ===
  mit: 'MIT',
  'mit license': 'MIT',
  'the mit license': 'MIT',
  'mit/x11': 'MIT',
  expat: 'MIT',
  x11: 'MIT',

  // === BSD ===
  bsd: 'BSD-2-Clause',
  'bsd-2-clause': 'BSD-2-Clause',
  'bsd-3-clause': 'BSD-3-Clause',
  'bsd-2': 'BSD-2-Clause',
  'bsd-3': 'BSD-3-Clause',
  'bsd 2-clause': 'BSD-2-Clause',
  'bsd 3-clause': 'BSD-3-Clause',
  'bsd-2-clause-freebsd': 'BSD-2-Clause',
  '2-clause bsd': 'BSD-2-Clause',
  '3-clause bsd': 'BSD-3-Clause',
  'simplified bsd': 'BSD-2-Clause',
  'new bsd': 'BSD-3-Clause',
  'modified bsd': 'BSD-3-Clause',
  freebsd: 'BSD-2-Clause',
  'revised bsd': 'BSD-3-Clause',

  // === ISC ===
  isc: 'ISC',
  'isc license': 'ISC',

  // === GPL ===
  'gpl-2.0': 'GPL-2.0-only',
  'gpl-3.0': 'GPL-3.0-only',
  gpl2: 'GPL-2.0-only',
  gpl3: 'GPL-3.0-only',
  gplv2: 'GPL-2.0-only',
  gplv3: 'GPL-3.0-only',
  'gnu gpl v2': 'GPL-2.0-only',
  'gnu gpl v3': 'GPL-3.0-only',
  'gnu general public license v2': 'GPL-2.0-only',
  'gnu general public license v3': 'GPL-3.0-only',
  'gnu general public license v2.0': 'GPL-2.0-only',
  'gnu general public license v3.0': 'GPL-3.0-only',
  'gpl 2.0': 'GPL-2.0-only',
  'gpl 3.0': 'GPL-3.0-only',
  'gpl-2.0-only': 'GPL-2.0-only',
  'gpl-3.0-only': 'GPL-3.0-only',
  'gpl-2.0-or-later': 'GPL-2.0-or-later',
  'gpl-3.0-or-later': 'GPL-3.0-or-later',

  // === LGPL ===
  'lgpl-2.0': 'LGPL-2.0-only',
  'lgpl-2.1': 'LGPL-2.1-only',
  'lgpl-3.0': 'LGPL-3.0-only',
  lgplv2: 'LGPL-2.0-only',
  'lgplv2.1': 'LGPL-2.1-only',
  lgplv3: 'LGPL-3.0-only',
  'gnu lesser general public license v2.1': 'LGPL-2.1-only',
  'gnu lesser general public license v3': 'LGPL-3.0-only',
  'lgpl 2.1': 'LGPL-2.1-only',
  'lgpl 3.0': 'LGPL-3.0-only',

  // === AGPL ===
  'agpl-3.0': 'AGPL-3.0-only',
  agplv3: 'AGPL-3.0-only',
  'affero gpl v3': 'AGPL-3.0-only',
  'gnu affero general public license v3': 'AGPL-3.0-only',

  // === MPL ===
  'mpl-2.0': 'MPL-2.0',
  'mpl 2.0': 'MPL-2.0',
  'mozilla public license 2.0': 'MPL-2.0',
  'mozilla public license, version 2.0': 'MPL-2.0',
  'mpl-1.1': 'MPL-1.1',

  // === Unlicense / Public Domain ===
  unlicense: 'Unlicense',
  'the unlicense': 'Unlicense',
  unlicensed: 'Unlicense',
  'public domain': 'Unlicense',

  // === CC0 ===
  cc0: 'CC0-1.0',
  'cc0-1.0': 'CC0-1.0',
  'cc0 1.0': 'CC0-1.0',
  'cc0 1.0 universal': 'CC0-1.0',

  // === WTFPL ===
  wtfpl: 'WTFPL',

  // === Artistic ===
  'artistic-2.0': 'Artistic-2.0',
  'artistic license 2.0': 'Artistic-2.0',

  // === Zlib ===
  zlib: 'Zlib',
  'zlib/libpng': 'Zlib',
};

// ============================================
// Tier Classification Sets
// ============================================

const SAFE = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'Python-2.0',
  'BlueOak-1.0.0',
]);

const WARNING = new Set([
  'LGPL-2.0-only',
  'LGPL-2.1-only',
  'LGPL-3.0-only',
  'LGPL-2.0-or-later',
  'LGPL-2.1-or-later',
  'LGPL-3.0-or-later',
  'MPL-2.0',
  'CDDL-1.0',
  'EPL-1.0',
  'EPL-2.0',
  'EUPL-1.1',
  'EUPL-1.2',
]);

const DANGEROUS = new Set([
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'SSPL-1.0',
]);

// ============================================
// Internal helpers
// ============================================

/**
 * Normalise a raw license string to a canonical SPDX identifier.
 * @param {string|undefined} raw
 * @returns {string}
 */
function normaliseSpdx(raw) {
  if (!raw || raw === 'UNKNOWN') return 'UNKNOWN';
  const key = raw.trim().toLowerCase();
  return SPDX_NORM_MAP[key] || raw.trim();
}

/**
 * Classify a normalised SPDX identifier into a risk tier.
 * @param {string} spdx
 * @returns {'safe'|'warning'|'dangerous'|'unknown'}
 */
function classifyLicense(spdx) {
  if (spdx === 'UNKNOWN') return 'unknown';
  if (SAFE.has(spdx)) return 'safe';
  if (WARNING.has(spdx)) return 'warning';
  if (DANGEROUS.has(spdx)) return 'dangerous';
  return 'unknown';
}

/**
 * Classify a potentially compound SPDX expression.
 * e.g. "(MIT OR Apache-2.0)" → 'safe'
 * e.g. "(GPL-3.0 OR MIT)" → 'dangerous'
 * @param {string} rawLicense
 * @returns {'safe'|'warning'|'dangerous'|'unknown'}
 */
function classifyCompound(rawLicense) {
  const stripped = rawLicense.replace(/^\(|\)$/g, '').trim();
  const parts = stripped.split(/\s+(?:OR|AND)\s+/i).map((p) => p.trim());
  let worst = 'safe';
  for (const part of parts) {
    const tier = classifyLicense(normaliseSpdx(part));
    if (tier === 'dangerous') return 'dangerous';
    if (tier === 'warning') worst = 'warning';
    if (tier === 'unknown' && worst === 'safe') worst = 'unknown';
  }
  return worst;
}

/**
 * Compute aggregate statistics from an array of LicenseEntry objects.
 * @param {Array<{riskTier: string}>} entries
 * @returns {{ total: number, safe: number, warning: number, dangerous: number, unknown: number }}
 */
function computeStats(entries) {
  const stats = { total: 0, safe: 0, warning: 0, dangerous: 0, unknown: 0 };
  for (const e of entries) {
    stats.total++;
    stats[e.riskTier] = (stats[e.riskTier] || 0) + 1;
  }
  return stats;
}

/**
 * Build a map of { [licenseIdentifier]: count } from an array of LicenseEntry objects.
 * @param {Array<{license: string}>} entries
 * @returns {Record<string, number>}
 */
function computeByLicense(entries) {
  /** @type {Record<string, number>} */
  const byLicense = {};
  for (const e of entries) {
    const key = e.license || 'UNKNOWN';
    byLicense[key] = (byLicense[key] || 0) + 1;
  }
  return byLicense;
}

// ============================================
// Main exported function
// ============================================

/**
 * Scan all packages in a project's package-lock.json for license information.
 *
 * Error handling rules:
 * - If package-lock.json is missing or unreadable, throws with a descriptive message.
 * - If node_modules fallback read fails for a single package, silently skips it
 *   (licenseRaw stays empty and becomes "UNKNOWN").
 * - Never throws on individual package failures; always returns a complete result.
 *
 * @param {string} projectPath - Absolute path to the project directory
 * @returns {Promise<{
 *   projectPath: string,
 *   projectName: string,
 *   scannedAt: string,
 *   entries: Array,
 *   stats: { total: number, safe: number, warning: number, dangerous: number, unknown: number }
 * }>}
 */
async function scanLicenses(projectPath) {
  const lockfilePath = path.join(projectPath, 'package-lock.json');
  let lockfile;
  try {
    const raw = await fs.promises.readFile(lockfilePath, 'utf8');
    lockfile = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot read package-lock.json at ${lockfilePath}: ${err.message}`, {
      cause: err,
    });
  }

  const packages = lockfile.packages || {};
  const entries = [];

  for (const [key, pkgData] of Object.entries(packages)) {
    // Skip root project entry
    if (key === '') continue;
    // Only process top-level node_modules entries
    if (!key.startsWith('node_modules/')) continue;
    // Skip nested node_modules hoisting artifacts (e.g. "node_modules/a/node_modules/b")
    if (key.split('/node_modules/').length > 2) continue;

    const name = key.replace(/^node_modules\//, '');
    const version = pkgData.version || '0.0.0';
    let licenseRaw = pkgData.license || '';
    let description = '';

    if (!licenseRaw) {
      try {
        const pkgJsonPath = path.join(projectPath, 'node_modules', name, 'package.json');
        const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));
        // Support both string and object/array forms of the license field
        if (typeof pkgJson.license === 'string') {
          licenseRaw = pkgJson.license;
        } else if (pkgJson.license && typeof pkgJson.license === 'object') {
          licenseRaw = pkgJson.license.type || '';
        } else if (Array.isArray(pkgJson.licenses) && pkgJson.licenses[0]) {
          licenseRaw = pkgJson.licenses[0].type || '';
        }
        description = pkgJson.description || '';
      } catch {
        // package not installed or unreadable — leave licenseRaw empty
      }
    }

    if (!licenseRaw) licenseRaw = 'UNKNOWN';

    const license = normaliseSpdx(licenseRaw);
    const riskTier = classifyCompound(licenseRaw);
    // Handle scoped packages: @scope/name → %40scope/name in PURL (per PURL spec for npm)
    const purlName = name.startsWith('@') ? name.replace('@', '%40') : name;
    const purl = `pkg:npm/${purlName}@${version}`;
    // npm website handles @ in URLs correctly: https://www.npmjs.com/package/@scope/name
    const npmUrl = `https://www.npmjs.com/package/${name}`;

    entries.push({
      name,
      version,
      license,
      licenseRaw,
      riskTier,
      purl,
      npmUrl,
      description,
      path: key,
    });
  }

  const stats = computeStats(entries);
  const byLicense = computeByLicense(entries);

  return {
    projectPath,
    projectName: path.basename(projectPath),
    scannedAt: new Date().toISOString(),
    entries,
    byLicense,
    stats,
  };
}

module.exports = { scanLicenses, normaliseSpdx };
