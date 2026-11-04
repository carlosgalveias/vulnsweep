'use strict';
/* eslint-disable no-console */
/**
 * Full pipeline scan of _examples/proj0 using the same scanner-orchestrator
 * that the Electron app uses. Outputs JSON array of vulnerabilities found.
 * If the array is empty, the fix is working.
 *
 * Run: node scripts/full-scan-proj0.js
 *
 * Note: When running without an NVD API key the NVD rate-limit queue enforces
 * 6 s between calls (free tier). With ~54 packages this requires up to 324 s of
 * queue depth. perPackageTimeoutMs is set to 600 000 ms (10 min) so no package
 * times out while waiting in the serial NVD queue.
 * The Electron UI is unaffected — it reads the API key from secure storage and
 * uses the 600 ms key-tier rate limit instead (< 1 min total).
 */
const path = require('path');
const { scanProject } = require('../src/main/modules/scanner/scanner-orchestrator');

const PROJECT_PATH = path.resolve(__dirname, '..', '_examples', 'proj0');

// 10 minutes — enough headroom for the full NVD queue at free-tier rate (6 s/call x 54 pkgs)
const PER_PACKAGE_TIMEOUT_MS = 10 * 60 * 1000;

async function main() {
  console.error(`Scanning ${PROJECT_PATH} ...`);
  const result = await scanProject(PROJECT_PATH, {
    enabledSources: ['npm-audit', 'osv', 'nvd', 'github-advisory', 'cisa-kev', 'epss'],
    perPackageTimeoutMs: PER_PACKAGE_TIMEOUT_MS,
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
