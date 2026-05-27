'use strict';
/* eslint-disable no-console */
/**
 * Full pipeline scan of _examples/proj0 using the same scanner-orchestrator
 * that the Electron app uses. Outputs JSON array of vulnerabilities found.
 * If the array is empty, the fix is working.
 *
 * Run: node scripts/full-scan-proj0.js
 */
const path = require('path');
const { scanProject } = require('../src/main/modules/scanner/scanner-orchestrator');

const PROJECT_PATH = path.resolve(__dirname, '..', '_examples', 'proj0');

async function main() {
  console.error(`Scanning ${PROJECT_PATH} ...`);
  const result = await scanProject(PROJECT_PATH, {
    enabledSources: ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'],
  });
  const vulns = (result.vulnerabilities || []).map((v) => ({
    package: v.package,
    installedVersion: v.installedVersion,
    patchedVersion: v.patchedVersion,
    severity: v.severity,
    cveIds: v.cveIds,
    sources: v.sources,
    title: v.title,
  }));
  console.log(JSON.stringify(vulns, null, 2));
  console.error(`Total vulnerabilities: ${vulns.length}`);
  if (vulns.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(2);
});
