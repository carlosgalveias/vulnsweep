const { contextBridge, ipcRenderer, shell } = require('electron');
// Import opcode constants (bundled by esbuild at build time)
const {
  OP_SELECT_FOLDER,
  OP_DISCOVER_PROJECTS,
  OP_PREPARE_REPOSITORY,
  OP_COMMIT_AND_PUSH,
  OP_ANALYZE_PROJECT,
  OP_ANALYZE_PROJECTS,
  OP_SCAN_PROJECT,
  OP_SCAN_PROJECTS,
  OP_CANCEL_SCAN,
  OP_GET_SCAN_SETTINGS,
  OP_APPLY_FIXES,
  OP_SCAN_DEP_UPDATES,
  OP_APPLY_DEP_UPDATES,
  OP_SCAN_LICENSES,
  OP_SBOM_GET_SAVE_PATH,
  OP_SBOM_EXPORT,
  OP_GET_COMMERCIAL_STATUS,
  OP_ACTIVATE_LICENSE,
  OP_GET_INSTALL_INFO,
  OP_GET_TRIAL_STATUS,
  OP_INCREMENT_TRIAL_FIX,
  OP_OPEN_PAYMENT_WINDOW,
  OP_VERIFY_AND_ACTIVATE,
  OP_SEED_DEV_TRANSACTION,
  OP_GET_ACTIVE_PRICE,
  OP_SET_ANALYTICS_OPT_OUT,
  OP_GET_ANALYTICS_OPT_OUT,
  OP_GET_APP_VERSION,
  OP_OPEN_LOCAL_DOC,
  OP_LICENSE_BACKUP,
  OP_LICENSE_RESTORE,
  OP_CACHE_CLEAR,
  OP_CACHE_GET_STATS,
  OP_GET_CREDENTIAL_STATUS,
  OP_SET_CREDENTIAL,
  OP_DELETE_CREDENTIAL,
  OP_GET_SETTINGS,
  OP_SET_SETTINGS,
  OP_GET_DEPENDENCY_PATHS,
  OP_OPEN_EXTERNAL,
  OP_ON_LOG_MESSAGE,
  OP_ON_SCAN_PROGRESS,
  OP_ON_ANALYSIS_PROGRESS,
  OP_ON_DEP_UPDATE_PROGRESS,
} = require('../shared/renderer-api-opcodes.js');

// ─── Invoke dispatch table ──────────────────────────────────────────────
// Maps opcode → function that returns a Promise (or value for shell ops)
const INVOKE_TABLE = {
  [OP_SELECT_FOLDER]: () => ipcRenderer.invoke('select-folder'),
  [OP_DISCOVER_PROJECTS]: (args) => ipcRenderer.invoke('discover-projects', ...args),
  [OP_PREPARE_REPOSITORY]: (args) => ipcRenderer.invoke('prepare-repository', ...args),
  [OP_COMMIT_AND_PUSH]: (args) => ipcRenderer.invoke('commit-and-push', ...args),
  [OP_ANALYZE_PROJECT]: (args) => ipcRenderer.invoke('analyze-project', ...args),
  [OP_ANALYZE_PROJECTS]: (args) => ipcRenderer.invoke('analyze-projects', ...args),
  [OP_SCAN_PROJECT]: (args) => ipcRenderer.invoke('scan-project', ...args),
  [OP_SCAN_PROJECTS]: (args) => ipcRenderer.invoke('scan-projects', ...args),
  [OP_CANCEL_SCAN]: () => ipcRenderer.invoke('scan:cancel'),
  [OP_GET_SCAN_SETTINGS]: () => ipcRenderer.invoke('get-scan-settings'),
  [OP_APPLY_FIXES]: (args) => ipcRenderer.invoke('apply-fixes', ...args),
  [OP_SCAN_DEP_UPDATES]: (args) => ipcRenderer.invoke('scan-dep-updates', ...args),
  [OP_APPLY_DEP_UPDATES]: (args) => ipcRenderer.invoke('apply-dep-updates', ...args),
  [OP_SCAN_LICENSES]: (args) => ipcRenderer.invoke('license:scan', ...args),
  [OP_SBOM_GET_SAVE_PATH]: (args) => ipcRenderer.invoke('sbom:get-save-path', ...args),
  [OP_SBOM_EXPORT]: (args) => ipcRenderer.invoke('sbom:export', ...args),
  [OP_GET_COMMERCIAL_STATUS]: () => ipcRenderer.invoke('get-commercial-status'),
  [OP_ACTIVATE_LICENSE]: (args) => ipcRenderer.invoke('activate-license', ...args),
  [OP_GET_INSTALL_INFO]: () => ipcRenderer.invoke('get-install-info'),
  [OP_GET_TRIAL_STATUS]: () => ipcRenderer.invoke('get-trial-status'),
  [OP_INCREMENT_TRIAL_FIX]: () => ipcRenderer.invoke('increment-trial-fix'),
  [OP_OPEN_PAYMENT_WINDOW]: (args) => ipcRenderer.invoke('open-payment-window', ...args),
  [OP_VERIFY_AND_ACTIVATE]: (args) => ipcRenderer.invoke('verify-and-activate', ...args),
  [OP_GET_ACTIVE_PRICE]: () => ipcRenderer.invoke('get-active-price'),
  [OP_SET_ANALYTICS_OPT_OUT]: (args) => ipcRenderer.invoke('set-analytics-opt-out', ...args),
  [OP_GET_ANALYTICS_OPT_OUT]: () => ipcRenderer.invoke('get-analytics-opt-out'),
  [OP_GET_APP_VERSION]: () => ipcRenderer.invoke('get-app-version'),
  [OP_OPEN_LOCAL_DOC]: (args) => ipcRenderer.invoke('open-local-doc', ...args),
  [OP_LICENSE_BACKUP]: () => ipcRenderer.invoke('license-backup'),
  [OP_LICENSE_RESTORE]: () => ipcRenderer.invoke('license-restore'),
  [OP_CACHE_CLEAR]: () => ipcRenderer.invoke('cache:clear'),
  [OP_CACHE_GET_STATS]: () => ipcRenderer.invoke('cache:getStats'),
  [OP_GET_CREDENTIAL_STATUS]: () => ipcRenderer.invoke('credentials:getStatus'),
  [OP_SET_CREDENTIAL]: (args) => ipcRenderer.invoke('credentials:set', ...args),
  [OP_DELETE_CREDENTIAL]: (args) => ipcRenderer.invoke('credentials:delete', ...args),
  [OP_GET_SETTINGS]: () => ipcRenderer.invoke('settings:get'),
  [OP_SET_SETTINGS]: (args) => ipcRenderer.invoke('settings:set', ...args),
  [OP_GET_DEPENDENCY_PATHS]: (args) => ipcRenderer.invoke('get-dependency-paths', ...args),
  [OP_OPEN_EXTERNAL]: (args) => shell.openExternal(...args),
};

// Conditionally add dev-only opcode
if (process.env.VULNSWEEP_DEV === 'true') {
  INVOKE_TABLE[OP_SEED_DEV_TRANSACTION] = (args) =>
    ipcRenderer.invoke('seed-dev-transaction', ...args);
}

// ─── Event channel mapping ──────────────────────────────────────────────
const EVENT_CHANNELS = {
  [OP_ON_LOG_MESSAGE]: 'log-message',
  [OP_ON_SCAN_PROGRESS]: 'scan-progress',
  [OP_ON_ANALYSIS_PROGRESS]: 'analysis-progress',
  [OP_ON_DEP_UPDATE_PROGRESS]: 'dep-update-progress',
};

// ─── Expose the opaque dispatch surface ─────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (op, ...args) => {
    const handler = INVOKE_TABLE[op];
    if (!handler) throw new Error(`Invalid op: ${op}`);
    return handler(args);
  },

  on: (op, cb) => {
    const channel = EVENT_CHANNELS[op];
    if (!channel) throw new Error(`Invalid event op: ${op}`);
    const subscription = (_event, data) => cb(data);
    ipcRenderer.on(channel, subscription);
    // Return unsubscribe function (same pattern as before)
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  off: (op, cb) => {
    const channel = EVENT_CHANNELS[op];
    if (!channel) throw new Error(`Invalid event op: ${op}`);
    ipcRenderer.removeListener(channel, cb);
  },
});

// Expose version metadata (non-sensitive, keep as-is)
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});
