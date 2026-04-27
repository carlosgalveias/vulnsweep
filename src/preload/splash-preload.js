const { contextBridge } = require('electron');

/**
 * Splash Screen Preload Script
 *
 * Note: Version data is injected by the main process via executeJavaScript
 * after the page loads. This file maintains the security pattern but doesn't
 * require package.json access, making it work reliably in both development
 * and production builds.
 */
contextBridge.exposeInMainWorld('splashAPI', {
  // Version will be set by main process after load
  version: 'loading...',
  appName: 'VulnSweep'
});