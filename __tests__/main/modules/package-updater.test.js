/**
 * Tests for package-updater.js — override synchronisation logic.
 * Prevents EOVERRIDE npm conflicts when a direct/parent dep is bumped.
 */
'use strict';

const {
  generatePackageJsonChanges,
  syncOverrideForDirectDep,
} = require('../../../src/main/modules/audit/appliers/package-updater');

function makePkg(ovr) {
  const p = {
    name: 'test-project',
    version: '1.0.0',
    dependencies: { lodash: '4.17.20', parent: '1.0.0' },
    devDependencies: { tool: '1.0.0' },
  };
  if (ovr !== undefined) p.overrides = ovr;
  return p;
}

// ── syncOverrideForDirectDep ─────────────────────────────────────────────────

describe('syncOverrideForDirectDep', () => {
  it('updates matching override to new version', () => {
    const p = makePkg({ lodash: '4.17.20' });
    syncOverrideForDirectDep(p, 'lodash', '4.18.0');
    expect(p.overrides.lodash).toBe('4.18.0');
  });

  it('no-ops when there is no overrides section', () => {
    const p = makePkg(undefined);
    expect(() => syncOverrideForDirectDep(p, 'lodash', '4.18.0')).not.toThrow();
    expect(p.overrides).toBeUndefined();
  });

  it('no-ops when package absent from overrides', () => {
    const p = makePkg({ minimist: '^1.2.6' });
    syncOverrideForDirectDep(p, 'lodash', '4.18.0');
    expect(p.overrides.lodash).toBeUndefined();
    expect(p.overrides.minimist).toBe('^1.2.6');
  });

  it('leaves sibling overrides untouched', () => {
    const p = makePkg({ lodash: '4.17.20', minimist: '^1.2.6' });
    syncOverrideForDirectDep(p, 'lodash', '4.18.0');
    expect(p.overrides.lodash).toBe('4.18.0');
    expect(p.overrides.minimist).toBe('^1.2.6');
  });
});

// ── UPDATE_DIRECT ────────────────────────────────────────────────────────────

describe('generatePackageJsonChanges UPDATE_DIRECT override sync', () => {
  it('syncs matching override in dependencies', () => {
    const cur = makePkg({ lodash: '4.17.20' });
    const { modifiedPackageJson: m, changes } = generatePackageJsonChanges(
      [{ type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.dependencies.lodash).toBe('4.18.0');
    expect(m.overrides.lodash).toBe('4.18.0');
    expect(changes[0]).toMatchObject({
      type: 'UPDATE_DIRECT',
      location: 'dependencies',
      package: 'lodash',
      from: '4.17.20',
      to: '4.18.0',
    });
  });

  it('no crash, unrelated overrides intact when no match', () => {
    const cur = makePkg({ minimist: '^1.2.6' });
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.dependencies.lodash).toBe('4.18.0');
    expect(m.overrides.lodash).toBeUndefined();
    expect(m.overrides.minimist).toBe('^1.2.6');
  });

  it('no crash, no overrides section created when none existed', () => {
    const cur = makePkg(undefined);
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.dependencies.lodash).toBe('4.18.0');
    expect(m.overrides).toBeUndefined();
  });

  it('syncs override for dep in devDependencies', () => {
    const cur = makePkg({ tool: '1.0.0' });
    const { modifiedPackageJson: m, changes } = generatePackageJsonChanges(
      [{ type: 'UPDATE_DIRECT', package: 'tool', targetVersion: '1.1.0' }],
      cur
    );
    expect(m.devDependencies.tool).toBe('1.1.0');
    expect(m.overrides.tool).toBe('1.1.0');
    expect(changes[0].location).toBe('devDependencies');
  });

  it('does not mutate the original package.json', () => {
    const cur = makePkg({ lodash: '4.17.20' });
    generatePackageJsonChanges(
      [{ type: 'UPDATE_DIRECT', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(cur.dependencies.lodash).toBe('4.17.20');
    expect(cur.overrides.lodash).toBe('4.17.20');
  });
});

// ── UPDATE_PARENT ────────────────────────────────────────────────────────────

describe('generatePackageJsonChanges UPDATE_PARENT override sync', () => {
  it('syncs matching override for parent dep in dependencies', () => {
    const cur = makePkg({ parent: '1.0.0' });
    const { modifiedPackageJson: m, changes } = generatePackageJsonChanges(
      [{ type: 'UPDATE_PARENT', parentPackage: 'parent', targetVersion: '1.2.0' }],
      cur
    );
    expect(m.dependencies.parent).toBe('1.2.0');
    expect(m.overrides.parent).toBe('1.2.0');
    expect(changes[0]).toMatchObject({
      type: 'UPDATE_PARENT',
      location: 'dependencies',
      package: 'parent',
      from: '1.0.0',
      to: '1.2.0',
    });
  });

  it('no crash when no matching override for parent dep', () => {
    const cur = makePkg({ minimist: '^1.2.6' });
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'UPDATE_PARENT', parentPackage: 'parent', targetVersion: '1.2.0' }],
      cur
    );
    expect(m.dependencies.parent).toBe('1.2.0');
    expect(m.overrides.parent).toBeUndefined();
  });

  it('syncs override for parent dep in devDependencies', () => {
    const cur = {
      name: 'x',
      version: '1.0.0',
      dependencies: {},
      devDependencies: { parent: '1.0.0' },
      overrides: { parent: '1.0.0' },
    };
    const { modifiedPackageJson: m, changes } = generatePackageJsonChanges(
      [{ type: 'UPDATE_PARENT', parentPackage: 'parent', targetVersion: '1.2.0' }],
      cur
    );
    expect(m.devDependencies.parent).toBe('1.2.0');
    expect(m.overrides.parent).toBe('1.2.0');
    expect(changes[0].location).toBe('devDependencies');
  });

  it('no crash and no overrides section created when none existed for parent dep', () => {
    const cur = makePkg(undefined);
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'UPDATE_PARENT', parentPackage: 'parent', targetVersion: '1.2.0' }],
      cur
    );
    expect(m.dependencies.parent).toBe('1.2.0');
    expect(m.overrides).toBeUndefined();
  });
});

// ── ADD_OVERRIDE + existing direct dep sync ──────────────────────────────────

describe('generatePackageJsonChanges ADD_OVERRIDE + existing direct dep sync', () => {
  it('syncs direct dep in dependencies when version differs', () => {
    const cur = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: { lodash: '4.17.20' },
      devDependencies: {},
      overrides: { lodash: '4.17.20' },
    };
    const { modifiedPackageJson: m, changes } = generatePackageJsonChanges(
      [{ type: 'ADD_OVERRIDE', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.overrides.lodash).toBe('4.18.0');
    expect(m.dependencies.lodash).toBe('4.18.0');
    expect(changes[0]).toMatchObject({
      type: 'ADD_OVERRIDE',
      location: 'overrides',
      package: 'lodash',
      to: '4.18.0',
    });
  });

  it('syncs direct dep in devDependencies when version differs', () => {
    const cur = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: {},
      devDependencies: { lodash: '4.17.20' },
    };
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'ADD_OVERRIDE', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.overrides.lodash).toBe('4.18.0');
    expect(m.devDependencies.lodash).toBe('4.18.0');
  });

  it('does not modify direct dep when versions are already identical', () => {
    const cur = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: { lodash: '4.18.0' },
      devDependencies: {},
    };
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'ADD_OVERRIDE', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.overrides.lodash).toBe('4.18.0');
    expect(m.dependencies.lodash).toBe('4.18.0');
  });

  it('only modifies overrides when package not in dependencies or devDependencies', () => {
    const cur = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: { react: '18.0.0' },
      devDependencies: {},
    };
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'ADD_OVERRIDE', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(m.overrides.lodash).toBe('4.18.0');
    expect(m.dependencies.lodash).toBeUndefined();
    expect(m.devDependencies.lodash).toBeUndefined();
  });

  it('creates overrides section when it did not exist', () => {
    const cur = makePkg(undefined);
    const { modifiedPackageJson: m } = generatePackageJsonChanges(
      [{ type: 'ADD_OVERRIDE', package: 'semver', targetVersion: '7.6.0' }],
      cur
    );
    expect(m.overrides).toBeDefined();
    expect(m.overrides.semver).toBe('7.6.0');
  });

  it('does not mutate the original package.json', () => {
    const cur = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: { lodash: '4.17.20' },
      devDependencies: {},
      overrides: { lodash: '4.17.20' },
    };
    generatePackageJsonChanges(
      [{ type: 'ADD_OVERRIDE', package: 'lodash', targetVersion: '4.18.0' }],
      cur
    );
    expect(cur.overrides.lodash).toBe('4.17.20');
    expect(cur.dependencies.lodash).toBe('4.17.20');
  });
});
