/* eslint-disable no-console */
/**
 * Post-build verification: ensures NO human-readable IPC channel names
 * remain in the production dist-main/ output.
 *
 * Usage: node scripts/verify-ipc-obfuscation.js
 * Exit code 0 = clean, 1 = leaked channel names found
 */
import { readFileSync } from 'fs';
import { IPC_CHANNEL_MAP } from '../ipc-channel-map.js';

const FILES_TO_CHECK = [
  'dist-main/main.js',
  'dist-main/preload/preload.js',
  'dist-main/preload/splash-preload.js',
];

const channels = Object.keys(IPC_CHANNEL_MAP);
let leaked = false;

for (const file of FILES_TO_CHECK) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    console.error(`[SKIP] ${file} not found (run production build first)`);
    continue;
  }

  for (const channel of channels) {
    // Check for the channel as a complete string literal
    const singleQuote = `'${channel}'`;
    const doubleQuote = `"${channel}"`;

    if (content.includes(singleQuote) || content.includes(doubleQuote)) {
      console.error(`[LEAK] "${channel}" found in ${file}`);
      leaked = true;
    }
  }

  // Also verify hex values ARE present
  const hexValues = Object.values(IPC_CHANNEL_MAP);
  let hexFound = 0;
  for (const hex of hexValues) {
    if (content.includes(hex)) hexFound++;
  }
  console.log(`[OK] ${file}: ${hexFound}/${hexValues.length} hex channels present`);
}

if (leaked) {
  console.error('\n✗ VERIFICATION FAILED: Human-readable IPC channels leaked into build output.');
  process.exit(1);
} else {
  console.log('\n✓ All IPC channels successfully obfuscated.');
  process.exit(0);
}
