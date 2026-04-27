/**
 * Tests for discovery.js module
 * 
 * Tests project discovery functionality
 */

const discovery = require('../../../src/main/modules/discovery');

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn()
  },
  constants: {
    R_OK: 4
  }
}));

const fs = require('fs').promises;

describe('discovery module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('validateProject', () => {
    it('should return success for valid Node.js project with git', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({
        isDirectory: () => true
      });
      
      const result = await discovery.validateProject('/test/project');
      
      expect(result.success).toBe(true);
      expect(result.content).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(
        expect.stringContaining('package.json'),
        expect.any(Number)
      );
    });
    
    it('should return error if package.json does not exist', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT: no such file'));
      
      const result = await discovery.validateProject('/test/project');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
    
    it('should return error if .git is not a directory', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({
        isDirectory: () => false
      });
      
      const result = await discovery.validateProject('/test/project');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a valid git repository');
    });
    
    it('should return error if .git directory does not exist', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockRejectedValue(new Error('ENOENT'));
      
      const result = await discovery.validateProject('/test/project');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
  
  describe('discoverProjects', () => {
    it('should discover valid Node.js projects', async () => {
      // Mock base directory validation
      fs.access.mockResolvedValue();
      fs.stat.mockImplementation((path) => {
        if (path.includes('.git')) {
          return Promise.resolve({ isDirectory: () => true });
        }
        return Promise.resolve({ isDirectory: () => true });
      });
      
      // Mock readdir to return mock directories
      fs.readdir.mockResolvedValue([
        { name: 'project1', isDirectory: () => true },
        { name: 'project2', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false }
      ]);
      
      // Mock readFile for package.json
      fs.readFile.mockResolvedValue(JSON.stringify({
        name: 'test-project',
        version: '1.0.0'
      }));
      
      const result = await discovery.discoverProjects('/base/dir');
      
      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('project1');
      expect(result.content[0].packageJson.name).toBe('test-project');
    });
    
    it('should skip directories without package.json', async () => {
      fs.access.mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        return Promise.resolve();
      });
      
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      
      fs.readdir.mockResolvedValue([
        { name: 'not-a-project', isDirectory: () => true }
      ]);
      
      const result = await discovery.discoverProjects('/base/dir');
      
      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(0);
    });
    
    it('should skip directories with invalid package.json', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      
      fs.readdir.mockResolvedValue([
        { name: 'bad-project', isDirectory: () => true }
      ]);
      
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
  });
  
  describe('discoverProjectsStream', () => {
    it('should yield projects as they are discovered', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockImplementation((path) => {
        if (path.includes('.git')) {
          return Promise.resolve({ isDirectory: () => true });
        }
        return Promise.resolve({ isDirectory: () => true });
      });
      
      fs.readdir.mockResolvedValue([
        { name: 'project1', isDirectory: () => true },
        { name: 'project2', isDirectory: () => true }
      ]);
      
      fs.readFile.mockResolvedValue(JSON.stringify({
        name: 'test-project',
        version: '1.0.0'
      }));
      
      const projects = [];
      for await (const project of discovery.discoverProjectsStream('/base/dir')) {
        projects.push(project);
      }
      
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('project1');
    });
    
    it('should skip invalid projects without throwing', async () => {
      fs.access.mockResolvedValue();
      fs.stat.mockImplementation((path) => {
        if (path.includes('.git')) {
          return Promise.resolve({ isDirectory: () => true });
        }
        return Promise.resolve({ isDirectory: () => true });
      });
      
      fs.readdir.mockResolvedValue([
        { name: 'good-project', isDirectory: () => true },
        { name: 'bad-project', isDirectory: () => true }
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
  });
});