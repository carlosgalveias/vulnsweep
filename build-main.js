import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

// Build configuration for main process
const mainBuildOptions = {
  entryPoints: ['src/main/main.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist-main/main.js',
  external: ['electron'],
  minify: isProduction,
  sourcemap: !isProduction,
  treeShaking: true,
  // Aggressive minification options for production
  ...(isProduction && {
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    dropLabels: ['DEV'],
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
  ...(isProduction && {
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
  }),
};

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
    writeFileSync(
      'dist-main/package.json',
      JSON.stringify(minimalPackageJson, null, 2)
    );
    console.log('✓ Package.json copied to dist-main');
    
    console.log('\n✓ Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();