/**
 * Tests for discovery.js module
 *
 * Tests project discovery functionality.
 * A valid Node.js project requires only package.json.
 * package-lock.json is optional at discovery time (projects without it are
 * still discovered; they may fail later at the npm audit stage).
 */

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn(),
  },
  constants: {
    R_OK: 4,
  },
}));

const fs = require('fs').promises;
const path = require('path');
const discovery = require('../../../src/main/modules/discovery');

describe('discovery module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateProject', () => {
    it('should return success when package.json exists', async () => {
      fs.access.mockResolvedValue();

      const result = await discovery.validateProject('/test/project');

      expect(result.success).toBe(true);
      expect(result.content).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(
        expect.stringContaining('package.json'),
        expect.any(Number)
      );
    });

    it('should return success even when package-lock.json does not exist', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT: no such file'));
        }
        return Promise.resolve();
      });

      const result = await discovery.validateProject('/test/project');

      expect(result.success).toBe(true);
      expect(result.content).toBe(true);
    });

    it('should return error if package.json does not exist', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('package.json') && !filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT: no such file'));
        }
        return Promise.resolve();
      });

      const result = await discovery.validateProject('/test/project');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should NOT require a .git directory', async () => {
      fs.access.mockResolvedValue();

      const result = await discovery.validateProject('/test/project-without-git');

      expect(result.success).toBe(true);
      expect(fs.stat).not.toHaveBeenCalled();
    });
  });

  describe('discoverProjects', () => {
    it('should discover valid Node.js projects at immediate level', async () => {
      // Base dir itself is NOT a project (no package.json), but children are
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'project1', isDirectory: () => true },
            { name: 'project2', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('project1');
      expect(result.content[0].packageJson.name).toBe('test-project');
    });

    it('should discover nested projects with relative path names', async () => {
      const baseDir = '/Work/projects';
      const myProjDir = path.join(baseDir, 'my_proj');
      const demoDir = path.join(myProjDir, 'demo');

      // Base dir does NOT have package.json; child dirs do
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([{ name: 'my_proj', isDirectory: () => true }]);
        }
        if (dirPath === myProjDir) {
          return Promise.resolve([{ name: 'demo', isDirectory: () => true }]);
        }
        if (dirPath === demoDir) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'nested-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      // The nested project should have relative path as name
      const nestedProject = result.content.find(
        (p) => p.name.includes(path.sep) || p.name.includes('/')
      );
      expect(nestedProject).toBeDefined();
      expect(nestedProject.path).toBe(demoDir);
    });

    it('should discover nested projects when parent is already a project', async () => {
      const baseDir = '/Work/projects';
      const parentDir = path.join(baseDir, 'project-with-nested');
      const childDir = path.join(parentDir, 'nested-child');

      // Base dir itself does NOT have package.json; children do
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([{ name: 'project-with-nested', isDirectory: () => true }]);
        }
        if (dirPath === parentDir) {
          return Promise.resolve([{ name: 'nested-child', isDirectory: () => true }]);
        }
        if (dirPath === childDir) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      // Should find both the parent and the nested child
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('project-with-nested');
      expect(result.content[1].name).toContain('nested-child');
    });

    it('should check if base directory itself has package.json', async () => {
      const baseDir = '/single-project';

      // Base dir has package.json
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockResolvedValue([]); // No subdirs

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'single-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir);

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('single-project');
      expect(result.content[0].path).toBe(baseDir);
    });

    it('should skip directories without package.json', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('package.json') && !filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });

      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([{ name: 'not-a-project', isDirectory: () => true }]);
        }
        return Promise.resolve([]);
      });

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      // Base dir also checked - no package.json there either, so 0 projects
      expect(result.content).toHaveLength(0);
    });

    it('should discover projects even when package-lock.json is absent', async () => {
      fs.access.mockImplementation((filePath) => {
        // Base dir has no package.json; children do (but lack lock file)
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        if (filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });

      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([{ name: 'no-lockfile-project', isDirectory: () => true }]);
        }
        return Promise.resolve([]);
      });
      fs.readFile.mockResolvedValue(
        JSON.stringify({ name: 'no-lockfile-project', version: '1.0.0' })
      );

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('no-lockfile-project');
    });

    it('should skip directories with invalid package.json', async () => {
      // access resolves for all (base + children have package.json) but readFile
      // returns invalid JSON for all, so no projects are counted.
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([{ name: 'bad-project', isDirectory: () => true }]);
        }
        return Promise.resolve([]);
      });
      fs.readFile.mockResolvedValue('{ invalid json }');

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      // Both base dir and bad-project have invalid JSON, so 0 projects
      expect(result.content).toHaveLength(0);
    });

    it('should return error for invalid base directory', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await discovery.discoverProjects('/invalid/path');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid base directory');
    });

    it('should return error if base directory is not a directory', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => false });

      const result = await discovery.discoverProjects('/file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path is not a directory');
    });

    it('should find projects inside a numeric-prefixed parent folder (01_utils regression)', async () => {
      const baseDir = '/Work/cognus-voice/01_utils';

      // Base dir does not have package.json
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'some-project', isDirectory: () => true },
            { name: 'another-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'some-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('some-project');
      expect(result.content[1].name).toBe('another-project');
    });

    it('should discover projects even when children lack package-lock.json (01_utils regression)', async () => {
      const baseDir = '/Work/cognus-voice/01_utils';

      fs.access.mockImplementation((filePath) => {
        // Base dir has no package.json
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        if (filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });

      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'some-project', isDirectory: () => true },
            { name: 'another-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'child-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
    });

    it('should skip node_modules directory in discoverProjects', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'node_modules', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });

    it('should skip hidden directories (starting with .) in discoverProjects', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: '.git', isDirectory: () => true },
            { name: '.idea', isDirectory: () => true },
            { name: '.vscode', isDirectory: () => true },
            { name: '.hidden-folder', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });

    it('should skip coverage, dist, tmp, and temp directories in discoverProjects', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'coverage', isDirectory: () => true },
            { name: 'dist', isDirectory: () => true },
            { name: 'tmp', isDirectory: () => true },
            { name: 'temp', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir', { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });
  });

  describe('discoverProjectsStream', () => {
    it('should yield projects as they are discovered', async () => {
      // Base dir does not have package.json, but children do
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'project1', isDirectory: () => true },
            { name: 'project2', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir', {
        recursive: true,
      })) {
        projects.push(project);
      }

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('project1');
    });

    it('should skip invalid projects without throwing', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'good-project', isDirectory: () => true },
            { name: 'bad-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', '.vsignore')) {
          return Promise.reject(new Error('ENOENT'));
        }
        if (filePath === path.join('/base/dir', 'good-project', 'package.json')) {
          return Promise.resolve(JSON.stringify({ name: 'good', version: '1.0.0' }));
        }
        return Promise.resolve('{ invalid json }');
      });

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir', {
        recursive: true,
      })) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].packageJson.name).toBe('good');
    });

    it('should throw error for invalid base directory', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const generator = discovery.discoverProjectsStream('/invalid/path', { recursive: true });

      await expect(generator.next()).rejects.toThrow('Invalid base directory');
    });

    it('should yield projects inside numeric-prefixed folder without .git (regression)', async () => {
      const baseDir = '/Work/cognus-voice/01_utils';

      // Base dir does not have package.json, but children do
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'some-project', isDirectory: () => true },
            { name: 'another-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'child-project', version: '2.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream(baseDir, { recursive: true })) {
        projects.push(project);
      }

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('some-project');
      expect(projects[1].name).toBe('another-project');
    });

    it('should skip node_modules directory in discoverProjectsStream', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'node_modules', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir', {
        recursive: true,
      })) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('valid-project');
    });

    it('should skip hidden directories (starting with .) in discoverProjectsStream', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: '.git', isDirectory: () => true },
            { name: '.idea', isDirectory: () => true },
            { name: '.vscode', isDirectory: () => true },
            { name: '.hidden-folder', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir', {
        recursive: true,
      })) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('valid-project');
    });

    it('should skip coverage, dist, tmp, and temp directories in discoverProjectsStream', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join('/base/dir', 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === '/base/dir') {
          return Promise.resolve([
            { name: 'coverage', isDirectory: () => true },
            { name: 'dist', isDirectory: () => true },
            { name: 'tmp', isDirectory: () => true },
            { name: 'temp', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir', {
        recursive: true,
      })) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('valid-project');
    });
  });

  describe('recursive option', () => {
    describe('discoverProjects', () => {
      it('should only discover base directory project when recursive is false (default)', async () => {
        const baseDir = '/base/dir';

        // Base dir has package.json
        fs.access.mockResolvedValue();
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.readFile.mockResolvedValue(JSON.stringify({ name: 'base-project', version: '1.0.0' }));

        const result = await discovery.discoverProjects(baseDir);

        expect(result.success).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].name).toBe('dir');
        expect(result.content[0].path).toBe(baseDir);
        // fs.readdir should NOT be called when recursive is false
        expect(fs.readdir).not.toHaveBeenCalled();
      });

      it('should discover base + nested projects when recursive is true', async () => {
        const baseDir = '/base/dir';

        // Base dir has package.json; child dirs also have package.json
        fs.access.mockResolvedValue();
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.readdir.mockImplementation((dirPath) => {
          if (dirPath === baseDir) {
            return Promise.resolve([{ name: 'child-project', isDirectory: () => true }]);
          }
          return Promise.resolve([]);
        });
        fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

        const result = await discovery.discoverProjects(baseDir, { recursive: true });

        expect(result.success).toBe(true);
        expect(result.content.length).toBeGreaterThanOrEqual(2);
      });

      it('should return empty array when recursive is false and base dir has no package.json', async () => {
        const baseDir = '/base/dir';

        fs.access.mockImplementation((filePath) => {
          if (filePath === path.join(baseDir, 'package.json')) {
            return Promise.reject(new Error('ENOENT'));
          }
          return Promise.resolve();
        });
        fs.stat.mockResolvedValue({ isDirectory: () => true });

        const result = await discovery.discoverProjects(baseDir);

        expect(result.success).toBe(true);
        expect(result.content).toHaveLength(0);
        expect(fs.readdir).not.toHaveBeenCalled();
      });

      it('should default to recursive false when options object is omitted', async () => {
        const baseDir = '/base/dir';

        // Base dir has package.json
        fs.access.mockResolvedValue();
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.readFile.mockResolvedValue(JSON.stringify({ name: 'base-project', version: '1.0.0' }));

        const result = await discovery.discoverProjects(baseDir);

        expect(result.success).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(fs.readdir).not.toHaveBeenCalled();
      });
    });

    describe('discoverProjectsStream', () => {
      it('should only yield base directory project when recursive is false (default)', async () => {
        const baseDir = '/base/dir';

        fs.access.mockResolvedValue();
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.readFile.mockResolvedValue(JSON.stringify({ name: 'base-project', version: '1.0.0' }));

        const projects = [];
        for await (const project of discovery.discoverProjectsStream(baseDir)) {
          projects.push(project);
        }

        expect(projects).toHaveLength(1);
        expect(projects[0].name).toBe('dir');
        expect(fs.readdir).not.toHaveBeenCalled();
      });

      it('should yield base + nested projects when recursive is true', async () => {
        const baseDir = '/base/dir';

        fs.access.mockResolvedValue();
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.readdir.mockImplementation((dirPath) => {
          if (dirPath === baseDir) {
            return Promise.resolve([{ name: 'child-project', isDirectory: () => true }]);
          }
          return Promise.resolve([]);
        });
        fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

        const projects = [];
        for await (const project of discovery.discoverProjectsStream(baseDir, {
          recursive: true,
        })) {
          projects.push(project);
        }

        expect(projects.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('.vsignore and ignore options', () => {
    it('should exclude folders listed in .vsignore at scan root', async () => {
      const baseDir = '/base/dir';

      // Base dir does NOT have package.json; children do
      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'project-a', isDirectory: () => true },
            { name: 'excluded-folder', isDirectory: () => true },
            { name: 'project-b', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, '.vsignore')) {
          return Promise.resolve('excluded-folder\n');
        }
        return Promise.resolve(JSON.stringify({ name: 'test', version: '1.0.0' }));
      });

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      const names = result.content.map((p) => p.name);
      expect(names).toContain('project-a');
      expect(names).toContain('project-b');
      expect(names).not.toContain('excluded-folder');
    });

    it('should ignore comments and empty lines in .vsignore', async () => {
      const baseDir = '/base/dir';

      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'project-a', isDirectory: () => true },
            { name: 'real-exclude', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, '.vsignore')) {
          return Promise.resolve('# This is a comment\n\n   \nreal-exclude\n# another comment\n');
        }
        return Promise.resolve(JSON.stringify({ name: 'test', version: '1.0.0' }));
      });

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('project-a');
    });

    it('should handle missing .vsignore gracefully', async () => {
      const baseDir = '/base/dir';

      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([{ name: 'project-a', isDirectory: () => true }]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, '.vsignore')) {
          return Promise.reject(new Error('ENOENT: no such file'));
        }
        return Promise.resolve(JSON.stringify({ name: 'test', version: '1.0.0' }));
      });

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('project-a');
    });

    it('should exclude folders passed via options.ignore', async () => {
      const baseDir = '/base/dir';

      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'project-a', isDirectory: () => true },
            { name: 'custom-dir', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, '.vsignore')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve(JSON.stringify({ name: 'test', version: '1.0.0' }));
      });

      const result = await discovery.discoverProjects(baseDir, {
        recursive: true,
        ignore: ['custom-dir'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('project-a');
    });

    it('should combine hardcoded + .vsignore + options.ignore exclusions', async () => {
      const baseDir = '/base/dir';

      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'node_modules', isDirectory: () => true }, // hardcoded
            { name: 'vsignore-excluded', isDirectory: () => true }, // .vsignore
            { name: 'cli-excluded', isDirectory: () => true }, // options.ignore
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, '.vsignore')) {
          return Promise.resolve('vsignore-excluded\n');
        }
        return Promise.resolve(JSON.stringify({ name: 'test', version: '1.0.0' }));
      });

      const result = await discovery.discoverProjects(baseDir, {
        recursive: true,
        ignore: ['cli-excluded'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });

    it('should handle .vsignore with Windows line endings', async () => {
      const baseDir = '/base/dir';

      fs.access.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, 'package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([
            { name: 'excluded-a', isDirectory: () => true },
            { name: 'excluded-b', isDirectory: () => true },
            { name: 'valid-project', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((filePath) => {
        if (filePath === path.join(baseDir, '.vsignore')) {
          return Promise.resolve('excluded-a\r\nexcluded-b\r\n');
        }
        return Promise.resolve(JSON.stringify({ name: 'test', version: '1.0.0' }));
      });

      const result = await discovery.discoverProjects(baseDir, { recursive: true });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });
  });

  describe('parseVsIgnoreFile', () => {
    it('should return empty array when file does not exist', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await discovery.parseVsIgnoreFile('/nonexistent/.vsignore');

      expect(result).toEqual([]);
    });

    it('should parse valid .vsignore content', async () => {
      fs.readFile.mockResolvedValue(
        '# comment\nfolder-a\n\n  folder-b  \n# another comment\nfolder-c\n'
      );

      const result = await discovery.parseVsIgnoreFile('/some/path/.vsignore');

      expect(result).toEqual(['folder-a', 'folder-b', 'folder-c']);
    });
  });
});
