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
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'project1', isDirectory: () => true },
        { name: 'project2', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('project1');
      expect(result.content[0].packageJson.name).toBe('test-project');
    });

    it('should discover nested projects with relative path names', async () => {
      const baseDir = '/Work/projects';

      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      // First call for /Work/projects - returns one subdir 'my_proj'
      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([{ name: 'my_proj', isDirectory: () => true }]);
        }
        // Second call for /Work/projects/my_proj - returns 'demo'
        if (dirPath === '/Work/projects/my_proj') {
          return Promise.resolve([{ name: 'demo', isDirectory: () => true }]);
        }
        // Third call for /Work/projects/my_proj/demo - no subdirs
        if (dirPath === '/Work/projects/my_proj/demo') {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'nested-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir);

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      // The nested project should have relative path as name
      const nestedProject = result.content.find(
        (p) => p.name.includes(path.sep) || p.name.includes('/')
      );
      expect(nestedProject).toBeDefined();
      expect(nestedProject.path).toBe('/Work/projects/my_proj/demo');
    });

    it('should discover nested projects when parent is already a project', async () => {
      const baseDir = '/Work/projects';

      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockImplementation((dirPath) => {
        if (dirPath === baseDir) {
          return Promise.resolve([{ name: 'project-with-nested', isDirectory: () => true }]);
        }
        if (dirPath === '/Work/projects/project-with-nested') {
          return Promise.resolve([{ name: 'nested-child', isDirectory: () => true }]);
        }
        if (dirPath === '/Work/projects/project-with-nested/nested-child') {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir);

      expect(result.success).toBe(true);
      // Should find both the parent and the nested child
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('project-with-nested');
      expect(result.content[1].name).toBe('project-with-nested/nested-child');
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
      fs.readdir.mockResolvedValue([{ name: 'not-a-project', isDirectory: () => true }]);

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
      // Base dir also checked - no package.json there either, so 0 projects
      expect(result.content).toHaveLength(0);
    });

    it('should discover projects even when package-lock.json is absent', async () => {
      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });

      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockResolvedValue([{ name: 'no-lockfile-project', isDirectory: () => true }]);
      fs.readFile.mockResolvedValue(
        JSON.stringify({ name: 'no-lockfile-project', version: '1.0.0' })
      );

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('no-lockfile-project');
    });

    it('should skip directories with invalid package.json', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockResolvedValue([{ name: 'bad-project', isDirectory: () => true }]);
      fs.readFile.mockResolvedValue('{ invalid json }');

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
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

      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'some-project', isDirectory: () => true },
        { name: 'another-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'some-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir);

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('some-project');
      expect(result.content[1].name).toBe('another-project');
    });

    it('should discover projects even when children lack package-lock.json (01_utils regression)', async () => {
      const baseDir = '/Work/cognus-voice/01_utils';

      fs.access.mockImplementation((filePath) => {
        if (filePath.endsWith('package-lock.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });

      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'some-project', isDirectory: () => true },
        { name: 'another-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'child-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects(baseDir);

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
    });

    it('should skip node_modules directory in discoverProjects', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'node_modules', isDirectory: () => true },
        { name: 'valid-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });

    it('should skip hidden directories (starting with .) in discoverProjects', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: '.git', isDirectory: () => true },
        { name: '.idea', isDirectory: () => true },
        { name: '.vscode', isDirectory: () => true },
        { name: '.hidden-folder', isDirectory: () => true },
        { name: 'valid-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });

    it('should skip coverage, dist, tmp, and temp directories in discoverProjects', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'coverage', isDirectory: () => true },
        { name: 'dist', isDirectory: () => true },
        { name: 'tmp', isDirectory: () => true },
        { name: 'temp', isDirectory: () => true },
        { name: 'valid-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const result = await discovery.discoverProjects('/base/dir');

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe('valid-project');
    });
  });

  describe('discoverProjectsStream', () => {
    it('should yield projects as they are discovered', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'project1', isDirectory: () => true },
        { name: 'project2', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir')) {
        projects.push(project);
      }

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('project1');
    });

    it('should skip invalid projects without throwing', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'good-project', isDirectory: () => true },
        { name: 'bad-project', isDirectory: () => true },
      ]);

      let callCount = 0;
      fs.readFile.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(JSON.stringify({ name: 'good', version: '1.0.0' }));
        }
        return Promise.resolve('{ invalid json }');
      });

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir')) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].packageJson.name).toBe('good');
    });

    it('should throw error for invalid base directory', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const generator = discovery.discoverProjectsStream('/invalid/path');

      await expect(generator.next()).rejects.toThrow('Invalid base directory');
    });

    it('should yield projects inside numeric-prefixed folder without .git (regression)', async () => {
      const baseDir = '/Work/cognus-voice/01_utils';

      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'some-project', isDirectory: () => true },
        { name: 'another-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'child-project', version: '2.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream(baseDir)) {
        projects.push(project);
      }

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('some-project');
      expect(projects[1].name).toBe('another-project');
    });

    it('should skip node_modules directory in discoverProjectsStream', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'node_modules', isDirectory: () => true },
        { name: 'valid-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir')) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('valid-project');
    });

    it('should skip hidden directories (starting with .) in discoverProjectsStream', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: '.git', isDirectory: () => true },
        { name: '.idea', isDirectory: () => true },
        { name: '.vscode', isDirectory: () => true },
        { name: '.hidden-folder', isDirectory: () => true },
        { name: 'valid-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir')) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('valid-project');
    });

    it('should skip coverage, dist, tmp, and temp directories in discoverProjectsStream', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      fs.readdir.mockResolvedValue([
        { name: 'coverage', isDirectory: () => true },
        { name: 'dist', isDirectory: () => true },
        { name: 'tmp', isDirectory: () => true },
        { name: 'temp', isDirectory: () => true },
        { name: 'valid-project', isDirectory: () => true },
      ]);

      fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-project', version: '1.0.0' }));

      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir')) {
        projects.push(project);
      }

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('valid-project');
    });
  });
});
