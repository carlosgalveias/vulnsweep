/**
 * Tests for git.js module
 * 
 * Tests Git operations including reset, pull, commit, and push
 */

const git = require('../../../src/main/modules/git');
const { GIT_CONFIG } = require('../../../src/main/config/constants');

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn()
}));

const { exec, spawn } = require('child_process');

describe('git module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup spawn mock to simulate child process with streams and events
    spawn.mockImplementation(() => {
      const EventEmitter = require('events');
      const mockProcess = new EventEmitter();
      
      // Create mock stdin stream
      mockProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      
      // Create mock stdout stream
      mockProcess.stdout = new EventEmitter();
      
      // Create mock stderr stream
      mockProcess.stderr = new EventEmitter();
      
      mockProcess.kill = jest.fn();
      
      // Simulate successful execution after a short delay
      setTimeout(() => {
        mockProcess.stdout.emit('data', '[main abc123] Commit message');
        mockProcess.emit('close', 0);
      }, 10);
      
      return mockProcess;
    });
  });
  
  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
            resolve({ stdout: 'main\n', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.getCurrentBranch('/test/repo');
      
      expect(result.success).toBe(true);
      expect(result.content).toBe('main');
    });
    
    it('should handle errors when git command fails', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('not a git repository');
        const promise = Promise.reject(error);
        
        if (callback) {
          promise.catch(err => callback(err));
        }
        
        return promise;
      });
      
      const result = await git.getCurrentBranch('/test/repo');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
  
  describe('resetHard', () => {
    it('should execute git reset --hard successfully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git reset --hard HEAD')) {
            resolve({ stdout: 'HEAD is now at abc123', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.resetHard('/test/repo');
      
      expect(result.success).toBe(true);
      expect(result.content.stdout).toContain('HEAD is now');
    });
    
    it('should handle reset errors', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('fatal: not a git repository');
        const promise = Promise.reject(error);
        
        if (callback) {
          promise.catch(err => callback(err));
        }
        
        return promise;
      });
      
      const result = await git.resetHard('/test/repo');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a git repository');
    });
  });
  
  describe('pullOrigin', () => {
    it('should pull from origin successfully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
            resolve({ stdout: 'main', stderr: '' });
          } else if (cmd.includes('git pull origin main')) {
            resolve({ stdout: 'Already up to date.', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.pullOrigin('/test/repo');
      
      expect(result.success).toBe(true);
      expect(result.content.stdout).toContain('up to date');
    });
    
    it('should use provided branch name', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git pull origin develop')) {
            resolve({ stdout: 'Updating abc123..def456', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.pullOrigin('/test/repo', 'develop');
      
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git pull origin develop'),
        expect.any(Object),
        expect.any(Function)
      );
    });
    
    it('should handle pull errors', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve, reject) => {
          if (cmd.includes('git rev-parse')) {
            resolve({ stdout: 'main', stderr: '' });
          } else if (cmd.includes('git pull')) {
            reject(new Error('Failed to pull'));
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
      
      const result = await git.pullOrigin('/test/repo');
      
      expect(result.success).toBe(false);
    });
  });
  
  describe('commitChanges', () => {
    it('should commit changes with custom message', async () => {
      // Override spawn mock for this test to return custom message
      spawn.mockImplementation(() => {
        const EventEmitter = require('events');
        const mockProcess = new EventEmitter();
        
        mockProcess.stdin = {
          write: jest.fn(),
          end: jest.fn()
        };
        
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        mockProcess.kill = jest.fn();
        
        setTimeout(() => {
          mockProcess.stdout.emit('data', '[main abc123] Custom message');
          mockProcess.emit('close', 0);
        }, 10);
        
        return mockProcess;
      });
      
      const result = await git.commitChanges('/test/repo', 'Custom message');
      
      expect(result.success).toBe(true);
      expect(result.content.stdout).toContain('Custom message');
    });
    
    it('should use default message when none provided', async () => {
      const result = await git.commitChanges('/test/repo');
      
      expect(result.success).toBe(true);
      // After debug fix: message is passed via stdin using spawn with -F - flag
      // Verify spawn was called with the correct git command
      expect(spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['commit', '-a', '-F', '-']),
        expect.objectContaining({
          cwd: '/test/repo'
        })
      );
      // Verify stdin was written with the sanitized default message
      // Parentheses are removed by sanitization, so "fix(security)" becomes "fixsecurity"
      const spawnCall = spawn.mock.results[0].value;
      expect(spawnCall.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('fixsecurity')
      );
    });
    
    it('should handle nothing to commit scenario', async () => {
      // Override spawn mock to return "nothing to commit" message
      spawn.mockImplementation(() => {
        const EventEmitter = require('events');
        const mockProcess = new EventEmitter();
        
        mockProcess.stdin = {
          write: jest.fn(),
          end: jest.fn()
        };
        
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        mockProcess.kill = jest.fn();
        
        setTimeout(() => {
          mockProcess.stdout.emit('data', 'nothing to commit, working tree clean');
          mockProcess.emit('close', 0);
        }, 10);
        
        return mockProcess;
      });
      
      const result = await git.commitChanges('/test/repo');
      
      expect(result.content.stdout).toContain('nothing to commit');
    });
  });
  
  describe('pushChanges', () => {
    it('should push changes successfully', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git push')) {
            resolve({ stdout: 'To github.com:user/repo.git\nabc123..def456  main -> main', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.pushChanges('/test/repo');
      
      expect(result.success).toBe(true);
    });
    
    it('should handle "Everything up-to-date"', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve, reject) => {
          const error = new Error('Push failed');
          error.stderr = 'Everything up-to-date';
          reject(error);
        });
        
        if (callback) {
          promise.catch(err => callback(err));
        }
        
        return promise;
      });
      
      const result = await git.pushChanges('/test/repo');
      
      expect(result.success).toBe(true);
      expect(result.content.stdout).toBe('Everything up-to-date');
    });
    
    it('should handle push errors', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const error = new Error('failed to push');
        const promise = Promise.reject(error);
        
        if (callback) {
          promise.catch(err => callback(err));
        }
        
        return promise;
      });
      
      const result = await git.pushChanges('/test/repo');
      
      expect(result.success).toBe(false);
    });
  });
  
  describe('prepareRepository', () => {
    it('should prepare repository with reset and pull', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git rev-parse')) {
            resolve({ stdout: 'main', stderr: '' });
          } else if (cmd.includes('git reset --hard')) {
            resolve({ stdout: 'HEAD is now at abc123', stderr: '' });
          } else if (cmd.includes('git pull')) {
            resolve({ stdout: 'Already up to date.', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.prepareRepository('/test/repo', true);
      
      expect(result.success).toBe(true);
      expect(result.content.branch).toBe('main');
      expect(result.content.logs).toHaveLength(3);
    });
    
    it('should skip reset when allowReset is false', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git rev-parse')) {
            resolve({ stdout: 'main', stderr: '' });
          } else if (cmd.includes('git pull')) {
            resolve({ stdout: 'Already up to date.', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.prepareRepository('/test/repo', false);
      
      expect(result.success).toBe(true);
      expect(result.content.logs).toHaveLength(2); // Should not include reset
      expect(result.content.logs.some(log => log.operation === 'resetHard')).toBe(false);
    });
  });
  
  describe('commitAndPush', () => {
    it('should commit and push changes', async () => {
      exec.mockImplementation((cmd, options, callback) => {
        const promise = new Promise((resolve) => {
          if (cmd.includes('git commit')) {
            resolve({ stdout: '[main abc123] security update', stderr: '' });
          } else if (cmd.includes('git push')) {
            resolve({ stdout: 'To github.com\nabc123..def456  main -> main', stderr: '' });
          }
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.commitAndPush('/test/repo');
      
      expect(result.success).toBe(true);
      expect(result.content.logs).toHaveLength(2);
    });
    
    it('should handle nothing to commit gracefully', async () => {
      // Override spawn mock to return "nothing to commit" message
      spawn.mockImplementation(() => {
        const EventEmitter = require('events');
        const mockProcess = new EventEmitter();
        
        mockProcess.stdin = {
          write: jest.fn(),
          end: jest.fn()
        };
        
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        mockProcess.kill = jest.fn();
        
        setTimeout(() => {
          mockProcess.stdout.emit('data', 'nothing to commit, working tree clean');
          mockProcess.emit('close', 0);
        }, 10);
        
        return mockProcess;
      });
      
      const result = await git.commitAndPush('/test/repo');
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Nothing to commit');
    });
  });
  
  describe('sanitizeGitMessage', () => {
    it('should remove backticks to prevent command injection', () => {
      const malicious = '`rm -rf /`';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('`');
      expect(sanitized).toBe("'rm -rf /'");
    });
    
    it('should remove semicolons to prevent command chaining', () => {
      const malicious = 'normal message; rm -rf /';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain(';');
      expect(sanitized).toBe('normal message, rm -rf /');
    });
    
    it('should handle double quotes in message', () => {
      const malicious = 'message with "quotes" inside';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('"');
      expect(sanitized).toBe("message with 'quotes' inside");
    });
    
    it('should remove newlines and carriage returns', () => {
      const malicious = 'message\nwith\nnewlines\r\nand\rcarriage';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toContain('\r');
      // \n is replaced with space, \r is removed
      expect(sanitized).toBe('message with newlines andcarriage');
    });
    
    it('should remove pipe symbols to prevent command piping', () => {
      const malicious = 'message | cat /etc/passwd';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('|');
      expect(sanitized).toBe('message  cat /etc/passwd');
    });
    
    it('should remove dollar signs to prevent variable expansion', () => {
      const malicious = 'message $HOME $(whoami)';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('$');
      expect(sanitized).toBe('message HOME whoami');
    });
    
    it('should remove ampersands to prevent background execution', () => {
      const malicious = 'message & sleep 10 &';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('&');
      expect(sanitized).toBe('message and sleep 10 and');
    });
    
    it('should remove shell redirection operators', () => {
      const malicious = 'message > /tmp/file < input.txt';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('>');
      expect(sanitized).not.toContain('<');
      expect(sanitized).toBe('message  /tmp/file  input.txt');
    });
    
    it('should remove parentheses, brackets, and braces', () => {
      const malicious = 'message (subshell) [array] {block}';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('(');
      expect(sanitized).not.toContain(')');
      expect(sanitized).not.toContain('[');
      expect(sanitized).not.toContain(']');
      expect(sanitized).not.toContain('{');
      expect(sanitized).not.toContain('}');
      expect(sanitized).toBe('message subshell array block');
    });
    
    it('should remove backslashes to prevent escape sequences', () => {
      const malicious = 'message\\nwith\\tescapes\\x00';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('\\');
      // Backslashes are removed completely
      expect(sanitized).toBe('messagenwithtescapesx00');
    });
    
    it('should truncate excessively long messages', () => {
      const longMessage = 'a'.repeat(1000);
      const sanitized = git.sanitizeGitMessage(longMessage);
      
      expect(sanitized.length).toBeLessThanOrEqual(GIT_CONFIG.MESSAGE_MAX_LENGTH);
      expect(sanitized.length).toBe(GIT_CONFIG.MESSAGE_MAX_LENGTH);
    });
    
    it('should return default message for empty input after sanitization', () => {
      const emptyish = '     ';
      const sanitized = git.sanitizeGitMessage(emptyish);
      
      expect(sanitized).toBe('fix(security): update vulnerable dependencies');
    });
    
    it('should return default message for non-string input', () => {
      expect(git.sanitizeGitMessage(null)).toBe('fix(security): update vulnerable dependencies');
      expect(git.sanitizeGitMessage(undefined)).toBe('fix(security): update vulnerable dependencies');
      expect(git.sanitizeGitMessage(123)).toBe('fix(security): update vulnerable dependencies');
      expect(git.sanitizeGitMessage({})).toBe('fix(security): update vulnerable dependencies');
    });
    
    it('should preserve legitimate commit message content', () => {
      const legitimate = 'chore: update dependencies to v2.1.0';
      const sanitized = git.sanitizeGitMessage(legitimate);
      
      expect(sanitized).toBe('chore: update dependencies to v2.1.0');
    });
    
    it('should handle multiple dangerous characters in one message', () => {
      const malicious = '"; rm -rf / & echo `whoami` | cat > /tmp/h4ck; #';
      const sanitized = git.sanitizeGitMessage(malicious);
      
      expect(sanitized).not.toContain('"');
      expect(sanitized).not.toContain(';');
      expect(sanitized).not.toContain('&');
      expect(sanitized).not.toContain('`');
      expect(sanitized).not.toContain('|');
      expect(sanitized).not.toContain('>');
      expect(sanitized).toBe("', rm -rf / and echo 'whoami'  cat  /tmp/h4ck, #");
    });
  });
  
  describe('sanitizeBranchName', () => {
    it('should allow alphanumeric characters', () => {
      const branch = 'feature123';
      const sanitized = git.sanitizeBranchName(branch);
      
      expect(sanitized).toBe('feature123');
    });
    
    it('should allow hyphens, underscores, dots, and slashes', () => {
      const branch = 'feature/sub-branch_v1.0';
      const sanitized = git.sanitizeBranchName(branch);
      
      expect(sanitized).toBe('feature/sub-branch_v1.0');
    });
    
    it('should remove dangerous characters', () => {
      const malicious = 'branch; rm -rf /';
      const sanitized = git.sanitizeBranchName(malicious);
      
      expect(sanitized).not.toContain(';');
      expect(sanitized).not.toContain(' ');
      // Forward slash is allowed in branch names (for feature branches like "feature/xyz")
      expect(sanitized).toBe('branchrm-rf/');
    });
    
    it('should remove backticks and quotes', () => {
      const malicious = 'branch`whoami`"test"';
      const sanitized = git.sanitizeBranchName(malicious);
      
      expect(sanitized).not.toContain('`');
      expect(sanitized).not.toContain('"');
      expect(sanitized).toBe('branchwhoamitest');
    });
    
    it('should truncate excessively long branch names', () => {
      const longBranch = 'feature/' + 'a'.repeat(300);
      const sanitized = git.sanitizeBranchName(longBranch);
      
      expect(sanitized.length).toBeLessThanOrEqual(GIT_CONFIG.BRANCH_MAX_LENGTH);
    });
    
    it('should return default for empty branch name', () => {
      const empty = '   ';
      const sanitized = git.sanitizeBranchName(empty);
      
      expect(sanitized).toBe('main');
    });
    
    it('should return default for branch starting with dash', () => {
      const invalid = '-invalid-branch';
      const sanitized = git.sanitizeBranchName(invalid);
      
      expect(sanitized).toBe('main');
    });
    
    it('should return default for branch starting with dot', () => {
      const invalid = '.invalid-branch';
      const sanitized = git.sanitizeBranchName(invalid);
      
      expect(sanitized).toBe('main');
    });
    
    it('should return default for non-string input', () => {
      expect(git.sanitizeBranchName(null)).toBe('main');
      expect(git.sanitizeBranchName(undefined)).toBe('main');
      expect(git.sanitizeBranchName(123)).toBe('main');
      expect(git.sanitizeBranchName({})).toBe('main');
    });
  });
  
  describe('commitChanges with sanitization', () => {
    it('should sanitize dangerous commit message before execution', async () => {
      const dangerousMessage = 'test"; rm -rf /; echo "';
      
      exec.mockImplementation((cmd, options, callback) => {
        // Verify that the command does NOT contain the original dangerous message
        expect(cmd).not.toContain(dangerousMessage);
        // Verify that semicolons were replaced
        expect(cmd).not.toContain('; rm -rf /;');
        
        const promise = new Promise((resolve) => {
          resolve({ stdout: '[main abc123] sanitized message', stderr: '' });
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.commitChanges('/test/repo', dangerousMessage);
      
      expect(result.success).toBe(true);
    });
  });
  
  describe('pullOrigin with sanitization', () => {
    it('should sanitize dangerous branch name before execution', async () => {
      const dangerousBranch = 'main; rm -rf /';
      
      exec.mockImplementation((cmd, options, callback) => {
        // Verify that the command does NOT contain the semicolon
        expect(cmd).not.toContain('; rm -rf /');
        
        const promise = new Promise((resolve) => {
          resolve({ stdout: 'Already up to date.', stderr: '' });
        });
        
        if (callback) {
          promise.then(result => callback(null, result));
        }
        
        return promise;
      });
      
      const result = await git.pullOrigin('/test/repo', dangerousBranch);
      
      expect(result.success).toBe(true);
    });
  });
});