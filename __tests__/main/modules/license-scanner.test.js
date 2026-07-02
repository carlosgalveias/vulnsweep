'use strict';

const { normaliseSpdx } = require('../../../src/main/modules/license-scanner');

describe('normaliseSpdx', () => {
  describe('Apache variants', () => {
    it.each([
      ['Apache-2.0', 'Apache-2.0'],
      ['Apache 2.0', 'Apache-2.0'],
      ['Apache2', 'Apache-2.0'],
      ['apache 2', 'Apache-2.0'],
      ['Apache License 2.0', 'Apache-2.0'],
      ['Apache License, Version 2.0', 'Apache-2.0'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('MIT variants', () => {
    it.each([
      ['MIT', 'MIT'],
      ['MIT License', 'MIT'],
      ['The MIT License', 'MIT'],
      ['MIT/X11', 'MIT'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('BSD variants', () => {
    it.each([
      ['BSD-2-Clause', 'BSD-2-Clause'],
      ['BSD-3-Clause', 'BSD-3-Clause'],
      ['BSD 2-Clause', 'BSD-2-Clause'],
      ['BSD 3-Clause', 'BSD-3-Clause'],
      ['Simplified BSD', 'BSD-2-Clause'],
      ['New BSD', 'BSD-3-Clause'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('ISC variants', () => {
    it.each([
      ['ISC', 'ISC'],
      ['ISC License', 'ISC'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('GPL variants', () => {
    it.each([
      ['GPL-2.0', 'GPL-2.0-only'],
      ['GPL-3.0', 'GPL-3.0-only'],
      ['GPLv2', 'GPL-2.0-only'],
      ['GPLv3', 'GPL-3.0-only'],
      ['GNU GPL v2', 'GPL-2.0-only'],
      ['GNU General Public License v3', 'GPL-3.0-only'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('LGPL variants', () => {
    it.each([
      ['LGPL-2.1', 'LGPL-2.1-only'],
      ['LGPL-3.0', 'LGPL-3.0-only'],
      ['LGPLv2.1', 'LGPL-2.1-only'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('MPL variants', () => {
    it.each([
      ['MPL-2.0', 'MPL-2.0'],
      ['Mozilla Public License 2.0', 'MPL-2.0'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('Unlicense variants', () => {
    it.each([
      ['Unlicense', 'Unlicense'],
      ['The Unlicense', 'Unlicense'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('CC0 variants', () => {
    it.each([
      ['CC0-1.0', 'CC0-1.0'],
      ['CC0 1.0', 'CC0-1.0'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(normaliseSpdx(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('returns UNKNOWN for falsy input', () => {
      expect(normaliseSpdx(undefined)).toBe('UNKNOWN');
      expect(normaliseSpdx('')).toBe('UNKNOWN');
      expect(normaliseSpdx(null)).toBe('UNKNOWN');
    });

    it('preserves unrecognised identifiers as-is (trimmed)', () => {
      expect(normaliseSpdx('  SomeCustomLicense  ')).toBe('SomeCustomLicense');
    });

    it('is case-insensitive for known variants', () => {
      expect(normaliseSpdx('APACHE 2.0')).toBe('Apache-2.0');
      expect(normaliseSpdx('mit LICENSE')).toBe('MIT');
    });
  });
});
