'use strict';

const path = require('node:path');
const { parseCliArgs } = require('../../src/cli/arg-parser');

describe('parseCliArgs', () => {
  it('parses --dir with a valid directory', () => {
    const cwd = process.cwd();
    const result = parseCliArgs(['--dir', cwd]);
    expect(result.dir).toBe(path.resolve(cwd));
  });

  it('parses --type audit', () => {
    const result = parseCliArgs(['--type', 'audit']);
    expect(result.type).toBe('audit');
  });

  it('parses --type dependency', () => {
    const result = parseCliArgs(['--type', 'dependency']);
    expect(result.type).toBe('dependency');
  });

  it('rejects invalid --type value', () => {
    expect(() => parseCliArgs(['--type', 'invalid'])).toThrow(/Invalid value "invalid" for --type/);
  });

  it('parses --threshold with all valid values', () => {
    const validThresholds = ['none', 'critical', 'high', 'medium', 'low', 'any'];
    for (const threshold of validThresholds) {
      const result = parseCliArgs(['--threshold', threshold]);
      expect(result.threshold).toBe(threshold);
    }
  });

  it('rejects invalid --threshold value', () => {
    expect(() => parseCliArgs(['--threshold', 'extreme'])).toThrow(
      /Invalid value "extreme" for --threshold/
    );
  });

  it('returns { help: true } when -h is passed', () => {
    const result = parseCliArgs(['-h']);
    expect(result).toEqual({ help: true });
  });

  it('returns { version: true } when -V is passed', () => {
    const result = parseCliArgs(['-V']);
    expect(result).toEqual({ version: true });
  });

  it('uses current directory as default when no --dir provided', () => {
    const result = parseCliArgs([]);
    expect(result.dir).toBe(path.resolve(process.cwd()));
  });

  it('parses boolean flags (-o, -a, -q)', () => {
    const result = parseCliArgs(['-o', '-a', '-q']);
    expect(result.output).toBe(true);
    expect(result.autofix).toBe(true);
    expect(result.quiet).toBe(true);
  });

  it('parses --format with valid values', () => {
    const resultCdx = parseCliArgs(['--format', 'cyclonedx']);
    expect(resultCdx.format).toBe('cyclonedx');

    const resultSpdx = parseCliArgs(['--format', 'spdx']);
    expect(resultSpdx.format).toBe('spdx');

    const resultCsv = parseCliArgs(['--format', 'csv']);
    expect(resultCsv.format).toBe('csv');
  });

  it('rejects invalid --format value', () => {
    expect(() => parseCliArgs(['--format', 'xml'])).toThrow(/Invalid value "xml" for --format/);
  });
});
