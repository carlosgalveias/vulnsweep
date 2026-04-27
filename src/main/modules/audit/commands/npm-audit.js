/**
 * VulnSweep - NPM Audit Command Module
 *
 * Executes npm audit command and parses JSON output.
 * Handles the special case where npm audit returns non-zero exit codes
 * when vulnerabilities are found (but output is still valid JSON).
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { API_CONFIG } = require('../../../config/constants');
const { createSuccess, createError } = require('../../../utils/result');

const execAsync = promisify(exec);

/**
 * Execute npm audit and parse JSON output
 * @param {string} projectPath - Absolute path to the project
 * @returns {Promise<Object>} { success: boolean, auditData: object, rawOutput: string }
 */
async function runNpmAudit(projectPath) {
  try {
    console.log(`[audit] Running npm audit in: ${projectPath}`);

    const { stdout } = await execAsync('npm audit --json', {
      cwd: projectPath,
      encoding: 'utf8',
      maxBuffer: API_CONFIG.MAX_BUFFER_BYTES,
    });

    const auditData = JSON.parse(stdout);

    return createSuccess({
      auditData,
      rawOutput: stdout,
    });
  } catch (error) {
    // npm audit returns non-zero exit code when vulnerabilities are found
    // So we need to check if we got valid JSON output
    const output = error.stdout?.toString() || '';

    if (output) {
      try {
        const auditData = JSON.parse(output);
        return createSuccess({
          auditData,
          rawOutput: output,
        });
      } catch (parseError) {
        console.error(`[audit] Failed to parse npm audit output: ${parseError.message}`);
        return createError(parseError.message, {
          auditData: null,
          rawOutput: output,
        });
      }
    }

    console.error(`[audit] npm audit failed: ${error.message}`);
    return createError(error.message, {
      auditData: null,
      rawOutput: '',
    });
  }
}

// Export functions
module.exports = {
  runNpmAudit,
};
