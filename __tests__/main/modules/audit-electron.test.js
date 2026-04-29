/**
 * Regression: electron multi-advisory via + prerelease hyphen range.
 * Bug 1 (parser): title overwrote on each via iteration - pick highest CVSS.
 * Bug 2 (version-resolver): "X.Y.Z-pre - A.B.C" matched no pattern - NO_FIX.
 */
jest.mock('child_process', () => ({ exec: jest.fn() }));
jest.mock('fs', () => ({
  promises: { readFile: jest.fn(), writeFile: jest.fn(), access: jest.fn() },
}));

const { exec } = require('child_process');
const fs = require('fs').promises;
const audit = require('../../../src/main/modules/audit');

const AUDIT_DATA = {
  auditReportVersion: 2,
  vulnerabilities: {
    'aws-sdk': {
      name: 'aws-sdk',
      severity: 'low',
      isDirect: false,
      via: [
        {
          source: 1,
          name: 'aws-sdk',
          title: 'AWS SDK vuln',
          url: 'https://x.com/1',
          severity: 'low',
          cwe: ['CWE-20'],
          cvss: { score: 3.7 },
          range: '>=2.0.0',
        },
      ],
      effects: ['s3'],
      range: '>=2.0.1',
      nodes: ['node_modules/aws-sdk'],
      fixAvailable: false,
    },
    electron: {
      name: 'electron',
      severity: 'high',
      isDirect: false,
      via: [
        {
          source: 2,
          name: 'electron',
          title: 'Moderate: AppleScript injection',
          url: 'https://x.com/2',
          severity: 'moderate',
          cwe: ['CWE-78'],
          cvss: { score: 6.5 },
          range: '>=40.0.0-alpha.1 <40.8.0',
        },
        {
          source: 3,
          name: 'electron',
          title: 'High: Use-after-free in PowerMonitor',
          url: 'https://x.com/3',
          severity: 'high',
          cwe: ['CWE-416'],
          cvss: { score: 7.0 },
          range: '>=40.0.0-alpha.1 <40.8.0',
        },
        {
          source: 4,
          name: 'electron',
          title: 'Low: Unquoted executable path',
          url: 'https://x.com/4',
          severity: 'low',
          cwe: ['CWE-428'],
          cvss: { score: 3.9 },
          range: '>=40.0.0-alpha.1 <40.8.0',
        },
      ],
      effects: [],
      range: '40.0.0-alpha.2 - 40.8.4',
      nodes: ['node_modules/electron'],
      fixAvailable: true,
    },
    s3: {
      name: 's3',
      severity: 'low',
      isDirect: true,
      via: ['aws-sdk'],
      effects: [],
      range: '>=3.0.0',
      nodes: ['node_modules/s3'],
      fixAvailable: false,
    },
  },
};

describe('Electron vulnerability regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.clearCache();
    fs.access.mockRejectedValue(new Error('ENOENT'));
  });

  describe('parseVulnerabilities — multiple via advisory objects', () => {
    it('electron appears as root cause (was silently dropped before fix)', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      const v = r.find((x) => x.package === 'electron');
      expect(v).toBeDefined();
      expect(v.isRootCause).toBe(true);
    });

    it('returns 2 entries: electron + s3 (aws-sdk suppressed)', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      expect(r).toHaveLength(2);
      expect(r.map((x) => x.package).sort()).toEqual(['electron', 's3']);
    });

    it('aws-sdk is suppressed (fixAvailable:false with dependent s3)', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      expect(r.find((x) => x.package === 'aws-sdk')).toBeUndefined();
    });

    it('s3 is promoted with unfixableRootCause=aws-sdk', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      const s3 = r.find((x) => x.package === 's3');
      expect(s3).toBeDefined();
      expect(s3.isPromotedDependent).toBe(true);
      expect(s3.unfixableRootCause).toBe('aws-sdk');
    });

    it('electron.title is highest-CVSS advisory (7.0), NOT the last one (3.9)', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      const v = r.find((x) => x.package === 'electron');
      expect(v.title).toBe('High: Use-after-free in PowerMonitor');
      expect(v.url).toBe('https://x.com/3');
      expect(v.cwe).toEqual(['CWE-416']);
    });

    it('electron.via preserves all 3 raw advisory objects', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      const v = r.find((x) => x.package === 'electron');
      expect(v.via).toHaveLength(3);
      expect(v.via.every((i) => typeof i === 'object')).toBe(true);
    });

    it('electron.resolvesDependents is empty', async () => {
      const r = await audit.parseVulnerabilities(AUDIT_DATA, '/test/path');
      const v = r.find((x) => x.package === 'electron');
      expect(v.resolvesDependents).toEqual([]);
    });
  });

  describe('determineSafeVersion — prerelease hyphen range', () => {
    beforeEach(() => {
      exec.mockImplementation((cmd, options, cb) => {
        const p = new Promise((res) => {
          if (cmd.includes('versions --json')) {
            res({ stdout: JSON.stringify(['40.8.4', '40.8.5', '40.9.0']), stderr: '' });
          } else {
            res({ stdout: '40.9.0\n', stderr: '' });
          }
        });
        if (cb)
          p.then(
            (r) => cb(null, r),
            (e) => cb(e)
          );
        return p;
      });
    });

    it('prerelease hyphen range resolves to first version above upper bound', async () => {
      const v = await audit.determineSafeVersion('electron', '40.0.0-alpha.2 - 40.8.4', '40.7.0');
      expect(v).toBe('40.8.5');
    });

    it('plain hyphen range still works after the fix', async () => {
      // range "1.0.0 - 3.0.0" → safe range ">3.0.0" → minSatisfying(['40.8.4','40.8.5','40.9.0']) = '40.8.4'
      const v = await audit.determineSafeVersion('electron', '1.0.0 - 3.0.0', '2.0.0');
      expect(v).toBe('40.8.4');
    });
  });
});
