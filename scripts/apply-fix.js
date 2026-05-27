'use strict';
/* eslint-disable no-console */
/**
 * One-shot patcher: applies the isVersionSafe false-positive filter to all
 * relevant source files, then rebuilds dist-main/main.js via build-main.js.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const bundle = require('fs').readFileSync('dist-main/main.js', 'utf8');
const path = require('path');

function patch(filePath, searchStr, replaceStr, label) {
  const full = path.resolve(filePath);
  let src = fs.readFileSync(full, 'utf8');
  if (src.includes(replaceStr.slice(0, 40))) {
    console.log(`Already patched: ${label}`);
    return;
  }
  if (!src.includes(searchStr.slice(0, 40))) {
    console.error(`SEARCH NOT FOUND in ${label}: ${searchStr.slice(0, 60)}`);
    return;
  }
  src = src.replace(searchStr, replaceStr);
  fs.writeFileSync(full, src, 'utf8');
  console.log(`Patched: ${label}`);
}

// ── 1. enrichment/sources/osv-source.js ──────────────────────────────────────

const OSV_ENRICH = 'src/main/modules/enrichment/sources/osv-source.js';

const OLD_EXTRACT = [
  'function extractFixedIn(osvVuln) {',
  '  if (!Array.isArray(osvVuln.affected)) return null;',
  '',
  '  // First pass: collect fixed versions from npm ecosystem entries only',
  '  const npmFixed = [];',
  '  for (const aff of osvVuln.affected) {',
  "    if (!aff.package || aff.package.ecosystem !== 'npm') continue;",
  '    if (!Array.isArray(aff.ranges)) continue;',
  '    for (const range of aff.ranges) {',
  "      if (range.type !== 'ECOSYSTEM' && range.type !== 'SEMVER') continue;",
  '      if (!Array.isArray(range.events)) continue;',
  '      for (const ev of range.events) {',
  "        if (ev.fixed && typeof ev.fixed === 'string') npmFixed.push(ev.fixed);",
  '      }',
  '    }',
  '  }',
  '',
  '  if (npmFixed.length > 0) return minVersion(npmFixed);',
  '',
  '  // Fallback: first fixed event from any ecosystem',
  '  for (const aff of osvVuln.affected) {',
  '    if (!Array.isArray(aff.ranges)) continue;',
  '    for (const range of aff.ranges) {',
  '      if (!Array.isArray(range.events)) continue;',
  '      for (const ev of range.events) {',
  "        if (ev.fixed && typeof ev.fixed === 'string') return ev.fixed;",
  '      }',
  '    }',
  '  }',
  '  return null;',
  '}',
].join('\n');

const NEW_EXTRACT = [
  'function compareVersions(a, b) {',
  "  const aCoreStr = String(a).split('-')[0];",
  "  const bCoreStr = String(b).split('-')[0];",
  "  const aPre = String(a).indexOf('-') !== -1 ? String(a).slice(String(a).indexOf('-') + 1) : null;",
  "  const bPre = String(b).indexOf('-') !== -1 ? String(b).slice(String(b).indexOf('-') + 1) : null;",
  "  const aParts = aCoreStr.split('.').map(function(p) { return parseInt(p, 10) || 0; });",
  "  const bParts = bCoreStr.split('.').map(function(p) { return parseInt(p, 10) || 0; });",
  '  const len = Math.max(aParts.length, bParts.length);',
  '  for (let i = 0; i < len; i++) {',
  '    const av = aParts[i] || 0;',
  '    const bv = bParts[i] || 0;',
  '    if (av < bv) return -1;',
  '    if (av > bv) return 1;',
  '  }',
  '  if (aPre && !bPre) return -1;',
  '  if (!aPre && bPre) return 1;',
  '  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;',
  '  return 0;',
  '}',
  '',
  'function parseLastKnownAffectedBound(rangeStr) {',
  "  if (!rangeStr || typeof rangeStr !== 'string') return null;",
  '  const trimmed = rangeStr.trim();',
  '  const m1 = trimmed.match(/^<=\\s*(\\S+)$/);',
  '  if (m1) return m1[1];',
  '  const m2 = trimmed.match(/^<\\s*(\\S+)$/);',
  '  if (m2) return m2[1];',
  '  return null;',
  '}',
  '',
  'function extractFixedIn(osvVuln) {',
  '  if (!Array.isArray(osvVuln.affected)) return null;',
  '  const npmFixed = [];',
  '  for (const aff of osvVuln.affected) {',
  "    if (!aff.package || aff.package.ecosystem !== 'npm') continue;",
  '    if (!Array.isArray(aff.ranges)) continue;',
  '    for (const range of aff.ranges) {',
  "      if (range.type !== 'ECOSYSTEM' && range.type !== 'SEMVER') continue;",
  '      if (!Array.isArray(range.events)) continue;',
  '      for (const ev of range.events) {',
  "        if (ev.fixed && typeof ev.fixed === 'string') npmFixed.push(ev.fixed);",
  '      }',
  '    }',
  '  }',
  '  if (npmFixed.length > 0) return minVersion(npmFixed);',
  '  const npmBounds = [];',
  '  for (const aff of osvVuln.affected) {',
  "    if (!aff.package || aff.package.ecosystem !== 'npm') continue;",
  '    const bound = parseLastKnownAffectedBound(',
  '      aff.database_specific && aff.database_specific.last_known_affected_version_range',
  '    );',
  '    if (bound) npmBounds.push(bound);',
  '  }',
  '  if (npmBounds.length > 0) return minVersion(npmBounds);',
  '  for (const aff of osvVuln.affected) {',
  '    if (!Array.isArray(aff.ranges)) continue;',
  '    for (const range of aff.ranges) {',
  '      if (!Array.isArray(range.events)) continue;',
  '      for (const ev of range.events) {',
  "        if (ev.fixed && typeof ev.fixed === 'string') return ev.fixed;",
  '      }',
  '    }',
  '  }',
  '  return null;',
  '}',
  '',
  'function isVersionSafe(installedVersion, osvVuln) {',
  '  if (!installedVersion || !osvVuln) return false;',
  '  const fixedIn = extractFixedIn(osvVuln);',
  '  if (!fixedIn) return false;',
  '  return compareVersions(installedVersion, fixedIn) >= 0;',
  '}',
].join('\n');

const OLD_EXPORTS =
  'module.exports = {\n  queryOSV,\n  fetchOsvRaw,\n  extractFixedIn,\n  extractSeverity,\n  extractAliases,\n  extractUrl,\n};';
const NEW_EXPORTS =
  'module.exports = {\n  queryOSV,\n  fetchOsvRaw,\n  extractFixedIn,\n  extractSeverity,\n  extractAliases,\n  extractUrl,\n  isVersionSafe,\n};';

patch(OSV_ENRICH, OLD_EXTRACT, NEW_EXTRACT, 'enrichment/osv-source.js (functions)');
patch(OSV_ENRICH, OLD_EXPORTS, NEW_EXPORTS, 'enrichment/osv-source.js (exports)');

// ── 2. scanner/sources/osv-source.js ─────────────────────────────────────────

const OSV_SCAN = 'src/main/modules/scanner/sources/osv-source.js';

patch(
  OSV_SCAN,
  "  fetchOsvRaw,\n  extractFixedIn,\n  extractSeverity,\n  extractAliases,\n  extractUrl,\n} = require('../../enrichment/sources/osv-source');",
  "  fetchOsvRaw,\n  extractFixedIn,\n  extractSeverity,\n  extractAliases,\n  extractUrl,\n  isVersionSafe,\n} = require('../../enrichment/sources/osv-source');",
  'scanner/osv-source.js (import)'
);

patch(
  OSV_SCAN,
  '    return vulns.map((v) => {',
  '    const safe = vulns.filter(function(v) { return !isVersionSafe(pkg.version, v); });\n    if (safe.length === 0) return [];\n    return safe.map((v) => {',
  'scanner/osv-source.js (filter)'
);

// ── 3. scanner/sources/nvd-source.js ─────────────────────────────────────────

const NVD_SCAN = 'src/main/modules/scanner/sources/nvd-source.js';

patch(
  NVD_SCAN,
  "  fetchOsvRaw,\n  extractFixedIn,\n  extractAliases,\n  extractSeverity,\n  extractUrl,\n} = require('../../enrichment/sources/osv-source');",
  "  fetchOsvRaw,\n  extractFixedIn,\n  extractAliases,\n  extractSeverity,\n  extractUrl,\n  isVersionSafe,\n} = require('../../enrichment/sources/osv-source');",
  'scanner/nvd-source.js (import)'
);

patch(
  NVD_SCAN,
  '    for (const v of vulns) {\n      const allAliases = extractAliases(v);',
  '    for (const v of vulns) {\n      if (isVersionSafe(pkg.version, v)) continue;\n      const allAliases = extractAliases(v);',
  'scanner/nvd-source.js (guard)'
);

// ── 4. scanner/sources/github-advisory-source.js ─────────────────────────────

const GH_SCAN = 'src/main/modules/scanner/sources/github-advisory-source.js';

patch(
  GH_SCAN,
  "  fetchOsvRaw,\n  extractFixedIn,\n  extractAliases,\n  extractSeverity,\n  extractUrl,\n} = require('../../enrichment/sources/osv-source');",
  "  fetchOsvRaw,\n  extractFixedIn,\n  extractAliases,\n  extractSeverity,\n  extractUrl,\n  isVersionSafe,\n} = require('../../enrichment/sources/osv-source');",
  'scanner/github-advisory-source.js (import)'
);

patch(
  GH_SCAN,
  '    for (const v of vulns) {\n      const allAliases = extractAliases(v);\n      const { cveIds, ghsaIds, aliases } = partitionAliases(allAliases);',
  '    for (const v of vulns) {\n      if (isVersionSafe(pkg.version, v)) continue;\n      const allAliases = extractAliases(v);\n      const { cveIds, ghsaIds, aliases } = partitionAliases(allAliases);',
  'scanner/github-advisory-source.js (guard)'
);

// ── 5. Verify + Rebuild ───────────────────────────────────────────────────────

const m = require('./src/main/modules/enrichment/sources/osv-source');
if (!m.isVersionSafe) {
  console.error('FATAL: isVersionSafe still not exported after patching!');
  process.exit(1);
}
console.log('Verification: isVersionSafe exported correctly');

console.log('Rebuilding dist-main/main.js ...');
execSync('node build-main.js', { stdio: 'inherit' });
console.log('Build complete.');

// Verify the bundle contains the fix
if (!bundle.includes('isVersionSafe')) {
  console.error('FATAL: isVersionSafe not in bundle after rebuild!');
  process.exit(1);
}
console.log('Bundle verification: isVersionSafe found in dist-main/main.js');
console.log('Done. Restart the app to pick up the fix.');
