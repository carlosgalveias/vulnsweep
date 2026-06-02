'use strict';

const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { generateSbom } = require('../main/modules/sbom-generator');

const { version: toolVersion } = JSON.parse(
  readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
);

/**
 * Extracts all unique packages from the runner result's project scan data.
 * Each scan result contains a `packages` array (PackageScanResult[]) with
 * name and version fields for every unique dependency in the project.
 *
 * @param {Array} projects - Array of scanProject results (may contain nulls)
 * @returns {Array<{name: string, version: string}>} Deduplicated package list
 */
function extractPackages(projects) {
  const seen = new Set();
  const packages = [];

  for (const project of projects) {
    if (!project || !Array.isArray(project.packages)) continue;

    for (const pkg of project.packages) {
      if (!pkg || !pkg.name || !pkg.version) continue;
      const key = `${pkg.name}@${pkg.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      packages.push({ name: pkg.name, version: pkg.version });
    }
  }

  return packages;
}

/**
 * Builds a synthetic LicenseScanResult structure from extracted packages.
 * The existing sbom-generator.js expects entries with license/purl/description.
 * Since the CLI audit scan doesn't perform license analysis, we use NOASSERTION.
 *
 * @param {Array<{name: string, version: string}>} packages
 * @param {string} projectName
 * @returns {{projectPath: string, projectName: string, entries: Array}}
 */
function buildSyntheticLicenseResult(packages, projectName) {
  return {
    projectPath: '',
    projectName,
    entries: packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: 'NOASSERTION',
      licenseRaw: '',
      riskTier: 'unknown',
      purl: pkg.name.startsWith('@')
        ? `pkg:npm/${encodeURIComponent(pkg.name)}@${pkg.version}`
        : `pkg:npm/${pkg.name}@${pkg.version}`,
      description: '',
    })),
  };
}

/**
 * Extracts vulnerability data from the runner result for CycloneDX output.
 * Maps unified vulnerabilities to CycloneDX v1.6 vulnerability entries.
 *
 * @param {Array} projects - Array of scanProject results
 * @returns {Array} CycloneDX vulnerability objects
 */
function extractVulnerabilities(projects) {
  const vulns = [];
  const seen = new Set();

  for (const project of projects) {
    if (!project || !Array.isArray(project.vulnerabilities)) continue;

    for (const vuln of project.vulnerabilities) {
      if (!vuln) continue;

      const ids = Array.isArray(vuln.cveIds) ? vuln.cveIds : [];
      const primaryId = ids[0] || vuln.title || vuln.id || null;
      if (!primaryId) continue;

      // Deduplicate by primary identifier
      if (seen.has(primaryId)) continue;
      seen.add(primaryId);

      const severity = (vuln.severity || 'unknown').toLowerCase();
      const score = typeof vuln.cvssScore === 'number' ? vuln.cvssScore : null;
      const pkgName = vuln.packageName || vuln.name || '';
      const pkgVersion = vuln.installedVersion || vuln.version || '';

      const entry = { id: primaryId, source: { name: 'NVD' } };

      if (score !== null || severity !== 'unknown') {
        const rating = {};
        if (severity !== 'unknown') rating.severity = severity;
        if (score !== null) rating.score = score;
        entry.ratings = [rating];
      }

      if (pkgName && pkgVersion) {
        const purl = pkgName.startsWith('@')
          ? `pkg:npm/${encodeURIComponent(pkgName)}@${pkgVersion}`
          : `pkg:npm/${pkgName}@${pkgVersion}`;
        entry.affects = [{ ref: purl }];
      }

      vulns.push(entry);
    }
  }

  return vulns;
}

/**
 * Derives a human-friendly project name from the runner result.
 *
 * @param {{projects: Array}} result - Runner result
 * @returns {string}
 */
function deriveProjectName(result) {
  const firstValid = (result.projects || []).find((p) => p && p.projectPath);
  if (!firstValid) return 'unknown-project';
  return path.basename(firstValid.projectPath);
}

/**
 * Writes an SBOM file from the CLI scan result.
 *
 * Reuses the existing `sbom-generator.js` for CycloneDX/SPDX serialisation,
 * then augments CycloneDX output with vulnerability data from the audit scan.
 *
 * @param {{type: string, projects: Array, summary: object, timestamp: string}} result
 *   The run result from runner.js (contains `projects` array of scan results)
 * @param {{sbom: string, format: 'cyclonedx' | 'spdx'}} opts
 *   CLI options — `sbom` is the file path, `format` is the SBOM format
 * @returns {string} The absolute file path written
 */
async function writeSbom(result, opts) {
  const format = opts.format || 'cyclonedx';
  const outputPath = path.resolve(opts.sbom);

  const projects = result.projects || [];
  const projectName = deriveProjectName(result);
  const packages = extractPackages(projects);

  // Build synthetic license result for sbom-generator compatibility
  const syntheticResult = buildSyntheticLicenseResult(packages, projectName);

  const meta = { name: projectName, version: '0.0.0', toolVersion };

  // Generate base SBOM via existing module
  let content = generateSbom(syntheticResult, format, meta);

  // For CycloneDX, inject vulnerabilities section from scan data
  if (format === 'cyclonedx') {
    const vulns = extractVulnerabilities(projects);
    if (vulns.length > 0) {
      const doc = JSON.parse(content);
      doc.vulnerabilities = vulns;
      content = JSON.stringify(doc, null, 2);
    }
  }

  // Ensure output directory exists and write
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');

  return outputPath;
}

module.exports = { writeSbom };
