const fs = require('fs').promises;
const { constants: fsConstants } = require('fs');
const path = require('path');
const { createSuccess, createError } = require('../utils/result');
const excluded_folders = [
  'node_modules',
  'bower_components',
  'vendor',
  'public',
  'coverage',
  'dist',
  'tmp',
  'temp',
];

/** Maximum recursion depth for directory traversal (prevents OOM from symlink loops or deep trees) */
const MAX_RECURSION_DEPTH = 10;

/**
 * Validates if a directory is a valid Node.js project.
 * A valid project must have package.json. package-lock.json is NOT required
 * for discovery — projects without a lock file are still discovered but may
 * fail later at the `npm audit` stage.
 * @param {string} projectPath - Absolute path to the project directory
 * @returns {Promise<Object>} - Result object with success boolean
 */
async function validateProject(projectPath) {
  try {
    // Check if package.json exists and is accessible
    await fs.access(path.join(projectPath, 'package.json'), fsConstants.R_OK);

    return createSuccess(true);
  } catch (error) {
    return createError(error.message || 'Invalid Node.js project');
  }
}

/**
 * Parses a .vsignore file and returns an array of exclusion patterns.
 * Format: one entry per line, # comments, empty lines ignored.
 * Each entry is a folder/file name to exclude (exact match).
 *
 * @param {string} filePath - Absolute path to the .vsignore file
 * @returns {Promise<string[]>} Array of exclusion patterns (folder/file names)
 */
async function parseVsIgnoreFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    // File doesn't exist or isn't readable — not an error, just no extra exclusions
    return [];
  }
}

/**
 * Builds the final exclusion list by merging:
 *   1. Hardcoded excluded_folders
 *   2. Patterns from .vsignore file at scan root (if exists)
 *   3. Patterns from options.ignore (CLI --ignore or programmatic)
 *
 * @param {string} baseDirectory - The scan root directory
 * @param {Object} options - Discovery options
 * @param {string[]} [options.ignore] - Additional patterns to exclude
 * @returns {Promise<Set<string>>} Deduplicated set of exclusion patterns
 */
async function buildExclusionList(baseDirectory, options = {}) {
  const patterns = [...excluded_folders];

  // Read .vsignore from scan root
  const vsIgnorePath = path.join(baseDirectory, '.vsignore');
  const vsIgnorePatterns = await parseVsIgnoreFile(vsIgnorePath);
  patterns.push(...vsIgnorePatterns);

  // Merge CLI/programmatic ignore patterns
  if (Array.isArray(options.ignore) && options.ignore.length > 0) {
    patterns.push(...options.ignore);
  }

  return new Set(patterns);
}

/**
 * Recursively discovers valid Node.js projects starting from a directory
 * @param {string} dirPath - Directory path to scan
 * @param {string} baseDirectory - Original base directory for relative path calculation
 * @param {string[]} discoveredPaths - Array of already-discovered project paths to avoid duplicates
 * @param {Set<string>} exclusionSet - Set of folder names to exclude
 * @param {number} depth - Current recursion depth (capped at MAX_RECURSION_DEPTH)
 * @returns {Promise<Array>} - Array of discovered projects
 */
async function discoverProjectsRecursive(
  dirPath,
  baseDirectory,
  discoveredPaths,
  exclusionSet,
  depth = 0
) {
  const projects = [];

  if (depth >= MAX_RECURSION_DEPTH) {
    return projects;
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    for (const dir of directories) {
      const projectPath = path.join(dirPath, dir.name);

      // Skip common directories that should never be scanned
      if (exclusionSet.has(dir.name) || dir.name.startsWith('.')) {
        continue;
      }

      const validationResult = await validateProject(projectPath);

      if (validationResult.success) {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');

        try {
          const packageJson = JSON.parse(packageJsonContent);
          const relativePath = path.relative(baseDirectory, projectPath);
          const projectName = relativePath.split(path.sep).join('/');

          discoveredPaths.push(projectPath);

          projects.push({
            name: projectName,
            path: projectPath,
            packageJson,
          });
        } catch (parseError) {
          console.warn(`Invalid package.json in ${projectPath}:`, parseError.message);
        }
      }

      // Recursively scan subdirectories even if this one isn't a project
      const nestedProjects = await discoverProjectsRecursive(
        projectPath,
        baseDirectory,
        discoveredPaths,
        exclusionSet,
        depth + 1
      );
      projects.push(...nestedProjects);
    }
  } catch {
    // Skip directories with access issues
  }

  return projects;
}

/**
 * Discovers all valid Node.js projects in the base directory
 * Checks base directory itself and (optionally) all subdirectories for package.json
 * @param {string} baseDirectory - Base directory path to scan
 * @param {Object} [options={}] - Discovery options
 * @param {boolean} [options.recursive=false] - When true, recurse into subdirectories up to MAX_RECURSION_DEPTH
 * @param {string[]} [options.ignore] - Additional folder names to exclude
 * @returns {Promise<Object>} - Result object with projects array and optional errors
 */
async function discoverProjects(baseDirectory, options = {}) {
  const projects = [];
  const errors = [];
  const discoveredPaths = [];
  const recursive = options.recursive === true;

  try {
    // Validate base directory exists and is accessible
    await fs.access(baseDirectory, fsConstants.R_OK);
    const baseStat = await fs.stat(baseDirectory);

    if (!baseStat.isDirectory()) {
      return createError(`Path is not a directory: ${baseDirectory}`);
    }
  } catch (error) {
    return createError(`Invalid base directory: ${error.message}`);
  }

  // Check if base directory itself has a package.json
  const baseValidation = await validateProject(baseDirectory);
  if (baseValidation.success) {
    try {
      const packageJsonPath = path.join(baseDirectory, 'package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);

      discoveredPaths.push(baseDirectory);
      projects.push({
        name: path.basename(baseDirectory),
        path: baseDirectory,
        packageJson,
      });
    } catch (parseError) {
      errors.push({
        project: path.basename(baseDirectory),
        path: baseDirectory,
        error: `Invalid package.json: ${parseError.message}`,
      });
    }
  }

  // Recursively discover projects in subdirectories
  if (recursive) {
    // Build exclusion list (hardcoded + .vsignore + options.ignore)
    const exclusionSet = await buildExclusionList(baseDirectory, options);

    const recursiveProjects = await discoverProjectsRecursive(
      baseDirectory,
      baseDirectory,
      discoveredPaths,
      exclusionSet
    );
    projects.push(...recursiveProjects);
  }

  // Log errors if any occurred (for debugging)
  if (errors.length > 0) {
    console.warn('Some projects could not be processed:', errors);
  }

  return createSuccess(
    projects,
    errors.length > 0
      ? `Found ${projects.length} projects with ${errors.length} errors`
      : `Found ${projects.length} projects`
  );
}

/**
 * Async generator version of discoverProjects for memory efficiency
 * Yields projects as they are discovered
 * @param {string} baseDirectory - Base directory path to scan
 * @param {Object} [options={}] - Discovery options
 * @param {boolean} [options.recursive=false] - When true, recurse into subdirectories up to MAX_RECURSION_DEPTH
 * @param {string[]} discoveredPaths - Internal use: tracks discovered paths to avoid duplicates
 * @param {number} depth - Current recursion depth (capped at MAX_RECURSION_DEPTH)
 * @yields {Object} - Project object
 */
async function* discoverProjectsStream(
  baseDirectory,
  options = {},
  discoveredPaths = [],
  depth = 0
) {
  if (depth >= MAX_RECURSION_DEPTH) {
    return;
  }

  const recursive = options.recursive === true;

  // Build or reuse exclusion set
  let exclusionSet;
  if (depth === 0) {
    exclusionSet = await buildExclusionList(baseDirectory, options);
    // Cache for recursive calls
    options = { ...options, _exclusionSet: exclusionSet };
  } else {
    exclusionSet = options._exclusionSet || new Set(excluded_folders);
  }

  // Validate base directory exists on the initial call (depth 0)
  if (depth === 0) {
    try {
      await fs.access(baseDirectory, fsConstants.R_OK);
      const baseStat = await fs.stat(baseDirectory);
      if (!baseStat.isDirectory()) {
        throw new Error(`Invalid base directory: Path is not a directory: ${baseDirectory}`);
      }
    } catch (error) {
      if (error.message.startsWith('Invalid base directory')) throw error;
      throw new Error(`Invalid base directory: ${error.message}`, { cause: error });
    }
  }

  // Check if base directory itself has a package.json
  const baseValidation = await validateProject(baseDirectory);
  if (baseValidation.success) {
    try {
      const packageJsonPath = path.join(baseDirectory, 'package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);

      discoveredPaths.push(baseDirectory);

      yield {
        name: path.basename(baseDirectory),
        path: baseDirectory,
        packageJson,
      };
    } catch (parseError) {
      console.warn(`Invalid package.json in ${baseDirectory}:`, parseError.message);
    }
  }

  // Recursively scan subdirectories
  if (recursive) {
    try {
      const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory());

      for (const dir of directories) {
        const projectPath = path.join(baseDirectory, dir.name);

        // Skip common directories that should never be scanned
        if (exclusionSet.has(dir.name) || dir.name.startsWith('.')) {
          continue;
        }

        // Recursively yield projects from subdirectories
        yield* discoverProjectsStream(projectPath, options, discoveredPaths, depth + 1);
      }
    } catch {
      // Skip directories with access issues
    }
  }
}

/**
 * Simple test function to verify the module works correctly
 * Usage: node -e "require('./src/main/modules/discovery').testDiscovery()"
 */
async function testDiscovery() {
  console.log('=== Discovery Module Test ===\n');

  // Test 1: Validate current directory (should be valid if run from project root)
  const currentDir = process.cwd();
  console.log(`Test 1: Validating current directory: ${currentDir}`);
  const isValid = await validateProject(currentDir);
  console.log(`Result: ${isValid ? 'VALID' : 'INVALID'} Node.js project\n`);

  // Test 2: Discover projects in parent directory
  const parentDir = path.dirname(currentDir);
  console.log(`Test 2: Discovering projects in parent directory: ${parentDir}`);

  try {
    const projects = await discoverProjects(parentDir, { recursive: true });
    console.log(`Found ${projects.length} valid Node.js projects:`);

    projects.forEach((project, index) => {
      console.log(`\n${index + 1}. ${project.name}`);
      console.log(`   Path: ${project.path}`);
      console.log(
        `   Package: ${project.packageJson.name || 'N/A'} v${project.packageJson.version || 'N/A'}`
      );

      if (project.packageJson.dependencies) {
        const depCount = Object.keys(project.packageJson.dependencies).length;
        console.log(`   Dependencies: ${depCount}`);
      }
      if (project.packageJson.devDependencies) {
        const devDepCount = Object.keys(project.packageJson.devDependencies).length;
        console.log(`   Dev Dependencies: ${devDepCount}`);
      }
    });
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\n=== Test Complete ===');
}

module.exports = {
  discoverProjects,
  discoverProjectsStream,
  validateProject,
  parseVsIgnoreFile,
  testDiscovery,
};
