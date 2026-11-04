# Spec: Infer `fixedIn` from `vulnerable_version_range`

**Status:** Ready for Implementation  
**Target File:** [`src/main/modules/scanner/sources/github-advisory-source.js`](src/main/modules/scanner/sources/github-advisory-source.js)  
**Test File:** [`__tests__/main/modules/scanner/sources/github-advisory-source.test.js`](__tests__/main/modules/scanner/sources/github-advisory-source.test.js)

---

## Problem Statement

The GitHub Advisory API sometimes returns vulnerability entries where:

- `patched_versions` is `undefined` (not set)
- `first_patched_version` is `null`
- But `vulnerable_version_range` clearly states `"< 14.0.0"` — meaning 14.0.0 is the fix.

Real-world example: **uuid@11.1.1** (GHSA-qmq6-f8pr-cx5x):

```json
{
  "package": { "ecosystem": "npm", "name": "uuid" },
  "severity": "low",
  "vulnerable_version_range": "< 14.0.0",
  "patched_versions": undefined,
  "first_patched_version": null
}
```

Current behavior: [`extractFixedInFromAdvisory()`](src/main/modules/scanner/sources/github-advisory-source.js:72) returns `null` → user sees "No fix available."

Expected behavior: Return `"14.0.0"` inferred from the exclusive upper bound `< 14.0.0`.

---

## Design Decision: Why Not `first_patched_version`?

The existing code at [line 100](src/main/modules/scanner/sources/github-advisory-source.js:100) only checks `vuln.patched_versions`. It does NOT attempt `vuln.first_patched_version`. However, since the real-world data shows `first_patched_version: null` alongside `patched_versions: undefined`, adding a `first_patched_version` fallback alone won't solve the problem. We add BOTH fallbacks for completeness:

1. `first_patched_version.identifier` (or the string value directly)
2. Regex inference from `vulnerable_version_range`

---

## Implementation Specification

### 1. New Helper Function: `inferFixedInFromRange(vulnerableVersionRange)`

**Location:** Same file, above [`extractFixedInFromAdvisory()`](src/main/modules/scanner/sources/github-advisory-source.js:72).

```javascript
/**
 * Attempts to infer a fixedIn version from a vulnerable_version_range string
 * when patched_versions is unavailable.
 *
 * Only handles EXCLUSIVE upper bounds: "< X.Y.Z"
 * Does NOT handle inclusive upper bounds: "<= X.Y.Z" (too complex to infer next version)
 *
 * @param {string} range - e.g. "< 14.0.0" or ">= 1.0.0, < 2.3.1"
 * @returns {string|null} The inferred fix version, or null if not inferrable
 */
function inferFixedInFromRange(range) {
  if (!range || typeof range !== 'string') return null;

  // Match "< X.Y.Z" but NOT "<= X.Y.Z"
  // The regex captures the last "< X.Y.Z" segment in a comma-separated range
  const match = range.match(/<\s+(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\s*$/);
  if (!match) return null;

  // Verify it's truly exclusive (not "<=")
  // Check the character before "<" to ensure it's not "="
  const idx = range.lastIndexOf('<');
  if (idx > 0 && range[idx - 1] === '<') return null; // bizarre edge case: "<<"
  // Check for "<=" pattern
  if (range.substring(idx, idx + 2) === '<=') return null;

  return match[1];
}
```

**Regex Explanation:**

- `<\s+` — literal `<` followed by whitespace (ensures NOT `<=`)
- `(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)` — captures semver (e.g., `14.0.0` or `2.3.1-beta.1`)
- `\s*$` — optional trailing whitespace, anchored to end of string

**Why anchored to end?** In multi-constraint ranges like `">= 1.0.0, < 2.3.1"`, the upper bound is always the LAST constraint. This is a universal convention in GitHub Advisory data.

### 2. Modified `extractFixedInFromAdvisory()` Logic

**Replace the loop body** (lines 80–114) with the following structure:

```javascript
function extractFixedInFromAdvisory(advisory, packageName, installedVersion) {
  if (!advisory || !Array.isArray(advisory.vulnerabilities)) return null;

  const coerced = semver.coerce(installedVersion);
  const cleanVersion = semver.clean(installedVersion) || (coerced && coerced.version);

  let bestFixed = null;

  for (const vuln of advisory.vulnerabilities) {
    if (!vuln.package || vuln.package.ecosystem !== 'npm') continue;
    if (vuln.package.name !== packageName) continue;

    // Only consider this entry if the installed version falls in its vulnerable range
    if (cleanVersion) {
      const range = vuln.vulnerable_version_range;
      if (range && typeof range === 'string') {
        const semverRange = range
          .split(',')
          .map((part) => part.trim())
          .join(' ');
        try {
          if (!semver.satisfies(cleanVersion, semverRange)) continue;
        } catch {
          // If range parsing fails, still consider this entry (conservative)
        }
      }
    }

    // === PRIMARY: Extract from patched_versions ===
    let version = null;
    const patched = vuln.patched_versions;
    if (patched && typeof patched === 'string') {
      const cleaned = patched.replace(/^>=\s*/, '').trim();
      const patchedCoerced = semver.coerce(cleaned);
      if (patchedCoerced) {
        version = patchedCoerced.version;
      }
    }

    // === FALLBACK 1: Extract from first_patched_version ===
    if (!version) {
      const fpv = vuln.first_patched_version;
      const fpvStr = fpv && typeof fpv === 'object' ? fpv.identifier : fpv;
      if (fpvStr && typeof fpvStr === 'string') {
        const fpvCoerced = semver.coerce(fpvStr);
        if (fpvCoerced) {
          version = fpvCoerced.version;
        }
      }
    }

    // === FALLBACK 2: Infer from vulnerable_version_range upper bound ===
    if (!version) {
      const inferred = inferFixedInFromRange(vuln.vulnerable_version_range);
      if (inferred) {
        const inferredCoerced = semver.coerce(inferred);
        if (inferredCoerced) {
          version = inferredCoerced.version;
        }
      }
    }

    // Skip entry if no fix version could be determined
    if (!version) continue;

    if (!bestFixed || semver.lt(version, bestFixed)) {
      bestFixed = version;
    }
  }

  return bestFixed;
}
```

### 3. Export `inferFixedInFromRange` for Testing

Update the [`module.exports`](src/main/modules/scanner/sources/github-advisory-source.js:204) line:

```javascript
module.exports = {
  query,
  SOURCE_ID,
  isVersionAffectedByAdvisory,
  extractFixedInFromAdvisory,
  inferFixedInFromRange, // exported for unit testing
};
```

---

## Behavioral Contract

| Scenario                        | `patched_versions` | `first_patched_version`   | `vulnerable_version_range` | Expected `fixedIn`                     |
| ------------------------------- | ------------------ | ------------------------- | -------------------------- | -------------------------------------- |
| Normal advisory (lodash)        | `">= 4.17.21"`     | `"4.17.21"`               | `">= 4.0.0, < 4.17.21"`    | `"4.17.21"` (from patched_versions)    |
| uuid advisory                   | `undefined`        | `null`                    | `"< 14.0.0"`               | `"14.0.0"` (inferred from range)       |
| Multi-constraint range          | `undefined`        | `null`                    | `">= 1.0.0, < 2.3.1"`      | `"2.3.1"` (inferred from range)        |
| Inclusive upper bound           | `undefined`        | `null`                    | `"<= 13.9.9"`              | `null` (cannot safely infer)           |
| No upper bound                  | `undefined`        | `null`                    | `">= 1.0.0"`               | `null` (no `<` constraint)             |
| first_patched_version present   | `undefined`        | `{ identifier: "5.0.0" }` | `"< 5.0.0"`                | `"5.0.0"` (from first_patched_version) |
| first_patched_version string    | `undefined`        | `"5.0.0"`                 | `"< 5.0.0"`                | `"5.0.0"` (from first_patched_version) |
| patched_versions takes priority | `">= 4.17.21"`     | `null`                    | `"< 14.0.0"`               | `"4.17.21"` (patched_versions wins)    |

---

## Test Requirements

### New Tests for `inferFixedInFromRange()`

Add a new `describe('inferFixedInFromRange()')` block in [`__tests__/main/modules/scanner/sources/github-advisory-source.test.js`](__tests__/main/modules/scanner/sources/github-advisory-source.test.js):

```javascript
describe('inferFixedInFromRange()', () => {
  it('extracts version from simple exclusive upper bound "< X.Y.Z"', () => {
    expect(inferFixedInFromRange('< 14.0.0')).toBe('14.0.0');
  });

  it('extracts version from multi-constraint range', () => {
    expect(inferFixedInFromRange('>= 1.0.0, < 2.3.1')).toBe('2.3.1');
  });

  it('returns null for inclusive upper bound "<= X.Y.Z"', () => {
    expect(inferFixedInFromRange('<= 13.9.9')).toBeNull();
  });

  it('returns null when no upper bound exists', () => {
    expect(inferFixedInFromRange('>= 1.0.0')).toBeNull();
  });

  it('returns null for null/undefined/empty input', () => {
    expect(inferFixedInFromRange(null)).toBeNull();
    expect(inferFixedInFromRange(undefined)).toBeNull();
    expect(inferFixedInFromRange('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(inferFixedInFromRange(42)).toBeNull();
    expect(inferFixedInFromRange({})).toBeNull();
  });

  it('handles pre-release versions', () => {
    expect(inferFixedInFromRange('< 2.0.0-rc.1')).toBe('2.0.0-rc.1');
  });

  it('handles extra whitespace', () => {
    expect(inferFixedInFromRange('<   3.0.0  ')).toBe('3.0.0');
  });
});
```

### New Tests for `extractFixedInFromAdvisory()` Fallback Behavior

Add to the existing `describe('extractFixedInFromAdvisory()')` block:

```javascript
it('infers fixedIn from vulnerable_version_range when patched_versions is undefined', () => {
  const advisory = makeAdvisory([
    {
      package: { ecosystem: 'npm', name: 'uuid' },
      vulnerable_version_range: '< 14.0.0',
      // patched_versions intentionally omitted
    },
  ]);
  expect(extractFixedInFromAdvisory(advisory, 'uuid', '11.1.1')).toBe('14.0.0');
});

it('infers fixedIn from multi-constraint range when patched_versions is null', () => {
  const advisory = makeAdvisory([
    {
      package: { ecosystem: 'npm', name: 'foo' },
      vulnerable_version_range: '>= 1.0.0, < 2.3.1',
      patched_versions: null,
      first_patched_version: null,
    },
  ]);
  expect(extractFixedInFromAdvisory(advisory, 'foo', '1.5.0')).toBe('2.3.1');
});

it('returns null when range has only inclusive upper bound', () => {
  const advisory = makeAdvisory([
    {
      package: { ecosystem: 'npm', name: 'bar' },
      vulnerable_version_range: '<= 13.9.9',
      patched_versions: undefined,
    },
  ]);
  expect(extractFixedInFromAdvisory(advisory, 'bar', '13.0.0')).toBeNull();
});

it('prefers patched_versions over range inference', () => {
  const advisory = makeAdvisory([
    {
      package: { ecosystem: 'npm', name: 'baz' },
      vulnerable_version_range: '< 14.0.0',
      patched_versions: '>= 12.0.1',
    },
  ]);
  // patched_versions says 12.0.1, range says 14.0.0 — patched_versions wins
  expect(extractFixedInFromAdvisory(advisory, 'baz', '11.0.0')).toBe('12.0.1');
});

it('uses first_patched_version as intermediate fallback (object form)', () => {
  const advisory = makeAdvisory([
    {
      package: { ecosystem: 'npm', name: 'qux' },
      vulnerable_version_range: '< 5.0.0',
      patched_versions: undefined,
      first_patched_version: { identifier: '5.0.0' },
    },
  ]);
  expect(extractFixedInFromAdvisory(advisory, 'qux', '4.0.0')).toBe('5.0.0');
});

it('uses first_patched_version as intermediate fallback (string form)', () => {
  const advisory = makeAdvisory([
    {
      package: { ecosystem: 'npm', name: 'qux' },
      vulnerable_version_range: '< 5.0.0',
      patched_versions: undefined,
      first_patched_version: '5.0.0',
    },
  ]);
  expect(extractFixedInFromAdvisory(advisory, 'qux', '4.0.0')).toBe('5.0.0');
});
```

### Update Test Imports

The import line at the top of the test file must include `inferFixedInFromRange`:

```javascript
const {
  query,
  SOURCE_ID,
  isVersionAffectedByAdvisory,
  extractFixedInFromAdvisory,
  inferFixedInFromRange,
} = require('../../../../../src/main/modules/scanner/sources/github-advisory-source');
```

---

## Regression Safety

The following existing tests MUST continue to pass unchanged — they validate that `patched_versions` still takes priority:

1. `'extracts patched version for the target package'` — morgan with `patched_versions: '>= 1.10.2'`
2. `'picks fix version from the branch matching the installed version (multi-branch)'` — lodash
3. `'picks the earliest fix when installed version matches multiple entries in same branch'` — express

If any of these break, the fallback logic is interfering with the primary path. This would indicate the implementation forgot to `continue` past the range-inference fallback when `patched_versions` already succeeded.

---

## Implementation Checklist

- [ ] Add `inferFixedInFromRange()` helper function (above `extractFixedInFromAdvisory`)
- [ ] Refactor `extractFixedInFromAdvisory()` loop body to use 3-tier fallback (patched_versions → first_patched_version → range inference)
- [ ] Export `inferFixedInFromRange` in `module.exports`
- [ ] Add `inferFixedInFromRange` unit tests (8 cases)
- [ ] Add `extractFixedInFromAdvisory` fallback integration tests (6 cases)
- [ ] Update test imports
- [ ] Run full test suite, confirm zero regressions

---

## Complexity Assessment

- **Lines of new code:** ~30 (helper) + ~20 (refactored loop body)
- **Risk:** Low — purely additive fallback, guarded by null checks
- **Dependencies:** None new (already uses `semver`)
- **Performance impact:** Zero — regex only runs when `patched_versions` AND `first_patched_version` are both unavailable
