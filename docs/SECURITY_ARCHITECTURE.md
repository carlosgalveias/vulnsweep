# Security Architecture — Developer Guide

> **Audience:** Any developer modifying VulnSweep's Electron app.  
> **Rule #1:** If you're unsure whether a change breaks security, run a production build and verify with `node scripts/verify-ipc-obfuscation.js`.

---

## Table of Contents

1. [IPC Channel Obfuscation](#1-ipc-channel-obfuscation)
2. [Opaque Dispatch Pattern](#2-opaque-dispatch-pattern)
3. [Renderer Obfuscation](#3-renderer-obfuscation)
4. [Preload Obfuscation](#4-preload-obfuscation)
5. [ASAR Integrity](#5-asar-integrity)
6. [CLIENT_API_KEY Protection](#6-client_api_key-protection)
7. [Build Pipeline Overview](#7-build-pipeline-overview)
8. [Common Mistakes to Avoid](#8-common-mistakes-to-avoid)
9. [Security Testing](#9-security-testing)

---

## 1. IPC Channel Obfuscation

### How It Works

Human-readable IPC channel names (e.g. `'scan-project'`) are replaced at **build time** with opaque hex IDs (e.g. `'0xD9174B5C'`). This happens inside `build-main.js` → `replaceIpcChannels()`, which performs regex-based string replacement on the bundled output in `dist-main/`.

The mapping lives in [`ipc-channel-map.js`](../ipc-channel-map.js:11) — a static ES module exporting `IPC_CHANNEL_MAP`.

### Build Guard

After replacement, `build-main.js` checks the total replacement count:

```js
if (grandTotal < 44) {
  console.error('✗ FATAL: Only N IPC replacements made (expected ≥44).');
  process.exit(1);
}
```

If you add a channel but forget the map entry, the build **fails**.

### Checklist: Adding a New IPC Channel

1. **`src/main/main.js`** — Add the `ipcMain.handle('my-channel', ...)` handler.
2. **`ipc-channel-map.js`** — Add `'my-channel': '0xNEWHEXID'` with a unique 8-char hex.
3. **`src/shared/renderer-api-opcodes.js`** — Add `export const OP_MY_CHANNEL = 0xNN;` using the next available opcode (request-response: `0x01–0x7F`, events: `0x80–0xFE`).
4. **`src/preload/preload.js`** — Add an entry to `INVOKE_TABLE` (for invoke ops) or `EVENT_CHANNELS` (for push events).
5. **Renderer code** — Call via opcode: `window.electronAPI.invoke(OP_MY_CHANNEL, arg1, arg2)`. **Never** use the string name.

### Verification Script

```bash
node scripts/verify-ipc-obfuscation.js
```

Checks all `dist-main/` files for leaked human-readable channel names. Exit code `0` = clean, `1` = leaked.

---

## 2. Opaque Dispatch Pattern

### The API Surface

The renderer sees only three methods on `window.electronAPI`:

| Method                    | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `invoke(opcode, ...args)` | Request-response (wraps `ipcRenderer.invoke`) |
| `on(opcode, callback)`    | Subscribe to push events                      |
| `off(opcode, callback)`   | Unsubscribe from push events                  |

No method names, channel names, or feature descriptions are exposed.

### How Opcodes Map to Channels

In [`src/preload/preload.js`](../src/preload/preload.js:24):

```js
const INVOKE_TABLE = {
  [OP_SELECT_FOLDER]: (args) => ipcRenderer.invoke('select-folder'),
  // ...
};
```

The preload's `invoke()` method looks up the opcode in `INVOKE_TABLE` and dispatches. In production, both the OP constant names and the channel strings are stripped/replaced.

### Adding a New Opcode

1. Pick the next free hex value in [`renderer-api-opcodes.js`](../src/shared/renderer-api-opcodes.js:1) (check the range rules in the file header).
2. Export it: `export const OP_MY_THING = 0x29;`
3. Wire it in `INVOKE_TABLE` or `EVENT_CHANNELS` in the preload.
4. Import and use it in your renderer component.

### Why No Named Methods

If the API surface exposed `window.electronAPI.scanProject(...)`, an attacker reading the ASAR could enumerate every capability. The opaque `invoke(0x07)` pattern reveals nothing about what operation `0x07` performs.

---

## 3. Renderer Obfuscation

### Pipeline

```
vite build  →  dist-renderer/assets/index-*.js  →  build-renderer-obfuscate.js  →  obfuscated chunk
```

The script [`build-renderer-obfuscate.js`](../build-renderer-obfuscate.js:1) finds all `index-*.js` chunks in `dist-renderer/assets/` and applies `javascript-obfuscator` with the config from [`obfuscation-renderer.config.js`](../obfuscation-renderer.config.js:1).

### Key Settings

| Setting               | Value       | Why                                                                                       |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `target`              | `'browser'` | Renderer runs in Chromium                                                                 |
| `transformObjectKeys` | **`false`** | **REQUIRED** — React props are object keys; transforming them causes white-screen crashes |
| `selfDefending`       | `false`     | Breaks in some Chromium eval contexts                                                     |
| `debugProtection`     | `false`     | Users need DevTools for bug reports                                                       |
| `deadCodeInjection`   | `false`     | Keeps bundle size down for fast startup                                                   |

### Reserved Strings

```js
reservedStrings: ['electronAPI', 'invoke', 'on', 'off', 'splashAPI'];
```

These must survive obfuscation because the renderer calls `window.electronAPI.invoke(...)` by those literal names.

### ⚠️ Do NOT

- Set `transformObjectKeys: true` — **will break React**.
- Add `selfDefending: true` — can corrupt the renderer in Electron's sandboxed context.

---

## 4. Preload Obfuscation

### Why `transformObjectKeys: true` Is Safe Here

The preload has no React, no JSX, no framework that relies on property-name lookup. It only exposes `{ invoke, on, off }` via `contextBridge`, and those names are in `reservedStrings`.

Config: [`obfuscation.config.js`](../obfuscation.config.js:94) → `preloadConfig`.

### The `stripOpcodeNames()` Build Step

After esbuild bundles the preload, `OP_*` constant names survive as property keys in destructured patterns (e.g. `{OP_SELECT_FOLDER: a_} = ...`). These are semantic hints to an attacker.

[`build-main.js`](../build-main.js:80) runs `stripOpcodeNames()` to replace every `OP_[A-Z_]+` with short opaque IDs like `_$0`, `_$1`, `_$2a`, etc. This runs **before** javascript-obfuscator, so the obfuscator never even sees the original names.

### Reserved Strings (Preload)

```js
('invoke',
  'on',
  'off', // contextBridge API surface
  'node',
  'chrome',
  'electron', // window.versions property keys
  'electronAPI',
  'splashAPI',
  'versions'); // contextBridge world names
```

All hex IPC channel values are also auto-added from `IPC_CHANNEL_MAP` values.

---

## 5. ASAR Integrity

### Electron Fuses

Configured in [`package.json`](../package.json:118) → `build.electronFuses`:

| Fuse                                    | Value   | Effect                                         |
| --------------------------------------- | ------- | ---------------------------------------------- |
| `runAsNode`                             | `false` | Prevents `ELECTRON_RUN_AS_NODE` abuse          |
| `enableNodeOptionsEnvironmentVariable`  | `false` | Blocks `NODE_OPTIONS` injection                |
| `enableNodeCliInspectArguments`         | `false` | Disables `--inspect` debugging on packaged app |
| `enableEmbeddedAsarIntegrityValidation` | `true`  | Electron verifies ASAR at load                 |
| `onlyLoadAppFromAsar`                   | `true`  | Refuses to load from unpacked directories      |
| `enableCookieEncryption`                | `true`  | Encrypts persistent cookies                    |

### Runtime SHA-256 Checksum

In [`src/main/main.js`](../src/main/main.js:38), `_verifyAsarIntegrity()`:

1. Reads `dist-main/preload/preload.js` and `splash-preload.js` from disk at runtime.
2. Computes SHA-256 of each.
3. Compares against build-time injected hashes (`_PRELOAD_HASH`, `_SPLASH_HASH`).
4. If mismatch → **app quits silently** after a random delay (defeats timing analysis).
5. Returns an integrity token used downstream by license validation — removing the check breaks licensing.

The hash placeholders `{{PRELOAD_INTEGRITY_HASH}}` and `{{SPLASH_INTEGRITY_HASH}}` are injected by `build-main.js` **after** obfuscation (so the obfuscator can't transform them — they're in `reservedStrings`).

### Integrity Heartbeat

The check runs:

- On startup (synchronous, blocking)
- After ~30–45s (deferred re-check)
- Every ~5–7 min (periodic heartbeat with jitter)

### What Breaks If Preload Is Modified After Build

- Hash mismatch → app quits within seconds
- Integrity token becomes empty string → license validation fails
- User sees no error message (silent anti-tamper)

---

## 6. CLIENT_API_KEY Protection

### XOR Derivation

The license API key is **never** stored as a single plaintext string. Instead, two hex halves are XOR'd at runtime in [`src/main/config/constants.js`](../src/main/config/constants.js:221):

```js
function _deriveClientKey() {
  const _a = '1876fda7b7230ed4...'; // Half A (64 hex chars)
  const _b = '8064b378cce44f4c...'; // Half B (64 hex chars)
  let r = '';
  for (let i = 0; i < _a.length; i++) {
    r += (parseInt(_a[i], 16) ^ parseInt(_b[i], 16)).toString(16);
  }
  return r;
}
```

Neither half alone reveals the key. Both look like random hex in the obfuscated bundle.

### Where the Halves Live

- Both in `src/main/config/constants.js`, in the `_deriveClientKey()` function.
- After obfuscation, they end up as entries in the string array (base64 encoded, shuffled).

### Updating the Key

1. Generate a new 64-char hex key.
2. Generate a random 64-char hex value for `_b`.
3. Compute `_a = newKey XOR _b` (character by character, hex).
4. Replace both values in `_deriveClientKey()`.
5. Deploy the same key to your Cloudflare Worker.

---

## 7. Build Pipeline Overview

### Complete Build Order

```
npm run build
```

Executes in this sequence:

| #   | Step                      | Command/File                       | Output                                        |
| --- | ------------------------- | ---------------------------------- | --------------------------------------------- |
| 1   | Vite build (renderer)     | `vite build`                       | `dist-renderer/`                              |
| 2   | Renderer obfuscation      | `node build-renderer-obfuscate.js` | Overwrites `dist-renderer/assets/index-*.js`  |
| 3   | Main + preload build      | `node build-main.js`               | `dist-main/main.js`, `dist-main/preload/*.js` |
| 3a  | ↳ esbuild bundle          | —                                  | Bundled JS                                    |
| 3b  | ↳ Strip OP\_\* names      | `stripOpcodeNames()`               | No more `OP_SELECT_FOLDER` etc.               |
| 3c  | ↳ IPC channel replacement | `replaceIpcChannels()`             | `'scan-project'` → `'0xD9174B5C'`             |
| 3d  | ↳ Build guard             | —                                  | Fails if <44 replacements                     |
| 3e  | ↳ Obfuscation             | `javascript-obfuscator`            | String array, dead code, identifier mangling  |
| 3f  | ↳ ASAR hash injection     | —                                  | `{{PRELOAD_INTEGRITY_HASH}}` → actual SHA-256 |
| 4   | Electron packaging        | `electron-builder`                 | `.exe` / `.dmg` / `.AppImage`                 |

### Environment Variables

| Variable                | Effect                                             |
| ----------------------- | -------------------------------------------------- |
| `NODE_ENV=production`   | Enables minification, obfuscation, hash injection  |
| `SKIP_OBFUSCATION=true` | Skips javascript-obfuscator (for debugging builds) |
| `VERBOSE_BUILD=true`    | Prints per-channel replacement log                 |
| `COMMERCIAL_BUILD=true` | Includes commercial licensing features             |

### Debug Build (No Obfuscation)

```bash
npm run build:main:debug   # SKIP_OBFUSCATION=true NODE_ENV=production
```

Useful for debugging build issues without waiting for obfuscation.

---

## 8. Common Mistakes to Avoid

| ❌ Mistake                                            | 💥 Consequence                                            | ✅ Correct Approach                                    |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Add IPC channel without updating `ipc-channel-map.js` | Build fails (guard rejects <44 replacements)              | Always add the map entry first                         |
| Use `window.electronAPI.scanProject()`                | Exposes method name in bundled renderer                   | Use `window.electronAPI.invoke(OP_SCAN_PROJECT, ...)`  |
| Set `transformObjectKeys: true` in renderer config    | React white-screen crash                                  | Keep it `false` in `obfuscation-renderer.config.js`    |
| Store sensitive string as plaintext                   | Visible in ASAR via `strings` command                     | Use XOR derivation or environment-injected values      |
| Add files to `build.files` that contain source        | Readable `.js` files in shipped ASAR                      | Only include `dist-main/**/*` and `dist-renderer/**/*` |
| Put runtime deps in `devDependencies`                 | App crashes in production (module not found)              | Runtime deps go in `dependencies`                      |
| Put build-only deps in `dependencies`                 | Full source of build tools ships in ASAR as readable code | Build tools go in `devDependencies`                    |
| Reuse or change an existing opcode value              | Mismatched main/preload versions in the field             | Only add new opcodes, never modify deployed ones       |
| Remove or bypass `_verifyAsarIntegrity()`             | License validation breaks (integrity token is empty)      | Leave the integrity check in place                     |
| Add `reservedStrings` entry without hex prefix        | Obfuscator may split/encode it anyway                     | Use exact strings from the IPC map values              |

---

## 9. Security Testing

### Quick Verification After Build

```bash
# 1. Run production build
cross-env NODE_ENV=production node build-main.js

# 2. Verify no leaked IPC channel names
node scripts/verify-ipc-obfuscation.js

# 3. Check output confirms all hex channels present
# Expected: "[OK] dist-main/main.js: 56/56 hex channels present"
```

### Black-Box Check (Simulate Attacker)

```bash
# Extract and inspect the ASAR (requires asar CLI: npm i -g @electron/asar)
asar extract dist/win-unpacked/resources/app.asar ./extracted-app

# Search for any human-readable channel names
grep -r "scan-project\|analyze-project\|select-folder" ./extracted-app

# Search for OP_ constant names
grep -r "OP_" ./extracted-app

# Search for the API key (should NOT appear as a single 64-char hex string)
# Instead you should only see the two halves
```

If any of the above `grep` commands return results, obfuscation has a gap.

### Verify Renderer Obfuscation

```bash
# Open dist-renderer/assets/index-*.js — should be unreadable
# Confirm 'electronAPI' appears (it must — it's reserved) but no method names
Select-String -Pattern "scanProject|analyzeProject|selectFolder" dist-renderer/assets/index-*.js
# Expected: no matches
```

### CI Integration

Add to your CI pipeline:

```yaml
- run: cross-env NODE_ENV=production node build-main.js
- run: node scripts/verify-ipc-obfuscation.js
```

The verification script exits with code `1` on failure, which will fail the CI job.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  ADDING A NEW IPC CHANNEL — 5-STEP CHECKLIST                │
├─────────────────────────────────────────────────────────────┤
│  1. src/main/main.js         → ipcMain.handle('name', ...)  │
│  2. ipc-channel-map.js       → 'name': '0xHEXHEXHE'        │
│  3. src/shared/renderer-api-opcodes.js → OP_NAME = 0xNN    │
│  4. src/preload/preload.js   → INVOKE_TABLE or EVENT_CHANNELS│
│  5. Renderer component       → invoke(OP_NAME, args)        │
├─────────────────────────────────────────────────────────────┤
│  VERIFY: npm run build && node scripts/verify-ipc-obfuscation.js │
└─────────────────────────────────────────────────────────────┘
```
