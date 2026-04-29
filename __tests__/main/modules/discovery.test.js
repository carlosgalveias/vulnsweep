/**
 * Tests for discovery.js module
 *
 * Tests project discovery functionality.
 * A valid Node.js project requires only package.json.
 * package-lock.json is optional at discovery time (projects without it are
 * still discovered; they may fail later at the npm audit stage).
 */

const discovery = require('../../../src/main/modules/discovery');

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
    it('should discover valid Node.js projects', async () => {
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
  });
});
