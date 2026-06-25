/**
 * Renderer-specific obfuscation settings.
 *
 * CRITICAL DIFFERENCES from main process config:
 * - target: 'browser' (NOT 'node')
 * - NO selfDefending (breaks eval-like patterns in some bundlers)
 * - NO debugProtection (breaks DevTools for legitimate users reporting bugs)
 * - NO deadCodeInjection (inflates bundle size sent to renderer — hurts startup)
 * - transformObjectKeys: false (MUST be false — breaks React reconciler prop key lookups)
 * - reservedStrings includes the opaque dispatch surface ('invoke', 'on', 'off')
 */
export const rendererObfuscationConfig = {
  compact: true,
  simplify: true,
  target: 'browser',

  // Identifier mangling
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,

  // String array (primary protection)
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

  // String splitting
  splitStrings: true,
  splitStringsChunkLength: 10,

  // Object key transformation — DISABLED.
  // Breaks React: JSX compiles to _jsx(type, {children, className, ...}).
  // transformObjectKeys transforms literal keys into computed string-array
  // lookups. React's reconciler then accesses .type, .key, .props by name
  // and gets undefined → silent white screen crash.
  transformObjectKeys: false,

  // Numeric obfuscation
  numbersToExpressions: true,

  // ══════ DISABLED FOR RENDERER ══════
  controlFlowFlattening: false, // Too slow for UI thread
  deadCodeInjection: false, // Bundle size matters in renderer
  debugProtection: false, // Users need DevTools for bug reports
  selfDefending: false, // Breaks in some Chromium contexts
  disableConsoleOutput: false, // We want console.error visible

  // Source maps
  sourceMap: false,

  // Preserve the dispatch surface and React internals
  reservedNames: ['^electronAPI$', '^splashAPI$', '^versions$'],
  reservedStrings: ['electronAPI', 'invoke', 'on', 'off', 'splashAPI'],
};
