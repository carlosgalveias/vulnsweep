'use strict';

/**
 * SBOM Generator Module (F8)
 *
 * Serialises a LicenseScanResult into CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV.
 * No external dependencies — uses only Node.js built-ins.
 */

const nodeCrypto = require('crypto');

// ============================================
// UUID helper (no external uuid package needed)
// ============================================

/**
 * Generate a UUID v4 string using Node.js built-in crypto module.
 * Uses crypto.randomUUID() available in Node 15+.
 * Falls back to Math.random() for safety.
 * @returns {string}
 */
function uuidv4() {
  if (typeof nodeCrypto.randomUUID === 'function') {
    return nodeCrypto.randomUUID();
  }
  // Fallback for older Node versions
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ============================================
// CSV helpers
// ============================================

/**
 * Escape a single CSV field value.
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 * Doubles any embedded double-quotes.
 * @param {string} value
 * @returns {string}
 */
function csvField(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================
// Serialisers
// ============================================

/**
 * Serialise components to CycloneDX JSON v1.6.
 * @param {Array<{type:string,name:string,version:string,purl:string,licenses:Array,description:string}>} components
 * @param {{name:string,version:string,toolVersion?:string}} meta
 * @returns {string}
 */
function serialiseCycloneDx(components, meta) {
  const doc = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${uuidv4()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'VulnSweep', name: 'VulnSweep', version: meta.toolVersion || '1.0.0' }],
      component: {
        type: 'application',
        name: meta.name,
        version: meta.version,
      },
    },
    components: components.map((c) => ({
      type: 'library',
      name: c.name,
      version: c.version,
      purl: c.purl,
      licenses: c.licenses.map((l) => ({ license: { id: l.id } })),
      description: c.description,
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * Serialise components to SPDX JSON v2.3.
 * @param {Array<{type:string,name:string,version:string,purl:string,licenses:Array,description:string}>} components
 * @param {{name:string,version:string,toolVersion?:string}} meta
 * @returns {string}
 */
function serialiseSpdx(components, meta) {
  const timestamp = new Date().toISOString();
  const doc = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: meta.name,
    documentNamespace: `https://vulnsweep.app/sbom/${meta.name}-${timestamp}`,
    creationInfo: {
      created: timestamp,
      creators: [`Tool: VulnSweep-${meta.toolVersion || '1.0.0'}`],
    },
    packages: components.map((c, index) => ({
      SPDXID: `SPDXRef-Package-${index}`,
      name: c.name,
      versionInfo: c.version,
      downloadLocation: `https://www.npmjs.com/package/${c.name}`,
      filesAnalyzed: false,
      licenseConcluded: c.licenses[0] ? c.licenses[0].id : 'NOASSERTION',
      licenseDeclared: c.licenses[0] ? c.licenses[0].id : 'NOASSERTION',
      copyrightText: 'NOASSERTION',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: c.purl,
        },
      ],
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * Serialise components to CSV.
 * Header: Name,Version,License,RiskTier,PURL,Description
 * @param {Array<{name:string,version:string,licenses:Array,riskTier:string,purl:string,description:string}>} components
 * @returns {string}
 */
function serialiseCsv(components) {
  const header = 'Name,Version,License,RiskTier,PURL,Description';
  const rows = components.map((c) => {
    const license = c.licenses[0] ? c.licenses[0].id : 'UNKNOWN';
    return [
      csvField(c.name),
      csvField(c.version),
      csvField(license),
      csvField(c.riskTier),
      csvField(c.purl),
      csvField(c.description),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

// ============================================
// Main exported function
// ============================================

/**
 * Generate a serialised SBOM string from a LicenseScanResult.
 *
 * @param {{
 *   projectPath: string,
 *   projectName: string,
 *   entries: Array<{name:string,version:string,license:string,licenseRaw:string,riskTier:string,purl:string,description:string}>
 * }} licenseResult - Result from scanLicenses()
 * @param {'cyclonedx'|'spdx'|'csv'} format - Output format
 * @param {{name:string,version:string,toolVersion?:string}} projectMeta - Project name, version, and VulnSweep tool version
 * @returns {string} Serialised SBOM content
 */
function generateSbom(licenseResult, format, projectMeta) {
  const components = licenseResult.entries.map((e) => ({
    type: 'library',
    name: e.name,
    version: e.version,
    purl: e.purl,
    licenses: [{ id: e.license }],
    description: e.description,
    riskTier: e.riskTier,
  }));

  const meta = {
    name: (projectMeta && projectMeta.name) || licenseResult.projectName,
    version: (projectMeta && projectMeta.version) || '0.0.0',
    toolVersion: (projectMeta && projectMeta.toolVersion) || '1.0.0',
  };

  if (format === 'cyclonedx') return serialiseCycloneDx(components, meta);
  if (format === 'spdx') return serialiseSpdx(components, meta);
  if (format === 'csv') return serialiseCsv(components);
  throw new Error(`Unknown SBOM format: ${format}`);
}

module.exports = { generateSbom };
