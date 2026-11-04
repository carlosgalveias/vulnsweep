'use strict';

const { existsSync } = require('node:fs');

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(() => false),
}));

describe('isHeadlessEnvironment', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all CI env vars before each test
    const ciVars = [
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'JENKINS_URL',
      'CIRCLECI',
      'TRAVIS',
      'BITBUCKET_BUILD_NUMBER',
      'TF_BUILD',
      'CODEBUILD_BUILD_ID',
      'DRONE',
      'BUILD_ID',
      'TEAMCITY_VERSION',
    ];
    for (const v of ciVars) {
      delete process.env[v];
    }
    existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('returns false in a normal local environment', () => {
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(false);
  });

  it('returns true when CI env var is set', () => {
    process.env.CI = 'true';
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(true);
  });

  it('returns true when GITHUB_ACTIONS is set', () => {
    process.env.GITHUB_ACTIONS = 'true';
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(true);
  });

  it('returns true when GITLAB_CI is set', () => {
    process.env.GITLAB_CI = 'true';
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(true);
  });

  it('returns true when JENKINS_URL is set', () => {
    process.env.JENKINS_URL = 'http://jenkins.example.com';
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(true);
  });

  it('returns true when any single CI var is set', () => {
    const ciVars = [
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'JENKINS_URL',
      'CIRCLECI',
      'TRAVIS',
      'BITBUCKET_BUILD_NUMBER',
      'TF_BUILD',
      'CODEBUILD_BUILD_ID',
      'DRONE',
      'BUILD_ID',
      'TEAMCITY_VERSION',
    ];
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    for (const varName of ciVars) {
      // Clear all first
      for (const v of ciVars) delete process.env[v];
      process.env[varName] = 'true';
      expect(isHeadlessEnvironment()).toBe(true);
    }
  });

  it('returns true when /.dockerenv exists', () => {
    const { existsSync: mockExistsSync } = require('node:fs');
    mockExistsSync.mockReturnValue(true);
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(true);
  });

  it('returns false when /.dockerenv does not exist and no CI vars', () => {
    existsSync.mockReturnValue(false);
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(false);
  });

  it('does not use TTY as a detection signal', () => {
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
    const { isHeadlessEnvironment } = require('../../src/cli/utils');
    expect(isHeadlessEnvironment()).toBe(false);
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });
});
