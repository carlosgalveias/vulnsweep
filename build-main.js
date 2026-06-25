/* eslint-disable no-console */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { IPC_CHANNEL_MAP } from './ipc-channel-map.js';
import { mainProcessConfig, preloadConfig } from './obfuscation.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const skipObfuscation = process.env.SKIP_OBFUSCATION === 'true';

// Build configuration for main process
const mainBuildOptions = {
  entryPoints: ['src/main/main.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist-main/main.js',
  external: ['electron', '@aptabase/electron'],
  minify: isProduction,
  sourcemap: !isProduction,
  treeShaking: true,
  // Aggressive minification options for production
  ...(isProduction && {
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    dropLabels: ['DEV'],
    drop: ['debugger'],
  }),
};

// Build configuration for preload scripts
const preloadBuildOptions = {
  entryPoints: ['src/preload/preload.js', 'src/preload/splash-preload.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outdir: 'dist-main/preload',
  external: ['electron'],
  minify: isProduction,
  sourcemap: !isProduction,
  treeShaking: true,
  define: {
    'process.env.VULNSWEEP_DEV': isProduction ? '"false"' : '"true"',
  },
  ...(isProduction && {
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    drop: ['debugger'],
  }),
};

/**
 * Obfuscates a built JS file in-place using javascript-obfuscator.
 * @param {string} filePath - Path to the file to obfuscate
 * @param {object} config - Obfuscation config object
 */
function obfuscateFile(filePath, config) {
  const code = readFileSync(filePath, 'utf-8');
  const result = JavaScriptObfuscator.obfuscate(code, config);
  writeFileSync(filePath, result.getObfuscatedCode());
  console.log(`  ✓ Obfuscated: ${filePath}`);
}

/**
 * Strips OP_* constant names from bundled output.
 * After esbuild bundles the preload, OP_* names survive as property keys
 * in destructuring patterns (e.g., {OP_SELECT_FOLDER:a_} = module).
 * This replaces them with short opaque identifiers.
 *
 * @param {string} filePath - Path to the bundled JS file
 * @returns {number} Number of replacements made
 */
function stripOpcodeNames(filePath) {
  let code = readFileSync(filePath, 'utf-8');
  let counter = 0;
  const replacementMap = new Map();

  // Match OP_ identifiers that appear as property keys in destructuring or object literals
  // Pattern: OP_SOME_NAME followed by : or , or } (property key context)
  code = code.replace(/\bOP_[A-Z_]+\b/g, (match) => {
    if (!replacementMap.has(match)) {
      replacementMap.set(match, `_$${(counter++).toString(36)}`);
    }
    return replacementMap.get(match);
  });

  writeFileSync(filePath, code);
  return replacementMap.size;
}

/**
 * Replaces human-readable IPC channel strings with opaque hex identifiers
 * in the specified built file. Operates on dist-main/ output only.
 *
 * Strategy: Match each channel name as a COMPLETE string literal (both quote styles).
 * The regex ensures we never partially match a longer string.
 *
 * @param {string} filePath - Path to the bundled JS file
 * @returns {{ replacements: number, channels: string[] }} Replacement stats
 */
function replaceIpcChannels(filePath) {
  let code = readFileSync(filePath, 'utf-8');
  let totalReplacements = 0;
  const replacedChannels = [];

  // Sort by length descending to prevent prefix-of-another issues
  // e.g., 'scan-projects' must be replaced before 'scan-project'
  const sortedEntries = Object.entries(IPC_CHANNEL_MAP).sort((a, b) => b[0].length - a[0].length);

  for (const [channel, hex] of sortedEntries) {
    // Escape any regex special chars in channel name (defensive)
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match the channel as a complete string literal with either quote style
    // This matches: "channel-name" or 'channel-name' as full string values
    const regex = new RegExp(`(['"])${escaped}\\1`, 'g');

    const before = code;
    code = code.replace(regex, (match, quote) => `${quote}${hex}${quote}`);

    const count = before.length - code.length === 0 ? 0 : (before.match(regex) || []).length;

    if (count > 0) {
      totalReplacements += count;
      replacedChannels.push(`${channel} → ${hex} (×${count})`);
    }
  }

  writeFileSync(filePath, code);
  return { replacements: totalReplacements, channels: replacedChannels };
}

async function build() {
  try {
    console.log('Building main process...');

    // Create output directories
    mkdirSync('dist-main', { recursive: true });
    mkdirSync('dist-main/preload', { recursive: true });

    // Build main process
    await esbuild.build(mainBuildOptions);
    console.log('✓ Main process built successfully');

    // Build preload scripts
    await esbuild.build(preloadBuildOptions);
    console.log('✓ Preload scripts built successfully');

    // Remove any stale source maps (defense-in-depth for production packaging)
    if (isProduction) {
      const staleMapFiles = [
        'dist-main/main.js.map',
        'dist-main/preload/preload.js.map',
        'dist-main/preload/splash-preload.js.map',
      ];
      for (const mapFile of staleMapFiles) {
        try {
          unlinkSync(mapFile);
        } catch {
          /* not present — OK */
        }
      }
      console.log('✓ Stale source maps removed (if any)');
    }

    // ── Strip OP_* constant names (production only) ─────────────────────
    if (isProduction) {
      console.log('\nStripping OP_* constant names...');
      const opTargets = ['dist-main/preload/preload.js', 'dist-main/preload/splash-preload.js'];
      for (const target of opTargets) {
        const count = stripOpcodeNames(target);
        console.log(`  ✓ ${target}: ${count} OP_* names replaced`);
      }
      console.log('✓ OP_* names stripped');
    }

    // ── IPC Channel Obfuscation (production only) ──────────────────────
    if (isProduction) {
      console.log('\nObfuscating IPC channel identifiers...');
      const targets = [
        'dist-main/main.js',
        'dist-main/preload/preload.js',
        'dist-main/preload/splash-preload.js',
      ];

      let grandTotal = 0;
      for (const target of targets) {
        const { replacements, channels } = replaceIpcChannels(target);
        grandTotal += replacements;
        console.log(`  ✓ ${target}: ${replacements} replacements`);
        if (process.env.VERBOSE_BUILD) {
          channels.forEach((c) => console.log(`      ${c}`));
        }
      }

      // Sanity check: we expect at least 44 replacements across main + preload
      // (each channel appears in at least main.js AND one preload file)
      if (grandTotal < 44) {
        console.error(`\n✗ FATAL: Only ${grandTotal} IPC replacements made (expected ≥44).`);
        console.error('  This means some channels were not found in the build output.');
        console.error(
          '  Possible causes: channel name typo, esbuild tree-shook it, or quote style issue.'
        );
        process.exit(1);
      }

      console.log(`✓ IPC obfuscation complete (${grandTotal} total replacements)`);
    }

    // Copy package.json to dist-main for electron-builder
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
    // Create a minimal package.json for the built app
    const minimalPackageJson = {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      main: 'main.js',
      author: packageJson.author,
      license: packageJson.license,
      dependencies: packageJson.dependencies || {},
    };
    writeFileSync('dist-main/package.json', JSON.stringify(minimalPackageJson, null, 2));
    console.log('✓ Package.json copied to dist-main');

    // Production obfuscation step
    if (isProduction && !skipObfuscation) {
      console.log('\nApplying production obfuscation...');
      obfuscateFile('dist-main/main.js', mainProcessConfig);
      obfuscateFile('dist-main/preload/preload.js', preloadConfig);
      obfuscateFile('dist-main/preload/splash-preload.js', preloadConfig);
      console.log('✓ Obfuscation complete');
    } else if (skipObfuscation) {
      console.log('\n⚠ Obfuscation skipped (SKIP_OBFUSCATION=true)');
    }

    // ── ASAR Integrity Hash Injection (production only) ─────────────────
    if (isProduction) {
      console.log('\nComputing ASAR integrity hashes...');

      const preloadContent = readFileSync('dist-main/preload/preload.js');
      const splashContent = readFileSync('dist-main/preload/splash-preload.js');

      const preloadHash = createHash('sha256').update(preloadContent).digest('hex');
      const splashHash = createHash('sha256').update(splashContent).digest('hex');

      let mainCode = readFileSync('dist-main/main.js', 'utf-8');
      const preloadReplaced = mainCode.includes('{{PRELOAD_INTEGRITY_HASH}}');
      const splashReplaced = mainCode.includes('{{SPLASH_INTEGRITY_HASH}}');

      if (!preloadReplaced || !splashReplaced) {
        console.error('✗ FATAL: Integrity hash placeholders not found in dist-main/main.js');
        console.error('  The obfuscator may have transformed the placeholder strings.');
        console.error('  Ensure {{PRELOAD_INTEGRITY_HASH}} and {{SPLASH_INTEGRITY_HASH}}');
        console.error('  are in reservedStrings in obfuscation.config.js');
        process.exit(1);
      }

      mainCode = mainCode.replace('{{PRELOAD_INTEGRITY_HASH}}', preloadHash);
      mainCode = mainCode.replace('{{SPLASH_INTEGRITY_HASH}}', splashHash);
      writeFileSync('dist-main/main.js', mainCode);

      console.log(`  ✓ preload.js hash: ${preloadHash.substring(0, 16)}...`);
      console.log(`  ✓ splash-preload.js hash: ${splashHash.substring(0, 16)}...`);
      console.log('✓ Integrity hashes injected into main.js');
    }

    console.log('\n✓ Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
