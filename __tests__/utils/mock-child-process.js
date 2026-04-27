/**
 * Mock Helper for child_process
 * 
 * Provides utilities to mock child_process.exec calls in tests.
 * This allows testing git and npm commands without actually executing them.
 */

/**
 * Create a mock exec function that resolves with stdout/stderr
 * @param {string} stdout - Standard output
 * @param {string} stderr - Standard error
 * @returns {jest.Mock}
 */
function mockExecSuccess(stdout = '', stderr = '') {
  return jest.fn((command, options, callback) => {
    // Handle both callback and promise-based usage
    if (callback) {
      callback(null, { stdout, stderr });
    }
    return Promise.resolve({ stdout, stderr });
  });
}

/**
 * Create a mock exec function that rejects with an error
 * @param {string} message - Error message
 * @param {string} stdout - Standard output (optional)
 * @param {string} stderr - Standard error (optional)
 * @returns {jest.Mock}
 */
function mockExecFailure(message, stdout = '', stderr = '') {
  return jest.fn((command, options, callback) => {
    const error = new Error(message);
    error.stdout = stdout;
    error.stderr = stderr;
    
    if (callback) {
      callback(error);
    }
    return Promise.reject(error);
  });
}

/**
 * Create a conditional mock exec that returns different results based on command
 * @param {Object} commandResponses - Map of command patterns to responses
 * @returns {jest.Mock}
 * 
 * @example
 * mockExecConditional({
 *   'npm audit': { stdout: '{"vulnerabilities":{}}', stderr: '' },
 *   'git status': { stdout: 'nothing to commit', stderr: '' }
 * })
 */
function mockExecConditional(commandResponses) {
  return jest.fn((command, options, callback) => {
    const commandStr = typeof command === 'string' ? command : command.toString();
    
    // Find matching command pattern
    for (const [pattern, response] of Object.entries(commandResponses)) {
      if (commandStr.includes(pattern)) {
        if (response.error) {
          const error = new Error(response.error);
          error.stdout = response.stdout || '';
          error.stderr = response.stderr || '';
          
          if (callback) {
            callback(error);
          }
          return Promise.reject(error);
        }
        
        if (callback) {
          callback(null, { stdout: response.stdout || '', stderr: response.stderr || '' });
        }
        return Promise.resolve({ stdout: response.stdout || '', stderr: response.stderr || '' });
      }
    }
    
    // Default response if no pattern matches
    if (callback) {
      callback(null, { stdout: '', stderr: '' });
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  });
}

module.exports = {
  mockExecSuccess,
  mockExecFailure,
  mockExecConditional
};