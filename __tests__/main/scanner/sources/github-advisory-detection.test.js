'use strict';

const {
  isVersionAffectedByAdvisory,
  splitAdvisoryBranches,
  majorOf,
} = require('../../../../src/main/modules/scanner/sources/github-advisory-source');

/**
 * Builds a minimal raw GitHub advisory object for a single npm package.
 * @param {string} name
 * @param {string} range - vulnerable_version_range
 * @param {string} [patched] - patched_versions
 * @returns {object}
 */
function adv(name, range, patched) {
  const v = { package: { ecosystem: 'npm', name }, vulnerable_version_range: range };
  if (patched) v.patched_versions = patched;
  return { ghsa_id: 'GHSA-test', vulnerabilities: [v] };
}

describe('isVersionAffectedByAdvisory — multi-branch detection', () => {
  describe('splitAdvisoryBranches', () => {
    it('splits OR branches separated by commas', () => {
      expect(splitAdvisoryBranches('>= 4.0.0 < 4.22.0, >= 5.0.0 < 5.1.0')).toEqual([
        '>= 4.0.0 < 4.22.0',
        '>= 5.0.0 < 5.1.0',
      ]);
    });

    it('returns a single branch unchanged (no comma)', () => {
      expect(splitAdvisoryBranches('>= 4.17.0 < 4.17.21')).toEqual(['>= 4.17.0 < 4.17.21']);
    });

    it('handles an open-ended upper bound', () => {
      expect(splitAdvisoryBranches('< 5.1.0')).toEqual(['< 5.1.0']);
    });

    it('returns [] for empty/non-string input', () => {
      expect(splitAdvisoryBranches('')).toEqual([]);
      expect(splitAdvisoryBranches(null)).toEqual([]);
    });
  });

  describe('majorOf', () => {
    it('extracts the major version', () => {
      expect(majorOf('4.22.1')).toBe(4);
      expect(majorOf('5.1.0')).toBe(5);
    });
    it('returns null for non-semver', () => {
      expect(majorOf('abc')).toBeNull();
    });
  });

  describe('open upper bound is cross-major (GitHub semantics)', () => {
    // An OPEN "< 5.1.0" (no lower bound) means "all versions before 5.1.0",
    // which legitimately includes 4.x. This must flag 4.22.1 — scoping it to
    // a single major would silently DROP real findings (e.g. uuid < 14.0.0).
    const expressOpen = adv('express', '< 5.1.0', '5.1.0');

    it('flags express 4.22.1 against an open "< 5.1.0" range (correct, cross-major)', () => {
      expect(isVersionAffectedByAdvisory('4.22.1', expressOpen, 'express')).toBe(true);
    });

    it('flags express 5.0.9 against the open "< 5.1.0" range', () => {
      expect(isVersionAffectedByAdvisory('5.0.9', expressOpen, 'express')).toBe(true);
    });
  });

  describe('lower-bounded branch is major-scoped (the real FP fix)', () => {
    // A branch with an explicit lower bound scopes to that major line only.
    const express5x = adv('express', '>= 5.0.0 < 5.1.0', '5.1.0');

    it('does NOT flag express 4.22.1 against a ">= 5.0.0 < 5.1.0" 5.x branch', () => {
      expect(isVersionAffectedByAdvisory('4.22.1', express5x, 'express')).toBe(false);
    });

    it('DOES flag express 5.0.9 against the ">= 5.0.0 < 5.1.0" 5.x branch', () => {
      expect(isVersionAffectedByAdvisory('5.0.9', express5x, 'express')).toBe(true);
    });
  });

  describe('two-branch advisory (the unbounded-multi-branch bug)', () => {
    const twoBranch = adv('express', '>= 4.0.0 < 4.22.0, >= 5.0.0 < 5.1.0', '4.22.0 || 5.1.0');

    it('flags express 4.21.0 (inside the 4.x branch)', () => {
      expect(isVersionAffectedByAdvisory('4.21.0', twoBranch, 'express')).toBe(true);
    });

    it('flags express 5.0.9 (inside the 5.x branch)', () => {
      expect(isVersionAffectedByAdvisory('5.0.9', twoBranch, 'express')).toBe(true);
    });

    it('does NOT flag express 4.22.1 (between the 4.x and 5.x branches)', () => {
      expect(isVersionAffectedByAdvisory('4.22.1', twoBranch, 'express')).toBe(false);
    });

    it('does NOT flag express 5.1.0 (at the patched boundary)', () => {
      expect(isVersionAffectedByAdvisory('5.1.0', twoBranch, 'express')).toBe(false);
    });
  });

  describe('single-branch behavior is preserved', () => {
    const lodash = adv('lodash', '>= 4.17.0 < 4.17.21', '4.17.21');

    it('flags a version inside the single branch', () => {
      expect(isVersionAffectedByAdvisory('4.17.10', lodash, 'lodash')).toBe(true);
    });

    it('does not flag the patched version', () => {
      expect(isVersionAffectedByAdvisory('4.17.21', lodash, 'lodash')).toBe(false);
    });

    it('ignores a different package name', () => {
      expect(isVersionAffectedByAdvisory('4.17.10', lodash, 'left-pad')).toBe(false);
    });
  });

  describe('patched-version short-circuit across branches', () => {
    // 1.x branch patched at 1.5.0; 3.x branch patched at 3.5.0.
    const padded = adv('pad-left', '>= 1.0.0 < 2.0.0, >= 3.0.0 < 4.0.0', '1.5.0 || 3.5.0');

    it('flags 1.2.0 (inside 1.x branch, below its 1.5.0 fix)', () => {
      expect(isVersionAffectedByAdvisory('1.2.0', padded, 'pad-left')).toBe(true);
    });

    it('does NOT flag 1.5.0 (at the 1.x branch fix)', () => {
      expect(isVersionAffectedByAdvisory('1.5.0', padded, 'pad-left')).toBe(false);
    });

    it('flags 3.4.0 (inside 3.x branch, below its 3.5.0 fix)', () => {
      expect(isVersionAffectedByAdvisory('3.4.0', padded, 'pad-left')).toBe(true);
    });

    it('does NOT flag 4.0.1 (outside both branches entirely)', () => {
      expect(isVersionAffectedByAdvisory('4.0.1', padded, 'pad-left')).toBe(false);
    });
  });
});
