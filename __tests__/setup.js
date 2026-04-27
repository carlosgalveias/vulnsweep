/**
 * Jest Setup File for React Testing Library
 * 
 * This file runs after the test framework is installed but before tests execute.
 * It configures global test utilities and extends Jest matchers for DOM testing.
 */

require('@testing-library/jest-dom');

// Suppress console warnings in tests (optional, can be removed if you want to see warnings)
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
  
  console.warn = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Not implemented: HTMLFormElement')
    ) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});