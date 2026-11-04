/**
 * Production obfuscation configuration for VulnSweep.
 *
 * Uses javascript-obfuscator with Node.js target.
 * IPC channel names and external module identifiers are preserved via reservedStrings.
 *
 * @see https://github.com/nicolo-ribaudo/javascript-obfuscator
 */

// ============================================
// IPC CHANNEL IDENTIFIERS — obfuscated hex values from ipc-channel-map.js
// These MUST be preserved verbatim for Electron IPC to function.
// The human-readable names have already been replaced in a prior build step.
// ============================================
import { IPC_CHANNEL_MAP } from './ipc-channel-map.js';

const IPC_CHANNELS = Object.values(IPC_CHANNEL_MAP);

// External module names that appear as string literals in the bundle
const EXTERNAL_MODULES = [
  'electron',
  '@aptabase/electron',
  'sludge-crypt',
  'systeminformation',
  'secure-ls',
];

// Build reservedStrings array from IPC channels + external modules
const reservedStrings = [
  ...IPC_CHANNELS,
  ...EXTERNAL_MODULES,
  '{{PRELOAD_INTEGRITY_HASH}}',
  '{{SPLASH_INTEGRITY_HASH}}',
];

// ============================================
// BASE CONFIG
// ============================================
const baseObfuscationConfig = {
  compact: true,
  simplify: true,
  target: 'node',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  controlFlowFlattening: false,
  controlFlowFlatteningThreshold: 0,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'variable',
  stringArrayThreshold: 0.75,
  rotateStringArray: true,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  numbersToExpressions: true,
  transformObjectKeys: false,
  debugProtection: true,
  debugProtectionInterval: 0,
  selfDefending: true,
  disableConsoleOutput: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
  reservedNames: [
    '^require$',
    '^module$',
    '^exports$',
    '^__dirname$',
    '^__filename$',
    '^process$',
    '^Buffer$',
    '^global$',
  ],
  reservedStrings,
};

// ============================================
// PER-TARGET CONFIGS
// ============================================

/** Main process (dist-main/main.js) */
export const mainProcessConfig = {
  ...baseObfuscationConfig,
};

/** Preload scripts (dist-main/preload/*.js) */
export const preloadConfig = {
  ...baseObfuscationConfig,
  transformObjectKeys: true,
  reservedStrings: [
    ...new Set([
      ...reservedStrings,
      // contextBridge.exposeInMainWorld API surface — renderer calls these by name
      'invoke',
      'on',
      'off',
      // window.versions property keys
      'node',
      'chrome',
      'electron',
      // Top-level window property names exposed via contextBridge
      'electronAPI',
      'splashAPI',
      'versions',
    ]),
  ],
};

/** CLI bundle (dist-cli/vulnsweep.js) */
export const cliConfig = {
  ...baseObfuscationConfig,
  // CLI needs stdout — ensure console output is never disabled
  disableConsoleOutput: false,
};
