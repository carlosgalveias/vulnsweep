# Sprint 3 — Final Hardening (Target: 8.5/10)

> **Status:** Ready for Implementation  
> **Author:** Code Pathologist (Team Lead)  
> **Date:** 2026-06-25  
> **Baseline Score:** 6.5/10  
> **Target Score:** 8.5/10  
> **Affected Files:** 4 source files + `package.json`

---

## Executive Summary

Five surgical fixes that close the remaining information-leak surface in the packaged ASAR. Each fix removes a class of static-analysis attack vector that currently lets a moderately skilled reverser map the app's entire commercial logic in under 20 minutes.

**Implementation Order** (dependency-safe):

| #   | Fix                                     | Risk     | Effort      |
| --- | --------------------------------------- | -------- | ----------- |
| 1   | Enable `EnableCookieEncryption` fuse    | NONE     | 1 line      |
| 2   | Move `sludge-crypt` → `devDependencies` | VERY LOW | 1 line move |
| 3   | Remove PS1 from ASAR; inline command    | LOW      | 2 files     |
| 4   | Preload `transformObjectKeys: true`     | LOW      | 1 file      |
| 5   | CLIENT_API_KEY XOR derivation           | LOW      | 2 files     |

---

## Fix 1: Enable `EnableCookieEncryption` Fuse

### Diagnosis

The [`electronFuses`](package.json:118) block omits `enableCookieEncryption`. Chromium cookies stored in the user data directory sit in plaintext SQLite — trivially exfiltrable by any process running as the same OS user.

### Root Cause

Nobody thought of it. Classic.

### Implementation

**File:** [`package.json`](package.json:118)  
**Location:** `build.electronFuses` object (line 118–125)

```diff
  "electronFuses": {
    "runAsNode": false,
    "enableNodeOptionsEnvironmentVariable": false,
    "enableNodeCliInspectArguments": false,
    "enableEmbeddedAsarIntegrityValidation": true,
    "onlyLoadAppFromAsar": true,
-   "grantFileProtocolExtraPrivileges": true
+   "grantFileProtocolExtraPrivileges": true,
+   "enableCookieEncryption": true
  },
```

### Risk Assessment

**NONE.** This encrypts Chromium cookies at rest using OS-level key storage. No functional impact — the app does not read raw cookie files.

### Verification

1. Build the app
2. Inspect `%APPDATA%/vulnsweep/Cookies` with a SQLite viewer — values should be encrypted blobs, not plaintext

---

## Fix 2: Move `sludge-crypt` from `dependencies` to `devDependencies`

### Diagnosis

[`sludge-crypt`](package.json:110) sits in `dependencies`. electron-builder dutifully copies the ENTIRE package source into the ASAR's `node_modules/` — even though esbuild already bundles it into `dist-main/main.js`. The result: a pristine, readable copy of the crypto library source available for any attacker who unpacks the ASAR.

### Root Cause

The developer apparently never learned the difference between "I need this at build time" and "I need this at runtime inside the packaged binary." esbuild resolves imports from `node_modules` at bundle time regardless of whether the package is in `dependencies` or `devDependencies`.

### Implementation

**File:** [`package.json`](package.json:100)

Move line 110 (`"sludge-crypt": "^1.0.5"`) from the `dependencies` block to `devDependencies`:

```diff
  "dependencies": {
    "@aptabase/electron": "0.3.1",
    "jspdf": "^4.2.1",
    "jspdf-autotable": "^5.0.7",
    "lucide-react": "^1.14.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "recharts": "^3.8.1",
    "secure-ls": "^2.0.0",
    "semver": "^7.6.0",
-   "sludge-crypt": "^1.0.5",
    "systeminformation": "^5.31.6"
  },
  "devDependencies": {
+   "sludge-crypt": "^1.0.5",
    "@babel/preset-env": "^7.29.2",
```

### Risk Assessment

**VERY LOW.** esbuild bundles `sludge-crypt` at build time by resolving it from `node_modules` (which exists during `npm run build`). The dep type only affects what electron-builder packages into the ASAR. Since `sludge-crypt` is NOT in the esbuild `external` list, it's already inlined into `dist-main/main.js`.

### Verification

1. `npm run build:win`
2. Unpack the ASAR: `npx asar extract dist/win-unpacked/resources/app.asar ./asar-check`
3. Confirm `node_modules/sludge-crypt/` does NOT exist in the extracted output
4. Run the app → license activation still works (sludge-crypt functions are in the bundled main.js)

---

## Fix 3: Remove `set-birthtime.ps1` from ASAR — Inline as Encoded String

### Diagnosis

The [`build.files`](package.json:132) array includes `"src/main/scripts/*.ps1"` (line 138). This packages `set-birthtime.ps1` into the ASAR as a readable plaintext file. Its content:

```powershell
param(
  [string]$FilePath,
  [long]$WindowsFileTime
)
$p = [System.IO.Path]::GetFullPath($FilePath)
(Get-Item $p).CreationTimeUtc = [datetime]::FromFileTimeUtc($WindowsFileTime)
```

This screams "we use file creation timestamps for trial validation" to anyone who unzips the ASAR. Might as well put a neon sign on it.

### Root Cause

The developer chose a separate `.ps1` file for "cleanliness" and then included it in the build manifest. The PowerShell logic is 2 lines. It does not need its own file in production.

### Implementation

#### Step 1: Remove PS1 from build files

**File:** [`package.json`](package.json:132)  
**Location:** `build.files` array (line 132–139)

```diff
  "files": [
    "dist-main/**/*",
    "!dist-main/**/*.map",
    "dist-renderer/**/*",
    "!dist-renderer/**/*.map",
-   "assets/*",
-   "src/main/scripts/*.ps1"
+   "assets/*"
  ],
```

#### Step 2: Inline the PowerShell command

**File:** [`src/main/modules/license.js`](src/main/modules/license.js:52)  
**Location:** `restoreVsweepFileWithBirthtime` function, lines 67–88

Replace the script-file invocation with an inline `-Command` invocation:

```diff
  // Step 4: Set CreationTimeUtc via PowerShell
  // Windows FILETIME = (Unix ms + 11644473600000) * 10000
  const windowsFileTime = (targetBirthtimeMs + 11644473600000) * 10000;
- const scriptPath = path.join(__dirname, 'scripts', 'set-birthtime.ps1');
- const result = spawnSync(
-   'powershell.exe',
-   [
-     '-NoProfile',
-     '-NonInteractive',
-     '-ExecutionPolicy',
-     'Bypass',
-     '-File',
-     scriptPath,
-     '-FilePath',
-     vsweepPath,
-     '-WindowsFileTime',
-     String(windowsFileTime),
-   ],
-   { shell: false, windowsHide: true, timeout: 10000 }
- );
+ const psCmd = `$p=[System.IO.Path]::GetFullPath('${vsweepPath.replace(/'/g, "''")}');(Get-Item $p).CreationTimeUtc=[datetime]::FromFileTimeUtc(${windowsFileTime})`;
+ const result = spawnSync(
+   'powershell.exe',
+   [
+     '-NoProfile',
+     '-NonInteractive',
+     '-ExecutionPolicy',
+     'Bypass',
+     '-Command',
+     psCmd,
+   ],
+   { shell: false, windowsHide: true, timeout: 10000 }
+ );
```

**Security note:** The `vsweepPath` is constructed internally by [`getVsweepFilePath()`](src/main/modules/license.js:112) — it's never user-supplied input. The `.replace(/'/g, "''")` is defense-in-depth against paths containing single quotes (PowerShell escaping convention).

#### Step 3: Source file disposition

`src/main/scripts/set-birthtime.ps1` remains in the source tree for developer reference. It is simply no longer packaged. No deletion needed.

### Risk Assessment

**LOW.** The inline command performs the identical operation. The `psCmd` string will be swept into the obfuscated string array by javascript-obfuscator (base64-encoded, rotated, shuffled). An attacker would need to decode the string array to find it — a significant improvement over a plaintext .ps1 file.

### Verification

1. Build the app
2. Unpack ASAR → confirm no `.ps1` files exist
3. Run license restore flow on Windows → verify `birthtimeMs` is correctly set
4. Run existing test: `npm test -- --testPathPattern=license`

---

## Fix 4: Preload `transformObjectKeys: true` — OP\_ Name Leak Elimination

### Diagnosis

[`src/preload/preload.js`](src/preload/preload.js:1) imports OP\_ constants via CJS `require()` of an ESM module. esbuild generates an interop shim:

```javascript
__export(opcodes_exports, {
  OP_SELECT_FOLDER: () => a,
  OP_GET_COMMERCIAL_STATUS: () => b,
  // ... 40+ keys, ALL as string literals
});
```

The [`baseObfuscationConfig`](obfuscation.config.js:39) has `transformObjectKeys: false` (line 65). The [`preloadConfig`](obfuscation.config.js:95) inherits this without override. Result: every `OP_*` name survives obfuscation as a readable string key — a complete map of the application's IPC surface.

### Root Cause

`transformObjectKeys: false` exists because it breaks React components (JSX prop spreading). But the preload has NO React. It's pure Node/Electron. Someone applied a global config without thinking about per-target requirements. Textbook "copy-paste configuration."

### Implementation

**File:** [`obfuscation.config.js`](obfuscation.config.js:95)  
**Location:** `preloadConfig` export (lines 95–97)

```diff
 /** Preload scripts (dist-main/preload/*.js) */
 export const preloadConfig = {
   ...baseObfuscationConfig,
+  transformObjectKeys: true,
+  reservedStrings: [
+    ...reservedStrings,
+    // contextBridge.exposeInMainWorld API surface — renderer calls these by name
+    'invoke', 'on', 'off',
+    // window.versions property keys
+    'node', 'chrome', 'electron',
+    // Top-level window property names exposed via contextBridge
+    'electronAPI', 'splashAPI', 'versions',
+  ],
 };
```

### Why These Reserved Strings?

| String                                 | Reason                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `invoke`, `on`, `off`                  | [`electronAPI`](src/preload/preload.js:81) method names — renderer calls `window.electronAPI.invoke(op)` |
| `node`, `chrome`, `electron`           | [`versions`](src/preload/preload.js:105) object keys — renderer reads `window.versions.node()`           |
| `electronAPI`, `splashAPI`, `versions` | `contextBridge.exposeInMainWorld` first argument — becomes `window.electronAPI` etc.                     |

Everything else (OP\_ names, IPC channel strings, internal variable names) gets transformed into computed property access via the string array.

### Risk Assessment

**LOW.** `transformObjectKeys` converts object literal keys `{ foo: bar }` into `{ [_0x1234('0x5')]: bar }` — computed properties pulling from the encrypted string array. The only keys that MUST remain readable are those the renderer accesses by literal name. All are covered by `reservedStrings`.

### Verification

1. `npm run build:main`
2. Open `dist-main/preload.js` (or equivalent output)
3. Search for `OP_` — should return ZERO matches
4. Search for `SELECT_FOLDER`, `COMMERCIAL_STATUS` etc. — ZERO matches
5. Search for `electronAPI` — should still appear (reserved)
6. Run the app → all IPC operations work (invoke/on/off surface intact)
7. Run renderer tests: `npm test -- --testPathPattern=renderer`

---

## Fix 5: CLIENT_API_KEY Runtime XOR Derivation

### Diagnosis

[`LICENSE_API_CONFIG.CLIENT_API_KEY`](src/main/config/constants.js:256) is a 64-character hex string sitting as a single literal:

```javascript
CLIENT_API_KEY: '<REDACTED — rotated on release>',
```

Even with `splitStrings` (10-char chunks) and `stringArrayEncoding: ['base64']`, the fragments are trivially reassembled. A `strings` dump of the bundle → base64 decode each fragment → concatenate → you have the key. This is the equivalent of hiding your house key under a transparent doormat.

### Root Cause

The developer stored a secret as a literal string and trusted the obfuscator to hide it. The obfuscator's job is to make control flow hard to follow, not to hide specific data values. Different problem, different tool.

### Implementation — XOR Split Approach

#### Pre-computation (one-time, done by the implementer):

```javascript
// Run this ONCE to generate the mask and XOR'd value:
const REAL_KEY = '<REDACTED — rotated on release>';
// Generate random 64-char hex mask:
const crypto = require('crypto');
const _K1 = crypto.randomBytes(32).toString('hex'); // 64 hex chars
// Compute _K2 = XOR(REAL_KEY, _K1) char-by-char (hex nibble XOR):
let _K2 = '';
for (let i = 0; i < _K1.length; i++) {
  _K2 += (parseInt(REAL_KEY[i], 16) ^ parseInt(_K1[i], 16)).toString(16);
}
console.log('_K1:', _K1);
console.log('_K2:', _K2);
// Verify: XOR(_K1, _K2) === REAL_KEY
```

#### Step 1: Replace in constants.js

**File:** [`src/main/config/constants.js`](src/main/config/constants.js:256)  
**Location:** `LICENSE_API_CONFIG` object, line 256

```diff
+ /**
+  * Derives the client API key at runtime from two XOR'd halves.
+  * Neither half alone reveals the key; both appear as random hex.
+  * @returns {string} 64-char hex API key
+  */
+ function _deriveClientKey() {
+   const _a = '<GENERATED_K1_VALUE>'; // 64-char random hex mask
+   const _b = '<GENERATED_K2_VALUE>'; // XOR(realKey, _a)
+   let r = '';
+   for (let i = 0; i < _a.length; i++) {
+     r += (parseInt(_a[i], 16) ^ parseInt(_b[i], 16)).toString(16);
+   }
+   return r;
+ }
+
 const LICENSE_API_CONFIG = {
   // ...
-  CLIENT_API_KEY: '<REDACTED — rotated on release>',
+  CLIENT_API_KEY: _deriveClientKey(),
 };
```

**Note:** The implementer MUST generate fresh `_K1` and compute `_K2` using the pre-computation script above. The placeholder values `<GENERATED_K1_VALUE>` and `<GENERATED_K2_VALUE>` are NOT to be committed literally.

#### Step 2: CLI uses the same constant — no change needed

[`src/cli/purchase-handler.js`](src/cli/purchase-handler.js:99) already accesses the key via:

```javascript
'X-API-Key': LICENSE_API_CONFIG.CLIENT_API_KEY,
```

Since `LICENSE_API_CONFIG.CLIENT_API_KEY` is now the return value of `_deriveClientKey()` (evaluated at module load time), the CLI gets the derived key automatically. No changes to `purchase-handler.js`.

#### Step 3: Remove from obfuscation reservedStrings (if present)

Verify that the old key literal is NOT in `reservedStrings` anywhere. It shouldn't be — but confirm. The two new hex halves look like random noise and need no reservation.

### Security Properties

| Attack Vector                    | Before                          | After                                                             |
| -------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| Static `strings` dump            | Key visible in base64 fragments | Two random hex strings, neither is the key                        |
| Single-breakpoint extraction     | Set BP on fetch, read header    | Still works (runtime derivation)                                  |
| Pattern matching for 64-char hex | Immediate match                 | Three 64-char hex strings (K1, K2, and the result in memory only) |

This is NOT "unbreakable." It raises the bar from "5 seconds with `strings`" to "requires dynamic analysis or understanding the XOR pattern." Combined with the obfuscator wrapping `_deriveClientKey()` in control-flow flattening and string-array encoding, it becomes a meaningful deterrent.

### Risk Assessment

**LOW.** The derivation is pure arithmetic — no crypto dependencies, no async, no side effects. The key is computed once at module load and cached in the `LICENSE_API_CONFIG` object.

### Verification

1. Add a temporary `console.log(LICENSE_API_CONFIG.CLIENT_API_KEY)` → confirm it outputs `<REDACTED — rotated on release>`
2. Run `npm test -- --testPathPattern=license`
3. Test CLI activation: `node src/cli/index.js activate --email test@test.com --txn ABC1234567890` → should reach the server (even if verification fails, the key is sent correctly)
4. Build → unpack ASAR → search for the released key's first 8 hex characters (from the pre-rotation value, kept out of this document) in all files → ZERO matches
5. Search for `CLIENT_API_KEY` → should appear only as an obfuscated property name (if at all)

---

## Post-Implementation Checklist

- [ ] All 5 fixes applied
- [ ] `npm test` passes (all existing tests green)
- [ ] `npm run build:win` succeeds
- [ ] ASAR unpacked and verified:
  - [ ] No `node_modules/sludge-crypt/` directory
  - [ ] No `.ps1` files
  - [ ] No `OP_*` string literals in preload bundle
  - [ ] No plaintext client API key literal anywhere
  - [ ] `electronAPI`, `invoke`, `on`, `off` still present in preload (reserved)
- [ ] App functional smoke test:
  - [ ] Scan a project
  - [ ] License activation flow (can fail at server — key must reach endpoint)
  - [ ] All IPC channels respond correctly
- [ ] Cookie encryption fuse active (inspect with `@electron/fuses` if desired)

---

## Files Modified Summary

| File                                                               | Change                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| [`package.json`](package.json)                                     | +1 fuse, move sludge-crypt, remove .ps1 glob         |
| [`obfuscation.config.js`](obfuscation.config.js:95)                | preloadConfig: transformObjectKeys + reservedStrings |
| [`src/main/modules/license.js`](src/main/modules/license.js:67)    | Inline PowerShell command, remove scriptPath         |
| [`src/main/config/constants.js`](src/main/config/constants.js:256) | XOR derivation function, replace literal key         |

**No changes required:**

- [`src/cli/purchase-handler.js`](src/cli/purchase-handler.js:99) — already reads from `LICENSE_API_CONFIG.CLIENT_API_KEY`
- [`src/preload/preload.js`](src/preload/preload.js) — no source changes; obfuscation config handles it
- [`src/main/scripts/set-birthtime.ps1`](src/main/scripts/set-birthtime.ps1) — remains in source tree, just not packaged
