'use strict';

/**
 * Tests for src/main/modules/scanner/sources/osv-source.js
 * (the scanner plugin, not the enrichment source)
 */

jest.mock('../../../../../src/main/modules/enrichment/sources/osv-source', () => ({
  fetchOsvRaw: jest.fn(),
  extractFixedIn: jest.fn(),
  extractSeverity: jest.fn(),
  extractAliases: jest.fn(),
  extractUrl: jest.fn(),
  isVersionSafe: jest.fn().mockReturnValue(false),
}));

const enrichmentOsv = require('../../../../../src/main/modules/enrichment/sources/osv-source');
const { query, SOURCE_ID } = require('../../../../../src/main/modules/scanner/sources/osv-source');
const osvFixture = require('../../../../fixtures/osv-response.json');

function makePkg(overrides) {
  return Object.assign(
    {
      name: 'lodash',
      version: '4.17.15',
      resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz',
    },
    overrides
  );
}

describe('scanner/sources/osv-source query()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enrichmentOsv.fetchOsvRaw.mockResolvedValue([]);
    enrichmentOsv.extractSeverity.mockReturnValue(null);
    enrichmentOsv.extractAliases.mockReturnValue([]);
    enrichmentOsv.extractFixedIn.mockReturnValue(null);
    enrichmentOsv.extractUrl.mockReturnValue(null);
  });

  it('SOURCE_ID is "osv"', () => {
    expect(SOURCE_ID).toBe('osv');
  });

  it('returns [] for null pkg', async () => {
    expect(await query(null)).toEqual([]);
  });

  it('returns [] for undefined pkg', async () => {
    expect(await query(undefined)).toEqual([]);
  });

  it('returns [] when pkg.version is missing', async () => {
    expect(await query({ name: 'lodash', resolved: 'https://r.npmjs.org/a' })).toEqual([]);
  });

  it('returns [] when pkg.resolved is null', async () => {
    expect(await query({ name: 'lodash', version: '4.17.15', resolved: null })).toEqual([]);
  });

  it('returns [] when fetchOsvRaw returns empty array', async () => {
    enrichmentOsv.fetchOsvRaw.mockResolvedValue([]);
    expect(await query(makePkg())).toEqual([]);
  });

  it('returns N SourceResults when OSV finds N vulns', async () => {
    enrichmentOsv.fetchOsvRaw.mockResolvedValue(osvFixture.vulns);
    enrichmentOsv.extractSeverity.mockReturnValue('HIGH');
    enrichmentOsv.extractAliases.mockReturnValue(['CVE-2021-23337', 'GHSA-jf85-cpcp-j695']);
    enrichmentOsv.extractFixedIn.mockReturnValue('4.17.21');
    enrichmentOsv.extractUrl.mockReturnValue('https://github.com/advisories/GHSA-jf85-cpcp-j695');
    const results = await query(makePkg());
    expect(results).toHaveLength(osvFixture.vulns.length);
  });

  it('each SourceResult has sourceId="osv"', async () => {
    enrichmentOsv.fetchOsvRaw.mockResolvedValue(osvFixture.vulns);
    enrichmentOsv.extractAliases.mockReturnValue([]);
    const results = await query(makePkg());
    expect(results.every((r) => r.sourceId === 'osv')).toBe(true);
  });

  it('SourceResult has packageName and packageVersion from pkg', async () => {
    enrichmentOsv.fetchOsvRaw.mockResolvedValue(osvFixture.vulns);
    enrichmentOsv.extractAliases.mockReturnValue([]);
    const results = await query(makePkg());
    expect(results[0].packageName).toBe('lodash');
    expect(results[0].packageVersion).toBe('4.17.15');
  });

  it('per-entry cveIds isolation: each SourceResult has only its own CVEs', async () => {
    const vuln1 = { id: 'GHSA-aaa', aliases: ['CVE-2021-00001'] };
    const vuln2 = { id: 'GHSA-bbb', aliases: ['CVE-2022-00002'] };
    enrichmentOsv.fetchOsvRaw.mockResolvedValue([vuln1, vuln2]);
    enrichmentOsv.extractSeverity.mockReturnValue('medium');
    enrichmentOsv.extractAliases
      .mockReturnValueOnce(['CVE-2021-00001', 'GHSA-aaa'])
      .mockReturnValueOnce(['CVE-2022-00002', 'GHSA-bbb']);
    enrichmentOsv.extractFixedIn.mockReturnValue(null);
    enrichmentOsv.extractUrl.mockReturnValue(null);
    const results = await query(makePkg());
    expect(results[0].cveIds).toContain('CVE-2021-00001');
    expect(results[0].cveIds).not.toContain('CVE-2022-00002');
    expect(results[1].cveIds).toContain('CVE-2022-00002');
    expect(results[1].cveIds).not.toContain('CVE-2021-00001');
  });

  it('never throws — catches internal errors and returns []', async () => {
    enrichmentOsv.fetchOsvRaw.mockRejectedValue(new Error('network failure'));
    await expect(query(makePkg())).resolves.toEqual([]);
  });

  it('SourceResult fixedIn is populated from extractFixedIn()', async () => {
    enrichmentOsv.fetchOsvRaw.mockResolvedValue([osvFixture.vulns[0]]);
    enrichmentOsv.extractAliases.mockReturnValue([]);
    enrichmentOsv.extractFixedIn.mockReturnValue('4.17.21');
    const results = await query(makePkg());
    expect(results[0].fixedIn).toBe('4.17.21');
  });
});
