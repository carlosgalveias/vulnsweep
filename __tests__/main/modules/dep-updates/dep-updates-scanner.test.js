'use strict';
const mockGAV = jest.fn();
jest.mock('fs', () => {
  return {
    promises: { access: jest.fn(), readdir: jest.fn(), readFile: jest.fn() },
    constants: { R_OK: 4 },
  };
});
const mockDiscoverProjects = jest.fn();
jest.mock('../../../../src/main/modules/discovery', () => ({
  discoverProjects: mockDiscoverProjects,
}));
jest.mock('../../../../src/main/modules/scanner/package-universe-builder', () => ({
  parseOverridesMap: jest.requireActual(
    '../../../../src/main/modules/scanner/package-universe-builder'
  ).parseOverridesMap,
}));
// npm now uses exec (shell-based), git still uses execFile
jest.mock('child_process', () => {
  return { exec: jest.fn(), execFile: jest.fn() };
});
jest.mock('../../../../src/main/utils/registry-cache', () => {
  return jest.fn().mockImplementation(() => {
    return { getAllVersions: mockGAV };
  });
});
const cp = require('child_process');
const fs = require('fs');
const S = require('../../../../src/main/modules/dep-updates/dep-updates-scanner');

function pkg(deps, dev, overrides) {
  const o = { name: 't', version: '1.0.0' };
  if (deps) o.dependencies = deps;
  if (dev) o.devDependencies = dev;
  if (overrides) o.overrides = overrides;
  return JSON.stringify(o);
}
function nmv(v) {
  return JSON.stringify({ version: v });
}
function MC(ok, d) {
  mockGAV.mockResolvedValue(ok ? { success: true, content: d } : { success: false, error: 'x' });
}
// ME sets up exec (npm) mock to succeed or fail
function ME(fail) {
  cp.exec.mockImplementation((cmd, opts, cb) => {
    if (typeof opts === 'function') cb = opts;
    if (fail) cb(new Error('fail'));
    else cb(null, '', '');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scanDependencyUpdates - discovery integration', () => {
  it('returns results for root + child repos discovered by discoverProjects', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [
        { name: 'root-project', path: '/root', packageJson: {} },
        { name: 'child1', path: '/root/child1', packageJson: {} },
        { name: 'nested/deep', path: '/root/nested/deep', packageJson: {} },
      ],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ lodash: '4.0.0' }));
    });
    MC(true, ['4.1.0', '4.2.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.success).toBe(true);
    expect(r.content).toHaveLength(3);
    expect(r.content[0].repoName).toBe('root-project');
    expect(r.content[1].repoName).toBe('child1');
    expect(r.content[2].repoName).toBe('nested/deep');
    expect(r.content[0].candidates).toHaveLength(1);
  });

  it('always includes root when it has package.json (even with children)', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [
        { name: 'my-root', path: '/proj', packageJson: {} },
        { name: 'sub-a', path: '/proj/sub-a', packageJson: {} },
      ],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ express: '4.0.0' }));
    });
    MC(true, ['4.18.0']);
    const r = await S.scanDependencyUpdates('/proj');
    expect(r.success).toBe(true);
    // Root IS included — this was the bug
    const rootResult = r.content.find((c) => c.repoPath === '/proj');
    expect(rootResult).toBeDefined();
    expect(rootResult.repoName).toBe('my-root');
  });

  it('returns single-repo result when only root has package.json', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'single', path: '/single', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ axios: '0.21.0' }));
    });
    MC(true, ['1.0.0']);
    const r = await S.scanDependencyUpdates('/single');
    expect(r.success).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].repoPath).toBe('/single');
  });

  it('returns empty array when discoverProjects finds nothing', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [],
    });
    const r = await S.scanDependencyUpdates('/empty');
    expect(r.success).toBe(true);
    expect(r.content).toEqual([]);
  });

  it('returns empty array when discoverProjects fails', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: false,
      error: 'Invalid base directory',
    });
    const r = await S.scanDependencyUpdates('/invalid');
    expect(r.success).toBe(true);
    expect(r.content).toEqual([]);
  });

  it('each RepoUpdateResult has repoPath, repoName, candidates array', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'my-lib', path: '/root/my-lib', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ react: '17.0.0' }));
    });
    MC(true, ['18.0.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content[0]).toHaveProperty('repoPath', '/root/my-lib');
    expect(r.content[0]).toHaveProperty('repoName', 'my-lib');
    expect(r.content[0]).toHaveProperty('candidates');
    expect(Array.isArray(r.content[0].candidates)).toBe(true);
  });

  it('progressCallback receives object with repoName and packageName', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'svc', path: '/root/svc', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ express: '4.0.0' }));
    });
    MC(true, ['4.18.0']);
    const calls = [];
    await S.scanDependencyUpdates('/root', (d) => {
      calls.push(d);
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toHaveProperty('repoName', 'svc');
    expect(calls[0]).toHaveProperty('packageName', 'express');
    expect(calls[0]).toHaveProperty('current');
    expect(calls[0]).toHaveProperty('total');
  });

  it('reads devDependencies inside repo candidates', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'r1', path: '/root/r1', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg(null, { jest: '27.0.0' }));
    });
    MC(true, ['29.0.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content[0].candidates[0].depType).toBe('devDependencies');
  });

  it('skips package when no newer versions found', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'r1', path: '/root/r1', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.resolve(nmv('5.0.0'));
      return Promise.resolve(pkg({ lodash: '5.0.0' }));
    });
    MC(true, ['4.0.0', '5.0.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content[0].candidates).toHaveLength(0);
  });

  it('discovers deeply nested projects (recursive via discoverProjects)', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [
        { name: 'root', path: '/mono', packageJson: {} },
        { name: 'packages/core', path: '/mono/packages/core', packageJson: {} },
        { name: 'packages/ui/components', path: '/mono/packages/ui/components', packageJson: {} },
      ],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ lodash: '4.0.0' }));
    });
    MC(true, ['4.1.0']);
    const r = await S.scanDependencyUpdates('/mono');
    expect(r.success).toBe(true);
    expect(r.content).toHaveLength(3);
    // Verifies deep nesting is handled
    expect(r.content[2].repoPath).toBe('/mono/packages/ui/components');
  });
});

describe('applyUpdates', () => {
  it('error when empty array', async () => {
    const r = await S.applyUpdates('/f', []);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No updates/);
  });

  it('error when not array', async () => {
    const r = await S.applyUpdates('/f', null);
    expect(r.success).toBe(false);
  });

  it('runs npm install in repoPath when provided', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      { name: 'lodash', toVersion: '5.0.0', repoPath: '/root/repo1' },
    ]);
    expect(r.success).toBe(true);
    // exec is called with the npm install command and the repoPath as cwd
    const execCall = cp.exec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('npm install')
    );
    expect(execCall).toBeTruthy();
    const optsArg = execCall[1];
    expect(optsArg && optsArg.cwd).toBe('/root/repo1');
  });

  it('falls back to projectPath when update has no repoPath', async () => {
    ME(false);
    await S.applyUpdates('/fallback', [{ name: 'lodash', toVersion: '5.0.0' }]);
    const execCall = cp.exec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('npm install')
    );
    expect(execCall).toBeTruthy();
    const optsArg = execCall[1];
    expect(optsArg && optsArg.cwd).toBe('/fallback');
  });

  it('groups updates per repo and runs one npm install per repo (no git)', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      { name: 'a', toVersion: '2.0.0', repoPath: '/root/repo1' },
      { name: 'b', toVersion: '3.0.0', repoPath: '/root/repo1' },
      { name: 'c', toVersion: '4.0.0', repoPath: '/root/repo2' },
    ]);
    expect(r.success).toBe(true);
    // Two exec calls — one per repo
    const npmCalls = cp.exec.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('npm install')
    );
    expect(npmCalls).toHaveLength(2);
    // No git via execFile — git is handled by Commit & Push separately
    const gitCalls = cp.execFile.mock.calls.filter((c) => c[0] === 'git');
    expect(gitCalls).toHaveLength(0);
  });

  it('returns commitMessage string on success', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      { name: 'lo', toVersion: '5.0.0', repoPath: '/root/r1' },
    ]);
    expect(r.success).toBe(true);
    expect(typeof r.content.commitMessage).toBe('string');
    expect(r.content.commitMessage).toMatch(/chore: update/);
  });

  it('returns error when npm install fails', async () => {
    cp.exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      cb(new Error('npm fail'));
    });
    const r = await S.applyUpdates('/f', [{ name: 'lo', toVersion: '5.0.0', repoPath: '/f/r1' }]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/npm install failed/);
  });

  it('does not call git — commit is user-triggered via Commit & Push', async () => {
    ME(false);
    await S.applyUpdates('/f', [{ name: 'lo', toVersion: '5.0.0', repoPath: '/f/r1' }]);
    const gitCalls = cp.execFile.mock.calls.filter((c) => c[0] === 'git');
    expect(gitCalls).toHaveLength(0);
  });

  it('npm install failure returns error immediately', async () => {
    cp.exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      cb(new Error('npm fail'));
    });
    const r = await S.applyUpdates('/f', [{ name: 'lo', toVersion: '5.0.0', repoPath: '/f/r1' }]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/npm install failed/);
  });
});

describe('override handling in scanDependencyUpdates', () => {
  it('queries registry for resolved package name when override uses npm: protocol', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'proj', path: '/proj', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(
        pkg({ request: '2.88.2' }, null, { request: 'npm:@cypress/request@3.0.0' })
      );
    });
    MC(true, ['3.0.0', '3.1.0']);
    const r = await S.scanDependencyUpdates('/proj');
    expect(r.success).toBe(true);
    // The registry cache should have been called with the resolved name
    const gavCalls = mockGAV.mock.calls;
    const calledNames = gavCalls.map((c) => c[0]);
    expect(calledNames).toContain('@cypress/request');
    expect(calledNames).not.toContain('request');
  });

  it('candidate includes originalName when package is overridden', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'proj', path: '/proj', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(
        pkg({ request: '2.88.2' }, null, { request: 'npm:@cypress/request@3.0.0' })
      );
    });
    MC(true, ['3.0.0', '3.1.0']);
    const r = await S.scanDependencyUpdates('/proj');
    const candidate = r.content[0].candidates[0];
    expect(candidate.name).toBe('@cypress/request');
    expect(candidate.originalName).toBe('request');
  });

  it('works normally when package.json has no overrides field', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'proj', path: '/proj', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ express: '4.0.0' }));
    });
    MC(true, ['4.18.0']);
    const r = await S.scanDependencyUpdates('/proj');
    const candidate = r.content[0].candidates[0];
    expect(candidate.name).toBe('express');
    expect(candidate.originalName).toBeUndefined();
    // Registry should be queried with original name
    const calledNames = mockGAV.mock.calls.map((c) => c[0]);
    expect(calledNames).toContain('express');
  });

  it('ignores simple version pin overrides (no npm: protocol)', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'proj', path: '/proj', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ cookiejar: '2.1.0' }, null, { cookiejar: '2.1.4' }));
    });
    MC(true, ['2.1.4', '2.2.0']);
    const r = await S.scanDependencyUpdates('/proj');
    const candidate = r.content[0].candidates[0];
    // No name remapping — cookiejar is still cookiejar
    expect(candidate.name).toBe('cookiejar');
    expect(candidate.originalName).toBeUndefined();
    // Registry queried with original name
    const calledNames = mockGAV.mock.calls.map((c) => c[0]);
    expect(calledNames).toContain('cookiejar');
  });

  it('handles scoped packages in override resolvedName correctly', async () => {
    mockDiscoverProjects.mockResolvedValue({
      success: true,
      content: [{ name: 'proj', path: '/proj', packageJson: {} }],
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(
        pkg({ request: '2.88.2' }, null, { request: 'npm:@cypress/request@3.0.0' })
      );
    });
    MC(true, ['3.0.0', '3.1.0', '3.2.0']);
    const r = await S.scanDependencyUpdates('/proj');
    const candidate = r.content[0].candidates[0];
    // Scoped package name preserved correctly
    expect(candidate.name).toBe('@cypress/request');
    expect(candidate.originalName).toBe('request');
    expect(candidate.availableVersions).toContain('3.1.0');
  });

  it('applyUpdates uses npm: protocol syntax for overridden packages', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      {
        name: '@cypress/request',
        originalName: 'request',
        toVersion: '3.1.0',
        repoPath: '/root/r1',
      },
    ]);
    expect(r.success).toBe(true);
    const execCall = cp.exec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('npm install')
    );
    expect(execCall[0]).toContain('request@npm:@cypress/request@3.1.0');
  });

  it('applyUpdates uses plain syntax for non-overridden packages', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      { name: 'express', toVersion: '4.19.0', repoPath: '/root/r1' },
    ]);
    expect(r.success).toBe(true);
    const execCall = cp.exec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('npm install')
    );
    expect(execCall[0]).toContain('express@4.19.0');
    expect(execCall[0]).not.toContain('npm:');
  });
});
