'use strict';

const { evaluateThreshold } = require('../../src/cli/threshold-evaluator');

describe('evaluateThreshold', () => {
  const baseSummary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  it('returns passed=true when threshold is "none" regardless of findings', () => {
    const summary = { total: 10, critical: 3, high: 2, medium: 3, low: 2, info: 0 };
    const result = evaluateThreshold(summary, 'none');
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.reason).toBeNull();
  });

  it('returns passed=false when threshold is "critical" and critical > 0', () => {
    const summary = { ...baseSummary, total: 1, critical: 1 };
    const result = evaluateThreshold(summary, 'critical');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('returns passed=true when threshold is "critical" and only high/medium/low', () => {
    const summary = { ...baseSummary, total: 5, high: 2, medium: 2, low: 1 };
    const result = evaluateThreshold(summary, 'critical');
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('returns passed=false when threshold is "high" and high > 0', () => {
    const summary = { ...baseSummary, total: 2, high: 2 };
    const result = evaluateThreshold(summary, 'high');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('returns passed=false when threshold is "high" and critical > 0', () => {
    const summary = { ...baseSummary, total: 1, critical: 1 };
    const result = evaluateThreshold(summary, 'high');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('returns passed=true when threshold is "high" and only medium/low', () => {
    const summary = { ...baseSummary, total: 4, medium: 3, low: 1 };
    const result = evaluateThreshold(summary, 'high');
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('returns passed=false when threshold is "any" and total > 0', () => {
    const summary = { ...baseSummary, total: 1, low: 1 };
    const result = evaluateThreshold(summary, 'any');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('returns passed=true when threshold is "any" and total = 0', () => {
    const summary = { ...baseSummary };
    const result = evaluateThreshold(summary, 'any');
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('returns correct exit codes (0 for pass, 1 for fail)', () => {
    const pass = evaluateThreshold(baseSummary, 'critical');
    expect(pass.exitCode).toBe(0);

    const fail = evaluateThreshold({ ...baseSummary, total: 1, critical: 1 }, 'critical');
    expect(fail.exitCode).toBe(1);
  });

  it('returns descriptive reason string when failed', () => {
    const summary = { total: 3, critical: 1, high: 1, medium: 1, low: 0, info: 0 };
    const result = evaluateThreshold(summary, 'medium');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Threshold exceeded');
    expect(result.reason).toContain('1 critical');
    expect(result.reason).toContain('1 high');
    expect(result.reason).toContain('1 medium');
    expect(result.reason).toContain('threshold: medium');
  });
});
