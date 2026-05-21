'use strict';

/**
 * Manual Jest mock for github-rate-limiter.
 * Placed at src/main/utils/__mocks__/github-rate-limiter.js so that calling
 * jest.mock('../../utils/github-rate-limiter') in any test file automatically
 * uses this implementation — no path.resolve needed, no hoisting problem.
 *
 * enqueue() passes through to fn() immediately so tests run synchronously.
 */
module.exports = {
  enqueue: jest.fn((fn) => fn()),
  setRateLimited: jest.fn(),
  resetQueue: jest.fn(),
  getQueueDepth: jest.fn(() => 0),
};
