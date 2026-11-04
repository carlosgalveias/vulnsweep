'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateHtmlReport } = require('../../src/cli/html-report-generator');

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
          patchedVersion: '4.17.21',
          sources: ['nvd'],
        },
        {
          id: 'GHSA-xxxx',
          title: 'Medium Issue',
          severity: 'medium',
          package: 'axios',
          installedVersion: '0.21.0',
          patchedVersion: null,
          sources: ['osv'],
        },
      ],
      strategies: [
        {
          type: 'BUMP_DIRECT',
          package: 'lodash',
          currentVersion: '4.17.15',
          targetVersion: '4.17.21',
          riskLevel: 'LOW',
          reason: 'Bump lodash to 4.17.21',
        },
        {
          type: 'NO_FIX',
          package: 'axios',
          currentVersion: '0.21.0',
          targetVersion: null,
          riskLevel: null,
          reason: 'No fix available upstream',
        },
      ],
      packages: [
        { name: 'lodash', version: '4.17.15' },
        { name: 'axios', version: '0.21.0' },
      ],
    },
  ],
  summary: { total: 2, critical: 1, high: 0, medium: 1, low: 0, info: 0 },
  timestamp: '2024-01-01T00:00:00.000Z',
};

const mockDepResult = {
  type: 'dependency',
  projects: [
    {
      projectPath: '/test/project',
      projectName: 'test-project',
      updates: [
        {
          name: 'lodash',
          currentVersion: '4.17.15',
          recommendedVersion: '4.17.21',
          latestVersion: '4.17.21',
          riskLevel: 'Low',
          updateType: 'patch',
        },
        {
          name: 'express',
          currentVersion: '4.17.1',
          recommendedVersion: '5.0.0',
          latestVersion: '5.0.0',
          riskLevel: 'High',
          updateType: 'major',
        },
      ],
    },
  ],
  summary: { total: 2, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  timestamp: '2024-01-01T00:00:00.000Z',
};

describe('html-report-generator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `vulnsweep-html-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates HTML file in specified directory', async () => {
    const result = await generateHtmlReport(mockAuditResult, { reportDir: tmpDir });
    expect(fs.existsSync(result)).toBe(true);
    expect(result.endsWith('.html')).toBe(true);
  });

  it('HTML contains Chart.js script tag', async () => {
    const filePath = await generateHtmlReport(mockAuditResult, { reportDir: tmpDir });
    const html = fs.readFileSync(filePath, 'utf8');
    expect(html).toContain('chart.js');
  });

  it('HTML contains vulnerability data for audit type', async () => {
    const filePath = await generateHtmlReport(mockAuditResult, { reportDir: tmpDir });
    const html = fs.readFileSync(filePath, 'utf8');
    expect(html).toContain('CVE-2023-0001');
    expect(html).toContain('lodash');
  });

  it('HTML contains update data for dependency type', async () => {
    const filePath = await generateHtmlReport(mockDepResult, { reportDir: tmpDir });
    const html = fs.readFileSync(filePath, 'utf8');
    expect(html).toContain('lodash');
    expect(html).toContain('express');
  });

  it('creates report directory if it does not exist', async () => {
    const nestedDir = path.join(tmpDir, 'deep', 'nested');
    const result = await generateHtmlReport(mockAuditResult, { reportDir: nestedDir });
    expect(fs.existsSync(result)).toBe(true);
  });

  it('filename matches pattern vulnsweep-report-YYYY-MM-DD.html', async () => {
    const result = await generateHtmlReport(mockAuditResult, { reportDir: tmpDir });
    const filename = path.basename(result);
    expect(filename).toMatch(/^vulnsweep-report-\d{4}-\d{2}-\d{2}\.html$/);
  });

  it('HTML contains fix status from strategy data', async () => {
    const filePath = await generateHtmlReport(mockAuditResult, { reportDir: tmpDir });
    const html = fs.readFileSync(filePath, 'utf8');
    expect(html).toContain('fix-yes');
    expect(html).toContain('fix-no');
    expect(html).toContain('4.17.21');
  });
});
