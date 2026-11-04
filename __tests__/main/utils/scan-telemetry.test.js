'use strict';
const os = require('os');
const path = require('path');

describe('scan-telemetry production mode', () => {
  let tel;
  beforeEach(() => {
    jest.resetModules();
    delete process.env.NODE_ENV;
    tel = require('../../../src/main/utils/scan-telemetry');
  });
  afterEach(() => {
    delete process.env.NODE_ENV;
  });
  test('isEnabled false', () => expect(tel.isEnabled()).toBe(false));
  test('start returns null when disabled', () => expect(tel.start('x')).toBeNull());
  test('end returns 0 when disabled', () => {
    const t = tel.start('x');
    expect(tel.end(t, 'x')).toBe(0);
  });
  test('count no-op', () => expect(() => tel.count('y', 5)).not.toThrow());
  test('reset no-op', () => expect(() => tel.reset()).not.toThrow());
  test('report null', async () => expect(await tel.report()).toBeNull());
});

describe('scan-telemetry development mode', () => {
  let tel;
  const tmpDir = path.join(os.tmpdir(), `scan-tel-jest-${process.pid}`);
  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    tel = require('../../../src/main/utils/scan-telemetry');
    tel.reset();
  });
  afterEach(() => {
    delete process.env.NODE_ENV;
  });
  afterAll(() => {
    try {
      require('fs').rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('isEnabled true', () => expect(tel.isEnabled()).toBe(true));

  test('start returns numeric token', () => {
    const t = tel.start('t0');
    expect(typeof t).toBe('number');
    tel.end(t, 't0');
  });

  test('start+end returns elapsed >= 0', () => {
    const t = tel.start('t1');
    expect(tel.end(t, 't1')).toBeGreaterThanOrEqual(0);
  });

  test('end with unknown token returns 0', () => expect(tel.end(99999, 'unknown')).toBe(0));

  test('start/end accumulates callCount', async () => {
    const t1 = tel.start('s');
    tel.end(t1, 's');
    const t2 = tel.start('s');
    tel.end(t2, 's');
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(d.timers['s'].callCount).toBe(2);
  });

  test('count adds delta', async () => {
    tel.count('pkgs', 5);
    tel.count('pkgs', 3);
    const t = tel.start('scan:total');
    tel.end(t, 'scan:total');
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(d.counts['pkgs']).toBe(8);
  });

  test('count defaults to 1', async () => {
    tel.count('h');
    tel.count('h');
    tel.count('h');
    const t = tel.start('scan:total');
    tel.end(t, 'scan:total');
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(d.counts['h']).toBe(3);
  });

  test('reset clears all state', async () => {
    const t = tel.start('scan:total');
    tel.end(t, 'scan:total');
    tel.count('pkgs', 10);
    tel.reset();
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(Object.keys(d.timers).length).toBe(0);
    expect(Object.keys(d.counts).length).toBe(0);
    expect(d.totalScanMs).toBe(0);
  });

  test('report writes valid JSON', async () => {
    const t = tel.start('scan:total');
    tel.end(t, 'scan:total');
    tel.count('packages:total', 5);
    const fp = await tel.report(tmpDir);
    expect(fp.endsWith('.json')).toBe(true);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(d).toHaveProperty('generatedAt');
    expect(d).toHaveProperty('totalScanMs');
    expect(d).toHaveProperty('timers');
    expect(d).toHaveProperty('counts');
    expect(Array.isArray(d.slowestOperations)).toBe(true);
  });

  test('report totalScanMs matches scan:total', async () => {
    const t = tel.start('scan:total');
    tel.end(t, 'scan:total');
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(d.totalScanMs).toBe(d.timers['scan:total'].durationMs);
  });

  test('slowestOperations max 10 sorted desc', async () => {
    for (let i = 0; i < 15; i++) {
      const t = tel.start(`s${i}`);
      tel.end(t, `s${i}`);
    }
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    expect(d.slowestOperations.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < d.slowestOperations.length; i++) {
      expect(d.slowestOperations[i - 1].durationMs).toBeGreaterThanOrEqual(
        d.slowestOperations[i].durationMs
      );
    }
  });

  test('timer has ISO startedAt endedAt', async () => {
    const t = tel.start('scan:source:nvd');
    tel.end(t, 'scan:source:nvd');
    const fp = await tel.report(tmpDir);
    const d = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
    const e = d.timers['scan:source:nvd'];
    expect(e.startedAt).toMatch(/^\d{4}-/);
    expect(e.endedAt).toMatch(/^\d{4}-/);
  });

  test('report creates dir if not exists', async () => {
    const nd = path.join(tmpDir, `nested-${Date.now()}`);
    const t = tel.start('scan:total');
    tel.end(t, 'scan:total');
    const fp = await tel.report(nd);
    expect(fp).toBeTruthy();
    expect(require('fs').existsSync(nd)).toBe(true);
  });
});
