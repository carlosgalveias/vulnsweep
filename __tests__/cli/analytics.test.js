'use strict';

describe('CLI analytics module', () => {
  let analytics;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Mock global fetch
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    analytics = require('../../src/cli/analytics');
  });

  afterEach(() => {
    process.env = originalEnv;
    delete global.fetch;
  });

  it('trackEvent() calls fetch with correct Aptabase URL and headers', () => {
    analytics.trackEvent('test_event', { foo: 'bar' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://eu.aptabase.com/api/v0/event');
    expect(opts.method).toBe('POST');
    expect(opts.headers['App-Key']).toBe('A-EU-9601263447');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.eventName).toBe('test_event');
    expect(body.props.foo).toBe('bar');
    expect(body.props.source).toBe('cli');
  });

  it('trackEvent() does NOT call fetch when VULNSWEEP_NO_TELEMETRY=1', () => {
    process.env.VULNSWEEP_NO_TELEMETRY = '1';
    // Re-require to pick up env
    jest.resetModules();
    global.fetch = jest.fn();
    const a = require('../../src/cli/analytics');
    a.trackEvent('test_event');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('trackEvent() does NOT call fetch when DO_NOT_TRACK=1', () => {
    process.env.DO_NOT_TRACK = '1';
    jest.resetModules();
    global.fetch = jest.fn();
    const a = require('../../src/cli/analytics');
    a.trackEvent('test_event');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('trackEvent() never throws even when fetch rejects', () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network')));
    expect(() => analytics.trackEvent('e')).not.toThrow();
  });

  it('trackEvent() injects source: "cli" into props automatically', () => {
    analytics.trackEvent('e', { x: 1 });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.props.source).toBe('cli');
    expect(body.props.x).toBe(1);
  });

  it('trackEvent() includes sessionId and systemProps', () => {
    analytics.trackEvent('e');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sessionId).toBeDefined();
    expect(typeof body.sessionId).toBe('string');
    expect(body.systemProps.osName).toBe(process.platform);
    expect(body.systemProps.appVersion).toBeDefined();
  });

  it('isOptedOut() returns false by default', () => {
    expect(analytics.isOptedOut()).toBe(false);
  });

  it('isOptedOut() returns true when VULNSWEEP_NO_TELEMETRY=1', () => {
    process.env.VULNSWEEP_NO_TELEMETRY = '1';
    jest.resetModules();
    const a = require('../../src/cli/analytics');
    expect(a.isOptedOut()).toBe(true);
  });

  it('trackEvent() with no props still sends source: "cli"', () => {
    analytics.trackEvent('bare_event');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.props).toEqual({ source: 'cli' });
  });
});
