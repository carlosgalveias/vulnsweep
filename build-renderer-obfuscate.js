/* eslint-disable no-console */
/**
 * Post-Vite renderer obfuscation.
 * Runs AFTER `vite build` to apply javascript-obfuscator to the app chunk only.
 *
 * Usage: node build-renderer-obfuscate.js
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { rendererObfuscationConfig } from './obfuscation-renderer.config.js';

if (process.env.SKIP_OBFUSCATION === 'true') {
  console.log('SKIP_OBFUSCATION=true — skipping renderer obfuscation');
  process.exit(0);
}

const DIST_ASSETS = resolve('dist-renderer/assets');

// Find the app chunk(s) — match index-*.js pattern
let files;
try {
  files = readdirSync(DIST_ASSETS);
} catch (err) {
  console.error(`ERROR: Cannot read ${DIST_ASSETS}: ${err.message}`);
  process.exit(1);
}

const appChunks = files.filter((f) => f.startsWith('index-') && f.endsWith('.js'));

if (appChunks.length === 0) {
  console.error('ERROR: No index-*.js chunk found in dist-renderer/assets/');
  process.exit(1);
}

for (const chunk of appChunks) {
  const filePath = join(DIST_ASSETS, chunk);
  const code = readFileSync(filePath, 'utf-8');

  console.log(`Obfuscating renderer chunk: ${chunk} (${(code.length / 1024).toFixed(1)} KB)`);

  const result = JavaScriptObfuscator.obfuscate(code, rendererObfuscationConfig);
  writeFileSync(filePath, result.getObfuscatedCode());

  const newSize = result.getObfuscatedCode().length;
  console.log(`  ✓ Done: ${(newSize / 1024).toFixed(1)} KB`);
}

console.log(`\nRenderer obfuscation complete. ${appChunks.length} chunk(s) processed.`);
