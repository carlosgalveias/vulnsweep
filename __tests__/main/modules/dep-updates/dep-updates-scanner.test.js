'use strict';
const mockGAV = jest.fn();
jest.mock('fs', () => {
  return {
    promises: { access: jest.fn(), readdir: jest.fn(), readFile: jest.fn() },
    constants: { R_OK: 4 },
  };
});
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

function pkg(deps, dev) {
  const o = { name: 't', version: '1.0.0' };
  if (deps) o.dependencies = deps;
  if (dev) o.devDependencies = dev;
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
function dirEntry(name) {
  return {
    name,
    isDirectory() {
      return true;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scanDependencyUpdates - multi-repo discovery', () => {
  it('returns 2 RepoUpdateResults when root has 2 subdirs each with package.json', async () => {
    fs.promises.access.mockResolvedValue();
    fs.promises.readdir.mockResolvedValue([dirEntry('repo1'), dirEntry('repo2')]);
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ lodash: '4.0.0' }));
    });
    MC(true, ['4.1.0', '4.2.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.success).toBe(true);
    expect(r.content).toHaveLength(2);
    expect(r.content[0].repoName).toBe('repo1');
    expect(r.content[1].repoName).toBe('repo2');
    expect(r.content[0].candidates).toHaveLength(1);
    expect(r.content[0].candidates[0].name).toBe('lodash');
  });

  it('returns 1 RepoUpdateResult when root itself has package.json (single-repo fallback)', async () => {
    fs.promises.access.mockResolvedValue();
    fs.promises.readdir.mockResolvedValue([]);
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ axios: '0.21.0' }));
    });
    MC(true, ['1.0.0']);
    const r = await S.scanDependencyUpdates('/single');
    expect(r.success).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].repoPath).toBe('/single');
    expect(r.content[0].candidates[0].name).toBe('axios');
  });

  it('returns empty array when root has no package.json anywhere', async () => {
    fs.promises.access.mockRejectedValue(new Error('ENOENT'));
    fs.promises.readdir.mockResolvedValue([]);
    const r = await S.scanDependencyUpdates('/empty');
    expect(r.success).toBe(true);
    expect(r.content).toEqual([]);
  });

  it('each RepoUpdateResult has repoPath, repoName, candidates array', async () => {
    fs.promises.access.mockResolvedValue();
    fs.promises.readdir.mockResolvedValue([dirEntry('my-lib')]);
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ react: '17.0.0' }));
    });
    MC(true, ['18.0.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content[0]).toHaveProperty('repoPath');
    expect(r.content[0]).toHaveProperty('repoName', 'my-lib');
    expect(r.content[0]).toHaveProperty('candidates');
    expect(Array.isArray(r.content[0].candidates)).toBe(true);
  });

  it('progressCallback receives object with repoName and packageName', async () => {
    fs.promises.access.mockResolvedValue();
    fs.promises.readdir.mockResolvedValue([dirEntry('svc')]);
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

  it('subdirs without package.json are skipped', async () => {
    fs.promises.readdir.mockResolvedValue([dirEntry('no-pkg'), dirEntry('has-pkg')]);
    fs.promises.access.mockImplementation((p) => {
      if (p.indexOf('no-pkg') !== -1) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve();
    });
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg({ lodash: '4.0.0' }));
    });
    MC(true, ['4.1.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content).toHaveLength(1);
    expect(r.content[0].repoName).toBe('has-pkg');
  });

  it('reads devDependencies inside repo candidates', async () => {
    fs.promises.access.mockResolvedValue();
    fs.promises.readdir.mockResolvedValue([dirEntry('r1')]);
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.reject(new Error('nm'));
      return Promise.resolve(pkg(null, { jest: '27.0.0' }));
    });
    MC(true, ['29.0.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content[0].candidates[0].depType).toBe('devDependencies');
  });

  it('skips package when no newer versions found', async () => {
    fs.promises.access.mockResolvedValue();
    fs.promises.readdir.mockResolvedValue([dirEntry('r1')]);
    fs.promises.readFile.mockImplementation((p) => {
      if (p.indexOf('node_modules') !== -1) return Promise.resolve(nmv('5.0.0'));
      return Promise.resolve(pkg({ lodash: '5.0.0' }));
    });
    MC(true, ['4.0.0', '5.0.0']);
    const r = await S.scanDependencyUpdates('/root');
    expect(r.content[0].candidates).toHaveLength(0);
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
