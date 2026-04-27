/**
 * VulnSweep - Standardized Result Pattern
 *
 * Provides a consistent return value pattern across all backend operations.
 * This eliminates the inconsistency of having three different error handling patterns
 * throughout the codebase.
 *
 * Standard Result Pattern:
 *
 * Success result:
 * {
 *   success: true,
 *   content: any,        // Optional: the actual result content
 *   message: string   // Optional: success message
 * }
 *
 * Error result:
 * {
 *   success: false,
 *   error: string,    // Required: error message (user-friendly)
 *   details: any      // Optional: additional error details (stderr, stack, etc.)
 * }
 *
 * Benefits:
 * - Clear success/failure indicator with `success` boolean
 * - Consistent structure across all operations
 * - Room for additional context without breaking the pattern
 * - Easy to check: `if (!result.success) { handle error }`
 * - TypeScript-friendly structure (if migrating to TypeScript)
 */

/**
 * Create a successful result
 * @param {*} data - The result data (optional)
 * @param {string} message - Success message (optional)
 * @returns {Object} Success result object
 *
 * @example
 * return createSuccess({ projects: [...] }, 'Found 5 projects');
 * return createSuccess(null, 'Operation completed');
 * return createSuccess(userData);
 */
function createSuccess(data = null, message = null) {
  const result = { success: true };

  if (data !== null && data !== undefined) {
    result.content = data;
  }

  if (message) {
    result.message = message;
  }

  return result;
}

/**
 * Create an error result
 * @param {string|Error} error - Error message or Error object
 * @param {*} details - Additional error details (optional)
 * @returns {Object} Error result object
 *
 * @example
 * return createError('Failed to read file');
 * return createError(error.message, { stderr: error.stderr });
 * return createError(new Error('Invalid input'), { code: 'EINVAL' });
 */
function createError(error, details = null) {
  const result = {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };

  if (details !== null && details !== undefined) {
    result.details = details;
  }

  return result;
}

/**
 * Check if a result is successful
 * Type guard function for Result type checking
 * @param {Object} result - Result object to check
 * @returns {boolean} True if result indicates success
 *
 * @example
 * const result = await someOperation();
 * if (isSuccess(result)) {
 *   console.log('Success:', result.content);
 * }
 */
function isSuccess(result) {
  return result && result.success === true;
}

/**
 * Check if a result is an error
 * Type guard function for Result type checking
 * @param {Object} result - Result object to check
 * @returns {boolean} True if result indicates error
 *
 * @example
 * const result = await someOperation();
 * if (isError(result)) {
 *   console.error('Error:', result.error);
 * }
 */
function isError(result) {
  return result && result.success === false;
}

/**
 * Wrap a synchronous function to return a Result
 * Automatically catches exceptions and converts them to error results
 * @param {Function} fn - Function to wrap
 * @returns {Function} Wrapped function that returns Result
 *
 * @example
 * const safeParseJSON = wrapSync((str) => JSON.parse(str));
 * const result = safeParseJSON('{"key":"value"}');
 * if (isSuccess(result)) {
 *   console.log(result.content);
 * }
 */
function wrapSync(fn) {
  return function (...args) {
    try {
      const data = fn(...args);
      return createSuccess(data);
    } catch (error) {
      return createError(error);
    }
  };
}

/**
 * Wrap an async function to return a Result
 * Automatically catches exceptions and converts them to error results
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped async function that returns Result
 *
 * @example
 * const safeReadFile = wrapAsync(async (path) => {
 *   return await fs.readFile(path, 'utf8');
 * });
 * const result = await safeReadFile('file.txt');
 * if (isSuccess(result)) {
 *   console.log(result.content);
 * }
 */
function wrapAsync(fn) {
  return async function (...args) {
    try {
      const data = await fn(...args);
      return createSuccess(data);
    } catch (error) {
      return createError(error);
    }
  };
}

/**
 * Convert a legacy result format to standardized Result
 * Useful for migrating from old patterns to new standardized pattern
 * @param {Object} legacyResult - Old format result
 * @returns {Object} Standardized Result object
 *
 * @example
 * // Convert { success: false, stdout: '', stderr: 'error msg' } to standard format
 * const result = fromLegacy(oldResult);
 */
function fromLegacy(legacyResult) {
  if (!legacyResult || typeof legacyResult !== 'object') {
    return createError('Invalid result object');
  }

  // If already in standard format, return as-is
  if (
    legacyResult.success === true &&
    (legacyResult.content !== undefined || legacyResult.message !== undefined)
  ) {
    return legacyResult;
  }

  if (legacyResult.success === false && legacyResult.error !== undefined) {
    return legacyResult;
  }

  // Convert from legacy git.js format: { success, stdout, stderr, error }
  if (legacyResult.success === true && legacyResult.stdout !== undefined) {
    return createSuccess(
      { stdout: legacyResult.stdout, stderr: legacyResult.stderr },
      'Operation completed'
    );
  }

  if (legacyResult.success === false) {
    return createError(legacyResult.error || legacyResult.stderr || 'Operation failed', {
      stdout: legacyResult.stdout,
      stderr: legacyResult.stderr,
    });
  }

  // If boolean false, convert to error
  if (legacyResult === false) {
    return createError('Operation failed');
  }

  // If boolean true, convert to success
  if (legacyResult === true) {
    return createSuccess();
  }

  // Unknown format, return as data
  return createSuccess(legacyResult);
}

/**
 * Combine multiple Results into a single Result
 * Returns success only if all results are successful
 * @param {Array<Object>} results - Array of Result objects
 * @returns {Object} Combined Result object
 *
 * @example
 * const results = await Promise.all([op1(), op2(), op3()]);
 * const combined = combineResults(results);
 * if (isSuccess(combined)) {
 *   console.log('All operations succeeded:', combined.content);
 * } else {
 *   console.error('Some operations failed:', combined.error);
 * }
 */
function combineResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return createError('Invalid results array');
  }

  const errors = results.filter((r) => isError(r));

  if (errors.length > 0) {
    return createError(`${errors.length} operation(s) failed`, {
      errors: errors.map((e) => e.error),
      results,
    });
  }

  return createSuccess(
    results.map((r) => r.content),
    'All operations completed successfully'
  );
}

// Export all functions
module.exports = {
  createSuccess,
  createError,
  isSuccess,
  isError,
  wrapSync,
  wrapAsync,
  fromLegacy,
  combineResults,
};
