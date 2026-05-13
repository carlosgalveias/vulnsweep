'use strict';
const mockGAV = jest.fn();
jest.mock('fs', () => {
  return {
    promises: { access: jest.fn(), readdir: jest.fn(), readFile: jest.fn() },
    constants: { R_OK: 4 },
  };
});
jest.mock('child_process', () => {
  return { execFile: jest.fn() };
});
jest.mock('../../../../src/main/utils/registry-cache', () => {
  return jest.fn().mockImplementation(() => {
    return { getAllVersions: mockGAV };
  });
});
const fs = require('fs');
const ef = require('child_process').execFile;
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
function ME(fail) {
  ef.mockImplementation((c, a, o, cb) => {
    if (typeof o === 'function') cb = o;
    if (fail) cb(new Error('fail'));
    else cb(null, { stdout: '', stderr: '' });
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
    expect(
      ef.mock.calls.some((c) => {
        return c[0] === 'npm' && c[2] && c[2].cwd === '/root/repo1';
      })
    ).toBe(true);
    expect(r.success).toBe(true);
  });

  it('falls back to projectPath when update has no repoPath', async () => {
    ME(false);
    await S.applyUpdates('/fallback', [{ name: 'lodash', toVersion: '5.0.0' }]);
    expect(
      ef.mock.calls.some((c) => {
        return c[0] === 'npm' && c[2] && c[2].cwd === '/fallback';
      })
    ).toBe(true);
  });

  it('groups updates per repo and runs one commit per repo', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      { name: 'a', toVersion: '2.0.0', repoPath: '/root/repo1' },
      { name: 'b', toVersion: '3.0.0', repoPath: '/root/repo1' },
      { name: 'c', toVersion: '4.0.0', repoPath: '/root/repo2' },
    ]);
    expect(r.success).toBe(true);
    const commitCalls = ef.mock.calls.filter((c) => {
      return c[0] === 'git' && c[1][0] === 'commit';
    });
    expect(commitCalls).toHaveLength(2);
  });

  it('returns commitMessages array on success', async () => {
    ME(false);
    const r = await S.applyUpdates('/root', [
      { name: 'lo', toVersion: '5.0.0', repoPath: '/root/r1' },
    ]);
    expect(r.success).toBe(true);
    expect(Array.isArray(r.content.commitMessages)).toBe(true);
    expect(r.content.commitMessages[0]).toMatch(/chore: update/);
  });

  it('returns error when npm install fails', async () => {
    ef.mockImplementation((c, a, o, cb) => {
      if (typeof o === 'function') cb = o;
      if (c === 'npm') cb(new Error('npm fail'));
      else cb(null, { stdout: '', stderr: '' });
    });
    const r = await S.applyUpdates('/f', [{ name: 'lo', toVersion: '5.0.0', repoPath: '/f/r1' }]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/npm install failed/);
  });

  it('returns error when git add fails', async () => {
    ef.mockImplementation((c, a, o, cb) => {
      if (typeof o === 'function') cb = o;
      if (c === 'npm') cb(null, { stdout: '', stderr: '' });
      else if (a[0] === 'add') cb(new Error('git add fail'));
      else cb(null, { stdout: '', stderr: '' });
    });
    const r = await S.applyUpdates('/f', [{ name: 'lo', toVersion: '5.0.0', repoPath: '/f/r1' }]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/git add failed/);
  });

  it('returns error when git commit fails', async () => {
    ef.mockImplementation((c, a, o, cb) => {
      if (typeof o === 'function') cb = o;
      if (c === 'npm' || a[0] === 'add') cb(null, { stdout: '', stderr: '' });
      else cb(new Error('git commit fail'));
    });
    const r = await S.applyUpdates('/f', [{ name: 'lo', toVersion: '5.0.0', repoPath: '/f/r1' }]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/git commit failed/);
  });
});
