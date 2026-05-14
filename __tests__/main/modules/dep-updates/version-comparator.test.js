'use strict';
const {
  filterNewerVersions,
  selectRecommendedVersion,
  computeRiskLevel,
} = require('../../../../src/main/modules/dep-updates/version-comparator');
afterEach(() => {
  jest.clearAllMocks();
});
describe('filterNewerVersions', () => {
  it('returns [] when null', () => {
    expect(filterNewerVersions(null, ['1.0.0'])).toEqual([]);
  });
  it('returns [] when not coercible', () => {
    expect(filterNewerVersions('bad', ['1.0.0'])).toEqual([]);
  });
  it('returns [] when empty list', () => {
    expect(filterNewerVersions('1.0.0', [])).toEqual([]);
  });
  it('excludes equal version', () => {
    const r = filterNewerVersions('1.0.0', ['1.0.0', '1.0.1']);
    expect(r).not.toContain('1.0.0');
    expect(r).toContain('1.0.1');
  });
  it('excludes older versions', () => {
    expect(filterNewerVersions('2.0.0', ['1.0.0', '0.5.0'])).toEqual([]);
  });
  it('includes strictly greater', () => {
    expect(filterNewerVersions('1.0.0', ['1.0.1', '1.1.0', '2.0.0'])).toEqual([
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ]);
  });
  it('excludes pre-releases', () => {
    const r = filterNewerVersions('1.0.0', [
      '1.1.0',
      '2.0.0-beta.1',
      '2.0.0-alpha',
      '2.0.0-rc.1',
      '2.0.0',
    ]);
    expect(r).not.toContain('2.0.0-beta.1');
    expect(r).not.toContain('2.0.0-alpha');
    expect(r).not.toContain('2.0.0-rc.1');
    expect(r).toContain('1.1.0');
    expect(r).toContain('2.0.0');
  });
  it('excludes non-semver', () => {
    expect(filterNewerVersions('1.0.0', ['bad', '2.0.0', 'foo'])).toEqual(['2.0.0']);
  });
  it('sorts ascending', () => {
    expect(filterNewerVersions('1.0.0', ['3.0.0', '1.1.0', '2.0.0', '1.2.0'])).toEqual([
      '1.1.0',
      '1.2.0',
      '2.0.0',
      '3.0.0',
    ]);
  });
  it('handles v-prefix', () => {
    const r = filterNewerVersions('v4.0.0', ['4.0.1', '4.1.0', '3.9.9']);
    expect(r).toEqual(['4.0.1', '4.1.0']);
    expect(r).not.toContain('3.9.9');
  });
  it('handles range coercion', () => {
    const r = filterNewerVersions('^4.17.0', ['4.17.0', '4.17.21', '5.0.0']);
    expect(r).not.toContain('4.17.0');
    expect(r).toContain('4.17.21');
  });
  it('returns [] all pre-releases', () => {
    expect(filterNewerVersions('1.0.0', ['2.0.0-alpha', '2.0.0-beta'])).toEqual([]);
  });
  it('handles duplicates', () => {
    const r = filterNewerVersions('1.0.0', ['2.0.0', '2.0.0']);
    expect(
      r.filter((v) => {
        return v === '2.0.0';
      }).length
    ).toBeGreaterThanOrEqual(1);
  });
});
describe('selectRecommendedVersion', () => {
  it('null when empty', () => {
    expect(selectRecommendedVersion('1.0.0', [])).toBeNull();
  });
  it('highest same-major', () => {
    expect(selectRecommendedVersion('1.0.0', ['1.1.0', '1.2.0', '2.0.0'])).toBe('1.2.0');
  });
  it('highest overall no same-major', () => {
    expect(selectRecommendedVersion('1.9.9', ['2.0.0', '3.0.0'])).toBe('3.0.0');
  });
  it('latest for null current', () => {
    expect(selectRecommendedVersion(null, ['1.0.0', '3.0.0'])).toBe('3.0.0');
  });
  it('latest for non-coercible', () => {
    expect(selectRecommendedVersion('bad', ['1.0.0', '3.0.0'])).toBe('3.0.0');
  });
  it('major boundary', () => {
    expect(selectRecommendedVersion('1.9.9', ['1.9.10', '2.0.0'])).toBe('1.9.10');
  });
  it('highest same-major many', () => {
    expect(selectRecommendedVersion('2.0.0', ['2.0.1', '2.2.0', '3.0.0'])).toBe('2.2.0');
  });
});
describe('computeRiskLevel', () => {
  it('High null current', () => {
    expect(computeRiskLevel(null, '2.0.0')).toBe('High');
  });
  it('High null recommended', () => {
    expect(computeRiskLevel('1.0.0', null)).toBe('High');
  });
  it('Low same major', () => {
    expect(computeRiskLevel('4.17.0', '4.17.21')).toBe('Low');
  });
  it('High different major', () => {
    expect(computeRiskLevel('4.17.21', '5.0.0')).toBe('High');
  });
  it('High not coercible', () => {
    expect(computeRiskLevel('bad', '2.0.0')).toBe('High');
    expect(computeRiskLevel('1.0.0', 'bad')).toBe('High');
  });
  it('Low patch upgrade', () => {
    expect(computeRiskLevel('4.17.0', '4.17.21')).toBe('Low');
  });
  it('Low minor upgrade', () => {
    expect(computeRiskLevel('4.0.0', '4.17.0')).toBe('Low');
  });
  it('High major upgrade', () => {
    expect(computeRiskLevel('4.17.21', '5.0.0')).toBe('High');
  });
  it('High both undefined', () => {
    expect(computeRiskLevel(undefined, undefined)).toBe('High');
  });
});
