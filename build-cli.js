import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { platform } from 'os';
import esbuild from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

async function buildCli() {
  console.log('Building VulnSweep CLI...');

  mkdirSync('dist-cli', { recursive: true });

  await esbuild.build({
    entryPoints: ['src/cli/index.js'],
    outfile: 'dist-cli/vulnsweep.js',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: true,
    treeShaking: true,
    keepNames: false,
    legalComments: 'none',
    drop: ['debugger'],
    dropLabels: ['DEV'],
    mangleProps: /_internal$|_private$/,
    external: ['electron', 'sludge-crypt', 'systeminformation', 'secure-ls'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  // Fix the package.json path reference in the bundle.
  // Source code reads ../../package.json (relative to src/cli/), but the bundle
  // lives in dist-cli/ where the correct relative path is ./package.json.
  let bundle = readFileSync('dist-cli/vulnsweep.js', 'utf-8');
  bundle = bundle.replaceAll('../../package.json', './package.json');
  writeFileSync('dist-cli/vulnsweep.js', bundle);

  // Generate platform-specific launcher scripts
  generateLaunchers();

  // Write dist-cli/package.json for standalone npm global install
  const distPkg = {
    name: 'vulnsweep',
    version: pkg.version,
    description: 'VulnSweep CLI - npm vulnerability scanner',
    bin: { vulnsweep: './vulnsweep.js' },
    engines: { node: '>=18.0.0' },
    os: ['win32', 'linux', 'darwin'],
    files: ['vulnsweep.js', 'vulnsweep.cmd', 'vulnsweep'],
    dependencies: {
      'sludge-crypt': pkg.dependencies['sludge-crypt'],
      systeminformation: pkg.dependencies['systeminformation'],
      'secure-ls': pkg.dependencies['secure-ls'],
    },
  };
  writeFileSync('dist-cli/package.json', JSON.stringify(distPkg, null, 2));

  console.log(`✓ VulnSweep CLI v${pkg.version} built to dist-cli/vulnsweep.js`);
  console.log('✓ Platform launchers generated (vulnsweep.cmd, vulnsweep)');
  console.log('✓ dist-cli/package.json written for npm global install');
}

/**
 * Generates platform-specific launcher scripts in dist-cli/.
 * - vulnsweep.cmd  → Windows batch file (direct execution without npm link)
 * - vulnsweep      → Unix shell script (chmod +x on non-Windows)
 */
function generateLaunchers() {
  // Windows batch launcher
  const cmdContent = '@echo off\r\nnode "%~dp0vulnsweep.js" %*\r\n';
  writeFileSync('dist-cli/vulnsweep.cmd', cmdContent);

  // Unix shell launcher
  const shContent = '#!/bin/sh\nexec node "$(dirname "$0")/vulnsweep.js" "$@"\n';
  writeFileSync('dist-cli/vulnsweep', shContent);

  // Set executable permission on Unix systems
  if (platform() !== 'win32') {
    chmodSync('dist-cli/vulnsweep', 0o755);
  }
}

buildCli().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
