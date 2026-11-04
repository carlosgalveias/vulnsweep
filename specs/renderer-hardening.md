# Renderer Hardening — Implementation Specification

**Author:** Code Pathologist (Team Lead)  
**Date:** 2026-06-24  
**Target Implementer:** JavaScript Expert  
**Priority:** Critical (Security Hardening — Sprint 2)  
**Depends on:** `specs/ipc-channel-obfuscation.md` (already implemented)

---

## Executive Summary

Two gaping wounds remain in the production build after IPC channel obfuscation shipped:

1. **`window.electronAPI` property names are plaintext** — An attacker opens DevTools (or the ASAR), types `Object.keys(window.electronAPI)`, and receives a love letter describing every capability: `selectFolder`, `verifyAndActivate`, `getCommercialStatus`, `activateLicense`. The IPC channel strings may be hex, but the _method names_ scream intent.

2. **Renderer bundle has zero obfuscation** — `dist-renderer/assets/index-*.js` is Terser-minified (variable shortening) but structurally readable. PayPal flow logic, price constants, license key patterns, and component architecture are trivially recoverable.

Both gaps are fixed by this spec. No exceptions.

---

## Part 1: Opaque Numeric Dispatch for `window.electronAPI`

### 1.1 Problem Statement

The preload currently exposes ~39 named methods on `window.electronAPI`:

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getCommercialStatus: () => ipcRenderer.invoke('get-commercial-status'),
  verifyAndActivate: (email, txn) => ipcRenderer.invoke('verify-and-activate', email, txn),
  // ... 36 more readable method names
});
```

Even after IPC channel hex-replacement, the _property names_ remain in the ASAR as-is. Setting `transformObjectKeys: true` in obfuscation config would break cross-boundary contracts (the renderer must call the exact property name the preload defined).

### 1.2 Solution: Single-Entry Dispatch with Numeric Opcodes

Replace the entire named API surface with **three methods**:

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (op, ...args) => {
    /* numeric dispatch */
  },
  on: (op, cb) => {
    /* event subscription */
  },
  off: (op, cb) => {
    /* event unsubscription */
  },
});
```

The renderer calls `window.electronAPI.invoke(0x01)` instead of `window.electronAPI.selectFolder()`. An attacker sees three generic methods and meaningless numbers. Victory.

### 1.3 The Opcode Map

Create file: **`src/shared/renderer-api-opcodes.js`**

This file is importable by both:

- The **renderer** Vite build (ESM import)
- The **preload** esbuild build (bundled via esbuild from `src/preload/preload.js`)

```javascript
/**
 * Renderer API Opcodes
 *
 * Numeric dispatch codes for window.electronAPI.invoke() / .on() / .off()
 *
 * RULES:
 * - 0x01–0x7F: Request-response (ipcRenderer.invoke) operations
 * - 0x80–0xFE: Push-event (ipcRenderer.on) subscriptions
 * - 0xF0–0xFE: Reserved for splash preload
 * - NEVER reuse or change a deployed opcode value
 */

// ═══════════════════════════════════════════
// REQUEST-RESPONSE OPCODES (invoke)
// ═══════════════════════════════════════════

// Project Discovery
export const OP_SELECT_FOLDER = 0x01;
export const OP_DISCOVER_PROJECTS = 0x02;

// Git Operations
export const OP_PREPARE_REPOSITORY = 0x03;
export const OP_COMMIT_AND_PUSH = 0x04;

// Audit / Scan Operations
export const OP_ANALYZE_PROJECT = 0x05;
export const OP_ANALYZE_PROJECTS = 0x06;
export const OP_SCAN_PROJECT = 0x07;
export const OP_SCAN_PROJECTS = 0x08;
export const OP_CANCEL_SCAN = 0x09;
export const OP_GET_SCAN_SETTINGS = 0x0a;
export const OP_APPLY_FIXES = 0x0b;

// Dependency Updates
export const OP_SCAN_DEP_UPDATES = 0x0c;
export const OP_APPLY_DEP_UPDATES = 0x0d;

// License Scan & SBOM
export const OP_SCAN_LICENSES = 0x0e;
export const OP_SBOM_GET_SAVE_PATH = 0x0f;
export const OP_SBOM_EXPORT = 0x10;

// Commercial & Licensing
export const OP_GET_COMMERCIAL_STATUS = 0x11;
export const OP_ACTIVATE_LICENSE = 0x12;
export const OP_GET_INSTALL_INFO = 0x13;
export const OP_GET_TRIAL_STATUS = 0x14;
export const OP_INCREMENT_TRIAL_FIX = 0x15;
export const OP_OPEN_PAYMENT_WINDOW = 0x16;
export const OP_VERIFY_AND_ACTIVATE = 0x17;
export const OP_SEED_DEV_TRANSACTION = 0x18; // DEV-only
export const OP_GET_ACTIVE_PRICE = 0x19;

// Analytics
export const OP_SET_ANALYTICS_OPT_OUT = 0x1a;
export const OP_GET_ANALYTICS_OPT_OUT = 0x1b;

// App Info & Docs
export const OP_GET_APP_VERSION = 0x1c;
export const OP_OPEN_LOCAL_DOC = 0x1d;
export const OP_LICENSE_BACKUP = 0x1e;
export const OP_LICENSE_RESTORE = 0x1f;

// Scan Cache
export const OP_CACHE_CLEAR = 0x20;
export const OP_CACHE_GET_STATS = 0x21;

// Credentials
export const OP_GET_CREDENTIAL_STATUS = 0x22;
export const OP_SET_CREDENTIAL = 0x23;
export const OP_DELETE_CREDENTIAL = 0x24;

// Settings
export const OP_GET_SETTINGS = 0x25;
export const OP_SET_SETTINGS = 0x26;

// Dependency Paths
export const OP_GET_DEPENDENCY_PATHS = 0x27;

// Shell (special — uses shell.openExternal, NOT ipcRenderer.invoke)
export const OP_OPEN_EXTERNAL = 0x28;

// ═══════════════════════════════════════════
// PUSH-EVENT OPCODES (on/off)
// ═══════════════════════════════════════════

export const OP_ON_LOG_MESSAGE = 0x80;
export const OP_ON_SCAN_PROGRESS = 0x81;
export const OP_ON_ANALYSIS_PROGRESS = 0x82;
export const OP_ON_DEP_UPDATE_PROGRESS = 0x83;

// ═══════════════════════════════════════════
// SPLASH-SPECIFIC OPCODES
// ═══════════════════════════════════════════

export const OP_ON_SPLASH_DATA = 0xf0;
```

**Key design decisions:**

| Decision                     | Rationale                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Named exports (not object)   | Tree-shaking — unused opcodes eliminated from renderer bundle                               |
| Hex literals                 | Consistent with IPC channel map aesthetic; harder to grep than decimals                     |
| `0x80+` for events           | Single bit-check (`op & 0x80`) distinguishes invoke vs event in preload                     |
| `0xF0+` for splash           | Isolated range — splash preload only handles its own subset                                 |
| `OP_OPEN_EXTERNAL` as opcode | Even though it uses `shell.openExternal`, it appears as generic `.invoke()` to the attacker |

---

### 1.4 Preload Rewrite: `src/preload/preload.js`

Replace the entire `contextBridge.exposeInMainWorld('electronAPI', {...})` block with:

```javascript
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
  [OP_SELECT_FOLDER]: (args) => ipcRenderer.invoke('select-folder'),
  [OP_DISCOVER_PROJECTS]: (args) => ipcRenderer.invoke('discover-projects', ...args),
  [OP_PREPARE_REPOSITORY]: (args) => ipcRenderer.invoke('prepare-repository', ...args),
  [OP_COMMIT_AND_PUSH]: (args) => ipcRenderer.invoke('commit-and-push', ...args),
  [OP_ANALYZE_PROJECT]: (args) => ipcRenderer.invoke('analyze-project', ...args),
  [OP_ANALYZE_PROJECTS]: (args) => ipcRenderer.invoke('analyze-projects', ...args),
  [OP_SCAN_PROJECT]: (args) => ipcRenderer.invoke('scan-project', ...args),
  [OP_SCAN_PROJECTS]: (args) => ipcRenderer.invoke('scan-projects', ...args),
  [OP_CANCEL_SCAN]: (args) => ipcRenderer.invoke('scan:cancel'),
  [OP_GET_SCAN_SETTINGS]: (args) => ipcRenderer.invoke('get-scan-settings'),
  [OP_APPLY_FIXES]: (args) => ipcRenderer.invoke('apply-fixes', ...args),
  [OP_SCAN_DEP_UPDATES]: (args) => ipcRenderer.invoke('scan-dep-updates', ...args),
  [OP_APPLY_DEP_UPDATES]: (args) => ipcRenderer.invoke('apply-dep-updates', ...args),
  [OP_SCAN_LICENSES]: (args) => ipcRenderer.invoke('license:scan', ...args),
  [OP_SBOM_GET_SAVE_PATH]: (args) => ipcRenderer.invoke('sbom:get-save-path', ...args),
  [OP_SBOM_EXPORT]: (args) => ipcRenderer.invoke('sbom:export', ...args),
  [OP_GET_COMMERCIAL_STATUS]: (args) => ipcRenderer.invoke('get-commercial-status'),
  [OP_ACTIVATE_LICENSE]: (args) => ipcRenderer.invoke('activate-license', ...args),
  [OP_GET_INSTALL_INFO]: (args) => ipcRenderer.invoke('get-install-info'),
  [OP_GET_TRIAL_STATUS]: (args) => ipcRenderer.invoke('get-trial-status'),
  [OP_INCREMENT_TRIAL_FIX]: (args) => ipcRenderer.invoke('increment-trial-fix'),
  [OP_OPEN_PAYMENT_WINDOW]: (args) => ipcRenderer.invoke('open-payment-window', ...args),
  [OP_VERIFY_AND_ACTIVATE]: (args) => ipcRenderer.invoke('verify-and-activate', ...args),
  [OP_GET_ACTIVE_PRICE]: (args) => ipcRenderer.invoke('get-active-price'),
  [OP_SET_ANALYTICS_OPT_OUT]: (args) => ipcRenderer.invoke('set-analytics-opt-out', ...args),
  [OP_GET_ANALYTICS_OPT_OUT]: (args) => ipcRenderer.invoke('get-analytics-opt-out'),
  [OP_GET_APP_VERSION]: (args) => ipcRenderer.invoke('get-app-version'),
  [OP_OPEN_LOCAL_DOC]: (args) => ipcRenderer.invoke('open-local-doc', ...args),
  [OP_LICENSE_BACKUP]: (args) => ipcRenderer.invoke('license-backup'),
  [OP_LICENSE_RESTORE]: (args) => ipcRenderer.invoke('license-restore'),
  [OP_CACHE_CLEAR]: (args) => ipcRenderer.invoke('cache:clear'),
  [OP_CACHE_GET_STATS]: (args) => ipcRenderer.invoke('cache:getStats'),
  [OP_GET_CREDENTIAL_STATUS]: (args) => ipcRenderer.invoke('credentials:getStatus'),
  [OP_SET_CREDENTIAL]: (args) => ipcRenderer.invoke('credentials:set', ...args),
  [OP_DELETE_CREDENTIAL]: (args) => ipcRenderer.invoke('credentials:delete', ...args),
  [OP_GET_SETTINGS]: (args) => ipcRenderer.invoke('settings:get'),
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
```

**Critical notes:**

1. The `args` parameter in each dispatch handler receives the **spread rest** from `.invoke(op, ...args)`. The handler then spreads it back into ipcRenderer. This means **any arg shape** (objects, arrays, primitives, multiple args) passes through transparently.

2. `OP_OPEN_EXTERNAL` is special — it calls `shell.openExternal()` directly, not `ipcRenderer.invoke()`. From the renderer's perspective, it's still `.invoke(OP_OPEN_EXTERNAL, url)`. The attacker cannot distinguish it from any other opcode.

3. The `on()` method returns an unsubscribe function (matching current behavior where hooks call `const unsub = window.electronAPI.onLogMessage(cb)` and later `unsub()`). The new pattern: `const unsub = window.electronAPI.on(OP_ON_LOG_MESSAGE, cb)`.

4. Error on invalid opcode — fail loud during dev, silent-but-logged in prod. The obfuscated build won't have readable error strings anyway.

---

### 1.5 Splash Preload Rewrite: `src/preload/splash-preload.js`

```javascript
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
```

The splash HTML must be updated to use:

```javascript
window.splashAPI.on(0xf0, (data) => {
  /* render version info */
});
```

Since the splash HTML is in `src/renderer/splash.html` (inline script), update that inline `<script>` to use the numeric literal directly (no import needed — it's a single constant `0xF0`).

---

### 1.6 Renderer Migration Strategy

Every call site in `src/renderer/` that touches `window.electronAPI.methodName(...)` must be rewritten.

**Step 1:** Add opcode imports to each file that calls the API.

**Step 2:** Mechanically replace each call pattern:

| Before                                                                                  | After                                                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `window.electronAPI.selectFolder()`                                                     | `window.electronAPI.invoke(OP_SELECT_FOLDER)`                                                       |
| `window.electronAPI.discoverProjects(folder.content)`                                   | `window.electronAPI.invoke(OP_DISCOVER_PROJECTS, folder.content)`                                   |
| `window.electronAPI.prepareRepository(project.path, allowReset, { removePackageLock })` | `window.electronAPI.invoke(OP_PREPARE_REPOSITORY, project.path, allowReset, { removePackageLock })` |
| `window.electronAPI.commitAndPush(projectPath, { message })`                            | `window.electronAPI.invoke(OP_COMMIT_AND_PUSH, projectPath, { message })`                           |
| `window.electronAPI.analyzeProject(projectPath)`                                        | `window.electronAPI.invoke(OP_ANALYZE_PROJECT, projectPath)`                                        |
| `window.electronAPI.analyzeProjects(paths, allowReset)`                                 | `window.electronAPI.invoke(OP_ANALYZE_PROJECTS, paths, allowReset)`                                 |
| `window.electronAPI.scanProject(projectPath)`                                           | `window.electronAPI.invoke(OP_SCAN_PROJECT, projectPath)`                                           |
| `window.electronAPI.scanProjects(paths, allowReset)`                                    | `window.electronAPI.invoke(OP_SCAN_PROJECTS, paths, allowReset)`                                    |
| `window.electronAPI.cancelScan()`                                                       | `window.electronAPI.invoke(OP_CANCEL_SCAN)`                                                         |
| `window.electronAPI.getScanSettings()`                                                  | `window.electronAPI.invoke(OP_GET_SCAN_SETTINGS)`                                                   |
| `window.electronAPI.applyFixes(path, strategies, opts)`                                 | `window.electronAPI.invoke(OP_APPLY_FIXES, path, strategies, opts)`                                 |
| `window.electronAPI.scanDepUpdates(path, reset, opts)`                                  | `window.electronAPI.invoke(OP_SCAN_DEP_UPDATES, path, reset, opts)`                                 |
| `window.electronAPI.applyDepUpdates(path, updates)`                                     | `window.electronAPI.invoke(OP_APPLY_DEP_UPDATES, path, updates)`                                    |
| `window.electronAPI.scanLicenses(path)`                                                 | `window.electronAPI.invoke(OP_SCAN_LICENSES, path)`                                                 |
| `window.electronAPI.sbomGetSavePath(opts)`                                              | `window.electronAPI.invoke(OP_SBOM_GET_SAVE_PATH, opts)`                                            |
| `window.electronAPI.sbomExport(params)`                                                 | `window.electronAPI.invoke(OP_SBOM_EXPORT, params)`                                                 |
| `window.electronAPI.getCommercialStatus()`                                              | `window.electronAPI.invoke(OP_GET_COMMERCIAL_STATUS)`                                               |
| `window.electronAPI.activateLicense(paymentData)`                                       | `window.electronAPI.invoke(OP_ACTIVATE_LICENSE, paymentData)`                                       |
| `window.electronAPI.getInstallInfo()`                                                   | `window.electronAPI.invoke(OP_GET_INSTALL_INFO)`                                                    |
| `window.electronAPI.getTrialStatus()`                                                   | `window.electronAPI.invoke(OP_GET_TRIAL_STATUS)`                                                    |
| `window.electronAPI.incrementTrialFix()`                                                | `window.electronAPI.invoke(OP_INCREMENT_TRIAL_FIX)`                                                 |
| `window.electronAPI.openPaymentWindow(isPromo)`                                         | `window.electronAPI.invoke(OP_OPEN_PAYMENT_WINDOW, isPromo)`                                        |
| `window.electronAPI.verifyAndActivate(email, txn)`                                      | `window.electronAPI.invoke(OP_VERIFY_AND_ACTIVATE, email, txn)`                                     |
| `window.electronAPI.seedDevTransaction(email, amount)`                                  | `window.electronAPI.invoke(OP_SEED_DEV_TRANSACTION, email, amount)`                                 |
| `window.electronAPI.getActivePrice()`                                                   | `window.electronAPI.invoke(OP_GET_ACTIVE_PRICE)`                                                    |
| `window.electronAPI.setAnalyticsOptOut(value)`                                          | `window.electronAPI.invoke(OP_SET_ANALYTICS_OPT_OUT, value)`                                        |
| `window.electronAPI.getAnalyticsOptOut()`                                               | `window.electronAPI.invoke(OP_GET_ANALYTICS_OPT_OUT)`                                               |
| `window.electronAPI.getAppVersion()`                                                    | `window.electronAPI.invoke(OP_GET_APP_VERSION)`                                                     |
| `window.electronAPI.openLocalDoc(filename)`                                             | `window.electronAPI.invoke(OP_OPEN_LOCAL_DOC, filename)`                                            |
| `window.electronAPI.licenseBackup()`                                                    | `window.electronAPI.invoke(OP_LICENSE_BACKUP)`                                                      |
| `window.electronAPI.licenseRestore()`                                                   | `window.electronAPI.invoke(OP_LICENSE_RESTORE)`                                                     |
| `window.electronAPI.clearScanCache()`                                                   | `window.electronAPI.invoke(OP_CACHE_CLEAR)`                                                         |
| `window.electronAPI.getScanCacheStats()`                                                | `window.electronAPI.invoke(OP_CACHE_GET_STATS)`                                                     |
| `window.electronAPI.getCredentialStatus()`                                              | `window.electronAPI.invoke(OP_GET_CREDENTIAL_STATUS)`                                               |
| `window.electronAPI.setCredential(sourceId, plaintext)`                                 | `window.electronAPI.invoke(OP_SET_CREDENTIAL, sourceId, plaintext)`                                 |
| `window.electronAPI.deleteCredential(sourceId)`                                         | `window.electronAPI.invoke(OP_DELETE_CREDENTIAL, sourceId)`                                         |
| `window.electronAPI.getSettings()`                                                      | `window.electronAPI.invoke(OP_GET_SETTINGS)`                                                        |
| `window.electronAPI.setSettings(settings)`                                              | `window.electronAPI.invoke(OP_SET_SETTINGS, settings)`                                              |
| `window.electronAPI.getDependencyPaths(path, pkg)`                                      | `window.electronAPI.invoke(OP_GET_DEPENDENCY_PATHS, path, pkg)`                                     |
| `window.electronAPI.openExternal(url)`                                                  | `window.electronAPI.invoke(OP_OPEN_EXTERNAL, url)`                                                  |

**Event listener migration:**

| Before                                       | After                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| `window.electronAPI.onLogMessage(cb)`        | `window.electronAPI.on(OP_ON_LOG_MESSAGE, cb)`         |
| `window.electronAPI.onScanProgress(cb)`      | `window.electronAPI.on(OP_ON_SCAN_PROGRESS, cb)`       |
| `window.electronAPI.onAnalysisProgress(cb)`  | `window.electronAPI.on(OP_ON_ANALYSIS_PROGRESS, cb)`   |
| `window.electronAPI.onDepUpdateProgress(cb)` | `window.electronAPI.on(OP_ON_DEP_UPDATE_PROGRESS, cb)` |

The return value of `.on()` is still an unsubscribe function — the hooks already use this pattern:

```javascript
// Before:
const unsub = window.electronAPI.onLogMessage((log) => { ... });
return () => unsub();

// After:
const unsub = window.electronAPI.on(OP_ON_LOG_MESSAGE, (log) => { ... });
return () => unsub();
```

No behavioral change to the hooks' cleanup logic.

---

### 1.7 Files Requiring Modification (Complete List)

| File                                               | Changes                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/shared/renderer-api-opcodes.js`               | **NEW** — opcode constants                                                  |
| `src/preload/preload.js`                           | Full rewrite (dispatch table pattern)                                       |
| `src/preload/splash-preload.js`                    | Rewrite (opaque `.on()` pattern)                                            |
| `src/renderer/splash.html`                         | Update inline script: `0xF0` literal                                        |
| `src/renderer/App.jsx`                             | Replace 10 `window.electronAPI.X()` calls                                   |
| `src/renderer/hooks/useLogConsole.js`              | Replace `onLogMessage` → `.on(OP_ON_LOG_MESSAGE, ...)`                      |
| `src/renderer/hooks/useVulnerabilityScanner.js`    | Replace `onScanProgress`, `prepareRepository`, `scanProjects`, `cancelScan` |
| `src/renderer/hooks/useProjectDiscovery.js`        | Replace `selectFolder`, `discoverProjects`                                  |
| `src/renderer/hooks/useGitOperations.js`           | Replace `commitAndPush`                                                     |
| `src/renderer/hooks/useFixApplication.js`          | Replace `applyFixes`, `incrementTrialFix`                                   |
| `src/renderer/hooks/useSettings.js`                | Replace `getSettings`, `setSettings`                                        |
| `src/renderer/hooks/useCredentials.js`             | Replace `getCredentialStatus`                                               |
| `src/renderer/components/AboutTab.jsx`             | Replace `openLocalDoc`, `licenseBackup`, `licenseRestore`, `openExternal`   |
| `src/renderer/components/BuyModal.jsx`             | Replace `openPaymentWindow`, `verifyAndActivate`, `seedDevTransaction`      |
| `src/renderer/components/LicensesTab.jsx`          | Replace `sbomGetSavePath`, `sbomExport`                                     |
| `src/renderer/components/VulnerabilityGrid.jsx`    | Replace `getDependencyPaths`                                                |
| `src/renderer/components/SettingsTab.jsx`          | Replace cache/credential/settings calls (if any)                            |
| `src/renderer/components/DependencyUpdatesTab.jsx` | Replace dep-update calls (if any, or in App.jsx)                            |

**Import pattern for each renderer file:**

```javascript
import {
  OP_SELECT_FOLDER,
  OP_DISCOVER_PROJECTS,
  // ... only what this file needs
} from '../shared/renderer-api-opcodes.js';
```

---

### 1.8 esbuild Configuration Update

The preload build in `build-main.js` uses esbuild with `entryPoints: ['src/preload/preload.js', 'src/preload/splash-preload.js']`. The `require('../shared/renderer-api-opcodes.js')` will be resolved and **inlined** by esbuild automatically (it's a relative local file, not external). No config changes needed.

However, verify that the `src/shared/` directory is reachable from both build contexts:

- **Preload (esbuild):** Resolves `../shared/renderer-api-opcodes.js` relative to `src/preload/` → `src/shared/renderer-api-opcodes.js` ✓
- **Renderer (Vite):** Resolves `../shared/renderer-api-opcodes.js` relative to `src/renderer/hooks/` → needs `../../shared/renderer-api-opcodes.js` or use Vite alias

**Recommendation:** Add a Vite alias in `vite.config.js`:

```javascript
resolve: {
  alias: {
    '@shared': path.resolve(__dirname, 'src/shared'),
  },
}
```

Then renderer imports become:

```javascript
import { OP_SELECT_FOLDER } from '@shared/renderer-api-opcodes.js';
```

And preload stays as relative `require('../shared/renderer-api-opcodes.js')`.

---

## Part 2: Renderer Bundle Obfuscation

### 2.1 Problem Statement

After `vite build`, the output at `dist-renderer/assets/index-*.js` is only Terser-minified. The structural logic is fully recoverable:

- License validation flow
- PayPal payment URLs and price constants
- Component hierarchy and state machine
- API call patterns (even with opcodes, the _surrounding logic_ reveals intent)

### 2.2 Solution: Post-Vite Obfuscation (Option A — RECOMMENDED)

**Why not a Vite plugin?**

The `rollup-plugin-obfuscator` approach is fragile — it hooks into Rollup's transform pipeline and can conflict with Vite's chunk-splitting, HMR assumptions, and source maps. A post-build step is isolated, predictable, and debuggable. KISS wins.

**Implementation:** Add a new build script `build-renderer-obfuscate.js` (or inline it into the npm `build` script) that:

1. Globs `dist-renderer/assets/index-*.js` (the app chunk)
2. Runs `javascript-obfuscator` with renderer-safe settings
3. Overwrites the file in-place

### 2.3 Identifying the App Chunk vs Vendor Chunks

Vite's default chunking produces:

- `index-[hash].js` — the application code (our code)
- `vendor-[hash].js` or named chunks like `html2canvas-[hash].js` — third-party libraries

**Rule:** Only obfuscate files matching the pattern `index-*.js`. All other chunks are vendor code (already minified, no sensitive logic, and obfuscating them risks breakage with no security benefit).

**Detection logic:**

```javascript
import { globSync } from 'fs';
import path from 'path';

const distAssets = path.resolve('dist-renderer/assets');
const appChunks = globSync('index-*.js', { cwd: distAssets });
// Only obfuscate these ^^^
```

If Vite splits your app code into multiple chunks (code-splitting via dynamic imports), you may need to obfuscate all non-vendor chunks. Detect vendor chunks by checking if they match known library names or use the `manualChunks` Vite config to explicitly name vendor chunks.

### 2.4 Renderer Obfuscation Configuration

Create: **`obfuscation-renderer.config.js`** at project root (or add an export to existing `obfuscation.config.js`):

```javascript
/**
 * Renderer-specific obfuscation settings.
 *
 * CRITICAL DIFFERENCES from main process config:
 * - target: 'browser' (NOT 'node')
 * - NO selfDefending (breaks eval-like patterns in some bundlers)
 * - NO debugProtection (breaks DevTools for legitimate users reporting bugs)
 * - NO deadCodeInjection (inflates bundle size sent to renderer — hurts startup)
 * - transformObjectKeys: true (SAFE here — no cross-boundary contract in renderer internals)
 * - reservedStrings includes the opaque dispatch surface ('invoke', 'on', 'off')
 */
export const rendererObfuscationConfig = {
  compact: true,
  simplify: true,
  target: 'browser',

  // Identifier mangling
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,

  // String array (primary protection)
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'variable',
  stringArrayThreshold: 0.75,

  // String splitting
  splitStrings: true,
  splitStringsChunkLength: 10,

  // Object key transformation (safe in renderer — no IPC boundary)
  transformObjectKeys: true,

  // Numeric obfuscation
  numbersToExpressions: true,

  // ══════ DISABLED FOR RENDERER ══════
  controlFlowFlattening: false, // Too slow for UI thread
  deadCodeInjection: false, // Bundle size matters in renderer
  debugProtection: false, // Users need DevTools for bug reports
  selfDefending: false, // Breaks in some Chromium contexts
  disableConsoleOutput: false, // We want console.error visible

  // Source maps
  sourceMap: false,

  // Preserve the dispatch surface and React internals
  reservedNames: ['^electronAPI$', '^splashAPI$', '^versions$'],
  reservedStrings: ['electronAPI', 'invoke', 'on', 'off', 'splashAPI'],
};
```

**Why these specific settings?**

| Setting                 | Value                                 | Reason                                                            |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `target`                | `'browser'`                           | Renderer is Chromium — node-specific transforms would break       |
| `debugProtection`       | `false`                               | If a user opens DevTools to report a bug, the app must not freeze |
| `selfDefending`         | `false`                               | Known to cause infinite loops in some Electron renderer contexts  |
| `deadCodeInjection`     | `false`                               | Inflates bundle 20-30% — unacceptable for renderer startup time   |
| `controlFlowFlattening` | `false`                               | Causes 2-5x slowdown on UI-critical code paths                    |
| `transformObjectKeys`   | `true`                                | **Safe here** — React component state objects don't cross IPC     |
| `reservedStrings`       | `['electronAPI','invoke','on','off']` | The 3 dispatch methods must match what preload exposes            |
| `stringArrayThreshold`  | `0.75`                                | 75% of strings encoded — diminishing returns past this            |

### 2.5 Build Script: `build-renderer-obfuscate.js`

```javascript
/**
 * Post-Vite renderer obfuscation.
 * Runs AFTER `vite build` to apply javascript-obfuscator to the app chunk only.
 *
 * Usage: node build-renderer-obfuscate.js
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { rendererObfuscationConfig } from './obfuscation-renderer.config.js';

const DIST_ASSETS = resolve('dist-renderer/assets');

// Find the app chunk(s) — match index-*.js pattern
const files = readdirSync(DIST_ASSETS);
const appChunks = files.filter((f) => f.startsWith('index-') && f.endsWith('.js'));

if (appChunks.length === 0) {
  console.error('ERROR: No index-*.js chunk found in dist-renderer/assets/');
  process.exit(1);
}

for (const chunk of appChunks) {
  const filePath = join(DIST_ASSETS, chunk);
  const code = readFileSync(filePath, 'utf-8');

  console.log(`Obfuscating renderer chunk: ${chunk} (${(code.length / 1024).toFixed(1)} KB)`);

  const result = JavaScriptObfuscator.obfuscate(code, rendererObfuscationConfig);
  writeFileSync(filePath, result.getObfuscatedCode());

  const newSize = result.getObfuscatedCode().length;
  console.log(`  ✓ Done: ${(newSize / 1024).toFixed(1)} KB`);
}

console.log(`\nRenderer obfuscation complete. ${appChunks.length} chunk(s) processed.`);
```

### 2.6 CSS Chunk Handling

Vite also produces `index-*.css` in `dist-renderer/assets/`. CSS is **not** obfuscated — it has no sensitive logic. Tailwind class names are already short utilities (`flex`, `p-2`). Leave CSS alone.

---

## Part 3: Integration & Build Order

### 3.1 Updated Build Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: vite build                                          │
│ Input:  src/renderer/**                                     │
│ Output: dist-renderer/assets/index-[hash].js (minified)     │
│         dist-renderer/assets/vendor-[hash].js               │
│         dist-renderer/index.html                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: node build-renderer-obfuscate.js                    │
│ Input:  dist-renderer/assets/index-*.js                     │
│ Output: dist-renderer/assets/index-*.js (OVERWRITTEN)       │
│ Config: obfuscation-renderer.config.js                      │
│ Skip:   vendor chunks, CSS, HTML                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: node build-main.js                                  │
│ Input:  src/main/**, src/preload/**                         │
│ Steps:  esbuild → IPC channel replacement → obfuscation     │
│         → preload integrity hash injection                  │
│ Output: dist-main/main.js, dist-main/preload/preload.js,   │
│         dist-main/preload/splash-preload.js                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: electron-builder                                    │
│ Input:  dist-main/, dist-renderer/, package.json            │
│ Output: release/ (installer ASAR with all bundles)          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Updated npm Scripts in `package.json`

```json
{
  "scripts": {
    "build:renderer": "cross-env NODE_ENV=production vite build && node build-renderer-obfuscate.js",
    "build": "npm run build:renderer && cross-env NODE_ENV=production node build-main.js && electron-builder",
    "build:win": "npm run build:renderer && cross-env NODE_ENV=production node build-main.js && electron-builder --win",
    "build:mac": "npm run build:renderer && cross-env NODE_ENV=production node build-main.js && electron-builder --mac",
    "build:linux": "npm run build:renderer && cross-env NODE_ENV=production node build-main.js && electron-builder --linux",
    "build:win:com": "cross-env COMMERCIAL_BUILD=true npm run build:renderer && cross-env COMMERCIAL_BUILD=true node build-main.js && cross-env COMMERCIAL_BUILD=true electron-builder --win",
    "build:mac:com": "cross-env COMMERCIAL_BUILD=true npm run build:renderer && cross-env COMMERCIAL_BUILD=true node build-main.js && cross-env COMMERCIAL_BUILD=true electron-builder --mac",
    "build:linux:com": "cross-env COMMERCIAL_BUILD=true npm run build:renderer && cross-env COMMERCIAL_BUILD=true node build-main.js && cross-env COMMERCIAL_BUILD=true electron-builder --linux"
  }
}
```

**Key change:** Replace inline `vite build` with `npm run build:renderer` which chains `vite build` + obfuscation.

### 3.3 `SKIP_OBFUSCATION` Support

For debug builds, respect the existing `SKIP_OBFUSCATION=true` env var in `build-renderer-obfuscate.js`:

```javascript
if (process.env.SKIP_OBFUSCATION === 'true') {
  console.log('SKIP_OBFUSCATION=true — skipping renderer obfuscation');
  process.exit(0);
}
```

---

## Part 4: Test Mock Updates

### 4.1 Current Test Mock Pattern

Tests currently mock `window.electronAPI` with named methods:

```javascript
// __tests__/renderer/App.test.jsx (line 552)
window.electronAPI = {
  getCommercialStatus: jest.fn().mockResolvedValue({ isCommercial: false, isLicensed: true }),
  // ...
};
```

```javascript
// __tests__/renderer/components/AboutTab.test.jsx (line 36)
window.electronAPI = {
  licenseBackup: jest.fn().mockResolvedValue({ success: true }),
  licenseRestore: jest.fn().mockResolvedValue({ success: true }),
  openLocalDoc: jest.fn().mockResolvedValue({ success: true }),
  openExternal: jest.fn(),
  // ...
};
```

### 4.2 New Test Mock Pattern

Replace the named property mocks with the dispatch pattern:

```javascript
import {
  OP_GET_COMMERCIAL_STATUS,
  OP_LICENSE_BACKUP,
  OP_LICENSE_RESTORE,
  OP_OPEN_LOCAL_DOC,
  OP_OPEN_EXTERNAL,
  OP_ON_LOG_MESSAGE,
  // ... etc
} from '../../src/shared/renderer-api-opcodes.js';

// Create a dispatch-based mock that mirrors the real preload surface
function createElectronAPIMock(handlers = {}) {
  return {
    invoke: jest.fn((op, ...args) => {
      const handler = handlers[op];
      if (handler) return handler(...args);
      return Promise.resolve(undefined);
    }),
    on: jest.fn((op, cb) => {
      // Store for later triggering in tests
      return jest.fn(); // unsubscribe mock
    }),
    off: jest.fn(),
  };
}

// Usage in beforeEach:
beforeEach(() => {
  window.electronAPI = createElectronAPIMock({
    [OP_GET_COMMERCIAL_STATUS]: () => Promise.resolve({ isCommercial: false, isLicensed: true }),
    [OP_LICENSE_BACKUP]: () => Promise.resolve({ success: true }),
    [OP_LICENSE_RESTORE]: () => Promise.resolve({ success: true }),
    [OP_OPEN_LOCAL_DOC]: () => Promise.resolve({ success: true }),
    [OP_OPEN_EXTERNAL]: () => Promise.resolve(),
  });
});
```

### 4.3 Assertion Pattern Changes

```javascript
// Before:
expect(window.electronAPI.licenseBackup).toHaveBeenCalledTimes(1);

// After:
expect(window.electronAPI.invoke).toHaveBeenCalledWith(OP_LICENSE_BACKUP);
```

```javascript
// Before:
expect(window.electronAPI.openLocalDoc).toHaveBeenCalledWith('PRIVACY_POLICY.md');

// After:
expect(window.electronAPI.invoke).toHaveBeenCalledWith(OP_OPEN_LOCAL_DOC, 'PRIVACY_POLICY.md');
```

### 4.4 Test Helper File

Create: **`__tests__/utils/electron-api-mock.js`**

```javascript
/**
 * Shared test helper for mocking the opaque dispatch electronAPI surface.
 */
import * as OP from '../../src/shared/renderer-api-opcodes.js';

export { OP };

/**
 * Creates a mock window.electronAPI with the invoke/on/off dispatch pattern.
 * @param {Object} invokeHandlers - Map of opcode → mock handler function
 * @param {Object} [eventState] - Optional ref object to capture event subscriptions
 */
export function createElectronAPIMock(invokeHandlers = {}, eventState = {}) {
  const subscriptions = eventState;

  return {
    invoke: jest.fn((op, ...args) => {
      const handler = invokeHandlers[op];
      if (handler) return handler(...args);
      return Promise.resolve(undefined);
    }),
    on: jest.fn((op, cb) => {
      if (!subscriptions[op]) subscriptions[op] = [];
      subscriptions[op].push(cb);
      // Return unsubscribe function
      const unsub = jest.fn(() => {
        subscriptions[op] = subscriptions[op].filter((fn) => fn !== cb);
      });
      return unsub;
    }),
    off: jest.fn((op, cb) => {
      if (subscriptions[op]) {
        subscriptions[op] = subscriptions[op].filter((fn) => fn !== cb);
      }
    }),
  };
}

/**
 * Simulates a push event from the main process in tests.
 * @param {Object} eventState - The same ref object passed to createElectronAPIMock
 * @param {number} op - The event opcode
 * @param {*} data - The event payload
 */
export function emitMockEvent(eventState, op, data) {
  const subs = eventState[op] || [];
  subs.forEach((cb) => cb(data));
}
```

### 4.5 Files Requiring Test Updates

| Test File                                                     | Mock Changes                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `__tests__/renderer/App.test.jsx`                             | Lines 549-556: Replace named mock with `createElectronAPIMock()`; Lines 611-612: Replace assertion |
| `__tests__/renderer/components/AboutTab.test.jsx`             | Lines 35-44: Replace named mock; Lines 115-198: Replace assertions                                 |
| `__tests__/renderer/components/DependencyUpdatesTab.test.jsx` | Replace any `window.electronAPI.X` mocks                                                           |
| `__tests__/renderer/components/Modal.test.jsx`                | Check for any electronAPI usage                                                                    |
| `__tests__/renderer/components/ErrorBoundary.test.jsx`        | Check for any electronAPI usage                                                                    |
| `__tests__/renderer/components/Spinner.test.jsx`              | Unlikely to need changes                                                                           |
| `__tests__/setup.js`                                          | Consider adding a default `window.electronAPI` mock globally                                       |

---

## Part 5: Edge Cases & Gotchas

### 5.1 `openExternal` is NOT an IPC call

Currently: `openExternal: (url) => shell.openExternal(url)` — this calls `shell.openExternal` directly in the preload (which has access to the `shell` module). It does NOT go through `ipcRenderer.invoke`.

In the new pattern, the preload dispatch table handles this transparently:

```javascript
[OP_OPEN_EXTERNAL]: (args) => shell.openExternal(...args),
```

The renderer doesn't know or care that `OP_OPEN_EXTERNAL` doesn't use IPC. It just calls `.invoke(OP_OPEN_EXTERNAL, url)` like everything else.

### 5.2 `seedDevTransaction` is Conditionally Exposed

Currently gated by `process.env.VULNSWEEP_DEV`:

```javascript
...(process.env.VULNSWEEP_DEV === 'true' ? { seedDevTransaction: ... } : {})
```

In the new pattern, the `INVOKE_TABLE` is conditionally extended:

```javascript
if (process.env.VULNSWEEP_DEV === 'true') {
  INVOKE_TABLE[OP_SEED_DEV_TRANSACTION] = (args) =>
    ipcRenderer.invoke('seed-dev-transaction', ...args);
}
```

If a production renderer somehow calls `invoke(OP_SEED_DEV_TRANSACTION)`, it hits the `throw new Error('Invalid op')` guard. Good.

### 5.3 Event Listener Cleanup in Hooks

The hooks currently use this pattern:

```javascript
useEffect(() => {
  const unsub = window.electronAPI.onLogMessage((log) => { ... });
  return () => unsub();
}, []);
```

New pattern — **identical cleanup semantics**:

```javascript
useEffect(() => {
  const unsub = window.electronAPI.on(OP_ON_LOG_MESSAGE, (log) => { ... });
  return () => unsub();
}, []);
```

The `.on()` method returns an unsubscribe function. No behavioral change.

### 5.4 Vite Alias for `@shared`

Add to `vite.config.js`:

```javascript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  // ... rest of config
});
```

Also add to `jest.config.js` `moduleNameMapper`:

```javascript
moduleNameMapper: {
  '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  // ... existing mappers
}
```

### 5.5 Multiple Sequential API Calls

Some components call multiple APIs in sequence (e.g., `App.jsx` fetches `getCommercialStatus` then `getInstallInfo`). The opcode pattern doesn't complicate this at all:

```javascript
// Before:
const status = await window.electronAPI.getCommercialStatus();
const info = await window.electronAPI.getInstallInfo();

// After:
const status = await window.electronAPI.invoke(OP_GET_COMMERCIAL_STATUS);
const info = await window.electronAPI.invoke(OP_GET_INSTALL_INFO);
```

Same call pattern, same Promise semantics. The only visual difference is `invoke(CONSTANT)` vs `.methodName()`.

### 5.6 IPC Channel Replacement Still Applies

The existing build-time IPC channel string replacement (from Sprint 2's first hardening) continues to work unchanged. The preload dispatch table still contains the plain-text channel strings (`'select-folder'`, `'scan-progress'`, etc.) which `build-main.js` replaces with hex values post-esbuild.

The opcode map and the IPC channel map are **orthogonal concerns**:

- **Opcode map:** Hides _method semantics_ from renderer/DevTools introspection
- **IPC channel map:** Hides _channel names_ from ASAR string scanning

Both layers remain active.

### 5.7 Obfuscation Order for Preload

After esbuild bundles the preload (which inlines the opcodes as numeric literals), the pipeline is:

1. esbuild → `dist-main/preload/preload.js` (contains `0x01`, `0x02`, etc. as literals)
2. IPC channel replacement → replaces `'select-folder'` → `'0x7A3F1D8E'`
3. javascript-obfuscator → mangles everything else

After step 3, the preload contains neither readable method names NOR readable channel strings. Only hex opcodes (which appear as numeric computations after `numbersToExpressions`) and hex channel IDs (in the string array). Maximum opacity achieved.

---

## Part 6: Verification Checklist

After implementation, verify:

- [ ] `Object.keys(window.electronAPI)` in the packaged app returns only `['invoke', 'on', 'off']`
- [ ] `window.electronAPI.invoke(0x01)` opens the folder picker (works end-to-end)
- [ ] Event subscriptions via `.on(0x80, cb)` fire correctly (log messages appear)
- [ ] The splash screen renders version info via `.on(0xF0, cb)`
- [ ] `dist-renderer/assets/index-*.js` is obfuscated (no readable strings like 'PayPal', 'license', etc.)
- [ ] Vendor chunks (html2canvas, jspdf, etc.) are NOT obfuscated
- [ ] All tests pass (`npm test`)
- [ ] The `SKIP_OBFUSCATION=true` env var skips both main and renderer obfuscation
- [ ] Dev mode (`npm run dev`) still works (no obfuscation, direct API calls with opcodes still resolve)
- [ ] `seedDevTransaction` opcode is NOT available in production builds

---

## Part 7: New Files Summary

| File                                   | Type | Purpose                                |
| -------------------------------------- | ---- | -------------------------------------- |
| `src/shared/renderer-api-opcodes.js`   | New  | Opcode constant definitions            |
| `build-renderer-obfuscate.js`          | New  | Post-Vite obfuscation script           |
| `obfuscation-renderer.config.js`       | New  | Renderer-specific obfuscation settings |
| `__tests__/utils/electron-api-mock.js` | New  | Shared test helper for dispatch mocks  |

---

## Part 8: Dependencies

**No new npm dependencies required.** We already have:

- `javascript-obfuscator` — used by `build-main.js`
- `esbuild` — bundles preload
- `vite` — builds renderer

The `build-renderer-obfuscate.js` script reuses the existing `javascript-obfuscator` package.

---

## Part 9: Risk Assessment

| Risk                                             | Likelihood | Mitigation                                                                                                                            |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer obfuscation breaks React                | Low        | `transformObjectKeys` only affects local objects; React's internal keys are not transformed (they're in vendor chunk, not obfuscated) |
| Opcode mismatch between preload and renderer     | Medium     | Both import from same `renderer-api-opcodes.js` — single source of truth                                                              |
| Performance regression from renderer obfuscation | Low        | No `controlFlowFlattening`, no `deadCodeInjection` — only string encoding and identifier mangling, which are near-zero runtime cost   |
| Breaking change missed in migration              | Medium     | Run full test suite + manual smoke test of all features after migration                                                               |
| `ASAR` string scan still reveals opcodes         | Acceptable | Numeric literals like `0x01` are ubiquitous in compiled code — no semantic meaning without the source map                             |

---

## Implementation Order (for the JavaScript Expert)

1. Create `src/shared/renderer-api-opcodes.js`
2. Rewrite `src/preload/preload.js` (dispatch table)
3. Rewrite `src/preload/splash-preload.js`
4. Update `src/renderer/splash.html` inline script
5. Add Vite alias `@shared` to `vite.config.js`
6. Migrate all renderer files (hooks first, then components, then `App.jsx`)
7. Create `__tests__/utils/electron-api-mock.js` helper
8. Update all renderer test files to use new mock pattern
9. Add `jest.config.js` module name mapper for `@shared`
10. Run `npm test` — fix any failures
11. Create `obfuscation-renderer.config.js`
12. Create `build-renderer-obfuscate.js`
13. Update `package.json` build scripts
14. Run full production build (`npm run build:win`)
15. Verify packaged app: `Object.keys(window.electronAPI)` → `['invoke', 'on', 'off']`
16. Verify `dist-renderer/assets/index-*.js` is obfuscated (search for 'PayPal' — should be absent)

---

_End of specification. The diagnosis is terminal incompetence in the current build. The prescription is above. No excuses._
