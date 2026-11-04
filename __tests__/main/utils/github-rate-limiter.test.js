'use strict';

/**
 * Tests for the real github-rate-limiter module.
 * The .js extension bypasses the moduleNameMapper regex (github-rate-limiter$).
 */
const {
  isRateLimited,
  getQueueDepth,
  setRateLimited,
  resetQueue,
} = require('../../../src/main/utils/github-rate-limiter.js');

describe('github-rate-limiter new exports', () => {
  afterEach(() => {
    resetQueue();
  });

  describe('isRateLimited()', () => {
    it('returns false initially', () => {
      expect(isRateLimited()).toBe(false);
    });

    it('returns true after rate limit is set', () => {
      setRateLimited(5000);
      expect(isRateLimited()).toBe(true);
    });

    it('returns false after resetQueue() clears state', () => {
      setRateLimited(5000);
      resetQueue();
      expect(isRateLimited()).toBe(false);
    });
  });

  describe('getQueueDepth()', () => {
    it('returns 0 initially', () => {
      expect(getQueueDepth()).toBe(0);
    });
  });
});
