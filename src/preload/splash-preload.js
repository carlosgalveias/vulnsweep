const { contextBridge, ipcRenderer } = require('electron');
const { OP_ON_SPLASH_DATA } = require('../shared/renderer-api-opcodes.js');

const SPLASH_EVENTS = {
  [OP_ON_SPLASH_DATA]: 'splash:data',
};

contextBridge.exposeInMainWorld('splashAPI', {
  on: (op, cb) => {
    const channel = SPLASH_EVENTS[op];
    if (!channel) throw new Error(`Invalid splash op: ${op}`);
    ipcRenderer.on(channel, (_event, data) => cb(data));
  },
});
