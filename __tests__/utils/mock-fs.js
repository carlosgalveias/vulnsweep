/**
 * Mock Helper for fs.promises
 * 
 * Provides utilities to mock fs.promises operations in tests.
 * This allows testing file system operations without actual file I/O.
 */

/**
 * Create a mock fs.promises.readFile that returns specific content
 * @param {Object} fileContents - Map of file paths to their contents
 * @returns {jest.Mock}
 * 
 * @example
 * mockReadFile({
 *   '/path/to/package.json': '{"name":"test","version":"1.0.0"}',
 *   '/path/to/file.txt': 'Hello World'
 * })
 */
function mockReadFile(fileContents) {
  return jest.fn((filePath) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    for (const [path, content] of Object.entries(fileContents)) {
      const normalizedMockPath = path.replace(/\\/g, '/');
      if (normalizedPath.includes(normalizedMockPath) || normalizedPath.endsWith(normalizedMockPath)) {
        return Promise.resolve(content);
      }
    }
    
    const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    error.code = 'ENOENT';
    return Promise.reject(error);
  });
}

/**
 * Create a mock fs.promises.writeFile that succeeds
 * @returns {jest.Mock}
 */
function mockWriteFile() {
  return jest.fn(() => Promise.resolve());
}

/**
 * Create a mock fs.promises.access that succeeds or fails based on paths
 * @param {Array<string>} existingPaths - Paths that should exist
 * @returns {jest.Mock}
 */
function mockAccess(existingPaths = []) {
  return jest.fn((filePath) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    const exists = existingPaths.some(path => {
      const normalizedMockPath = path.replace(/\\/g, '/');
      return normalizedPath.includes(normalizedMockPath) || normalizedPath.endsWith(normalizedMockPath);
    });
    
    if (exists) {
      return Promise.resolve();
    }
    
    const error = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
    error.code = 'ENOENT';
    return Promise.reject(error);
  });
}

/**
 * Create a mock fs.promises.stat that returns file/directory info
 * @param {Object} statInfo - Map of paths to stat results
 * @returns {jest.Mock}
 * 
 * @example
 * mockStat({
 *   '/path/to/dir': { isDirectory: () => true, isFile: () => false },
 *   '/path/to/file': { isDirectory: () => false, isFile: () => true }
 * })
 */
function mockStat(statInfo = {}) {
  return jest.fn((filePath) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    for (const [path, info] of Object.entries(statInfo)) {
      const normalizedMockPath = path.replace(/\\/g, '/');
      if (normalizedPath.includes(normalizedMockPath) || normalizedPath.endsWith(normalizedMockPath)) {
        return Promise.resolve(info);
      }
    }
    
    const error = new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
    error.code = 'ENOENT';
    return Promise.reject(error);
  });
}

/**
 * Create a mock fs.promises.readdir that returns directory entries
 * @param {Object} dirContents - Map of directory paths to their entries
 * @returns {jest.Mock}
 * 
 * @example
 * mockReaddir({
 *   '/projects': [
 *     { name: 'project1', isDirectory: () => true },
 *     { name: 'project2', isDirectory: () => true }
 *   ]
 * })
 */
function mockReaddir(dirContents = {}) {
  return jest.fn((dirPath, options) => {
    const normalizedPath = dirPath.replace(/\\/g, '/');
    
    for (const [path, entries] of Object.entries(dirContents)) {
      const normalizedMockPath = path.replace(/\\/g, '/');
      if (normalizedPath.includes(normalizedMockPath) || normalizedPath.endsWith(normalizedMockPath)) {
        return Promise.resolve(entries);
      }
    }
    
    const error = new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`);
    error.code = 'ENOENT';
    return Promise.reject(error);
  });
}

module.exports = {
  mockReadFile,
  mockWriteFile,
  mockAccess,
  mockStat,
  mockReaddir
};