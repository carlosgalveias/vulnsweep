/**
 * Shared test helper for mocking the opaque dispatch electronAPI surface.
 */
import * as OP from '../../src/shared/renderer-api-opcodes.js';

export { OP };

/**
 * Creates a mock window.electronAPI with the invoke/on/off dispatch pattern.
 * @param {Object} invokeHandlers - Map of opcode → mock handler function
 * @param {Object} [eventState] - Optional ref object to capture event subscriptions
 */
export function createElectronAPIMock(invokeHandlers = {}, eventState = {}) {
  const subscriptions = eventState;

  return {
    invoke: jest.fn((op, ...args) => {
      const handler = invokeHandlers[op];
      if (handler) return handler(...args);
      return Promise.resolve(undefined);
    }),
    on: jest.fn((op, cb) => {
      if (!subscriptions[op]) subscriptions[op] = [];
      subscriptions[op].push(cb);
      // Return unsubscribe function
      const unsub = jest.fn(() => {
        subscriptions[op] = subscriptions[op].filter((fn) => fn !== cb);
      });
      return unsub;
    }),
    off: jest.fn((op, cb) => {
      if (subscriptions[op]) {
        subscriptions[op] = subscriptions[op].filter((fn) => fn !== cb);
      }
    }),
  };
}

/**
 * Simulates a push event from the main process in tests.
 * @param {Object} eventState - The same ref object passed to createElectronAPIMock
 * @param {number} op - The event opcode
 * @param {*} data - The event payload
 */
export function emitMockEvent(eventState, op, data) {
  const subs = eventState[op] || [];
  subs.forEach((cb) => cb(data));
}
