const fs = require('fs').promises;
const { constants: fsConstants } = require('fs');
const path = require('path');
const { createSuccess, createError } = require('../utils/result');
const excluded_folders = [
  'node_modules',
  'bower_compnents',
  'vendor',
  'public',
  'coverage',
  'dist',
  'tmp',
  'temp',
];

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
 * Recursively discovers valid Node.js projects starting from a directory
 * @param {string} dirPath - Directory path to scan
 * @param {string} baseDirectory - Original base directory for relative path calculation
 * @param {string[]} discoveredPaths - Array of already-discovered project paths to avoid duplicates
 * @returns {Promise<Array>} - Array of discovered projects
 */
async function discoverProjectsRecursive(dirPath, baseDirectory, discoveredPaths) {
  const projects = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    for (const dir of directories) {
      const projectPath = path.join(dirPath, dir.name);

      // Skip common directories that should never be scanned
      if (excluded_folders.includes(dir.name) || dir.name.startsWith('.')) {
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
        discoveredPaths
      );
      projects.push(...nestedProjects);
    }
  } catch {
    // Skip directories with access issues
  }

  return projects;
}

/**
 * Discovers all valid Node.js projects in the base directory (recursive)
 * Checks base directory itself and all subdirectories for package.json
 * @param {string} baseDirectory - Base directory path to scan
 * @returns {Promise<Object>} - Result object with projects array and optional errors
 */
async function discoverProjects(baseDirectory) {
  const projects = [];
  const errors = [];
  const discoveredPaths = [];

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
  console.log('Base directory validated:', baseDirectory, baseValidation);
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
  const recursiveProjects = await discoverProjectsRecursive(
    baseDirectory,
    baseDirectory,
    discoveredPaths
  );
  projects.push(...recursiveProjects);

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
 * Yields projects as they are discovered (recursive)
 * @param {string} baseDirectory - Base directory path to scan
 * @param {string[]} discoveredPaths - Internal use: tracks discovered paths to avoid duplicates
 * @yields {Object} - Project object
 */
async function* discoverProjectsStream(baseDirectory, discoveredPaths = []) {
  // Check if base directory itself has a package.json
  const baseValidation = await validateProject(baseDirectory);
  console.log('Base directory validated:', baseDirectory, baseValidation);
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
  try {
    const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    for (const dir of directories) {
      const projectPath = path.join(baseDirectory, dir.name);

      // Skip common directories that should never be scanned
      if (excluded_folders.includes(dir.name) || dir.name.startsWith('.')) {
        continue;
      }

      // Recursively yield projects from subdirectories
      yield* discoverProjectsStream(projectPath, discoveredPaths);
    }
  } catch {
    // Skip directories with access issues
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
    const projects = await discoverProjects(parentDir);
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
  testDiscovery,
};
