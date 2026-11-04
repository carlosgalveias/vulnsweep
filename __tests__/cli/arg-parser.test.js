'use strict';

const path = require('node:path');
const { parseCliArgs } = require('../../src/cli/arg-parser');

describe('parseCliArgs', () => {
  const cwd = process.cwd();

  it('parses --dir with a valid directory', () => {
    const result = parseCliArgs(['--dir', cwd]);
    expect(result.dir).toBe(path.resolve(cwd));
  });

  it('throws when no --dir and no positional path provided', () => {
    expect(() => parseCliArgs([])).toThrow(/Missing required argument: --dir/);
  });

  it('accepts a positional path as the scan directory', () => {
    const result = parseCliArgs([cwd]);
    expect(result.dir).toBe(path.resolve(cwd));
  });

  it('prefers --dir over positional argument when both are provided', () => {
    const result = parseCliArgs(['--dir', cwd, '/some/other/path']);
    expect(result.dir).toBe(path.resolve(cwd));
  });

  it('parses --type audit', () => {
    const result = parseCliArgs(['--dir', cwd, '--type', 'audit']);
    expect(result.type).toBe('audit');
  });

  it('parses --type dependency', () => {
    const result = parseCliArgs(['--dir', cwd, '--type', 'dependency']);
    expect(result.type).toBe('dependency');
  });

  it('rejects invalid --type value', () => {
    expect(() => parseCliArgs(['--dir', cwd, '--type', 'invalid'])).toThrow(
      /Invalid value "invalid" for --type/
    );
  });

  it('parses --threshold with all valid values', () => {
    const validThresholds = ['none', 'critical', 'high', 'medium', 'low', 'any'];
    for (const threshold of validThresholds) {
      const result = parseCliArgs(['--dir', cwd, '--threshold', threshold]);
      expect(result.threshold).toBe(threshold);
    }
  });

  it('rejects invalid --threshold value', () => {
    expect(() => parseCliArgs(['--dir', cwd, '--threshold', 'extreme'])).toThrow(
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

  it('parses boolean flags (-o, -a, -q)', () => {
    const result = parseCliArgs(['--dir', cwd, '-o', '-a', '-q']);
    expect(result.output).toBe(true);
    expect(result.autofix).toBe(true);
    expect(result.quiet).toBe(true);
  });

  it('parses --format with valid values', () => {
    const resultCdx = parseCliArgs(['--dir', cwd, '--format', 'cyclonedx']);
    expect(resultCdx.format).toBe('cyclonedx');

    const resultSpdx = parseCliArgs(['--dir', cwd, '--format', 'spdx']);
    expect(resultSpdx.format).toBe('spdx');

    const resultCsv = parseCliArgs(['--dir', cwd, '--format', 'csv']);
    expect(resultCsv.format).toBe('csv');
  });

  it('rejects invalid --format value', () => {
    expect(() => parseCliArgs(['--dir', cwd, '--format', 'xml'])).toThrow(
      /Invalid value "xml" for --format/
    );
  });

  describe('--ignore option', () => {
    it('should parse comma-separated ignore list into array', () => {
      const result = parseCliArgs(['--dir', cwd, '--ignore', 'tests,docs,scripts']);
      expect(result.ignore).toEqual(['tests', 'docs', 'scripts']);
    });

    it('should default to empty array when --ignore not provided', () => {
      const result = parseCliArgs(['--dir', cwd]);
      expect(result.ignore).toEqual([]);
    });

    it('should trim whitespace from ignore entries', () => {
      const result = parseCliArgs(['--dir', cwd, '--ignore', ' foo , bar ']);
      expect(result.ignore).toEqual(['foo', 'bar']);
    });

    it('should filter empty entries from ignore list', () => {
      const result = parseCliArgs(['--dir', cwd, '--ignore', 'a,,b,']);
      expect(result.ignore).toEqual(['a', 'b']);
    });
  });
});
