'use strict';

const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { scanLicenses } = require('../main/modules/license-scanner');
const { generateSbom } = require('../main/modules/sbom-generator');

const { version: toolVersion } = JSON.parse(
  readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
);

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
 * Writes an SBOM file (license/component inventory) from the CLI scan result.
 *
 * Runs scanLicenses() on each discovered project path to obtain real license
 * data, merges entries across projects (deduplicating by name@version), then
 * passes the combined result to generateSbom() for serialisation.
 *
 * @param {{type: string, projects: Array, summary: object, timestamp: string}} result
 *   The run result from runner.js (contains `projects` array of scan results)
 * @param {{sbom: string, format: 'cyclonedx' | 'spdx' | 'csv'}} opts
 *   CLI options — `sbom` is the file path, `format` is the SBOM format
 * @returns {string} The absolute file path written
 */
async function writeSbom(result, opts) {
  const format = opts.format || 'cyclonedx';
  const outputPath = path.resolve(opts.sbom);

  const projects = result.projects || [];
  const projectName = deriveProjectName(result);

  // Collect license entries from all project paths
  const seen = new Set();
  const mergedEntries = [];

  for (const project of projects) {
    if (!project || !project.projectPath) continue;

    let licenseResult;
    try {
      licenseResult = await scanLicenses(project.projectPath);
    } catch {
      // If license scanning fails for a project, skip it
      continue;
    }

    if (!licenseResult || !Array.isArray(licenseResult.entries)) continue;

    for (const entry of licenseResult.entries) {
      if (!entry || !entry.name || !entry.version) continue;
      const key = `${entry.name}@${entry.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mergedEntries.push(entry);
    }
  }

  // Build combined license result for the SBOM generator
  const combinedLicenseResult = {
    projectPath: '',
    projectName,
    entries: mergedEntries,
  };

  const meta = { name: projectName, version: '0.0.0', toolVersion };

  // Generate SBOM via existing module (no vulnerability injection)
  const content = generateSbom(combinedLicenseResult, format, meta);

  // Ensure output directory exists and write
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');

  return outputPath;
}

module.exports = { writeSbom };
