/**
 * Tests for audit.js module
 * 
 * Tests the core audit and remediation engine functionality
 */

const audit = require('../../../src/main/modules/audit');
const { mockExecSuccess, mockExecFailure, mockExecConditional } = require('../../utils/mock-child-process');
const { mockReadFile, mockAccess } = require('../../utils/mock-fs');
const path = require('path');
const fs = require('fs').promises;

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    access: jest.fn()
  }
}));

const { exec } = require('child_process');
const { promisify } = require('util');

// Load test fixtures
const npmAuditSample = require('../../fixtures/npm-audit-sample.json');
const packageJsonSample = require('../../fixtures/package.json');
const packageLockSample = require('../../fixtures/package-lock.json');

describe('audit module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.clearCache(); // Clear registry cache between tests
  });
  
  describe('parseVulnerabilities', () => {
    it('should parse npm audit data correctly', async () => {
      const vulnerabilities = await audit.parseVulnerabilities(npmAuditSample, '/test/path');
      
      expect(vulnerabilities).toHaveLength(3);
      expect(vulnerabilities[0].package).toBe('lodash');
      expect(vulnerabilities[0].severity).toBe('high');
      expect(vulnerabilities[0].isDirect).toBe(true);
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
      
      const lodashVuln = vulnerabilities.find(v => v.package === 'lodash');
      expect(lodashVuln.vulnerableRange).toBe('<4.17.21');
      expect(lodashVuln.severity).toBe('high');
      expect(lodashVuln.isDirect).toBe(true);
      expect(lodashVuln.title).toContain('Prototype Pollution');
    });
  });
  
  describe('determineSafeVersion', () => {
    beforeEach(() => {
      // Mock exec for npm view commands
      const execAsync = promisify(exec);
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve, reject) => {
          if (cmd.includes('npm view') && cmd.includes('version')) {
            if (cmd.includes('versions --json')) {
              // Return array of versions
              resolve({ stdout: JSON.stringify(['1.0.0', '2.0.0', '3.0.0', '4.17.21']), stderr: '' });
            } else {
              // Return single latest version
              resolve({ stdout: '4.17.21\n', stderr: '' });
            }
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(
            result => callback(null, result),
            error => callback(error)
          );
        }
        
        return promise;
      });
    });
    
    it('should handle "< X.Y.Z" pattern', async () => {
      const safeVersion = await audit.determineSafeVersion('test-package', '<4.17.21', '4.17.15');
      
      expect(safeVersion).toBe('^4.17.21');
    });
    
    it('should handle "<= X.Y.Z" pattern', async () => {
      const safeVersion = await audit.determineSafeVersion('test-package', '<=4.17.20');
      
      expect(safeVersion).toBe('4.17.21');
    });
    
    it('should handle range pattern "X.Y.Z - A.B.C"', async () => {
      const safeVersion = await audit.determineSafeVersion('test-package', '1.0.0 - 3.0.0');
      
      expect(safeVersion).toBe('4.17.21');
    });
    
    it('should return null for ">= X.Y.Z" pattern (no fix available)', async () => {
      const safeVersion = await audit.determineSafeVersion('test-package', '>=4.0.0');
      
      expect(safeVersion).toBeNull();
    });
    
    it('should not downgrade versions', async () => {
      const safeVersion = await audit.determineSafeVersion('test-package', '<3.0.0', '4.0.0');
      
      expect(safeVersion).toBeNull(); // Should reject downgrade
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
            result => callback(null, result),
            error => callback(error)
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
          promise.catch(err => callback(err));
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
            result => callback(null, result),
            error => callback(error)
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
          promise.catch(err => callback(err));
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
        installedVersion: '4.17.15'
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
        installedVersion: '1.0.0'
      };
      
      const strategy = await audit.determineFixStrategy(vulnerability, {});
      
      expect(strategy.type).toBe('NO_FIX');
    });
    
    it('should mark major version changes as HIGH risk', async () => {
      const vulnerability = {
        package: 'lodash',
        isDirect: true,
        fixAvailable: { version: '5.0.0', isSemVerMajor: true },
        installedVersion: '4.17.15'
      };
      
      const strategy = await audit.determineFixStrategy(vulnerability, npmAuditSample);
      
      expect(strategy.type).toBe('UPDATE_DIRECT');
      expect(strategy.riskLevel).toBe('HIGH');
    });
  });
  
  describe('generatePackageJsonChanges', () => {
    it('should generate changes for UPDATE_DIRECT strategy', () => {
      const strategies = [
        {
          type: 'UPDATE_DIRECT',
          package: 'lodash',
          targetVersion: '^4.17.21'
        }
      ];
      
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].type).toBe('UPDATE_DIRECT');
      expect(result.changes[0].package).toBe('lodash');
      expect(result.modifiedPackageJson.dependencies.lodash).toBe('^4.17.21');
    });
    
    it('should add overrides for ADD_OVERRIDE strategy', () => {
      const strategies = [
        {
          type: 'ADD_OVERRIDE',
          package: 'minimist',
          targetVersion: '^1.2.6'
        }
      ];
      
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      
      expect(result.modifiedPackageJson.overrides).toBeDefined();
      expect(result.modifiedPackageJson.overrides.minimist).toBe('^1.2.6');
    });
    
    it('should skip NO_FIX strategies', () => {
      const strategies = [
        {
          type: 'NO_FIX',
          package: 'unfixable-package'
        }
      ];
      
      const result = audit.generatePackageJsonChanges(strategies, packageJsonSample);
      
      expect(result.changes).toHaveLength(0);
    });
    
    it('should handle multiple changes at once', () => {
      const strategies = [
        { type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '^4.17.21' },
        { type: 'ADD_OVERRIDE', package: 'minimist', targetVersion: '^1.2.6' }
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
            result => callback(null, result),
            error => callback(error)
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
          promise.catch(err => callback(err));
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
          promise.catch(err => callback(err));
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
            result => callback(null, result),
            error => callback(error)
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
          promise.catch(err => callback(err));
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
    
    beforeEach(() => {
      // Clear cache for clean state
      audit.clearCache();
      
      // Mock successful npm operations
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm install')) {
            resolve({ stdout: 'added 10 packages', stderr: '' });
          } else if (cmd.includes('npm audit --json')) {
            resolve({ stdout: JSON.stringify(npmAuditSample), stderr: '' });
          } else if (cmd.includes('npm view') && cmd.includes('version')) {
            if (cmd.includes('versions --json')) {
              resolve({ stdout: JSON.stringify(['1.0.0', '2.0.0', '3.0.0', '4.17.21']), stderr: '' });
            } else {
              resolve({ stdout: '4.17.21\n', stderr: '' });
            }
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(
            result => callback(null, result),
            error => callback(error)
          );
        }
        
        return promise;
      });
      
      // Mock fs operations
      fs.access.mockResolvedValue();
      fs.readFile.mockImplementation(async (filePath) => {
        if (filePath.endsWith('package.json')) {
          return JSON.stringify(packageJsonSample);
        } else if (filePath.endsWith('package-lock.json')) {
          return JSON.stringify(packageLockSample);
        }
        throw new Error('File not found');
      });
    });
    
    it('should NOT clear registry cache when analyzeProject is called', async () => {
      // This test ensures the critical bug doesn't come back:
      // analyzeProject() was previously clearing the cache at line 894,
      // which resulted in 0% cache hit rate across multi-project scans
      
      // Manually trigger a cache population by calling fetchLatestSafeVersion
      // This simulates what happens during vulnerability analysis
      await audit.fetchLatestSafeVersion('lodash');
      
      // Get the cache size before calling analyzeProject
      // We're importing the audit module which has the singleton registryCache
      // The cache is internal to audit.js, so we check indirectly via behavior
      
      // Call analyzeProject (which previously cleared the cache - BUG)
      const result = await audit.analyzeProject(testProjectPath);
      
      expect(result.success).toBe(true);
      
      // Now try to fetch the same package again
      // If cache was NOT cleared, this will be a cache hit (fast)
      // If cache WAS cleared (bug), this will be a cache miss (slow, would call npm view)
      const execCallCountBefore = exec.mock.calls.length;
      await audit.fetchLatestSafeVersion('lodash');
      const execCallCountAfter = exec.mock.calls.length;
      
      // If the cache was preserved, we shouldn't see a new npm view call for lodash
      // Count how many npm view lodash calls happened after analyzeProject
      const newNpmViewCalls = exec.mock.calls
        .slice(execCallCountBefore)
        .filter(call => call[0].includes('npm view lodash'));
      
      // This should be 0 if cache was preserved (cache hit)
      // This would be > 0 if cache was cleared (cache miss, new npm call)
      expect(newNpmViewCalls.length).toBe(0);
    });
    
    it('should preserve cache entries across multiple analyzeProject calls', async () => {
      // This test verifies cache persists across projects in the same session
      // by checking that packages fetched in project 1 don't require new npm calls in project 2
      
      // Clear cache to start fresh (simulating start of scan session)
      audit.clearCache();
      
      // First, populate the cache by explicitly fetching a package
      await audit.fetchLatestSafeVersion('lodash');
      
      // Verify the fetch happened (should see an npm view call)
      const initialNpmViewCalls = exec.mock.calls.filter(call =>
        call[0].includes('npm view lodash')
      ).length;
      expect(initialNpmViewCalls).toBeGreaterThan(0);
      
      // Clear mock call history but NOT the cache
      jest.clearAllMocks();
      
      // Re-setup mocks for first project
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm install')) {
            resolve({ stdout: 'added 10 packages', stderr: '' });
          } else if (cmd.includes('npm audit --json')) {
            resolve({ stdout: JSON.stringify(npmAuditSample), stderr: '' });
          } else if (cmd.includes('npm view') && cmd.includes('version')) {
            if (cmd.includes('versions --json')) {
              resolve({ stdout: JSON.stringify(['1.0.0', '2.0.0', '3.0.0', '4.17.21']), stderr: '' });
            } else {
              resolve({ stdout: '4.17.21\n', stderr: '' });
            }
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(
            result => callback(null, result),
            error => callback(error)
          );
        }
        
        return promise;
      });
      
      // Analyze first project
      const result1 = await audit.analyzeProject(testProjectPath);
      expect(result1.success).toBe(true);
      
      // Clear mock call history but NOT the cache
      jest.clearAllMocks();
      
      // Re-setup mocks for second project
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('npm install')) {
            resolve({ stdout: 'added 10 packages', stderr: '' });
          } else if (cmd.includes('npm audit --json')) {
            resolve({ stdout: JSON.stringify(npmAuditSample), stderr: '' });
          } else if (cmd.includes('npm view') && cmd.includes('version')) {
            if (cmd.includes('versions --json')) {
              resolve({ stdout: JSON.stringify(['1.0.0', '2.0.0', '3.0.0', '4.17.21']), stderr: '' });
            } else {
              resolve({ stdout: '4.17.21\n', stderr: '' });
            }
          } else {
            resolve({ stdout: '', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(
            result => callback(null, result),
            error => callback(error)
          );
        }
        
        return promise;
      });
      
      // Analyze second project (should reuse cache from before project 1)
      const result2 = await audit.analyzeProject(testProjectPath);
      expect(result2.success).toBe(true);
      
      // Now fetch lodash again - if cache was preserved, this should be a cache hit
      // (no new npm view call for lodash)
      const callCountBefore = exec.mock.calls.length;
      await audit.fetchLatestSafeVersion('lodash');
      const callCountAfter = exec.mock.calls.length;
      
      // Should not have made a new npm view call for lodash (cache hit)
      const newNpmViewCallsForLodash = exec.mock.calls
        .slice(callCountBefore)
        .filter(call => call[0].includes('npm view lodash'));
      
      // If cache was preserved across projects, this should be 0 (cache hit)
      // If cache was cleared per-project (the bug), this would be > 0 (cache miss)
      expect(newNpmViewCallsForLodash.length).toBe(0);
    });
    
    it('clearCache function should clear the registry cache', () => {
      // Verify the explicit clear function works
      // This is called at the START of a scan session (not per-project)
      
      // Populate cache with some data
      const promise1 = audit.fetchLatestSafeVersion('test-package-1');
      const promise2 = audit.fetchLatestSafeVersion('test-package-2');
      
      return Promise.all([promise1, promise2]).then(() => {
        // Verify cache was populated (npm view was called for both packages)
        const npmViewCalls = exec.mock.calls.filter(call =>
          call[0].includes('npm view')
        );
        expect(npmViewCalls.length).toBeGreaterThan(0);
        
        // Clear mock history
        jest.clearAllMocks();
        
        // Call the exported clearCache function
        audit.clearCache();
        
        // Now fetch again - should be cache misses, requiring new npm view calls
        return Promise.all([
          audit.fetchLatestSafeVersion('test-package-1'),
          audit.fetchLatestSafeVersion('test-package-2')
        ]).then(() => {
          // After clearing cache, fetching should trigger new npm view calls
          const npmViewCallsAfterClear = exec.mock.calls.filter(call =>
            call[0].includes('npm view')
          );
          
          // Should have made new npm view calls (cache was cleared)
          expect(npmViewCallsAfterClear.length).toBeGreaterThan(0);
        });
      });
    });
  });
});