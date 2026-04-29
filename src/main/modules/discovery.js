const fs = require('fs').promises;
const { constants: fsConstants } = require('fs');
const path = require('path');
const { createSuccess, createError } = require('../utils/result');

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
 * Discovers all valid Node.js projects in the base directory
 * Scans only immediate subdirectories (not recursive)
 * @param {string} baseDirectory - Base directory path to scan
 * @returns {Promise<Object>} - Result object with projects array and optional errors
 */
async function discoverProjects(baseDirectory) {
  const projects = [];
  const errors = [];

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

  try {
    // Read all entries in the base directory
    const entries = await fs.readdir(baseDirectory, { withFileTypes: true });

    // Filter to only directories
    const directories = entries.filter((entry) => entry.isDirectory());

    // Process each subdirectory
    for (const dir of directories) {
      const projectPath = path.join(baseDirectory, dir.name);

      try {
        // Validate if this is a Node.js project
        const validationResult = await validateProject(projectPath);

        if (validationResult.success) {
          // Read and parse package.json
          const packageJsonPath = path.join(projectPath, 'package.json');
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');

          try {
            const packageJson = JSON.parse(packageJsonContent);

            projects.push({
              name: dir.name,
              path: projectPath,
              packageJson,
            });
          } catch (parseError) {
            errors.push({
              project: dir.name,
              path: projectPath,
              error: `Invalid package.json: ${parseError.message}`,
            });
          }
        }
      } catch (error) {
        // Skip directories with access issues
        errors.push({
          project: dir.name,
          path: projectPath,
          error: `Access denied or error reading project: ${error.message}`,
        });
      }
    }
  } catch (error) {
    return createError(`Error scanning directory: ${error.message}`);
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
 * @yields {Object} - Project object
 */
async function* discoverProjectsStream(baseDirectory) {
  try {
    // Validate base directory
    await fs.access(baseDirectory, fsConstants.R_OK);
    const baseStat = await fs.stat(baseDirectory);

    if (!baseStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${baseDirectory}`);
    }
  } catch (error) {
    throw new Error(`Invalid base directory: ${error.message}`);
  }

  try {
    const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    for (const dir of directories) {
      const projectPath = path.join(baseDirectory, dir.name);

      try {
        const isValid = await validateProject(projectPath);

        if (isValid) {
          const packageJsonPath = path.join(projectPath, 'package.json');
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');

          try {
            const packageJson = JSON.parse(packageJsonContent);

            yield {
              name: dir.name,
              path: projectPath,
              packageJson,
            };
          } catch (parseError) {
            console.warn(`Invalid package.json in ${dir.name}:`, parseError.message);
          }
        }
      } catch (error) {
        console.warn(`Error processing ${dir.name}:`, error.message);
      }
    }
  } catch (error) {
    throw new Error(`Error scanning directory: ${error.message}`);
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
