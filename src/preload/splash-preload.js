const { contextBridge, ipcRenderer } = require('electron');

/**
 * Splash Screen Preload Script
 *
 * Exposes a splashAPI to the renderer via contextBridge.
 * The main process sends version/appName data via IPC ('splash:data' channel)
 * after the page loads.
 */
contextBridge.exposeInMainWorld('splashAPI', {
  onData: (cb) => ipcRenderer.on('splash:data', (_event, data) => cb(data)),
});
