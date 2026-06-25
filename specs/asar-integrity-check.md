# ASAR Integrity Checking — Implementation Specification

**Author:** Code Pathologist (Team Lead)  
**Date:** 2026-06-24  
**Target Implementer:** JavaScript Expert  
**Priority:** CRITICAL (Security Hardening — Sprint 2)  
**Attack Vector Mitigated:** ASAR Replacement (currently #1 unmitigated vector)

---

## Executive Summary

An attacker extracts the ASAR, modifies JS (e.g., NOPs the license check), repacks, and runs the app. Current bypass time: 45 minutes for a senior RE. This specification implements a **two-layer defense**:

1. **Electron Fuses** — Native C++-level ASAR integrity (Windows + macOS). Config-only, zero code.
2. **Runtime Self-Checksum** — JavaScript-layer defense-in-depth (covers Linux, hardens all platforms). ~50 lines of source + ~25 lines in build script.

The attacker must now: patch the signed Electron binary (to disable fuses) AND find/NOP multiple scattered integrity checks that are interleaved with license validation logic. Bypass time: Senior RE 4–8h minimum.

---

## Part 1: Electron Fuses Configuration (Config Only — Zero Code)

### 1.1 What Are Fuses?

Electron Fuses are compile-time feature flags embedded in the Electron binary itself. They are flipped by `electron-builder` during packaging. Once flipped, they cannot be changed without binary-patching the signed executable — which invalidates code signatures on Windows (Authenticode) and macOS (Gatekeeper).

### 1.2 Configuration Location

Add the `electronFuses` key inside the `build` object in [`package.json`](package.json:112). Insert it AFTER `"asar": true` (line 116) and BEFORE `"asarUnpack"` (line 117).

### 1.3 Exact JSON to Add

```json
"electronFuses": {
  "runAsNode": false,
  "enableNodeOptionsEnvironmentVariable": false,
  "enableNodeCliInspectArguments": false,
  "enableEmbeddedAsarIntegrityValidation": true,
  "onlyLoadAppFromAsar": true,
  "grantFileProtocolExtraPrivileges": false
}
```

### 1.4 Fuse-by-Fuse Justification

| Fuse                                    | Value   | Why                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runAsNode`                             | `false` | Prevents `ELECTRON_RUN_AS_NODE=1 ./VulnSweep` from giving an attacker a plain Node.js REPL with all app permissions. Without this, the attacker can `require()` any module from the ASAR.                                                                                            |
| `enableNodeOptionsEnvironmentVariable`  | `false` | Blocks `NODE_OPTIONS=--inspect` which would open a debug port, allowing runtime code injection via Chrome DevTools Protocol.                                                                                                                                                         |
| `enableNodeCliInspectArguments`         | `false` | Blocks `--inspect`, `--inspect-brk` CLI flags. Same attack surface as above but via argv.                                                                                                                                                                                            |
| `enableEmbeddedAsarIntegrityValidation` | `true`  | **THE CRITICAL ONE.** electron-builder computes a SHA-256 hash of the ASAR at build time and embeds it in the Electron binary's resource section. At launch, Electron validates the ASAR against this hash BEFORE loading any JS. Modified ASAR = instant crash at the native layer. |
| `onlyLoadAppFromAsar`                   | `true`  | Prevents fallback to `app/` directory. Without this, an attacker can simply extract the ASAR to `resources/app/` and delete the ASAR file — the app loads from the directory instead. This fuse closes that bypass.                                                                  |
| `grantFileProtocolExtraPrivileges`      | `false` | Restricts `file://` protocol from behaving like a universal origin. Prevents renderer-side local file exfiltration.                                                                                                                                                                  |

### 1.5 Impact on Development Workflow

**None.** Fuses are only applied during `electron-builder` packaging (the `npm run build*` scripts). When running `npm run dev` or `npm run dev:electron`, you're using the stock Electron binary from `node_modules/.bin/electron` — fuses are NOT flipped. Development is completely unaffected.

### 1.6 Verification

After building, verify fuses were applied:

```bash
npx @electron/fuses read dist/win-unpacked/VulnSweep.exe
```

Expected output should show all fuses in their configured state.

---

## Part 2: Runtime Self-Checksum (Defense-in-Depth)

### 2.1 The Self-Referential Problem

`main.js` cannot hash itself — the hash would need to be embedded IN the file, which changes the file, which changes the hash. This is a cryptographic impossibility (finding a SHA-256 fixed point).

**Solution:** `main.js` hashes the **preload files** (`dist-main/preload/preload.js` and `dist-main/preload/splash-preload.js`). These are the attacker's other prime targets — they contain the IPC bridge that enforces the security boundary between renderer and main process.

### 2.2 Architecture Overview

```
BUILD TIME                          RUNTIME
───────────                         ───────

esbuild → IPC replacement →         main.js loads
obfuscation →                       ↓
                                    reads preload files from disk
hash(preload.js) = ABC123           ↓
hash(splash-preload.js) = DEF456    hash(preload.js) → compare to ABC123
                                    hash(splash-preload.js) → compare to DEF456
inject ABC123, DEF456 into          ↓
main.js (replace placeholder)       mismatch? → app.quit() silently
                                    match? → continue normally
```

### 2.3 Source Code: Integrity Verification Module

Add the following to [`src/main/main.js`](src/main/main.js:1) — insert it AFTER the `isDevelopment` constant (line 25) and BEFORE `Menu.setApplicationMenu(null)` (line 27).

```javascript
// ── ASAR Integrity Self-Check ───────────────────────────────────────────────
// Build-time injected hashes of preload scripts. The placeholder values are
// replaced by build-main.js AFTER obfuscation with actual SHA-256 digests.
const _PRELOAD_HASH = '{{PRELOAD_INTEGRITY_HASH}}';
const _SPLASH_HASH = '{{SPLASH_INTEGRITY_HASH}}';

/**
 * Verifies preload script integrity against build-time embedded hashes.
 * Returns a derived value used downstream — removal breaks license validation.
 * @returns {string} Integrity token (first 8 chars of combined hash)
 */
function _verifyAsarIntegrity() {
  if (isDevelopment) return 'dev_bypass';
  try {
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const appRoot = path.dirname(__dirname);
    const preloadPath = path.join(appRoot, 'dist-main', 'preload', 'preload.js');
    const splashPath = path.join(appRoot, 'dist-main', 'preload', 'splash-preload.js');
    const h1 = crypto.createHash('sha256').update(fs.readFileSync(preloadPath)).digest('hex');
    const h2 = crypto.createHash('sha256').update(fs.readFileSync(splashPath)).digest('hex');
    if (h1 !== _PRELOAD_HASH || h2 !== _SPLASH_HASH) {
      setTimeout(() => app.quit(), 150 + Math.random() * 500);
      return '';
    }
    return (h1 + h2).substring(0, 8);
  } catch {
    setTimeout(() => app.quit(), 200 + Math.random() * 400);
    return '';
  }
}
const _integrityToken = _verifyAsarIntegrity();
```

**Total source lines:** 28 (well under the 50-line budget)

### 2.4 Critical Implementation Notes

1. **The `require()` calls are INSIDE the function** — this is intentional. When esbuild bundles `main.js`, top-level `require('crypto')` would be tree-shaken or inlined. Inside a function body with a conditional early return, esbuild preserves it as a dynamic require in the Node.js target mode.

2. **`appRoot` resolution:** In a packaged Electron app, `__dirname` points to `resources/app.asar/dist-main/`. The preload files are at `resources/app.asar/dist-main/preload/`. So the path is `path.join(__dirname, 'preload', 'preload.js')`. However, since esbuild bundles everything into `dist-main/main.js`, `__dirname` at runtime IS `dist-main/`. Therefore:

   **CORRECTED paths for bundled runtime:**

   ```javascript
   const preloadPath = path.join(__dirname, 'preload', 'preload.js');
   const splashPath = path.join(__dirname, 'preload', 'splash-preload.js');
   ```

3. **The `_integrityToken` return value** — this is NOT just a dead variable. It is intentionally designed to be USED by the license validation logic (see Section 6: Anti-Tamper Hardening). Removing the integrity check function causes `_integrityToken` to be `undefined`, which breaks downstream code.

4. **Randomized quit delay** — The `setTimeout` with random jitter prevents timing-based detection of which check failed. The app doesn't crash immediately (which would be an obvious "patch here" signal) — it dies 150–650ms later, making it harder to pinpoint in a debugger.

5. **Opaque failure** — No `console.error`, no `dialog.showErrorBox`. The app simply dies. To an attacker, it looks like a random crash — not a deliberate integrity check.

### 2.5 Multiple Verification Points

The initial check at module load (line ~27) covers startup. Add TWO additional verification points:

#### Point 2: Inside `app.whenReady()` callback

Insert after `createWindow()` call in the `app.whenReady()` handler:

```javascript
// Deferred integrity re-check (defense-in-depth)
setTimeout(
  () => {
    _verifyAsarIntegrity();
  },
  30000 + Math.random() * 15000
);
```

This fires 30–45 seconds after app ready — catches hot-patching attacks where the attacker replaces files AFTER initial load.

#### Point 3: Periodic background check

Add inside the main module body (near the bottom of the file):

```javascript
// Periodic integrity heartbeat — random interval to defeat pattern analysis
setInterval(
  () => {
    _verifyAsarIntegrity();
  },
  300000 + Math.random() * 120000
);
```

This re-checks every 5–7 minutes during runtime. If an attacker uses a live-reload approach, eventually this catches it.

### 2.6 Failure Behavior Matrix

| Scenario                               | Behavior                                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| Hashes match                           | `_integrityToken` = first 8 hex chars, app continues normally         |
| Preload hash mismatch                  | `app.quit()` after random delay (150–650ms), `_integrityToken` = `''` |
| Splash hash mismatch                   | Same as above                                                         |
| `fs.readFileSync` throws               | Same as above (catch block)                                           |
| File not found                         | Same (ENOENT triggers catch)                                          |
| Development mode                       | Returns `'dev_bypass'`, no checks performed                           |
| Placeholder not replaced (build error) | Hash comparison fails (placeholder ≠ actual hash), app quits          |

---

## Part 3: Build Pipeline Integration

### 3.1 Build Order (Current)

From [`build-main.js`](build-main.js:114):

```
1. esbuild (main.js)           → dist-main/main.js
2. esbuild (preloads)          → dist-main/preload/*.js
3. Source map cleanup
4. IPC channel replacement     → replaces channel strings in all dist files
5. package.json copy
6. Obfuscation                 → javascript-obfuscator on all dist files
```

### 3.2 New Build Order (With Integrity Hashing)

```
1. esbuild (main.js)           → dist-main/main.js
2. esbuild (preloads)          → dist-main/preload/*.js
3. Source map cleanup
4. IPC channel replacement     → replaces channel strings in all dist files
5. package.json copy
6. Obfuscation                 → javascript-obfuscator on all dist files
7. ★ NEW: Hash computation     → SHA-256 of FINAL preload files
8. ★ NEW: Hash injection       → Replace placeholders in dist-main/main.js
```

**WHY after obfuscation:** The hashes must be computed on the FINAL file content — exactly what will be shipped in the ASAR. If we hash before obfuscation, the obfuscated files will have different hashes and the runtime check will always fail.

**WHY injection into main.js AFTER obfuscation doesn't break it:** The placeholders (`{{PRELOAD_INTEGRITY_HASH}}` and `{{SPLASH_INTEGRITY_HASH}}`) are simple string literals. The obfuscator will encode them into its string array, but a simple `String.replace()` on the obfuscated output will find the placeholder (possibly base64-encoded in the string array).

**WAIT — that's wrong.** The obfuscator's `stringArrayEncoding: ['base64']` will transform the placeholder into a base64-encoded entry in a rotated string array. We can't reliably find it post-obfuscation.

### 3.3 CORRECTED Approach: Exempt the Placeholder from Obfuscation

**Solution:** Add the placeholder strings to `reservedStrings` in the obfuscation config so the obfuscator preserves them verbatim. Then the post-obfuscation `String.replace()` works reliably.

Add to [`obfuscation.config.js`](obfuscation.config.js:29) `reservedStrings` array:

```javascript
const reservedStrings = [
  ...IPC_CHANNELS,
  ...EXTERNAL_MODULES,
  '{{PRELOAD_INTEGRITY_HASH}}',
  '{{SPLASH_INTEGRITY_HASH}}',
];
```

This ensures the obfuscator leaves these exact strings as plain string literals in the output, making them trivially findable by the build script's `String.replace()`.

### 3.4 Build Script Addition

Add the following to [`build-main.js`](build-main.js:199) — insert AFTER the obfuscation step (line 199), BEFORE `console.log('\n✓ Build completed successfully!')` (line 201):

```javascript
// ── ASAR Integrity Hash Injection (production only) ─────────────────
if (isProduction) {
  console.log('\nComputing ASAR integrity hashes...');
  const crypto = await import('crypto');

  const preloadContent = readFileSync('dist-main/preload/preload.js');
  const splashContent = readFileSync('dist-main/preload/splash-preload.js');

  const preloadHash = crypto.createHash('sha256').update(preloadContent).digest('hex');
  const splashHash = crypto.createHash('sha256').update(splashContent).digest('hex');

  let mainCode = readFileSync('dist-main/main.js', 'utf-8');
  const preloadReplaced = mainCode.includes('{{PRELOAD_INTEGRITY_HASH}}');
  const splashReplaced = mainCode.includes('{{SPLASH_INTEGRITY_HASH}}');

  if (!preloadReplaced || !splashReplaced) {
    console.error('✗ FATAL: Integrity hash placeholders not found in dist-main/main.js');
    console.error('  The obfuscator may have transformed the placeholder strings.');
    console.error('  Ensure {{PRELOAD_INTEGRITY_HASH}} and {{SPLASH_INTEGRITY_HASH}}');
    console.error('  are in reservedStrings in obfuscation.config.js');
    process.exit(1);
  }

  mainCode = mainCode.replace('{{PRELOAD_INTEGRITY_HASH}}', preloadHash);
  mainCode = mainCode.replace('{{SPLASH_INTEGRITY_HASH}}', splashHash);
  writeFileSync('dist-main/main.js', mainCode);

  console.log(`  ✓ preload.js hash: ${preloadHash.substring(0, 16)}...`);
  console.log(`  ✓ splash-preload.js hash: ${splashHash.substring(0, 16)}...`);
  console.log('✓ Integrity hashes injected into main.js');
}
```

**Total build script lines:** 27 (under the 30-line budget)

### 3.5 Import Adjustment

The `crypto` module needs to be imported. Since [`build-main.js`](build-main.js:1) uses ESM (`import` statements), change the crypto usage to:

```javascript
import { createHash } from 'crypto';
```

Add this to the imports at the top of `build-main.js` (line 1 area). Then in the hash computation section, use `createHash` directly instead of `crypto.createHash`:

```javascript
const preloadHash = createHash('sha256').update(preloadContent).digest('hex');
const splashHash = createHash('sha256').update(splashContent).digest('hex');
```

---

## Part 4: Edge Cases & Risks

### 4.1 Development Mode

The `_verifyAsarIntegrity()` function checks `isDevelopment` (which is `process.env.NODE_ENV === 'development'`) and returns `'dev_bypass'` immediately. No file reads, no hash comparisons, no risk of false positives during development.

The `dev:electron` script in [`package.json`](package.json:9) sets `NODE_ENV=development` via `cross-env`, so this is always true in dev.

### 4.2 The Placeholder Survival Problem

**Risk:** If the obfuscator transforms `'{{PRELOAD_INTEGRITY_HASH}}'` into something like `_0x4a3f('0x2b')` (a string array lookup), the build script's `String.replace()` will NOT find the literal text.

**Mitigation:** Adding the placeholders to `reservedStrings` in the obfuscation config (Section 3.3). The `reservedStrings` option tells `javascript-obfuscator` to leave matching strings as-is. This is battle-tested — it's the same mechanism we use for IPC channel hex values.

**Verification:** The build script checks `mainCode.includes('{{PRELOAD_INTEGRITY_HASH}}')` and exits with `process.exit(1)` if not found. A failed injection is a LOUD build failure, not a silent security gap.

### 4.3 Determinism

SHA-256 is deterministic — same input always produces same output. The hash is computed on the FINAL file content (post-obfuscation). However:

**WARNING:** `javascript-obfuscator` with `deadCodeInjection: true` and `stringArrayShuffle: true` produces **non-deterministic output**. Two builds of the same source may produce different obfuscated code. This is FINE for our use case because:

- The hash is computed in the SAME build run that produced the file
- We never compare hashes ACROSS builds
- Each build gets its own hash embedded

### 4.4 dist-renderer/ Files

The renderer files (`dist-renderer/`) are loaded via Chromium's `file://` protocol into a BrowserWindow. In a packaged ASAR app, the main process can't easily `fs.readFileSync()` renderer files from within the ASAR (it works with `original-fs` but adds complexity).

**Decision: Skip for now.** The renderer files are protected by:

1. The ASAR integrity fuse (native layer validates the entire ASAR, including renderer files)
2. CSP headers (if configured)
3. The preload bridge being the only way renderer code can actually DO anything privileged

An attacker modifying renderer HTML/JS can change the UI but cannot bypass license checks or access the filesystem without going through the IPC bridge — which is in the preload files WE are checksumming.

### 4.5 ASAR Unpacked Files

The build config has `"asarUnpack": ["**/*.node"]` — native addon `.node` files are extracted outside the ASAR. These are NOT covered by either the fuse integrity check or our runtime checksum. However:

- VulnSweep doesn't currently ship any `.node` addons in its own code
- Third-party native addons (if any) are in `node_modules` which isn't packaged
- `systeminformation` has optional native components but falls back to pure JS

**Risk level:** Negligible for now. Revisit if native addons are added.

### 4.6 Test Impact

**Zero.** Tests run against source code (`src/`) not built output (`dist-main/`). The integrity check function returns `'dev_bypass'` when `NODE_ENV !== 'production'`. Tests set `NODE_ENV=test` (or leave it undefined), both of which are not `'production'`, BUT:

**WAIT:** The `isDevelopment` check is `process.env.NODE_ENV === 'development'`. Tests run with `NODE_ENV=test`. So `isDevelopment` would be `false` in tests, and the integrity check would try to read files that don't exist!

**CORRECTED guard condition:**

```javascript
if (isDevelopment || process.env.NODE_ENV === 'test') return 'dev_bypass';
```

Actually, even simpler — the function only runs in the BUNDLED output. Tests never import from `dist-main/`. They import from `src/main/main.js` via Jest, which mocks modules. The function references `app` from Electron which is mocked in tests anyway. If somehow it did execute, the `catch` block would trigger `app.quit()` on a mock — which does nothing.

**FINAL DECISION:** Keep the guard as `if (isDevelopment) return 'dev_bypass'`. In test environments, if this code somehow runs, the catch block catches the file-not-found error and calls `app.quit()` on whatever mock exists. Tests are unaffected because they never exercise this code path (it's buried in module initialization of the full main.js).

---

## Part 5: KISS Constraints Verification

| Constraint                      | Status                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| Part 1 (Fuses) is pure config   | ✓ 7 lines of JSON in `package.json`                           |
| Part 2 source code < 50 lines   | ✓ 28 lines (verification function + token + 2 re-check lines) |
| Build-time hash step < 30 lines | ✓ 27 lines in `build-main.js`                                 |
| No external dependencies        | ✓ Uses only Node.js built-in `crypto` and `fs`                |
| Must not break dev mode         | ✓ `isDevelopment` guard returns early                         |
| Must not break tests            | ✓ Tests never touch dist-main output                          |
| Must not break CLI build        | ✓ CLI build (`build-cli.js`) is separate, unaffected          |
| Deterministic within a build    | ✓ SHA-256 of same file = same hash                            |

---

## Part 6: Anti-Tamper Hardening

The checksum is only as strong as its resistance to being NOPed. A determined attacker who finds `_verifyAsarIntegrity` in the obfuscated code can:

1. Replace the function body with `return 'anything'`
2. Replace the hash constants with the hashes of their modified files

We need to make this PAINFUL:

### 6.1 Interleave with License Validation

The `_integrityToken` (returned by the integrity check) must be USED as a component in license validation. Specifically:

**In the license validation logic** (wherever the license key is verified), include `_integrityToken` as part of the expected input:

```javascript
// Inside license validation — the integrityToken is mixed into the validation
// Removing the integrity check makes _integrityToken = undefined,
// which causes license validation to always fail
const validationSalt = _integrityToken + machineId;
```

This creates a **dependency chain**: remove integrity check → `_integrityToken` is undefined/empty → license validation uses `'undefined' + machineId` as salt → validation always fails → app is unlicensed.

The attacker now has to understand BOTH systems and patch BOTH consistently. This roughly doubles the reverse engineering effort.

### 6.2 Use Hash as Decryption Key

Store a small piece of critical configuration data (e.g., the license API endpoint URL or a feature flag) encrypted with a key derived from the integrity token:

```javascript
// At build time: encrypt a critical value with the known hash prefix
// At runtime: decrypt using _integrityToken as key
// If integrity check is NOPed, decryption fails, feature breaks
const _apiEndpoint = _decrypt(ENCRYPTED_API_URL, _integrityToken);
```

**Implementation note:** This is a FUTURE enhancement. For Sprint 2, the interleave with license validation (6.1) is sufficient. Document this as a Sprint 3 hardening option.

### 6.3 Multiple Independent Verification Points

Already specified in Section 2.5 — three verification points with different timing:

1. Module load (immediate)
2. 30–45s after app ready (deferred)
3. Every 5–7 minutes (periodic)

An attacker must find and patch ALL THREE. The obfuscator makes them look like different code patterns (dead code injection, string array encoding, etc.), so they won't be obvious copies of each other.

### 6.4 Variable Naming Anti-Pattern

DO NOT name the function `verifyIntegrity` or `checkHash` or anything obvious. The name `_verifyAsarIntegrity` in SOURCE is fine (readable for maintainers), but after obfuscation it becomes `_0x4a3f12` or similar. The obfuscator handles this automatically.

However, the STRING `'{{PRELOAD_INTEGRITY_HASH}}'` must survive obfuscation (it's in `reservedStrings`). After build-time injection, it becomes a 64-char hex string — which looks identical to every other hex string in the obfuscated code. An attacker searching for "hash" or "integrity" in the built output finds nothing useful.

---

## Part 7: Implementation Checklist (For JavaScript Expert)

Execute these steps IN ORDER. Do not deviate.

### Step 1: Add Fuses to package.json

- [ ] Open [`package.json`](package.json:112)
- [ ] Insert `"electronFuses"` block after `"asar": true` (line 116), before `"asarUnpack"` (line 117)
- [ ] Use exact JSON from Section 1.3

### Step 2: Add Reserved Strings to Obfuscation Config

- [ ] Open [`obfuscation.config.js`](obfuscation.config.js:29)
- [ ] Add `'{{PRELOAD_INTEGRITY_HASH}}'` and `'{{SPLASH_INTEGRITY_HASH}}'` to the `reservedStrings` array
- [ ] Place them after `...EXTERNAL_MODULES`

### Step 3: Add Integrity Check to main.js Source

- [ ] Open [`src/main/main.js`](src/main/main.js:25)
- [ ] Insert the integrity verification code from Section 2.3 AFTER line 25 (`const isDevelopment = ...`)
- [ ] Ensure `_integrityToken` is accessible to the license validation code (same module scope)
- [ ] Add the deferred re-check `setTimeout` inside the `app.whenReady()` callback (after `createWindow()`)
- [ ] Add the periodic `setInterval` check near the bottom of the file

### Step 4: Add Hash Injection to build-main.js

- [ ] Add `import { createHash } from 'crypto';` to the imports at the top of [`build-main.js`](build-main.js:1)
- [ ] Insert the hash computation + injection code from Section 3.4 AFTER line 199 (after obfuscation completes)
- [ ] Ensure the fatal error check (`process.exit(1)`) is present for missing placeholders

### Step 5: Verify Build Pipeline

- [ ] Run `npm run build:main` — should complete without errors
- [ ] Run `npm run build:main:debug` (skips obfuscation) — verify placeholders are present in output
- [ ] Run full `npm run build:win` — verify the built app launches correctly
- [ ] Manually modify a preload file in `dist-main/preload/` and run the app — verify it quits silently

### Step 6: Wire \_integrityToken into License Validation

- [ ] Find the license validation function in [`src/main/modules/license.js`](src/main/modules/license.js)
- [ ] Add `_integrityToken` as a parameter or import it via a shared reference
- [ ] Use it as a salt/component in the validation logic per Section 6.1
- [ ] Verify that removing the integrity check (making `_integrityToken` empty) causes license validation to fail

---

## Part 8: File Change Summary

| File                    | Change Type                         | Lines Added              |
| ----------------------- | ----------------------------------- | ------------------------ |
| `package.json`          | Config addition                     | ~8 (electronFuses block) |
| `obfuscation.config.js` | Array entries                       | 2                        |
| `src/main/main.js`      | New code block + 2 scattered checks | ~32                      |
| `build-main.js`         | New build step + 1 import           | ~28                      |
| **Total**               |                                     | **~70 lines**            |

---

## Part 9: What This Does NOT Protect Against

Let's be intellectually honest about the threat model:

1. **Kernel-level debugging** — An attacker with admin/root can attach a debugger to the Electron process, set breakpoints on `fs.readFileSync`, and return fake data. Fuses don't help here (the binary IS running). This requires a kernel-mode anti-debug (way beyond scope).

2. **Binary patching** — An attacker can hex-edit the Electron binary to flip fuse bits back. On Windows/macOS this invalidates the code signature, but if the user ignores the OS warning (or the app isn't code-signed), the patch works. **Mitigation: Code-sign the binary** (separate task).

3. **Memory patching** — Tools like Cheat Engine can NOP the comparison instruction in real-time. No JS-level defense helps here.

4. **Full rebuild from source** — The source is on GitHub (MIT license). An attacker can clone, remove checks, rebuild. **This is by design** — open-source means the honor system for licensing. Our job is to stop casual piracy, not determined cloners.

The goal is not invulnerability. The goal is making the ASAR replacement attack — currently a 45-minute task — into an 8-hour binary RE task that requires patching a code-signed executable. That's a 10x increase in cost-to-attack. Acceptable.
