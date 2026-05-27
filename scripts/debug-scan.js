/* eslint-disable no-console */
'use strict';

/**
 * Diagnostic + verification script: checks that after the fixes, babel-traverse
 * and xlsx are no longer flagged as vulnerable for _examples/proj0.
 *
 * Run: node scripts/debug-scan.js
 */

const path = require('path');
const { fetchOsvRaw } = require('../src/main/modules/enrichment/sources/osv-source');
const {
  buildPackageUniverse,
  getUniqueQueryTargets,
} = require('../src/main/modules/scanner/package-universe-builder');
const osvSource = require('../src/main/modules/scanner/sources/osv-source');

const PROJECT_PATH = path.resolve(__dirname, '..', '_examples', 'proj0');
const TARGETS_OF_INTEREST = new Set(['babel-traverse', '@babel/traverse', 'xlsx']);

async function main() {
  console.log('=== VulnSweep Diagnostic Script ===\n');
  console.log(`Project: ${PROJECT_PATH}\n`);

  // Step 1: Build the package universe and show what pkg descriptors are created
  console.log('--- Step 1: Package Universe Descriptors (ALL packages) ---');
  const universe = await buildPackageUniverse(PROJECT_PATH);
  const targets = getUniqueQueryTargets(universe);

  console.log('All packages in universe:');
  for (const p of universe) {
    const flag = TARGETS_OF_INTEREST.has(p.name) ? ' <-- INTERESTING' : '';
    console.log(
      `  name="${p.name}" version="${p.version}" resolved="${p.resolved || '(none)'}"${flag}`
    );
  }

  const interesting = universe.filter((p) => TARGETS_OF_INTEREST.has(p.name));
  console.log(`\n--- Interesting packages found: ${interesting.length} ---`);
  if (interesting.length === 0) {
    console.log(
      '  NONE. The names babel-traverse, @babel/traverse, xlsx were NOT in the universe!'
    );
    console.log('  This means buildPackageUniverse is using a DIFFERENT name for these packages.');
    console.log('  Check what name the lockfile key produces above.');
  } else {
    for (const p of interesting) {
      console.log(`  FOUND: name="${p.name}" version="${p.version}"`);
      console.log(`         isDirect=${p.isDirect} resolved="${p.resolved || '(none)'}"`);
    }
  }

  console.log('\n--- Step 2: OSV Scanner Source query() Results (after fixes) ---');
  for (const pkg of targets) {
    if (!TARGETS_OF_INTEREST.has(pkg.name)) continue;

    const fullPkg = Object.assign(
      {},
      universe.find((u) => u.name === pkg.name && u.version === pkg.version) || pkg,
      {
        projectPath: PROJECT_PATH,
      }
    );

    console.log(`\n  Testing scanner/osv-source.query() for: ${pkg.name}@${pkg.version}`);
    try {
      const results = await osvSource.query(fullPkg);
      if (!results || results.length === 0) {
        console.log('  -> scanner OSV source returned 0 results (CLEAN - PASS)');
      } else {
        console.log(
          `  -> scanner OSV source returned ${results.length} results (STILL FLAGGED - FAIL!)`
        );
        for (const r of results) {
          console.log(
            `     - cveIds: ${(r.cveIds || []).join(', ')} aliases: ${(r.aliases || []).join(', ')}`
          );
          console.log(`       title: ${r.title}`);
        }
      }
    } catch (err) {
      console.log(`  -> scanner OSV source ERROR: ${err.message}`);
    }

    // Also show raw OSV data for context
    console.log(`  (Raw OSV API for ${pkg.name}@${pkg.version}):`);
    try {
      const rawVulns = await fetchOsvRaw(pkg.name, pkg.version, 'npm');
      console.log(
        `    Raw OSV returned ${rawVulns ? rawVulns.length : 0} entries before range filtering`
      );
    } catch (err) {
      console.log(`    Raw OSV ERROR: ${err.message}`);
    }
  }

  // Step 3: Also check what OSV returns for @babel/traverse (what it SHOULD query)
  console.log('\n--- Step 3: What OSV says about @babel/traverse@7.29.7 (the REAL package) ---');
  try {
    const vulns2 = await fetchOsvRaw('@babel/traverse', '7.29.7', 'npm');
    if (!vulns2 || vulns2.length === 0) {
      console.log(
        '  -> OSV returned 0 vulnerabilities for @babel/traverse@7.29.7 (CLEAN - correct!)'
      );
    } else {
      console.log(
        `  -> OSV returned ${vulns2.length} vulns for @babel/traverse@7.29.7 (would also be flagged)`
      );
    }
  } catch (err) {
    console.log(`  -> OSV ERROR for @babel/traverse: ${err.message}`);
  }

  console.log('\n--- Step 4: What does the lockfile entry contain? ---');
  const babelEntry = universe.find((p) => p.version === '7.29.7');
  if (babelEntry) {
    console.log('  Full descriptor for version 7.29.7 package:');
    console.log(`  ${JSON.stringify(babelEntry, null, 2).replace(/\n/g, '\n  ')}`);
  }

  console.log('\n--- Step 5: Lockfile raw entry for node_modules/babel-traverse ---');
  const lockfile = require('../_examples/proj0/package-lock.json');
  const entry = lockfile.packages && lockfile.packages['node_modules/babel-traverse'];
  if (entry) {
    console.log(`  lockfile key "node_modules/babel-traverse" has entry.name = "${entry.name}"`);
    console.log(`  Full entry: ${JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ')}`);
  } else {
    console.log('  entry not found (unexpected)');
  }

  console.log('\n=== Diagnosis Summary ===');
  const babeInUniverse = universe.find((p) => p.name === 'babel-traverse');
  const atBabelInUniverse = universe.find((p) => p.name === '@babel/traverse');
  if (babeInUniverse) {
    console.log('BUG CONFIRMED: package-universe-builder used key-derived name "babel-traverse"');
    console.log('  instead of entry.name "@babel/traverse".');
    console.log(
      '  OSV will query for the OLD deprecated "babel-traverse" package which has vulnerabilities.'
    );
    console.log(
      `  The installed package is actually "@babel/traverse@${babeInUniverse.version}" which is CLEAN.`
    );
  } else if (atBabelInUniverse) {
    console.log('OK: package-universe-builder correctly used "@babel/traverse".');
    console.log('  The problem is elsewhere (OSV is flagging the correct package).');
  } else {
    console.log('UNEXPECTED: neither "babel-traverse" nor "@babel/traverse" found in universe.');
  }
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
