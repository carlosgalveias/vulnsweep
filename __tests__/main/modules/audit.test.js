/**
 * Tests for audit.js module
 *
 * Tests the core audit and remediation engine functionality
 */

// jest.mock() calls are hoisted by Babel — they must appear before any require()
// that imports a module which uses the mocked dependency. Order here is intentional.
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    access: jest.fn(),
  },
}));

// Built-in modules
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
// Local modules
const audit = require('../../../src/main/modules/audit');
// Test fixtures
const npmAuditExactVersion = require('../../fixtures/npm-audit-exact-version.json');
const npmAuditPostcssIndirect = require('../../fixtures/npm-audit-postcss-indirect.json');
const npmAuditRealWorld = require('../../fixtures/npm-audit-real-world.json');
const npmAuditSample = require('../../fixtures/npm-audit-sample.json');
const packageLockSample = require('../../fixtures/package-lock.json');
const packageJsonSample = require('../../fixtures/package.json');
describe('audit module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.clearCache(); // Clear registry cache between tests
  });

  describe('parseVulnerabilities', () => {
    it('should parse npm audit data correctly', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditSample, '/test/path');

      // fixture: lodash, ajv, minimist (root causes kept) + semver-dependent (filtered out as pure
      // dependent) + uuid (root cause, fixAvailable:false → suppressed, promotes @cypress/request
      // and ari-client as promoted dependents) → 3 root causes + 2 promoted = 5 total
      expect(vulnerabilities).toHaveLength(5);

      const lodashVuln = vulnerabilities.find((v) => v.package === 'lodash');
      expect(lodashVuln).toBeDefined();
      expect(lodashVuln.severity).toBe('high');
      expect(lodashVuln.isDirect).toBe(true);
    });

    it('should return empty array for no vulnerabilities', async () => {
      const emptyAudit = { vulnerabilities: {} };
      const vulnerabilities = await audit.parseVulnerabilities(emptyAudit, '/test/path');

      expect(vulnerabilities).toEqual([]);
    });

    it('should handle null or undefined audit data', async () => {
      const vulnerabilities1 = await audit.parseVulnerabilities(null, '/test/path');
      const vulnerabilities2 = await audit.parseVulnerabilities(undefined, '/test/path');

      expect(vulnerabilities1).toEqual([]);
      expect(vulnerabilities2).toEqual([]);
    });

    it('should extract vulnerability details correctly', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditSample, '/test/path');

      const lodashVuln = vulnerabilities.find((v) => v.package === 'lodash');
      expect(lodashVuln.vulnerableRange).toBe('<4.17.21');
      expect(lodashVuln.severity).toBe('high');
      expect(lodashVuln.isDirect).toBe(true);
      expect(lodashVuln.title).toContain('Prototype Pollution');
    });

    // ── Root-cause classification ─────────────────────────────────────────────

    it('should set isRootCause: true when via contains at least one object', async () => {
      const auditData = {
        vulnerabilities: {
          'vuln-pkg': {
            severity: 'high',
            isDirect: true,
            via: [
              {
                source: 1,
                title: 'RCE',
                url: 'https://example.com',
                cwe: ['CWE-94'],
                range: '<2.0.0',
              },
            ],
            range: '<2.0.0',
            nodes: ['node_modules/vuln-pkg'],
            fixAvailable: { name: 'vuln-pkg', version: '2.0.0', isSemVerMajor: false },
          },
        },
      };

      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');

      expect(vulnerabilities).toHaveLength(1);
      expect(vulnerabilities[0].package).toBe('vuln-pkg');
      expect(vulnerabilities[0].isRootCause).toBe(true);
    });

    it('should filter OUT a package whose via contains only strings (pure dependent)', async () => {
      const auditData = {
        vulnerabilities: {
          'root-pkg': {
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 1,
                title: 'Vuln',
                url: 'https://example.com',
                cwe: ['CWE-1321'],
                range: '<1.0.0',
              },
            ],
            range: '<1.0.0',
            nodes: ['node_modules/root-pkg'],
            fixAvailable: true,
          },
          'dependent-pkg': {
            severity: 'high',
            isDirect: false,
            via: ['root-pkg'],
            range: '<1.0.0',
            nodes: ['node_modules/dependent-pkg/node_modules/root-pkg'],
            fixAvailable: true,
          },
        },
      };

      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');

      expect(vulnerabilities).toHaveLength(1);
      expect(vulnerabilities[0].package).toBe('root-pkg');
      expect(vulnerabilities.find((v) => v.package === 'dependent-pkg')).toBeUndefined();
    });

    it('should populate resolvesDependents correctly from fixture', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditSample, '/test/path');

      // lodash -> semver-dependent (via: ["lodash"]) added in the fixture
      const lodashVuln = vulnerabilities.find((v) => v.package === 'lodash');
      expect(lodashVuln).toBeDefined();
      expect(lodashVuln.isRootCause).toBe(true);
      expect(Array.isArray(lodashVuln.resolvesDependents)).toBe(true);
      expect(lodashVuln.resolvesDependents).toContain('semver-dependent');
    });

    // ── No-fix promotion tests ───────────────────────────────────────────────

    it('root cause with fixAvailable:false and dependents → suppressed, dependents promoted', async () => {
      const auditData = {
        vulnerabilities: {
          'unfixable-root': {
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 5,
                title: 'Unfixable',
                url: 'https://x.com',
                cwe: ['CWE-200'],
                range: '*',
              },
            ],
            range: '*',
            nodes: ['node_modules/unfixable-root'],
            fixAvailable: false,
          },
          'dep-a': {
            severity: 'high',
            isDirect: false,
            via: ['unfixable-root'],
            range: '*',
            nodes: ['node_modules/dep-a'],
            fixAvailable: false,
          },
          'dep-b': {
            severity: 'high',
            isDirect: false,
            via: ['unfixable-root'],
            range: '*',
            nodes: ['node_modules/dep-b'],
            fixAvailable: false,
          },
        },
      };
      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');
      expect(vulnerabilities.find((v) => v.package === 'unfixable-root')).toBeUndefined();
      expect(vulnerabilities).toHaveLength(2);
      expect(vulnerabilities.find((v) => v.package === 'dep-a')).toBeDefined();
      expect(vulnerabilities.find((v) => v.package === 'dep-b')).toBeDefined();
    });

    it('promoted dependents have isPromotedDependent:true and correct unfixableRootCause', async () => {
      const auditData = {
        vulnerabilities: {
          'no-fix-root': {
            severity: 'critical',
            isDirect: false,
            via: [
              {
                source: 6,
                title: 'Critical',
                url: 'https://x.com/6',
                cwe: ['CWE-78'],
                range: '*',
              },
            ],
            range: '*',
            nodes: ['node_modules/no-fix-root'],
            fixAvailable: false,
          },
          'my-dependent': {
            severity: 'critical',
            isDirect: false,
            via: ['no-fix-root'],
            range: '*',
            nodes: ['node_modules/my-dependent'],
            fixAvailable: false,
          },
        },
      };
      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');
      expect(vulnerabilities).toHaveLength(1);
      const promoted = vulnerabilities[0];
      expect(promoted.package).toBe('my-dependent');
      expect(promoted.isPromotedDependent).toBe(true);
      expect(promoted.unfixableRootCause).toBe('no-fix-root');
      expect(promoted.isRootCause).toBe(false);
    });

    it('should treat a mixed via array (objects + strings) as a root cause', async () => {
      const auditData = {
        vulnerabilities: {
          'other-root': {
            severity: 'low',
            isDirect: false,
            via: [
              {
                source: 99,
                title: 'Issue',
                url: 'https://example.com',
                cwe: ['CWE-200'],
                range: '<3.0.0',
              },
            ],
            range: '<3.0.0',
            nodes: ['node_modules/other-root'],
            fixAvailable: true,
          },
          'mixed-pkg': {
            severity: 'moderate',
            isDirect: false,
            // mixed: one advisory object AND one string reference
            via: [
              {
                source: 2,
                title: 'Mixed issue',
                url: 'https://example.com/2',
                cwe: ['CWE-400'],
                range: '<2.0.0',
              },
              'other-root',
            ],
            range: '<2.0.0',
            nodes: ['node_modules/mixed-pkg'],
            fixAvailable: true,
          },
        },
      };

      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');

      // mixed-pkg has both an advisory object and a string in via → treated as root cause
      expect(vulnerabilities).toHaveLength(2);
      const mixedVuln = vulnerabilities.find((v) => v.package === 'mixed-pkg');
      expect(mixedVuln).toBeDefined();
      expect(mixedVuln.isRootCause).toBe(true);
    });

    it('root cause fixAvailable:false with NO dependents → kept as-is (NO_FIX)', async () => {
      const auditData = {
        vulnerabilities: {
          'lone-unfixable': {
            severity: 'moderate',
            isDirect: true,
            via: [
              {
                source: 7,
                title: 'Lone',
                url: 'https://x.com/7',
                cwe: ['CWE-400'],
                range: '<5.0.0',
              },
            ],
            range: '<5.0.0',
            nodes: ['node_modules/lone-unfixable'],
            fixAvailable: false,
          },
        },
      };
      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');
      expect(vulnerabilities).toHaveLength(1);
      expect(vulnerabilities[0].package).toBe('lone-unfixable');
      expect(vulnerabilities[0].isRootCause).toBe(true);
      expect(vulnerabilities[0].isPromotedDependent).toBeUndefined();
      expect(vulnerabilities[0].fixAvailable).toBe(false);
    });

    it('root cause fixAvailable:true → normal behavior (root shown, dependents suppressed)', async () => {
      const auditData = {
        vulnerabilities: {
          'fixable-root': {
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 8,
                title: 'Fixable',
                url: 'https://x.com/8',
                cwe: ['CWE-22'],
                range: '<3.0.0',
              },
            ],
            range: '<3.0.0',
            nodes: ['node_modules/fixable-root'],
            fixAvailable: true,
          },
          'fixable-dep': {
            severity: 'high',
            isDirect: false,
            via: ['fixable-root'],
            range: '<3.0.0',
            nodes: ['node_modules/fixable-dep'],
            fixAvailable: true,
          },
        },
      };
      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');
      expect(vulnerabilities).toHaveLength(1);
      expect(vulnerabilities[0].package).toBe('fixable-root');
      expect(vulnerabilities[0].isRootCause).toBe(true);
      expect(vulnerabilities.find((v) => v.package === 'fixable-dep')).toBeUndefined();
    });

    it('promoted dependent resolvesDependents contains its own sub-dependents', async () => {
      const auditData = {
        vulnerabilities: {
          'no-fix-pkg': {
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 9,
                title: 'No-fix',
                url: 'https://x.com/9',
                cwe: ['CWE-79'],
                range: '*',
              },
            ],
            range: '*',
            nodes: ['node_modules/no-fix-pkg'],
            fixAvailable: false,
          },
          'mid-dep': {
            severity: 'high',
            isDirect: false,
            via: ['no-fix-pkg'],
            range: '*',
            nodes: ['node_modules/mid-dep'],
            fixAvailable: false,
          },
          'sub-dep': {
            severity: 'high',
            isDirect: false,
            via: ['mid-dep'],
            range: '*',
            nodes: ['node_modules/sub-dep'],
            fixAvailable: false,
          },
        },
      };
      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');
      // no-fix-pkg is suppressed, mid-dep is promoted
      expect(vulnerabilities).toHaveLength(1);
      const promoted = vulnerabilities[0];
      expect(promoted.package).toBe('mid-dep');
      expect(promoted.isPromotedDependent).toBe(true);
      expect(promoted.unfixableRootCause).toBe('no-fix-pkg');
      // mid-dep's resolvesDependents should include sub-dep
      expect(promoted.resolvesDependents).toContain('sub-dep');
    });

    it('fixture: uuid promoted to @cypress/request and ari-client in fixture output', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditSample, '/test/path');
      // uuid (fixAvailable:false with dependents) must not appear
      expect(vulnerabilities.find((v) => v.package === 'uuid')).toBeUndefined();
      // @cypress/request and ari-client must appear as promoted dependents
      const cypressReq = vulnerabilities.find((v) => v.package === '@cypress/request');
      const ariClient = vulnerabilities.find((v) => v.package === 'ari-client');
      expect(cypressReq).toBeDefined();
      expect(cypressReq.isPromotedDependent).toBe(true);
      expect(cypressReq.unfixableRootCause).toBe('uuid');
      expect(ariClient).toBeDefined();
      expect(ariClient.isPromotedDependent).toBe(true);
      expect(ariClient.unfixableRootCause).toBe('uuid');
    });

    it('should set resolvesDependents to empty array when no dependents exist', async () => {
      const auditData = {
        vulnerabilities: {
          'standalone-pkg': {
            severity: 'critical',
            isDirect: false,
            via: [
              {
                source: 3,
                title: 'Standalone',
                url: 'https://example.com/3',
                cwe: ['CWE-78'],
                range: '<5.0.0',
              },
            ],
            range: '<5.0.0',
            nodes: ['node_modules/standalone-pkg'],
            fixAvailable: { name: 'standalone-pkg', version: '5.0.0', isSemVerMajor: true },
          },
        },
      };

      const result = await audit.parseVulnerabilities(auditData, '/test/path');

      expect(result).toHaveLength(1);
      expect(result[0].resolvesDependents).toEqual([]);
    });
  });

  describe('determineSafeVersion', () => {
    beforeEach(() => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm view') && cmd.includes('version')) {
            if (cmd.includes('versions --json')) {
              resolve({
                stdout: JSON.stringify(['1.0.0', '2.0.0', '3.0.0', '4.17.21']),
                stderr: '',
              });
            } else {
              resolve({ stdout: '4.17.21\n', stderr: '' });
            }
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (result) => callback(null, result),
            (error) => callback(error)
          );
        }
        return promise;
      });
    });
    it('should handle lt X.Y.Z pattern — returns actual min published version >= boundary', async () => {
      // Mock returns ['1.0.0', '2.0.0', '3.0.0', '4.17.21']
      // Range '<4.17.21' → safe range '>=4.17.21' → minSatisfying = '4.17.21'
      const v = await audit.determineSafeVersion('test-package', '<4.17.21', '4.17.15');
      expect(v).toBe('4.17.21');
    });
    it('should handle lte X.Y.Z pattern — returns min version strictly above boundary', async () => {
      // Range '<=4.17.20' → safe range '>4.17.20' → minSatisfying(['1.0.0','2.0.0','3.0.0','4.17.21'], '>4.17.20') = '4.17.21'
      const v = await audit.determineSafeVersion('test-package', '<=4.17.20');
      expect(v).toBe('4.17.21');
    });
    it('should handle range pattern — returns min version above upper bound', async () => {
      // Range '1.0.0 - 3.0.0' → safe range '>3.0.0' → minSatisfying(['1.0.0','2.0.0','3.0.0','4.17.21'], '>3.0.0') = '4.17.21'
      const v = await audit.determineSafeVersion('test-package', '1.0.0 - 3.0.0');
      expect(v).toBe('4.17.21');
    });
    it('should return null for gte pattern', async () => {
      const v = await audit.determineSafeVersion('test-package', '>=4.0.0');
      expect(v).toBeNull();
    });
    it('should not downgrade versions', async () => {
      // '<3.0.0' → safe range '>=3.0.0' → minSatisfying = '3.0.0' → but 3.0.0 < 4.0.0 → null
      const v = await audit.determineSafeVersion('test-package', '<3.0.0', '4.0.0');
      expect(v).toBeNull();
    });
    it('uuid scenario: vulnerableRange "<14.0.0", installedVersion "8.3.2" → suggests "14.0.0"', async () => {
      // Override exec mock for this test to return uuid-like version list
      exec.mockImplementationOnce((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('versions --json')) {
            resolve({
              stdout: JSON.stringify(['8.3.2', '13.9.0', '14.0.0', '14.1.0']),
              stderr: '',
            });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });
      const v = await audit.determineSafeVersion('uuid', '<14.0.0', '8.3.2');
      // Safe range is '>=14.0.0' → minSatisfying(['8.3.2','13.9.0','14.0.0','14.1.0'], '>=14.0.0') = '14.0.0'
      expect(v).toBe('14.0.0');
    });
  });

  describe('fetchLatestSafeVersion', () => {
    beforeEach(() => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm view') && cmd.includes('version') && !cmd.includes('versions')) {
            resolve({ stdout: '1.2.3\n', stderr: '' });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (result) => callback(null, result),
            (error) => callback(error)
          );
        }
        return promise;
      });
    });
    it('should fetch latest version from npm', async () => {
      const version = await audit.fetchLatestSafeVersion('test-package');
      expect(version).toBe('1.2.3');
      expect(exec).toHaveBeenCalled();
    });
    it('should handle errors gracefully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('Network error');
        const promise = Promise.reject(error);
        if (callback) {
          promise.catch((err) => callback(err));
        }
        return promise;
      });
      const version = await audit.fetchLatestSafeVersion('bad-package');
      expect(version).toBeNull();
    });
  });

  describe('fetchAllVersions', () => {
    beforeEach(() => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm view') && cmd.includes('versions --json')) {
            resolve({ stdout: JSON.stringify(['1.0.0', '1.1.0', '2.0.0']), stderr: '' });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (result) => callback(null, result),
            (error) => callback(error)
          );
        }
        return promise;
      });
    });
    it('should fetch all versions from npm', async () => {
      const versions = await audit.fetchAllVersions('test-package');
      expect(versions).toEqual(['1.0.0', '1.1.0', '2.0.0']);
      expect(exec).toHaveBeenCalled();
    });
    it('should handle errors gracefully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('Network error');
        const promise = Promise.reject(error);
        if (callback) {
          promise.catch((err) => callback(err));
        }
        return promise;
      });
      const versions = await audit.fetchAllVersions('bad-package');
      expect(versions).toBeNull();
    });
  });

  describe('getInstalledVersionFromLockfile', () => {
    it('should read version from npm v7+ lockfile format', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(packageLockSample));
      const version = await audit.getInstalledVersionFromLockfile('/test/path', 'lodash');
      expect(version).toBe('4.17.15');
    });
    it('should return null if package not found', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(packageLockSample));
      const version = await audit.getInstalledVersionFromLockfile('/test/path', 'non-existent');
      expect(version).toBeNull();
    });
    it('should return null if lockfile does not exist', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));
      const version = await audit.getInstalledVersionFromLockfile('/test/path', 'lodash');
      expect(version).toBeNull();
    });
    it('should handle read errors gracefully', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockRejectedValue(new Error('Permission denied'));
      const version = await audit.getInstalledVersionFromLockfile('/test/path', 'lodash');
      expect(version).toBeNull();
    });
  });

  describe('determineFixStrategy', () => {
    it('should return UPDATE_DIRECT for direct dependencies with fixes', async () => {
      const vulnerability = {
        package: 'lodash',
        isDirect: true,
        fixAvailable: { version: '4.17.21', isSemVerMajor: false },
        installedVersion: '4.17.15',
      };
      const strategy = await audit.determineFixStrategy(vulnerability, npmAuditSample);
      expect(strategy.type).toBe('UPDATE_DIRECT');
      expect(strategy.targetVersion).toBe('4.17.21');
      expect(strategy.riskLevel).toBe('LOW');
    });
    it('should return NO_FIX when no fix is available', async () => {
      const vulnerability = {
        package: 'test-package',
        isDirect: true,
        fixAvailable: false,
        installedVersion: '1.0.0',
      };
      const strategy = await audit.determineFixStrategy(vulnerability, {});
      expect(strategy.type).toBe('NO_FIX');
    });
    it('should mark major version changes as HIGH risk', async () => {
      const vulnerability = {
        package: 'lodash',
        isDirect: true,
        fixAvailable: { version: '5.0.0', isSemVerMajor: true },
        installedVersion: '4.17.15',
      };
      const strategy = await audit.determineFixStrategy(vulnerability, npmAuditSample);
      expect(strategy.type).toBe('UPDATE_DIRECT');
      expect(strategy.riskLevel).toBe('HIGH');
    });
  });

  describe('generatePackageJsonChanges', () => {
    it('should generate changes for UPDATE_DIRECT strategy', () => {
      const strategies = [{ type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '^4.17.21' }];
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].type).toBe('UPDATE_DIRECT');
      expect(result.changes[0].package).toBe('lodash');
      expect(result.modifiedPackageJson.dependencies.lodash).toBe('^4.17.21');
    });
    it('should add overrides for ADD_OVERRIDE strategy', () => {
      const strategies = [{ type: 'ADD_OVERRIDE', package: 'minimist', targetVersion: '^1.2.6' }];
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      expect(result.modifiedPackageJson.overrides).toBeDefined();
      expect(result.modifiedPackageJson.overrides.minimist).toBe('^1.2.6');
    });
    it('should skip NO_FIX strategies', () => {
      const strategies = [{ type: 'NO_FIX', package: 'unfixable-package' }];
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      expect(result.changes).toHaveLength(0);
    });
    it('should handle multiple changes at once', () => {
      const strategies = [
        { type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '^4.17.21' },
        { type: 'ADD_OVERRIDE', package: 'minimist', targetVersion: '^1.2.6' },
      ];
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      expect(result.changes).toHaveLength(2);
      expect(result.modifiedPackageJson.dependencies.lodash).toBe('^4.17.21');
      expect(result.modifiedPackageJson.overrides.minimist).toBe('^1.2.6');
    });
  });

  describe('runNpmAudit', () => {
    it('should parse npm audit JSON output successfully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm audit --json')) {
            resolve({ stdout: JSON.stringify(npmAuditSample), stderr: '' });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });
      const result = await audit.runNpmAudit('/test/path');
      expect(result.success).toBe(true);
      expect(result.content.auditData).toBeDefined();
      expect(result.content.auditData.vulnerabilities).toBeDefined();
    });
    it('should handle npm audit errors with JSON output', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('Vulnerabilities found');
        error.stdout = JSON.stringify(npmAuditSample);
        const promise = Promise.reject(error);
        if (callback) {
          promise.catch((err) => callback(err));
        }
        return promise;
      });
      const result = await audit.runNpmAudit('/test/path');
      expect(result.success).toBe(true);
      expect(result.content.auditData).toBeDefined();
    });
    it('should handle complete npm audit failure', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('npm command not found');
        const promise = Promise.reject(error);
        if (callback) {
          promise.catch((err) => callback(err));
        }
        return promise;
      });
      const result = await audit.runNpmAudit('/test/path');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.details.auditData).toBeNull();
    });
  });

  describe('runNpmInstall', () => {
    it('should run npm install successfully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm install')) {
            resolve({ stdout: 'added 10 packages', stderr: '' });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });
      const result = await audit.runNpmInstall('/test/path');
      expect(result.success).toBe(true);
      expect(result.content.stdout).toContain('added 10 packages');
    });
    it('should handle npm install errors', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('ENOENT: package.json not found');
        error.stderr = 'Error: package.json not found';
        const promise = Promise.reject(error);
        if (callback) {
          promise.catch((err) => callback(err));
        }
        return promise;
      });
      const result = await audit.runNpmInstall('/test/path');
      expect(result.success).toBe(false);
      expect(result.error).toContain('package.json not found');
    });
  });

  describe('Registry Cache Behavior During Multi-Project Scans', () => {
    const testProjectPath = path.join(__dirname, '../../fixtures');
    const setupExecMock = () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm install')) {
            resolve({ stdout: 'added 10 packages', stderr: '' });
          } else if (cmd.includes('npm audit --json')) {
            resolve({ stdout: JSON.stringify(npmAuditSample), stderr: '' });
          } else if (cmd.includes('npm view') && cmd.includes('version')) {
            if (cmd.includes('versions --json')) {
              resolve({
                stdout: JSON.stringify(['1.0.0', '2.0.0', '3.0.0', '4.17.21']),
                stderr: '',
              });
            } else {
              resolve({ stdout: '4.17.21\n', stderr: '' });
            }
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });
    };
    beforeEach(() => {
      audit.clearCache();
      setupExecMock();
      fs.access.mockResolvedValue();
      fs.readFile.mockImplementation(async (filePath) => {
        if (filePath.endsWith('package.json')) return JSON.stringify(packageJsonSample);
        if (filePath.endsWith('package-lock.json')) return JSON.stringify(packageLockSample);
        throw new Error('File not found');
      });
    });
    it('should NOT clear registry cache when analyzeProject is called', async () => {
      await audit.fetchLatestSafeVersion('lodash');
      const result = await audit.analyzeProject(testProjectPath);
      expect(result.success).toBe(true);
      const before = exec.mock.calls.length;
      await audit.fetchLatestSafeVersion('lodash');
      const newCalls = exec.mock.calls
        .slice(before)
        .filter((c) => c[0].includes('npm view lodash'));
      expect(newCalls.length).toBe(0);
    });
    it('should preserve cache entries across multiple analyzeProject calls', async () => {
      audit.clearCache();
      await audit.fetchLatestSafeVersion('lodash');
      const initialCalls = exec.mock.calls.filter((c) => c[0].includes('npm view lodash')).length;
      expect(initialCalls).toBeGreaterThan(0);
      jest.clearAllMocks();
      setupExecMock();
      fs.access.mockResolvedValue();
      fs.readFile.mockImplementation(async (filePath) => {
        if (filePath.endsWith('package.json')) return JSON.stringify(packageJsonSample);
        if (filePath.endsWith('package-lock.json')) return JSON.stringify(packageLockSample);
        throw new Error('File not found');
      });
      const result1 = await audit.analyzeProject(testProjectPath);
      expect(result1.success).toBe(true);
      jest.clearAllMocks();
      setupExecMock();
      fs.access.mockResolvedValue();
      fs.readFile.mockImplementation(async (filePath) => {
        if (filePath.endsWith('package.json')) return JSON.stringify(packageJsonSample);
        if (filePath.endsWith('package-lock.json')) return JSON.stringify(packageLockSample);
        throw new Error('File not found');
      });
      const result2 = await audit.analyzeProject(testProjectPath);
      expect(result2.success).toBe(true);
      const callsBefore = exec.mock.calls.length;
      await audit.fetchLatestSafeVersion('lodash');
      const newLodashCalls = exec.mock.calls
        .slice(callsBefore)
        .filter((c) => c[0].includes('npm view lodash'));
      expect(newLodashCalls.length).toBe(0);
    });
    it('clearCache function should clear the registry cache', () => {
      const p1 = audit.fetchLatestSafeVersion('test-package-1');
      const p2 = audit.fetchLatestSafeVersion('test-package-2');
      return Promise.all([p1, p2]).then(() => {
        const calls = exec.mock.calls.filter((c) => c[0].includes('npm view')).length;
        expect(calls).toBeGreaterThan(0);
        jest.clearAllMocks();
        setupExecMock();
        audit.clearCache();
        return Promise.all([
          audit.fetchLatestSafeVersion('test-package-1'),
          audit.fetchLatestSafeVersion('test-package-2'),
        ]).then(() => {
          const callsAfter = exec.mock.calls.filter((c) => c[0].includes('npm view')).length;
          expect(callsAfter).toBeGreaterThan(0);
        });
      });
    });
  });
  // ── Real-world regression suite ─────────────────────────────────────────────
  // Fixture: exact npm audit JSON from bluedarwin-agi that caused uuid to be
  // reported with fix version 1.1.0 (ari-client's ecosystem version, not uuid's).
  // Root cause: parser blindly used fixAvailable.version without checking
  // fixAvailable.name === pkgName. These tests must never be deleted.
  describe('Real-world regression: bluedarwin-agi uuid audit', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      audit.clearCache();
    });

    it('uuid patchedVersion must be null — fixAvailable.name is ari-client not uuid', async () => {
      const vulns = await audit.parseVulnerabilities(npmAuditRealWorld, '/test/path');
      const uuidVuln = vulns.find((v) => v.package === 'uuid');
      expect(uuidVuln).toBeDefined();
      expect(uuidVuln.patchedVersion).not.toBe('1.1.0');
      expect(uuidVuln.patchedVersion).toBeNull();
    });

    it('aws-sdk patchedVersion is 1.18.0 — fixAvailable.name matches aws-sdk (self-referential)', async () => {
      const vulns = await audit.parseVulnerabilities(npmAuditRealWorld, '/test/path');
      const awsVuln = vulns.find((v) => v.package === 'aws-sdk');
      expect(awsVuln).toBeDefined();
      expect(awsVuln.isRootCause).toBe(true);
      expect(awsVuln.patchedVersion).toBe('1.18.0');
    });

    it('pure dependents (@cypress/request via:[uuid]) must not appear as top-level entries', async () => {
      const vulns = await audit.parseVulnerabilities(npmAuditRealWorld, '/test/path');
      expect(vulns.find((v) => v.package === '@cypress/request')).toBeUndefined();
    });

    it('only root-cause packages appear: uuid, aws-sdk, @google-cloud/speech', async () => {
      const vulns = await audit.parseVulnerabilities(npmAuditRealWorld, '/test/path');
      const names = vulns.map((v) => v.package);
      const pureDependents = [
        '@cypress/request',
        '@fonoster/streams',
        '@google-cloud/common',
        'gaxios',
        'google-gax',
        'request-ntlm-promise',
        'request-promise',
        'request-promise-core',
        'request-promise-native',
        'retry-request',
        'teeny-request',
      ];
      for (const dep of pureDependents) {
        expect(names).not.toContain(dep);
      }
      expect(names).toContain('uuid');
      expect(names).toContain('aws-sdk');
    });

    it('determineFixStrategy for uuid uses vulnerable range not fixAvailable.version=1.1.0', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const p = new Promise((resolve) => {
          if (cmd.includes('versions --json')) {
            resolve({
              stdout: JSON.stringify(['8.3.2', '13.9.0', '14.0.0', '14.1.0']),
              stderr: '',
            });
          } else {
            resolve({ stdout: '14.0.0', stderr: '' });
          }
        });
        if (callback) {
          p.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return p;
      });
      const vuln = {
        package: 'uuid',
        isDirect: true,
        fixAvailable: { name: 'ari-client', version: '1.1.0', isSemVerMajor: true },
        installedVersion: '8.3.2',
        vulnerableRange: '<14.0.0',
        patchedVersion: null,
      };
      const strategy = await audit.determineFixStrategy(vuln, npmAuditRealWorld);
      expect(strategy.targetVersion).not.toBe('1.1.0');
      expect(strategy.targetVersion).toBe('14.0.0');
      expect(strategy.type).toBe('UPDATE_DIRECT');
    });
  });

  // ── Regression: exact-version range detection (Pattern 5) ───────────────────
  // Bug: ranges like "=4.0.0" or "4.0.0" fell through all pattern blocks and
  // returned null even when newer versions existed on the registry.
  // Fix: Pattern 5 in determineSafeVersion() now handles these forms by
  // converting them to a ">X.Y.Z" safe range and calling findMinSafeVersion().
  describe('determineSafeVersion — exact-version range handling (regression)', () => {
    const jwsVersions = ['4.0.0', '4.0.1', '4.0.2'];

    const mockJwsVersions = (versions) => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('versions --json')) {
            resolve({ stdout: JSON.stringify(versions), stderr: '' });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });
    };

    beforeEach(() => {
      mockJwsVersions(jwsVersions);
    });

    it('=X.Y.Z form returns the lowest version strictly greater than the pinned version', async () => {
      // Range "=4.0.0" → safe range ">4.0.0"
      // minSatisfying(['4.0.0','4.0.1','4.0.2'], '>4.0.0') = '4.0.1'
      const v = await audit.determineSafeVersion('jws', '=4.0.0', '4.0.0', null);
      expect(v).toBe('4.0.1');
    });

    it('bare X.Y.Z form returns the lowest version strictly greater than the pinned version', async () => {
      // Range "4.0.0" → safe range ">4.0.0"
      // minSatisfying(['4.0.0','4.0.1','4.0.2'], '>4.0.0') = '4.0.1'
      const v = await audit.determineSafeVersion('jws', '4.0.0', '4.0.0', null);
      expect(v).toBe('4.0.1');
    });

    it('=X.Y.Z when no higher version exists returns null', async () => {
      // Registry only has '4.0.0' — no version satisfies '>4.0.0'
      mockJwsVersions(['4.0.0']);
      const v = await audit.determineSafeVersion('jws', '=4.0.0', '4.0.0', null);
      expect(v).toBeNull();
    });

    it('>=X.Y.Z (all-versions-vulnerable guard) still returns null — regression guard', async () => {
      // ">=4.0.0" must NOT be handled by Pattern 5;
      // the all-vulnerable guard fires first and returns null
      const v = await audit.determineSafeVersion('jws', '>=4.0.0', '4.0.0', null);
      expect(v).toBeNull();
    });
  });

  // ── Integration: full audit with exact-version vulnerability ────────────────
  describe('Integration: exact-version vulnerability in full audit fixture', () => {
    beforeEach(() => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm audit --json')) {
            resolve({ stdout: JSON.stringify(npmAuditExactVersion), stderr: '' });
          } else if (cmd.includes('versions --json')) {
            resolve({
              stdout: JSON.stringify(['4.0.0', '4.0.1', '4.0.2']),
              stderr: '',
            });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });
    });

    it('jws vulnerability with exact-version range is parsed as a root cause', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditExactVersion, '/test/path');
      const jwsVuln = vulnerabilities.find((v) => v.package === 'jws');
      expect(jwsVuln).toBeDefined();
      expect(jwsVuln.isRootCause).toBe(true);
      // The parser uses the top-level `range` field ("4.0.0") as vulnerableRange,
      // not the via[].range ("=4.0.0"). Both forms are handled by Pattern 5.
      expect(jwsVuln.vulnerableRange).toBe('4.0.0');
    });

    it('jws fix strategy resolves to 4.0.1 and is NOT NO_FIX', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditExactVersion, '/test/path');
      const jwsVuln = vulnerabilities.find((v) => v.package === 'jws');
      expect(jwsVuln).toBeDefined();

      const strategy = await audit.determineFixStrategy(jwsVuln, npmAuditExactVersion);
      expect(strategy.type).not.toBe('NO_FIX');
      expect(strategy.targetVersion).toBe('4.0.1');
    });
  });
  // ── Regression: hasBoundedRange suppression guard (postcss scenario) ─────────
  // Bug: postcss had fixAvailable:false and range:'<8.5.10'. The old suppression
  // logic treated any root-cause with fixAvailable:false + dependents as unfixable
  // and promoted its dependents instead. None of them could compute a correct fix
  // because they are the wrong packages. The fix adds a hasBoundedRange guard so
  // that a root-cause with a concrete upper-bound range is NOT suppressed — the
  // strategy layer then derives an ADD_OVERRIDE for postcss@8.5.10 directly.
  // These tests must never be deleted.
  describe('Regression: hasBoundedRange guard — postcss with fixAvailable:false and <X.Y.Z range', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      audit.clearCache();
    });

    // ── Parser-level tests ──────────────────────────────────────────────────────

    it('postcss with fixAvailable:false and <X.Y.Z range is NOT suppressed — isRootCause:true', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(
        npmAuditPostcssIndirect,
        '/test/path'
      );
      const postcssVuln = vulnerabilities.find((v) => v.package === 'postcss');
      expect(postcssVuln).toBeDefined();
      expect(postcssVuln.isRootCause).toBe(true);
    });

    it('postcss with fixAvailable:false and <X.Y.Z range has vulnerableRange "<8.5.10"', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(
        npmAuditPostcssIndirect,
        '/test/path'
      );
      const postcssVuln = vulnerabilities.find((v) => v.package === 'postcss');
      expect(postcssVuln).toBeDefined();
      expect(postcssVuln.vulnerableRange).toBe('<8.5.10');
    });

    it('package with fixAvailable:false and UNBOUNDED range (*) IS still suppressed — regression guard', async () => {
      // Confirm the hasBoundedRange guard does NOT break suppression for truly unfixable
      // packages whose range is '*' (all versions vulnerable — no derivable safe version).
      const auditData = {
        vulnerabilities: {
          'unbounded-root': {
            severity: 'high',
            isDirect: false,
            via: [
              {
                source: 42,
                title: 'Unbounded issue',
                url: 'https://example.com/42',
                cwe: ['CWE-200'],
                range: '*',
              },
            ],
            range: '*',
            nodes: ['node_modules/unbounded-root'],
            fixAvailable: false,
          },
          'unbounded-dep': {
            severity: 'high',
            isDirect: false,
            via: ['unbounded-root'],
            range: '*',
            nodes: ['node_modules/unbounded-dep'],
            fixAvailable: false,
          },
        },
      };

      const vulnerabilities = await audit.parseVulnerabilities(auditData, '/test/path');

      // Root cause with '*' range must be suppressed (no bounded range -> old path)
      expect(vulnerabilities.find((v) => v.package === 'unbounded-root')).toBeUndefined();
      // Its dependent must be promoted
      const promoted = vulnerabilities.find((v) => v.package === 'unbounded-dep');
      expect(promoted).toBeDefined();
      expect(promoted.isPromotedDependent).toBe(true);
      expect(promoted.isRootCause).toBe(false);
    });

    // ── Integration-style tests — full fix strategy ─────────────────────────────

    it('postcss fix strategy resolves to 8.5.10 and is NOT NO_FIX', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('versions --json') && cmd.includes('postcss')) {
            resolve({
              stdout: JSON.stringify(['8.4.0', '8.5.0', '8.5.9', '8.5.10', '8.5.11']),
              stderr: '',
            });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });

      const vulnerabilities = await audit.parseVulnerabilities(
        npmAuditPostcssIndirect,
        '/test/path'
      );
      const postcssVuln = vulnerabilities.find((v) => v.package === 'postcss');
      expect(postcssVuln).toBeDefined();

      const strategy = await audit.determineFixStrategy(postcssVuln, npmAuditPostcssIndirect);
      expect(strategy.type).not.toBe('NO_FIX');
      expect(strategy.targetVersion).toBe('8.5.10');
    });

    it('postcss fix is reported as ADD_OVERRIDE because postcss is not a direct dependency', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('versions --json') && cmd.includes('postcss')) {
            resolve({
              stdout: JSON.stringify(['8.4.0', '8.5.0', '8.5.9', '8.5.10', '8.5.11']),
              stderr: '',
            });
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        if (callback) {
          promise.then(
            (r) => callback(null, r),
            (e) => callback(e)
          );
        }
        return promise;
      });

      const vulnerabilities = await audit.parseVulnerabilities(
        npmAuditPostcssIndirect,
        '/test/path'
      );
      const postcssVuln = vulnerabilities.find((v) => v.package === 'postcss');
      expect(postcssVuln).toBeDefined();

      // postcss is isDirect:false in the fixture, so the strategy must be ADD_OVERRIDE
      const strategy = await audit.determineFixStrategy(postcssVuln, npmAuditPostcssIndirect);
      expect(strategy.type).toBe('ADD_OVERRIDE');
      expect(strategy.targetVersion).toBe('8.5.10');
    });
  });
});
