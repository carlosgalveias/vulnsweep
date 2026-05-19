'use strict';

/**
 * Tests for fetchOsvRaw() and extractFixedIn() exported from
 * src/main/modules/enrichment/sources/osv-source.js (added in T3).
 */

// Variable name must be prefixed 'mock' to be accessible inside jest.mock() factories
const mockOsvFixture = require('../../../../fixtures/osv-response.json');

// ---------------------------------------------------------------------------
// https mock helpers — re-set via jest.resetModules() per describe block
// ---------------------------------------------------------------------------

function mockMk(statusCode, body) {
  const { EventEmitter } = require('events');
  return jest.fn((_opts, cb) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.setEncoding = jest.fn();
    const req = new EventEmitter();
    req.write = jest.fn();
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();
    req.end = jest.fn(() => {
      cb(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });
    return req;
  });
}

// ---------------------------------------------------------------------------
// fetchOsvRaw() tests
// ---------------------------------------------------------------------------

describe('fetchOsvRaw()', () => {
  beforeEach(() => jest.resetModules());

  it('returns [] when OSV response has no vulns field', async () => {
    jest.mock('https', () => ({ request: mockMk(200, {}) }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    expect(await fetchOsvRaw('lodash', '4.17.15')).toEqual([]);
  });

  it('returns [] when OSV response.vulns is empty array', async () => {
    jest.mock('https', () => ({ request: mockMk(200, { vulns: [] }) }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    expect(await fetchOsvRaw('lodash', '4.17.15')).toEqual([]);
  });

  it('returns all vuln entries from response.vulns without merging', async () => {
    jest.mock('https', () => ({ request: mockMk(200, mockOsvFixture) }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    const raw = await fetchOsvRaw('lodash', '4.17.15');
    expect(raw).toHaveLength(mockOsvFixture.vulns.length);
    expect(raw[0].id).toBe(mockOsvFixture.vulns[0].id);
  });

  it('returns raw objects (not merged result shape)', async () => {
    jest.mock('https', () => ({ request: mockMk(200, mockOsvFixture) }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    const raw = await fetchOsvRaw('lodash', '4.17.15');
    expect(raw[0]).not.toHaveProperty('found');
    expect(raw[0]).toHaveProperty('id');
    expect(raw[0]).toHaveProperty('affected');
  });

  it('returns [] on HTTP 500 error (does not throw)', async () => {
    jest.mock('https', () => ({ request: mockMk(500, { error: 'server error' }) }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    expect(await fetchOsvRaw('lodash', '4.17.15')).toEqual([]);
  });

  it('returns [] for empty package name', async () => {
    jest.mock('https', () => ({ request: jest.fn() }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    expect(await fetchOsvRaw('', '1.0.0')).toEqual([]);
  });

  it('returns [] for null package name', async () => {
    jest.mock('https', () => ({ request: jest.fn() }));
    const {
      fetchOsvRaw,
    } = require('../../../../../src/main/modules/enrichment/sources/osv-source');
    expect(await fetchOsvRaw(null, '1.0.0')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFixedIn() tests
// ---------------------------------------------------------------------------

describe('extractFixedIn()', () => {
  const {
    extractFixedIn,
  } = require('../../../../../src/main/modules/enrichment/sources/osv-source');

  it('returns null when affected is empty array', () => {
    expect(extractFixedIn({ affected: [] })).toBeNull();
  });

  it('returns null when affected is undefined', () => {
    expect(extractFixedIn({})).toBeNull();
  });

  it('returns null when affected entries have no ranges', () => {
    const vuln = { affected: [{ package: { ecosystem: 'npm', name: 'x' } }] };
    expect(extractFixedIn(vuln)).toBeNull();
  });

  it('extracts fixed version from npm ecosystem entry (fixture)', () => {
    const vuln = mockOsvFixture.vulns[0];
    expect(extractFixedIn(vuln)).toBe('4.17.21');
  });

  it('falls back to first fixed version from non-npm ecosystem when no npm entry', () => {
    const vuln = {
      affected: [
        {
          package: { ecosystem: 'PyPI', name: 'x' },
          ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
        },
      ],
    };
    expect(extractFixedIn(vuln)).toBe('2.0.0');
  });

  it('ignores non-npm ecosystem entries when npm entry is present', () => {
    const vuln = {
      affected: [
        {
          package: { ecosystem: 'PyPI', name: 'x' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '9.9.9' }] }],
        },
        {
          package: { ecosystem: 'npm', name: 'x' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.2.3' }] }],
        },
      ],
    };
    expect(extractFixedIn(vuln)).toBe('1.2.3');
  });

  it('returns minimum semver when multiple npm entries have different fixed versions', () => {
    const vuln = {
      affected: [
        {
          package: { ecosystem: 'npm', name: 'x' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
        },
        {
          package: { ecosystem: 'npm', name: 'x' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.5.0' }] }],
        },
      ],
    };
    expect(extractFixedIn(vuln)).toBe('1.5.0');
  });

  it('returns null when ranges have events but no fixed event', () => {
    const vuln = {
      affected: [
        {
          package: { ecosystem: 'npm', name: 'x' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }],
        },
      ],
    };
    expect(extractFixedIn(vuln)).toBeNull();
  });
});
