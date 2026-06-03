'use strict';

const { printAuditReport, printDependencyReport } = require('../../src/cli/console-reporter');

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
        },
        {
          id: 'GHSA-xxxx',
          title: 'Medium Issue',
          severity: 'medium',
          package: 'axios',
          installedVersion: '0.21.0',
          fixAvailable: false,
          fixVersion: null,
          sources: ['osv'],
        },
      ],
      strategies: [],
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

describe('console-reporter', () => {
  let writeSpy;
  let output;

  beforeEach(() => {
    output = '';
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += chunk;
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  describe('printAuditReport', () => {
    it('outputs vulnerability summary header', () => {
      printAuditReport(mockAuditResult, { noColor: true });
      expect(output).toContain('VULNERABILITY REPORT');
    });

    it('outputs severity counts', () => {
      printAuditReport(mockAuditResult, { noColor: true });
      expect(output).toContain('CRITICAL: 1');
      expect(output).toContain('MEDIUM: 1');
    });

    it('handles empty results gracefully', () => {
      const emptyResult = {
        type: 'audit',
        projects: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      expect(() => printAuditReport(emptyResult, { noColor: true })).not.toThrow();
      expect(output).toContain('VULNERABILITY REPORT');
      expect(output).toContain('Found: 0 vulnerabilities');
    });
  });

  describe('printDependencyReport', () => {
    it('outputs update summary', () => {
      printDependencyReport(mockDepResult, { noColor: true });
      expect(output).toContain('DEPENDENCY UPDATE REPORT');
      expect(output).toContain('lodash');
      expect(output).toContain('express');
    });

    it('handles empty results gracefully', () => {
      const emptyResult = {
        type: 'dependency',
        projects: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      expect(() => printDependencyReport(emptyResult, { noColor: true })).not.toThrow();
      expect(output).toContain('DEPENDENCY UPDATE REPORT');
    });
  });

  describe('noColor option', () => {
    it('respects noColor option (no ANSI escape codes in output)', () => {
      printAuditReport(mockAuditResult, { noColor: true });
      // ANSI codes start with ESC (0x1b) followed by [
      // eslint-disable-next-line no-control-regex
      const ansiRegex = new RegExp('\x1b\\[', 'g');
      expect(output).not.toMatch(ansiRegex);
    });
  });

  describe('box alignment', () => {
    it('box lines have consistent width (no overflow)', () => {
      // Use a result with multi-digit severity counts
      const mockResult = {
        type: 'audit',
        projects: [
          { name: 'test', path: '/test', findings: Array(123).fill({ severity: 'high' }) },
        ],
        summary: { total: 123, critical: 10, high: 99, medium: 12, low: 2, info: 0 },
      };
      printAuditReport(mockResult, { noColor: true });
      const boxLines = output
        .split('\n')
        .filter(
          (l) => l.startsWith('╔') || l.startsWith('║') || l.startsWith('╠') || l.startsWith('╚')
        );
      const widths = boxLines.map((l) => l.length);
      expect(new Set(widths).size).toBe(1);
    });
  });
});
