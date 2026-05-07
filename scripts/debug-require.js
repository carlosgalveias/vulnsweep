/* eslint-disable no-console */
/**
 * This script handles cases where a required module (sludge-crypt)
 * attempts to disable or override the global console object at runtime.
 */

// 1. BACKUP THE NATIVE CONSOLE IMMEDIATELY
// We do this before the 'require' so we have a clean copy.
const nativeConsole = { ...console };
const nativeStdout = process.stdout;
const nativeStderr = process.stderr;

const rawLog = (msg) => nativeStdout.write(`[DEBUG] ${msg}\n`);
const rawError = (msg) => nativeStderr.write(`\x1b[31m[ERROR]\x1b[0m ${msg}\n`);

rawLog('--- Console Integrity Session Started ---');

// 2. DEFINE A RESTORATION FUNCTION
function restoreConsole() {
  rawLog('Attempting to restore console methods...');
  // Some modules might freeze the console object, so we try to re-assign
  try {
    Object.keys(nativeConsole).forEach((key) => {
      if (typeof nativeConsole[key] === 'function') {
        console[key] = nativeConsole[key];
      }
    });
    rawLog('Console restoration attempt complete.');
  } catch (e) {
    rawError(`Failed to restore console (object might be frozen). ${e.message}`);
  }
}

// 3. MONITOR PROCESS EXITS
const originalExit = process.exit;
process.exit = (code) => {
  rawError(`process.exit(${code}) was called.`);
  originalExit(code);
};

// 4. LOAD THE MODULE
rawLog('Requiring "sludge-crypt"...');
try {
  require('sludge-crypt');
  rawLog('Module loaded.');

  // CHECK FOR TAMPERING
  if (console.log.toString().length < 50 || !console.log.toString().includes('[native code]')) {
    rawError('DETECTED: sludge-crypt has overwritten console.log');
    restoreConsole();
  } else {
    rawLog('Console seems untouched.');
  }
} catch (error) {
  rawError(`Import error: ${error.message}`);
}

// TEST LOGGING AFTER RESTORATION
console.log('Testing: Can you see this log now?');

setTimeout(() => {
  rawLog('Finished.');
}, 1000);
