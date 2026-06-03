'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- Mock scanLicenses and generateSbom ---

const mockScanLicenses = jest.fn();
const mockGenerateSbom = jest.fn();

jest.mock('../../src/main/modules/license-scanner', () => ({
  scanLicenses: (...args) => mockScanLicenses(...args),
}));

jest.mock('../../src/main/modules/sbom-generator', () => ({
  generateSbom: (...args) => mockGenerateSbom(...args),
}));

const { writeSbom } = require('../../src/cli/sbom-writer');

// --- Fixtures ---

const fakeLicenseEntries = [
  {
    name: 'lodash',
    version: '4.17.21',
    license: 'MIT',
    licenseRaw: 'MIT',
    riskTier: 'safe',
    purl: 'pkg:npm/lodash@4.17.21',
    npmUrl: 'https://www.npmjs.com/package/lodash',
    description: 'Lodash modular utilities.',
    path: '/test/project/node_modules/lodash',
  },
  {
    name: 'axios',
    version: '1.6.0',
    license: 'MIT',
    licenseRaw: 'MIT',
    riskTier: 'safe',
    purl: 'pkg:npm/axios@1.6.0',
    npmUrl: 'https://www.npmjs.com/package/axios',
    description: 'Promise based HTTP client',
    path: '/test/project/node_modules/axios',
  },
];

const fakeLicenseResult = {
  projectPath: '/test/project',
  projectName: 'test-project',
  scannedAt: '2024-01-01T00:00:00.000Z',
  entries: fakeLicenseEntries,
  byLicense: { MIT: 2 },
  stats: { total: 2, safe: 2, warning: 0, dangerous: 0, unknown: 0 },
};

const mockCycloneDxOutput = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { name: 'test-project', version: '0.0.0' } },
  components: [
    {
      type: 'library',
      name: 'lodash',
      version: '4.17.21',
      purl: 'pkg:npm/lodash@4.17.21',
      licenses: [{ id: 'MIT' }],
      description: 'Lodash modular utilities.',
      riskTier: 'safe',
    },
    {
      type: 'library',
      name: 'axios',
      version: '1.6.0',
      purl: 'pkg:npm/axios@1.6.0',
      licenses: [{ id: 'MIT' }],
      description: 'Promise based HTTP client',
      riskTier: 'safe',
    },
  ],
});

const mockSpdxOutput = JSON.stringify({
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  name: 'test-project',
  packages: [
    { name: 'lodash', versionInfo: '4.17.21', licenseDeclared: 'MIT' },
    { name: 'axios', versionInfo: '1.6.0', licenseDeclared: 'MIT' },
  ],
});

const mockCsvOutput =
  'name,version,license,purl,riskTier\nlodash,4.17.21,MIT,pkg:npm/lodash@4.17.21,safe\naxios,1.6.0,MIT,pkg:npm/axios@1.6.0,safe\n';

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

// --- Tests ---

describe('sbom-writer', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `vulnsweep-sbom-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mockScanLicenses.mockReset();
    mockGenerateSbom.mockReset();

    // Default mocks
    mockScanLicenses.mockResolvedValue(fakeLicenseResult);
    mockGenerateSbom.mockReturnValue(mockCycloneDxOutput);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('calls scanLicenses() for each project with a valid projectPath', async () => {
    const multiProjectResult = {
      ...mockAuditResult,
      projects: [
        { projectPath: '/project/one', vulnerabilities: [] },
        { projectPath: '/project/two', vulnerabilities: [] },
      ],
    };

    const sbomPath = path.join(tmpDir, 'sbom.json');
    await writeSbom(multiProjectResult, { sbom: sbomPath, format: 'cyclonedx' });

    expect(mockScanLicenses).toHaveBeenCalledTimes(2);
    expect(mockScanLicenses).toHaveBeenCalledWith('/project/one');
    expect(mockScanLicenses).toHaveBeenCalledWith('/project/two');
  });

  it('skips projects without a projectPath', async () => {
    const result = {
      ...mockAuditResult,
      projects: [
        { projectPath: '/valid/path', vulnerabilities: [] },
        { projectPath: null, vulnerabilities: [] },
        { vulnerabilities: [] },
      ],
    };

    const sbomPath = path.join(tmpDir, 'sbom.json');
    await writeSbom(result, { sbom: sbomPath, format: 'cyclonedx' });

    expect(mockScanLicenses).toHaveBeenCalledTimes(1);
    expect(mockScanLicenses).toHaveBeenCalledWith('/valid/path');
  });

  it('generates valid CycloneDX JSON with populated components', async () => {
    const sbomPath = path.join(tmpDir, 'sbom.json');
    const resultPath = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    expect(fs.existsSync(resultPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(content.bomFormat).toBe('CycloneDX');
    expect(content.specVersion).toBeDefined();
    expect(Array.isArray(content.components)).toBe(true);
    expect(content.components.length).toBe(2);
    expect(content.components[0]).toMatchObject({
      type: 'library',
      name: 'lodash',
      version: '4.17.21',
      licenses: [{ id: 'MIT' }],
    });
  });

  it('CycloneDX output does NOT contain a vulnerabilities section', async () => {
    const sbomPath = path.join(tmpDir, 'cdx.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    const content = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    expect(content.vulnerabilities).toBeUndefined();
  });

  it('generates valid SPDX JSON', async () => {
    mockGenerateSbom.mockReturnValue(mockSpdxOutput);

    const sbomPath = path.join(tmpDir, 'sbom-spdx.json');
    const resultPath = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'spdx' });

    expect(fs.existsSync(resultPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(content.spdxVersion).toBeDefined();
    expect(content.dataLicense).toBeDefined();
    expect(Array.isArray(content.packages)).toBe(true);
    expect(content.packages.length).toBeGreaterThan(0);
  });

  it('SPDX output does NOT contain a vulnerabilities section', async () => {
    mockGenerateSbom.mockReturnValue(mockSpdxOutput);

    const sbomPath = path.join(tmpDir, 'spdx.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'spdx' });

    const content = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    expect(content.vulnerabilities).toBeUndefined();
  });

  it('generates CSV format', async () => {
    mockGenerateSbom.mockReturnValue(mockCsvOutput);

    const sbomPath = path.join(tmpDir, 'sbom.csv');
    const resultPath = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'csv' });

    expect(fs.existsSync(resultPath)).toBe(true);
    const content = fs.readFileSync(resultPath, 'utf8');
    expect(content).toContain('lodash');
    expect(content).toContain('MIT');
    expect(content).not.toContain('vulnerabilities');
  });

  it('passes merged license entries to generateSbom()', async () => {
    const sbomPath = path.join(tmpDir, 'sbom.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    expect(mockGenerateSbom).toHaveBeenCalledTimes(1);
    const [licenseResultArg, formatArg, metaArg] = mockGenerateSbom.mock.calls[0];

    expect(formatArg).toBe('cyclonedx');
    expect(licenseResultArg.entries).toEqual(fakeLicenseEntries);
    expect(licenseResultArg.projectName).toBe('project');
    expect(metaArg).toMatchObject({
      name: 'project',
      version: '0.0.0',
    });
    expect(metaArg.toolVersion).toBeDefined();
  });

  it('deduplicates entries across multiple projects by name@version', async () => {
    const duplicateLicenseResult = {
      ...fakeLicenseResult,
      projectPath: '/test/project2',
      projectName: 'project2',
    };

    mockScanLicenses
      .mockResolvedValueOnce(fakeLicenseResult)
      .mockResolvedValueOnce(duplicateLicenseResult);

    const multiProjectResult = {
      ...mockAuditResult,
      projects: [
        { projectPath: '/test/project', vulnerabilities: [] },
        { projectPath: '/test/project2', vulnerabilities: [] },
      ],
    };

    const sbomPath = path.join(tmpDir, 'sbom.json');
    await writeSbom(multiProjectResult, { sbom: sbomPath, format: 'cyclonedx' });

    const [licenseResultArg] = mockGenerateSbom.mock.calls[0];
    // Both projects have same lodash@4.17.21 and axios@1.6.0, should be deduplicated
    expect(licenseResultArg.entries).toHaveLength(2);
  });

  it('creates parent directories if they do not exist', async () => {
    const nestedPath = path.join(tmpDir, 'deep', 'nested', 'sbom.json');
    const resultPath = await writeSbom(mockAuditResult, { sbom: nestedPath, format: 'cyclonedx' });

    expect(fs.existsSync(resultPath)).toBe(true);
  });

  it('returns the written file path', async () => {
    const sbomPath = path.join(tmpDir, 'out.json');
    const resultPath = await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    expect(resultPath).toBe(path.resolve(sbomPath));
  });

  it('defaults to cyclonedx format when format is not specified', async () => {
    const sbomPath = path.join(tmpDir, 'default.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath });

    expect(mockGenerateSbom).toHaveBeenCalledWith(
      expect.any(Object),
      'cyclonedx',
      expect.any(Object)
    );
  });

  it('gracefully handles scanLicenses failure for a project', async () => {
    mockScanLicenses
      .mockRejectedValueOnce(new Error('scan failed'))
      .mockResolvedValueOnce(fakeLicenseResult);

    const result = {
      ...mockAuditResult,
      projects: [
        { projectPath: '/project/broken', vulnerabilities: [] },
        { projectPath: '/project/working', vulnerabilities: [] },
      ],
    };

    const sbomPath = path.join(tmpDir, 'sbom.json');
    await writeSbom(result, { sbom: sbomPath, format: 'cyclonedx' });

    expect(mockScanLicenses).toHaveBeenCalledTimes(2);
    // Still generates SBOM with the successful project's data
    expect(mockGenerateSbom).toHaveBeenCalledTimes(1);
    const [licenseResultArg] = mockGenerateSbom.mock.calls[0];
    expect(licenseResultArg.entries).toEqual(fakeLicenseEntries);
  });

  it('handles empty projects array', async () => {
    const result = { ...mockAuditResult, projects: [] };

    const sbomPath = path.join(tmpDir, 'sbom.json');
    await writeSbom(result, { sbom: sbomPath, format: 'cyclonedx' });

    expect(mockScanLicenses).not.toHaveBeenCalled();
    expect(mockGenerateSbom).toHaveBeenCalledTimes(1);
    const [licenseResultArg] = mockGenerateSbom.mock.calls[0];
    expect(licenseResultArg.entries).toEqual([]);
  });

  it('components contain license information from scanLicenses', async () => {
    const sbomPath = path.join(tmpDir, 'license-check.json');
    await writeSbom(mockAuditResult, { sbom: sbomPath, format: 'cyclonedx' });

    const content = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    // Verify components have license info
    for (const comp of content.components) {
      expect(comp.licenses).toBeDefined();
      expect(comp.licenses.length).toBeGreaterThan(0);
      expect(comp.licenses[0].id).toBe('MIT');
    }
  });
});
