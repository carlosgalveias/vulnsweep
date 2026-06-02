'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeSbom } = require('../../src/cli/sbom-writer');

const mockAuditResult = {
  type: 'audit',
  projects: [
    {
      projectPath: '/test/project',
      projectName: 'test-project',
      vulnerabilities: [
        {
          id: 'CVE-2023-0001',
          title: 'Test Vuln',
          severity: 'critical',
          package: 'lodash',
          installedVersion: '4.17.15',
          fixAvailable: true,
          fixVersion: '4.17.21',
          sources: ['nvd'],
          cveIds: ['CVE-2023-0001'],
          packageName: 'lodash',
        },
      ],
      strategies: [],
      packages: [
        { name: 'lodash', version: '4.17.15' },
        { name: 'axios', version: '0.21.0' },
      ],
    },
  ],
  summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, info: 0 },
  timestamp: '2024-01-01T00:00:00.000Z',
};

describe('sbom-writer', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `vulnsweep-sbom-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates valid CycloneDX JSON', async () => {
    const sbomPath = path.join(tmpDir, 'sbom.json');
    const result = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    expect(fs.existsSync(result)).toBe(true);
    const content = JSON.parse(fs.readFileSync(result, 'utf8'));
    expect(content.bomFormat).toBe('CycloneDX');
  });

  it('generates valid SPDX JSON', async () => {
    const sbomPath = path.join(tmpDir, 'sbom-spdx.json');
    const result = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'spdx' });

    expect(fs.existsSync(result)).toBe(true);
    const content = JSON.parse(fs.readFileSync(result, 'utf8'));
    expect(content.spdxVersion).toBeDefined();
  });

  it('creates parent directories if they do not exist', async () => {
    const nestedPath = path.join(tmpDir, 'deep', 'nested', 'sbom.json');
    const result = await writeSbom(mockAuditResult, { sbom: nestedPath, format: 'cyclonedx' });

    expect(fs.existsSync(result)).toBe(true);
  });

  it('CycloneDX output has required fields (bomFormat, specVersion, components)', async () => {
    const sbomPath = path.join(tmpDir, 'cdx.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    const content = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    expect(content.bomFormat).toBe('CycloneDX');
    expect(content.specVersion).toBeDefined();
    expect(Array.isArray(content.components)).toBe(true);
    expect(content.components.length).toBeGreaterThan(0);
  });

  it('SPDX output has required fields (spdxVersion, dataLicense, packages)', async () => {
    const sbomPath = path.join(tmpDir, 'spdx.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'spdx' });

    const content = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    expect(content.spdxVersion).toBeDefined();
    expect(content.dataLicense).toBeDefined();
    expect(Array.isArray(content.packages)).toBe(true);
  });

  it('returns the written file path', async () => {
    const sbomPath = path.join(tmpDir, 'out.json');
    const result = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    expect(result).toBe(path.resolve(sbomPath));
  });
});
