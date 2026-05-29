'use strict';

/**
 * VulnSweep - GitHub Advisory API Singleton Rate Limiter
 *
 * Serializes ALL GitHub Advisory HTTP requests through a single module-scoped
 * promise-chain queue. When any request receives a 429/403 response and calls
 * setRateLimited(), ALL subsequent queued requests automatically wait out the
 * shared backoff — eliminating the thundering-herd problem where N concurrent
 * requests each independently retry with their own per-request sleep.
 *
 * Architecture:
 *   _queue is a promise chain. Each enqueue(fn) appends fn to the tail via .then().
 *   Before executing fn, the queue checks _rateLimitedUntil; if the epoch is in the
 *   future, it waits. This means whichever request sets _rateLimitedUntil first
 *   causes ALL subsequent queued requests to share that wait — one sleep, not N.
 *
 * Module singleton guarantee:
 *   Node.js caches require() results. The first require() initialises the module;
 *   all subsequent require() calls return the same exports object, so _queue and
 *   _rateLimitedUntil are shared across ALL callers within the same process.
 *
 * Integration note (Feature D — Cancel Scan):
 *   Call resetQueue() in the scan cancel path to drain the queue and reset backoff.
 *   This prevents a cancelled scan's rate-limit state from blocking the next scan.
 *   Example: ipcMain.handle('scan:cancel', () => { rateLimiter.resetQueue(); ... });
 *
 * @module utils/github-rate-limiter
 */

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

/** @type {Promise<void>} The tail of the serialised request chain. */
let _queue = Promise.resolve();

/**
 * Epoch millisecond timestamp after which queued requests may proceed.
 * 0 means "no rate limit active".
 * @type {number}
 */
let _rateLimitedUntil = 0;

/**
 * Running count of requests currently sitting in the queue (not yet executed).
 * Incremented when a request is enqueued; decremented when it starts executing.
 * @type {number}
 */
let _queueDepth = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a GitHub Advisory API call for serialised execution.
 *
 * The provided function is appended to the module-level promise chain.
 * It will not begin executing until all previously enqueued functions have
 * completed. If the queue is currently in a rate-limited backoff period, this
 * function will automatically wait until that period expires before executing.
 *
 * @template T
 * @param {() => Promise<T>} fn - Async function encapsulating a single HTTP request.
 * @param {AbortSignal} [signal] - Optional abort signal to cancel the request.
 * @returns {Promise<T>} Resolves with fn()'s return value, or rejects with fn()'s error.
 */
function enqueue(fn, signal = undefined) {
  if (signal?.aborted) {
    return Promise.reject(new Error('Request aborted'));
  }

  _queueDepth += 1;

  _queue = _queue.then(async () => {
    _queueDepth -= 1;

    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    const now = Date.now();
    if (_rateLimitedUntil > now) {
      const waitMs = _rateLimitedUntil - now;
      console.warn(
        `[github-rate-limiter] Rate limit active — waiting ${waitMs}ms before next request (shared backoff)`
      );
      await sleep(waitMs);
    }

    return fn(signal);
  });

  return _queue;
}

/**
 * Signal that a rate limit response (HTTP 429 or 403) was received.
 *
 * Advances _rateLimitedUntil to at least (Date.now() + waitMs). Takes the
 * maximum of the current value and the new deadline, so multiple concurrent
 * 403 signals from in-flight requests do not shorten an already-longer wait.
 *
 * All requests that have already been enqueued but not yet started will
 * automatically pick up this value when they reach the head of the queue.
 *
 * @param {number} waitMs - How long to wait in milliseconds (must be > 0).
 */
function setRateLimited(waitMs) {
  if (typeof waitMs !== 'number' || waitMs <= 0) return;
  _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + waitMs);
}

/**
 * Reset the queue and clear any active rate-limit state.
 *
 * Intended to be called when a scan is cancelled (Feature D integration point)
 * so that a cancelled scan's backoff state does not bleed into the next scan.
 * Also useful for test isolation between test cases.
 *
 * NOTE (Feature D): Wire this into the scan:cancel IPC handler in main.js:
 *   ipcMain.handle('scan:cancel', () => { rateLimiter.resetQueue(); ... });
 */
function resetQueue() {
  _queue = Promise.resolve();
  _rateLimitedUntil = 0;
  _queueDepth = 0;
}

/**
 * Returns the number of requests currently waiting in the queue (not yet executing).
 * Useful for telemetry, debugging, and test assertions.
 *
 * @returns {number}
 */
function getQueueDepth() {
  return _queueDepth;
}

module.exports = { enqueue, setRateLimited, resetQueue, getQueueDepth };
