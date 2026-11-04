'use strict';

/**
 * Babel plugin that transforms `import.meta.env.X` expressions for Jest.
 *
 * Vite injects `import.meta.env` at build time, but Jest/Babel doesn't handle
 * it. This plugin replaces MetaProperty nodes (`import.meta`) with a plain
 * object that mirrors Vite's defaults in test mode.
 */
module.exports = function babelImportMetaPlugin() {
  return {
    visitor: {
      MetaProperty(path) {
        // Only handle import.meta (not new.target etc.)
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWithSourceString(
            '({ env: { DEV: false, PROD: true, MODE: "test", BASE_URL: "/", SSR: false } })'
          );
        }
      },
    },
  };
};
