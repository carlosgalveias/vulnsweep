/**
 * Git Operations Module for VulnSweep
 *
 * Manages Git repository operations including reset, pull, commit, and push.
 * All operations are executed using child_process with proper error handling.
 * Uses standardized Result pattern for consistent error handling.
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { GIT_CONFIG, API_CONFIG } = require('../config/constants');
const { createSuccess, createError } = require('../utils/result');

const execAsync = promisify(exec);

/**
 * Execute a git command with stdin input using spawn()
 * This is needed because exec() doesn't support the input option
 * @param {string} command - The git command to execute
 * @param {string} projectPath - The project directory path
 * @param {string} stdinInput - Data to pipe to stdin
 * @param {number} timeout - Timeout in milliseconds (default: 30 seconds)
 * @returns {Promise<Object>} Object with stdout and stderr
 */
function executeGitWithStdin(command, projectPath, stdinInput, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const args = command.split(' ').slice(1); // Remove 'git' from command
    const child = spawn('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      maxBuffer: API_CONFIG.MAX_BUFFER_BYTES,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
    }, timeout);

    // Collect stdout
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle process completion
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (timedOut) return; // Already rejected

      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const error = new Error(`Git command failed with code ${code}: ${command}`);
        error.code = code;
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        reject(error);
      }
    });

    // Handle spawn errors
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    // Write to stdin and close it
    if (stdinInput) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Format vulnerability data into a markdown table for commit message body
 * @param {Array} vulnerabilities - Array of resolved vulnerability objects
 * @returns {string} Formatted markdown table
 */
function formatVulnerabilityTable(vulnerabilities) {
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    return '';
  }

  const tableHeader = `Dependency vulnerabilities fixed:

| Library | From Version | To Version | CVE(s) | Vulnerability Description |
|---------|--------------|------------|--------|---------------------------|`;

  const tableRows = vulnerabilities.map((vuln) => {
    const library = vuln.package || 'N/A';
    const fromVersion = vuln.installedVersion || 'N/A';
    const toVersion = vuln.patchedVersion || vuln.targetVersion || 'N/A';
    const cves = Array.isArray(vuln.cwe) && vuln.cwe.length > 0 ? vuln.cwe.join(', ') : 'N/A';
    const description = (vuln.title || 'No description available')
      .replace(/\|/g, '\\|') // Escape pipes in description
      .substring(0, 100); // Limit description length

    return `| ${library} | ${fromVersion} | ${toVersion} | ${cves} | ${description} |`;
  });

  return `${tableHeader}\n${tableRows.join('\n')}`;
}

/**
 * Create a complete commit message with title and body
 * @param {string} title - Commit message title
 * @param {Array} vulnerabilities - Array of resolved vulnerability objects
 * @returns {string} Complete commit message
 */
function createCommitMessage(title = 'fix(security): update vulnerable dependencies', vulnerabilities = []) {
  const sanitizedTitle = title
    .replace(/`/g, "'")
    .replace(/\$/g, '')
    .replace(/;/g, ',')
    .replace(/&/g, 'and')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
    .replace(/\0/g, '')
    .replace(/\\/g, '')
    .replace(/"/g, "'")
    .substring(0, 200)
    .trim();

  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    return sanitizedTitle;
  }

  const body = formatVulnerabilityTable(vulnerabilities);
  
  // Combine title and body with double newline
  return `${sanitizedTitle}\n\n${body}`;
}

/**
 * Sanitize a git commit message to prevent command injection
 * Removes or escapes dangerous characters while preserving legitimate content
 * @param {string} message - The commit message to sanitize
 * @returns {string} Sanitized message safe for use in git commands
 * @deprecated Use createCommitMessage instead for structured commit messages
 */
function sanitizeGitMessage(message) {
  if (typeof message !== 'string') {
    return 'fix(security): update vulnerable dependencies';
  }

  // Truncate excessively long messages
  let sanitized = message.substring(0, GIT_CONFIG.MESSAGE_MAX_LENGTH);

  // Remove or escape dangerous characters that could enable command injection
  // This includes: backticks, dollar signs (for variable expansion), semicolons,
  // pipe symbols, ampersands, newlines, carriage returns, null bytes, and quotes
  sanitized = sanitized
    .replace(/`/g, "'") // Replace backticks with single quotes
    .replace(/\$/g, '') // Remove dollar signs
    .replace(/;/g, ',') // Replace semicolons with commas
    .replace(/\|/g, '') // Remove pipe symbols
    .replace(/&/g, 'and') // Replace ampersands with 'and'
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .replace(/\r/g, '') // Remove carriage returns
    .replace(/\0/g, '') // Remove null bytes
    .replace(/\\/g, '') // Remove backslashes
    .replace(/"/g, "'") // Replace double quotes with single quotes
    .replace(/</g, '') // Remove less than
    .replace(/>/g, '') // Remove greater than
    .replace(/\(/g, '') // Remove opening parentheses
    .replace(/\)/g, '') // Remove closing parentheses
    .replace(/\[/g, '') // Remove opening brackets
    .replace(/\]/g, '') // Remove closing brackets
    .replace(/\{/g, '') // Remove opening braces
    .replace(/\}/g, ''); // Remove closing braces

  // Trim whitespace and ensure message is not empty
  sanitized = sanitized.trim();
  if (sanitized.length === 0) {
    return 'fix(security): update vulnerable dependencies';
  }

  return sanitized;
}

/**
 * Sanitize a git branch name to prevent command injection
 * Ensures branch name contains only safe characters
 * @param {string} branch - The branch name to sanitize
 * @returns {string} Sanitized branch name safe for use in git commands
 */
function sanitizeBranchName(branch) {
  if (typeof branch !== 'string') {
    return 'main';
  }

  // Branch names should only contain alphanumeric, hyphens, underscores, dots, and slashes
  // Remove any other characters
  let sanitized = branch.replace(/[^a-zA-Z0-9\-_./]/g, '');

  // Truncate to reasonable length
  sanitized = sanitized.substring(0, GIT_CONFIG.BRANCH_MAX_LENGTH);

  // Ensure not empty and doesn't start with problematic characters
  sanitized = sanitized.trim();
  if (sanitized.length === 0 || sanitized.startsWith('-') || sanitized.startsWith('.')) {
    return 'main';
  }

  return sanitized;
}

/**
 * Execute a git command in the specified directory
 * @param {string} command - The git command to execute
 * @param {string} projectPath - The project directory path
 * @returns {Promise<Object>} Result object with standardized pattern
 */
async function executeGitCommand(command, projectPath) {
  console.log(`[Git] Executing: ${command} in ${projectPath}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: projectPath,
      encoding: 'utf8',
      maxBuffer: API_CONFIG.MAX_BUFFER_BYTES,
    });

    return createSuccess({
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    });
  } catch (error) {
    return createError(error.message, {
      stdout: error.stdout ? error.stdout.toString().trim() : '',
      stderr: error.stderr ? error.stderr.toString().trim() : '',
    });
  }
}

/**
 * Get the current Git branch name
 * @param {string} projectPath - The project directory path
 * @returns {Promise<Object>} Result with branch name in data
 */
async function getCurrentBranch(projectPath) {
  const result = await executeGitCommand('git rev-parse --abbrev-ref HEAD', projectPath);

  if (result.success) {
    const branchName = result.content.stdout;
    console.log(`[Git] Current branch: ${branchName}`);
    return createSuccess(branchName);
  } else {
    console.error(`[Git] Failed to get current branch: ${result.error}`);
    return result;
  }
}

/**
 * Execute git reset --hard HEAD (DESTRUCTIVE!)
 * Discards all local changes in the working directory
 * @param {string} projectPath - The project directory path
 * @returns {Promise<Object>} Result object
 */
async function resetHard(projectPath) {
  console.log(`[Git] WARNING: Executing hard reset in ${projectPath}`);
  const result = await executeGitCommand('git reset --hard HEAD', projectPath);

  if (result.success) {
    console.log(`[Git] Hard reset completed successfully`);
  } else {
    console.error(`[Git] Hard reset failed: ${result.error}`);
  }

  return result;
}

/**
 * Pull changes from origin
 * @param {string} projectPath - The project directory path
 * @param {string} branch - Optional branch name (auto-detected if not provided)
 * @returns {Promise<Object>} Result object
 */
async function pullOrigin(projectPath, branch = null) {
  // Auto-detect branch if not provided
  if (!branch) {
    const branchResult = await getCurrentBranch(projectPath);
    if (!branchResult.success) {
      return createError('Failed to detect current branch');
    }
    branch = branchResult.content;
  }

  // Sanitize branch name to prevent command injection
  const safeBranch = sanitizeBranchName(branch);

  console.log(`[Git] Pulling from origin/${safeBranch}`);
  const result = await executeGitCommand(`git pull origin ${safeBranch}`, projectPath);

  if (result.success) {
    console.log(`[Git] Pull completed: ${result.content.stdout}`);
  } else {
    console.error(`[Git] Pull failed: ${result.error}`);
  }

  return result;
}

/**
 * Commit all changes with a message
 * @param {string} projectPath - The project directory path
 * @param {string|Object} messageOrOptions - Commit message string or options object with message and vulnerabilities
 * @returns {Promise<Object>} Result object
 */
async function commitChanges(
  projectPath,
  messageOrOptions = 'fix(security): update vulnerable dependencies'
) {
  let commitMessage;

  // Handle both old string format and new object format
  if (typeof messageOrOptions === 'string') {
    // Legacy format: just a message string
    commitMessage = sanitizeGitMessage(messageOrOptions);
  } else if (typeof messageOrOptions === 'object' && messageOrOptions !== null) {
    // New format: object with message and vulnerabilities
    const { message = 'fix(security): update vulnerable dependencies', vulnerabilities = [] } = messageOrOptions;
    commitMessage = createCommitMessage(message, vulnerabilities);
  } else {
    commitMessage = 'fix(security): update vulnerable dependencies';
  }

  console.log(`[Git] Committing changes with message: "${commitMessage.split('\n')[0]}..."`);

  // Use git commit -a -F - to read message from stdin
  // This avoids shell escaping issues with multiline messages and special characters
  // Use spawn() instead of exec() because exec() doesn't support the input option
  try {
    const { stdout, stderr } = await executeGitWithStdin(
      'git commit -a -F -',
      projectPath,
      commitMessage,
      30000 // 30 second timeout
    );

    const result = createSuccess({
      stdout: stdout,
      stderr: stderr,
    });
    
    console.log(`[Git] Commit successful`);
    return result;
  } catch (error) {
    const result = createError(error.message, {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    });
    
    // Check if there's nothing to commit (common case)
    const stdout = result.details?.stdout || '';
    const stderr = result.details?.stderr || '';
    
    if (stdout.includes('nothing to commit') || stdout.includes('no changes added') ||
        stderr.includes('nothing to commit') || stderr.includes('no changes added')) {
      console.log(`[Git] Nothing to commit (working tree clean)`);
    } else {
      console.error(`[Git] Commit failed: ${result.error}`);
    }
    
    return result;
  }
}

/**
 * Push committed changes to remote
 * @param {string} projectPath - The project directory path
 * @returns {Promise<Object>} Result object
 */
async function pushChanges(projectPath) {
  console.log(`[Git] Pushing changes to remote`);
  const result = await executeGitCommand('git push', projectPath);

  if (result.success) {
    console.log(`[Git] Push completed successfully`);
  } else {
    // Check for common issues
    // FIX: Add null checks before calling .includes()
    const stderr = result.details?.stderr || result.content?.stderr || '';
    if (stderr.includes('Everything up-to-date')) {
      console.log(`[Git] Already up to date`);
      return createSuccess({ stdout: 'Everything up-to-date', stderr: '' }, 'Already up to date');
    } else {
      console.error(`[Git] Push failed: ${result.error}`);
    }
  }

  return result;
}

/**
 * High-level function to prepare a repository (reset + pull)
 * @param {string} projectPath - The project directory path
 * @param {boolean} allowReset - Whether to perform hard reset (respects UI toggle)
 * @returns {Object} Result with success, branch, and logs array
 */
async function prepareRepository(projectPath, allowReset = true) {
  console.log(`[Git] Preparing repository: ${projectPath}`);
  console.log(`[Git] Allow reset: ${allowReset}`);

  const logs = [];
  let currentBranch = '';

  // Get current branch
  const branchResult = await getCurrentBranch(projectPath);
  logs.push({
    operation: 'getCurrentBranch',
    success: branchResult.success,
    output: branchResult.success ? branchResult.content : branchResult.error,
  });

  if (!branchResult.success) {
    return createError('Failed to get current branch', { branch: '', logs });
  }
  currentBranch = branchResult.content;

  // Perform hard reset if allowed
  if (allowReset) {
    const resetResult = await resetHard(projectPath);
    logs.push({
      operation: 'resetHard',
      success: resetResult.success,
      output: resetResult.success
        ? resetResult.content.stdout || resetResult.content.stderr
        : resetResult.error,
    });

    if (!resetResult.success) {
      return createError('Failed to reset repository', { branch: currentBranch, logs });
    }
  }

  // Pull latest changes
  const pullResult = await pullOrigin(projectPath, currentBranch);
  logs.push({
    operation: 'pullOrigin',
    success: pullResult.success,
    output: pullResult.success
      ? pullResult.content.stdout || pullResult.content.stderr
      : pullResult.error,
  });

  if (!pullResult.success) {
    return createError('Failed to pull from origin', { branch: currentBranch, logs });
  }

  return createSuccess({ branch: currentBranch, logs });
}

/**
 * High-level function to commit and push changes
 * @param {string} projectPath - The project directory path
 * @param {string|Object} messageOrOptions - Commit message string or options object with message and vulnerabilities
 * @returns {Object} Result with success and logs array
 */
async function commitAndPush(
  projectPath,
  messageOrOptions = 'fix(security): update vulnerable dependencies'
) {
  console.log(`[Git] Committing and pushing changes: ${projectPath}`);

  const logs = [];

  // Commit changes
  const commitResult = await commitChanges(projectPath, messageOrOptions);
  logs.push({
    operation: 'commitChanges',
    success: commitResult.success,
    output: commitResult.success
      ? commitResult.content.stdout || commitResult.content.stderr
      : commitResult.error,
  });

  // Check if there was nothing to commit (success case with specific message)
  if (commitResult.success && commitResult.content) {
    const stdout = commitResult.content.stdout || '';
    if (stdout.includes('nothing to commit') || stdout.includes('no changes added')) {
      return createSuccess({ logs }, 'Nothing to commit');
    }
  }

  if (!commitResult.success) {
    return createError('Failed to commit changes', { logs });
  }

  // Push changes
  const pushResult = await pushChanges(projectPath);
  logs.push({
    operation: 'pushChanges',
    success: pushResult.success,
    output: pushResult.success
      ? pushResult.content.stdout || pushResult.content.stderr
      : pushResult.error,
  });

  if (!pushResult.success) {
    return createError('Failed to push changes', { logs });
  }

  return createSuccess({ logs });
}

/**
 * Test function to verify module functionality with a real Git repository
 * @param {string} testRepoPath - Path to a test Git repository
 */
async function testGitModule(testRepoPath) {
  console.log('=== Git Module Test ===');
  console.log(`Testing with repository: ${testRepoPath}\n`);

  // Test 1: Get current branch
  console.log('Test 1: Get current branch');
  const branchResult = await getCurrentBranch(testRepoPath);
  console.log(`Result:`, branchResult);
  console.log('');

  // Test 2: Prepare repository (without reset for safety)
  console.log('Test 2: Prepare repository (no reset)');
  const prepareResult = await prepareRepository(testRepoPath, false);
  console.log(`Result:`, prepareResult);
  console.log('');

  // Test 3: Check git status
  console.log('Test 3: Check git status');
  const statusResult = await executeGitCommand('git status --short', testRepoPath);
  console.log(`Result:`, statusResult);
  console.log('');

  console.log('=== Test Complete ===');
}

// Export all functions
module.exports = {
  getCurrentBranch,
  resetHard,
  pullOrigin,
  commitChanges,
  pushChanges,
  prepareRepository,
  commitAndPush,
  testGitModule,
  sanitizeGitMessage,
  sanitizeBranchName,
  createCommitMessage,
  formatVulnerabilityTable,
};
