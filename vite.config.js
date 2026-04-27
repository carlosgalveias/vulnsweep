import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-assets',
      closeBundle() {
        // Create assets directory in dist-renderer
        const assetsDir = path.join(__dirname, 'dist-renderer', 'assets');
        mkdirSync(assetsDir, { recursive: true });
        
        // Copy logo.png for splash screen
        copyFileSync(
          path.join(__dirname, 'assets', 'logo.png'),
          path.join(assetsDir, 'logo.png')
        );
        
        // Copy and transform splash.html to dist-renderer
        const splashSrcPath = path.join(__dirname, 'src', 'renderer', 'splash.html');
        const splashDestPath = path.join(__dirname, 'dist-renderer', 'splash.html');
        
        // Read splash.html content
        let splashContent = readFileSync(splashSrcPath, 'utf-8');
        
        // Replace the image path for production build
        // In development: ../../assets/logo.png (from src/renderer to assets)
        // In production: ./assets/logo.png (from dist-renderer to dist-renderer/assets)
        splashContent = splashContent.replace(
          '../../assets/logo.png',
          './assets/logo.png'
        );
        
        // Write modified content to dist-renderer
        writeFileSync(splashDestPath, splashContent, 'utf-8');
      }
    }
  ],
  
  // Root directory for Vite (where index.html is located)
  root: path.join(__dirname, 'src/renderer'),
  
  // Base public path
  base: './',
  
  // Build configuration
  build: {
    // Output directory relative to project root
    outDir: path.join(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    // Disable sourcemaps in production for obfuscation
    sourcemap: false,
    // Enable minification with terser for better obfuscation
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console statements
        drop_debugger: true, // Remove debugger statements
        pure_funcs: ['console.log', 'console.info', 'console.debug'], // Remove specific console methods
      },
      mangle: {
        toplevel: true, // Mangle top-level variable names
      },
      format: {
        comments: false, // Remove all comments
      },
    },
    // CSS minification
    cssMinify: true,
    // Chunk size warnings
    chunkSizeWarningLimit: 1000,
  },
  
  // Development server configuration
  server: {
    port: 5173,
    strictPort: true
  },
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src/renderer')
    }
  }
});