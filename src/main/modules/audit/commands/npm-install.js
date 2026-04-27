/**
 * VulnSweep - NPM Install Command Module
 *
 * Executes npm install command in project directories with proper error handling.
 * Respects API_CONFIG settings for buffer size and timeouts.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { API_CONFIG } = require('../../../config/constants');
const { createSuccess, createError } = require('../../../utils/result');

const execAsync = promisify(exec);

/**
 * Execute npm install in the project directory
 * @param {string} projectPath - Absolute path to the project
 * @returns {Promise<Object>} { success: boolean, stdout: string, stderr: string }
 */
async function runNpmInstall(projectPath) {
  try {
    console.log(`[audit] Running npm install in: ${projectPath}`);

    const { stdout, stderr } = await execAsync('npm install', {
      cwd: projectPath,
      encoding: 'utf8',
      maxBuffer: API_CONFIG.MAX_BUFFER_BYTES,
    });

    return createSuccess({
      stdout: stdout || '',
      stderr: stderr || '',
    });
  } catch (error) {
    console.error(`[audit] npm install failed: ${error.message}`);
    return createError(error.stderr?.toString() || error.message, {
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
    });
  }
}

// Export functions
module.exports = {
  runNpmInstall,
};
