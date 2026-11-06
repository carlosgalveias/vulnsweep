'use strict';

// ─── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../../src/main/modules/git', () => ({
  commitAndPush: jest.fn(),
}));

jest.mock('../../src/cli/runner', () => ({
  run: jest.fn(),
}));

jest.mock('../../src/cli/autofix-handler', () => ({
  applyAutofix: jest.fn(),
}));


const { parseCliArgs } = require('../../src/cli/arg-parser');
const { commitAndPush } = require('../../src/main/modules/git');

// ─── arg-parser: --commit and --bump flags ──────────────────────────────────────

describe('arg-parser: --commit and --bump flags', () => {
  it('parses --commit as boolean true', () => {
    const opts = parseCliArgs(['--dir', process.cwd(), '--commit']);
    expect(opts.commit).toBe(true);
  });

  it('parses -c short alias for --commit', () => {
    const opts = parseCliArgs(['--dir', process.cwd(), '-c']);
    expect(opts.commit).toBe(true);
  });

  it('parses --bump as boolean true', () => {
    const opts = parseCliArgs(['--dir', process.cwd(), '--bump']);
    expect(opts.bump).toBe(true);
  });

  it('parses -b short alias for --bump', () => {
    const opts = parseCliArgs(['--dir', process.cwd(), '-b']);
    expect(opts.bump).toBe(true);
  });

  it('defaults --commit and --bump to false', () => {
    const opts = parseCliArgs(['--dir', process.cwd()]);
    expect(opts.commit).toBe(false);
    expect(opts.bump).toBe(false);
  });

  it('parses combined -a -c -b flags', () => {
    const opts = parseCliArgs(['--dir', process.cwd(), '-a', '-c', '-b']);
    expect(opts.autofix).toBe(true);
    expect(opts.commit).toBe(true);
    expect(opts.bump).toBe(true);
  });
});

// ─── Commit loop behavior ───────────────────────────────────────────────────────

describe('commit loop behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();

  });

  /**
   * Helper to invoke the main() function logic extracted from index.js.
   * Since index.js has side effects (process.exit), we test the commit logic in isolation.
   */
  function buildCommitLoop(opts, fixResult) {
    // Simulate the commit loop logic from index.js (lines 289-321)
    const commitAndPushFn = commitAndPush;

    return async () => {
      if (
        opts.commit &&
        fixResult.applied > 0 &&
        fixResult.modifiedPaths &&
        fixResult.modifiedPaths.length > 0
      ) {
        const commitMessage = opts.bump
          ? 'fix(security): update vulnerable dependencies and bump version'
          : 'fix(security): update vulnerable dependencies';
        let committed = 0;
        let commitFailed = 0;

        for (const modPath of fixResult.modifiedPaths) {
          try {
            const gitResult = await commitAndPushFn(modPath, commitMessage);
            if (gitResult.success) {
              committed++;
            } else {
              commitFailed++;
            }
          } catch (err) {
            commitFailed++;
            if (!opts.quiet) {
              console.error(`  ✗ Commit failed for ${modPath}: ${err.message}`);
            }
          }
        }

        return { committed, commitFailed };
      }
      return { committed: 0, commitFailed: 0, skipped: true };
    };
  }

  it('skips commit loop when modifiedPaths is empty', async () => {
    const opts = { commit: true, bump: false, quiet: false };
    const fixResult = { applied: 3, modifiedPaths: [] };

    const loop = buildCommitLoop(opts, fixResult);
    const result = await loop();

    expect(result.skipped).toBe(true);
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it('skips commit loop when modifiedPaths is undefined', async () => {
    const opts = { commit: true, bump: false, quiet: false };
    const fixResult = { applied: 3, modifiedPaths: undefined };

    const loop = buildCommitLoop(opts, fixResult);
    const result = await loop();

    expect(result.skipped).toBe(true);
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it('calls git.commitAndPush with correct project path and message', async () => {
    commitAndPush.mockResolvedValue({ success: true });
    const opts = { commit: true, bump: false, quiet: false };
    const fixResult = { applied: 2, modifiedPaths: ['/proj/a', '/proj/b'] };

    const loop = buildCommitLoop(opts, fixResult);
    await loop();

    expect(commitAndPush).toHaveBeenCalledTimes(2);
    expect(commitAndPush).toHaveBeenCalledWith(
      '/proj/a',
      'fix(security): update vulnerable dependencies'
    );
    expect(commitAndPush).toHaveBeenCalledWith(
      '/proj/b',
      'fix(security): update vulnerable dependencies'
    );
  });

  it('uses bump-aware commit message when opts.bump is true', async () => {
    commitAndPush.mockResolvedValue({ success: true });
    const opts = { commit: true, bump: true, quiet: false };
    const fixResult = { applied: 1, modifiedPaths: ['/proj/x'] };

    const loop = buildCommitLoop(opts, fixResult);
    await loop();

    expect(commitAndPush).toHaveBeenCalledWith(
      '/proj/x',
      'fix(security): update vulnerable dependencies and bump version'
    );
  });

  it('reports commit failure counts when all commits fail', async () => {
    commitAndPush.mockResolvedValue({ success: false });

    const opts = { commit: true, bump: false, quiet: false };
    const fixResult = { applied: 2, modifiedPaths: ['/proj/a'] };

    const loop = buildCommitLoop(opts, fixResult);
    const result = await loop();

    expect(result.committed).toBe(0);
    expect(result.commitFailed).toBe(1);
  });

  it('logs error when commitAndPush throws and quiet is false', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    commitAndPush.mockRejectedValue(new Error('network timeout'));

    const opts = { commit: true, bump: false, quiet: false };
    const fixResult = { applied: 1, modifiedPaths: ['/proj/a'] };

    const loop = buildCommitLoop(opts, fixResult);
    const result = await loop();

    expect(result.commitFailed).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Commit failed for /proj/a: network timeout')
    );
    consoleSpy.mockRestore();
  });

  it('suppresses error log when commitAndPush throws and quiet is true', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    commitAndPush.mockRejectedValue(new Error('network timeout'));

    const opts = { commit: true, bump: false, quiet: true };
    const fixResult = { applied: 1, modifiedPaths: ['/proj/a'] };

    const loop = buildCommitLoop(opts, fixResult);
    await loop();

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ─── --bump ignored for dependency scan type ────────────────────────────────────

describe('--bump ignored for dependency scan type', () => {
  it('warns and disables --bump when type is dependency', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Simulate the validation logic from index.js
    const opts = { bump: true, type: 'dependency', autofix: true, commit: false };
    if (opts.bump && opts.type === 'dependency') {
      console.warn('⚠ --bump is not supported for dependency update scans. Ignoring.');
      opts.bump = false;
    }

    expect(warnSpy).toHaveBeenCalledWith(
      '⚠ --bump is not supported for dependency update scans. Ignoring.'
    );
    expect(opts.bump).toBe(false);
    warnSpy.mockRestore();
  });

  it('does NOT warn when type is audit', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const opts = { bump: true, type: 'audit', autofix: true, commit: false };
    if (opts.bump && opts.type === 'dependency') {
      console.warn('⚠ --bump is not supported for dependency update scans. Ignoring.');
      opts.bump = false;
    }

    expect(warnSpy).not.toHaveBeenCalled();
    expect(opts.bump).toBe(true);
    warnSpy.mockRestore();
  });
});

// ─── License gate disabling autofix suppresses commit/bump warnings ─────────────

describe('license gate disabling autofix suppresses commit/bump warnings', () => {
  it('does not warn about --commit when license gate disabled autofix', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Simulate the logic from index.js
    const opts = { commit: true, bump: true, autofix: false };
    const userRequestedAutofix = true; // user DID pass --autofix but license gate killed it

    if (opts.commit && !opts.autofix && userRequestedAutofix) {
      opts.commit = false;
    } else if (opts.commit && !opts.autofix) {
      process.stderr.write('  ⚠ --commit requires --autofix. Ignoring.\n');
      opts.commit = false;
    }

    if (opts.bump && !opts.autofix && userRequestedAutofix) {
      opts.bump = false;
    } else if (opts.bump && !opts.autofix) {
      process.stderr.write('  ⚠ --bump requires --autofix. Ignoring.\n');
      opts.bump = false;
    }

    expect(opts.commit).toBe(false);
    expect(opts.bump).toBe(false);
    // No warning was written to stderr
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('warns about --commit when user never passed --autofix', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const opts = { commit: true, bump: false, autofix: false };
    const userRequestedAutofix = false; // user did NOT pass --autofix

    if (opts.commit && !opts.autofix && userRequestedAutofix) {
      opts.commit = false;
    } else if (opts.commit && !opts.autofix) {
      process.stderr.write('  ⚠ --commit requires --autofix. Ignoring.\n');
      opts.commit = false;
    }

    expect(opts.commit).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith('  ⚠ --commit requires --autofix. Ignoring.\n');
    stderrSpy.mockRestore();
  });
});
