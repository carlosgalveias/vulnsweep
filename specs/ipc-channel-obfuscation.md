# IPC Channel Obfuscation — Implementation Specification

**Author:** Code Pathologist (Team Lead)  
**Date:** 2026-06-24  
**Target Implementer:** JavaScript Expert  
**Priority:** High (Security Hardening — Sprint 2)

---

## 1. Architecture Decision: Build-Time String Replacement

**Approach:** Post-build find-and-replace on the `dist-main/` output files, executed AFTER esbuild bundling but BEFORE `javascript-obfuscator` runs.

**Rationale (why NOT source-code refactoring):**

| Criteria              | Build-Time Replace                        | Shared Constants File                |
| --------------------- | ----------------------------------------- | ------------------------------------ |
| Source readability    | Preserved — devs see `'activate-license'` | Destroyed — devs see `IPC.CH_0x7F3A` |
| Risk of breakage      | Isolated to build step                    | Touches 3 files, 88+ occurrences     |
| Rollback complexity   | Delete one function                       | Revert entire refactor               |
| Test impact           | Zero — tests never touch dist             | Possible import path issues          |
| Lines of code changed | ~60 (all in `build-main.js`)              | ~200+ across source                  |

**Security trade-off:** A determined reverse engineer with a debugger could still intercept IPC calls at runtime regardless of string obfuscation. However, this raises the bar from "open bundle in notepad, search `activate-license`" to "attach debugger, hook `ipcMain.handle`, dump arguments." That's the difference between a script-kiddy and someone who actually has to work for it. Good enough.

---

## 2. The IPC Channel Map

The following mapping is **deterministic and permanent**. Values are chosen to resemble 32-bit memory addresses (plausible vtable pointers) to mislead anyone scanning the binary for patterns.

Create file: **`ipc-channel-map.js`** at project root.

```javascript
/**
 * IPC Channel Obfuscation Map
 *
 * Maps human-readable IPC channel names to opaque hex identifiers.
 * Used ONLY by the build pipeline (build-main.js) for post-bundle string replacement.
 *
 * WARNING: These values are baked into production builds. Changing a value
 * after release will break IPC communication between mismatched main/preload versions.
 * NEVER change existing mappings — only ADD new ones.
 */
export const IPC_CHANNEL_MAP = {
  // Request-Response channels (ipcMain.handle / ipcRenderer.invoke)
  'select-folder': '0x7A3F1D8E',
  'discover-projects': '0x4E2C9B71',
  'prepare-repository': '0xB8D14A63',
  'commit-and-push': '0x1F6E3C92',
  'analyze-project': '0xA5D087B4',
  'analyze-projects': '0x63F2E1A9',
  'scan-project': '0xD9174B5C',
  'scan-projects': '0x82A6F3DE',
  'scan:cancel': '0x3C8B21F7',
  'get-scan-settings': '0xE7490DA6',
  'apply-fixes': '0x5B1C8E4F',
  'scan-dep-updates': '0x9F6A72D1',
  'apply-dep-updates': '0x2D8E4B96',
  'license:scan': '0xC4F31A7E',
  'sbom:get-save-path': '0x16D9E5B3',
  'sbom:export': '0x8A2F6C41',
  'increment-trial-fix': '0xF1B73D28',
  'get-trial-status': '0x47E9A1C5',
  'set-analytics-opt-out': '0xBC5D2F84',
  'get-analytics-opt-out': '0x6A1E8D37',
  'credentials:set': '0xD3F4916B',
  'credentials:delete': '0x29C7E5A0',
  'credentials:getStatus': '0x9E3B18D4',
  'settings:get': '0x51A4F7C2',
  'settings:set': '0x0D6B9238',
  'get-commercial-status': '0xE82A4F1D',
  'activate-license': '0x74C6D3B9',
  'get-install-info': '0x3F917E4A',
  'get-active-price': '0xAB5D21C8',
  'open-payment-window': '0x68E4B7F3',
  'verify-and-activate': '0x1C9F5A2E',
  'seed-dev-transaction': '0xB42D81F6',
  'get-app-version': '0x5E7C3A94',
  'open-local-doc': '0xC18F6D27',
  'license-backup': '0x93A2E4B1',
  'license-restore': '0x2F8D17C6',
  'cache:getStats': '0xDA64B92E',
  'cache:clear': '0x461F8A5D',
  'get-dependency-paths': '0xF7C23E19',

  // Push-event channels (webContents.send / ipcRenderer.on)
  'log-message': '0x85B6D4A3',
  'splash:data': '0x3A19F7CE',
  'analysis-progress': '0xEC4D2187',
  'scan-progress': '0x7182AF5B',
  'dep-update-progress': '0x0B9E63D4',
};
```

---

## 3. Exact File Changes Required

### Files to CREATE:

| File                 | Purpose                          |
| -------------------- | -------------------------------- |
| `ipc-channel-map.js` | Static hex mapping (shown above) |

### Files to MODIFY:

| File                    | Change                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| `build-main.js`         | Add `replaceIpcChannels()` function; call it after esbuild, before obfuscator |
| `obfuscation.config.js` | Replace `IPC_CHANNELS` array contents with hex values                         |

### Files NOT touched:

- `src/main/main.js` — remains human-readable
- `src/preload/preload.js` — remains human-readable
- `src/preload/splash-preload.js` — remains human-readable
- All test files — unaffected
- CLI build — unaffected

---

## 4. Build Script Integration (`build-main.js`)

### 4.1 Add Import

At line 6 of `build-main.js`, add after the existing imports:

```javascript
import { IPC_CHANNEL_MAP } from './ipc-channel-map.js';
```

### 4.2 Add the Replacement Function

Insert the following function AFTER the existing `obfuscateFile()` function (after line 67):

```javascript
/**
 * Replaces human-readable IPC channel strings with opaque hex identifiers
 * in the specified built file. Operates on dist-main/ output only.
 *
 * Strategy: Match each channel name as a COMPLETE string literal (both quote styles).
 * The regex ensures we never partially match a longer string.
 *
 * @param {string} filePath - Path to the bundled JS file
 * @returns {{ replacements: number, channels: string[] }} Replacement stats
 */
function replaceIpcChannels(filePath) {
  let code = readFileSync(filePath, 'utf-8');
  let totalReplacements = 0;
  const replacedChannels = [];

  // Sort by length descending to prevent prefix-of-another issues
  // e.g., 'scan-projects' must be replaced before 'scan-project'
  const sortedEntries = Object.entries(IPC_CHANNEL_MAP).sort((a, b) => b[0].length - a[0].length);

  for (const [channel, hex] of sortedEntries) {
    // Escape any regex special chars in channel name (defensive)
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match the channel as a complete string literal with either quote style
    // This matches: "channel-name" or 'channel-name' as full string values
    const regex = new RegExp(`(['"])${escaped}\\1`, 'g');

    const before = code;
    code = code.replace(regex, (match, quote) => `${quote}${hex}${quote}`);

    const count = before.length - code.length === 0 ? 0 : (before.match(regex) || []).length;

    if (count > 0) {
      totalReplacements += count;
      replacedChannels.push(`${channel} → ${hex} (×${count})`);
    }
  }

  writeFileSync(filePath, code);
  return { replacements: totalReplacements, channels: replacedChannels };
}
```

### 4.3 Insert the Replacement Step in the `build()` Function

Insert AFTER the source map removal block (after line 96) and BEFORE the package.json copy (line 98). The new block:

```javascript
// ── IPC Channel Obfuscation (production only) ──────────────────────
if (isProduction) {
  console.log('\nObfuscating IPC channel identifiers...');
  const targets = [
    'dist-main/main.js',
    'dist-main/preload/preload.js',
    'dist-main/preload/splash-preload.js',
  ];

  let grandTotal = 0;
  for (const target of targets) {
    const { replacements, channels } = replaceIpcChannels(target);
    grandTotal += replacements;
    console.log(`  ✓ ${target}: ${replacements} replacements`);
    if (process.env.VERBOSE_BUILD) {
      channels.forEach((c) => console.log(`      ${c}`));
    }
  }

  // Sanity check: we expect at least 44 replacements across main + preload
  // (each channel appears in at least main.js AND one preload file)
  if (grandTotal < 44) {
    console.error(`\n✗ FATAL: Only ${grandTotal} IPC replacements made (expected ≥44).`);
    console.error('  This means some channels were not found in the build output.');
    console.error(
      '  Possible causes: channel name typo, esbuild tree-shook it, or quote style issue.'
    );
    process.exit(1);
  }

  console.log(`✓ IPC obfuscation complete (${grandTotal} total replacements)`);
}
```

### 4.4 Complete Modified Build Flow

The final execution order inside `build()` becomes:

```
1. mkdirSync (create output dirs)
2. esbuild main process        → dist-main/main.js
3. esbuild preload scripts     → dist-main/preload/*.js
4. Remove stale source maps    (production only)
5. ★ IPC channel replacement   (production only) ← NEW
6. Copy minimal package.json
7. javascript-obfuscator       (production only, unless SKIP_OBFUSCATION)
```

---

## 5. Obfuscation Config Update (`obfuscation.config.js`)

The `IPC_CHANNELS` array currently tells `javascript-obfuscator` to PRESERVE these strings. Since the strings are now hex values in the dist output, the reserved list must reference the hex values instead.

### 5.1 Replace the `IPC_CHANNELS` Array

Replace lines 14–60 of `obfuscation.config.js` with:

```javascript
// ============================================
// IPC CHANNEL IDENTIFIERS — obfuscated hex values from ipc-channel-map.js
// These MUST be preserved verbatim for Electron IPC to function.
// The human-readable names have already been replaced in a prior build step.
// ============================================
import { IPC_CHANNEL_MAP } from './ipc-channel-map.js';

const IPC_CHANNELS = Object.values(IPC_CHANNEL_MAP);
```

This is dynamic — if you add a new channel to `ipc-channel-map.js`, it automatically gets preserved by the obfuscator. No dual maintenance.

### 5.2 Alternative (If Import Causes Issues)

If ESM import ordering creates a circular dependency issue with the build script (unlikely, but defensive), use a static array instead:

```javascript
const IPC_CHANNELS = [
  '0x7A3F1D8E',
  '0x4E2C9B71',
  '0xB8D14A63',
  '0x1F6E3C92',
  '0xA5D087B4',
  '0x63F2E1A9',
  '0xD9174B5C',
  '0x82A6F3DE',
  '0x3C8B21F7',
  '0xE7490DA6',
  '0x5B1C8E4F',
  '0x9F6A72D1',
  '0x2D8E4B96',
  '0xC4F31A7E',
  '0x16D9E5B3',
  '0x8A2F6C41',
  '0xF1B73D28',
  '0x47E9A1C5',
  '0xBC5D2F84',
  '0x6A1E8D37',
  '0xD3F4916B',
  '0x29C7E5A0',
  '0x9E3B18D4',
  '0x51A4F7C2',
  '0x0D6B9238',
  '0xE82A4F1D',
  '0x74C6D3B9',
  '0x3F917E4A',
  '0xAB5D21C8',
  '0x68E4B7F3',
  '0x1C9F5A2E',
  '0xB42D81F6',
  '0x5E7C3A94',
  '0xC18F6D27',
  '0x93A2E4B1',
  '0x2F8D17C6',
  '0xDA64B92E',
  '0x461F8A5D',
  '0xF7C23E19',
  '0x85B6D4A3',
  '0x3A19F7CE',
  '0xEC4D2187',
  '0x7182AF5B',
  '0x0B9E63D4',
];
```

**Prefer option 5.1** (dynamic import). Only fall back to 5.2 if there's a concrete issue.

---

## 6. Validation — Post-Build Verification

### 6.1 Inline Validation (Already in Section 4.3)

The build script already aborts if fewer than 44 replacements are made. This catches regressions immediately.

### 6.2 Optional: Verbose Verification Script

Add a `scripts/verify-ipc-obfuscation.js` file that can be run manually or in CI:

```javascript
/**
 * Post-build verification: ensures NO human-readable IPC channel names
 * remain in the production dist-main/ output.
 *
 * Usage: node scripts/verify-ipc-obfuscation.js
 * Exit code 0 = clean, 1 = leaked channel names found
 */
import { readFileSync } from 'fs';
import { IPC_CHANNEL_MAP } from '../ipc-channel-map.js';

const FILES_TO_CHECK = [
  'dist-main/main.js',
  'dist-main/preload/preload.js',
  'dist-main/preload/splash-preload.js',
];

const channels = Object.keys(IPC_CHANNEL_MAP);
let leaked = false;

for (const file of FILES_TO_CHECK) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    console.error(`[SKIP] ${file} not found (run production build first)`);
    continue;
  }

  for (const channel of channels) {
    // Check for the channel as a complete string literal
    const singleQuote = `'${channel}'`;
    const doubleQuote = `"${channel}"`;

    if (content.includes(singleQuote) || content.includes(doubleQuote)) {
      console.error(`[LEAK] "${channel}" found in ${file}`);
      leaked = true;
    }
  }

  // Also verify hex values ARE present
  const hexValues = Object.values(IPC_CHANNEL_MAP);
  let hexFound = 0;
  for (const hex of hexValues) {
    if (content.includes(hex)) hexFound++;
  }
  console.log(`[OK] ${file}: ${hexFound}/${hexValues.length} hex channels present`);
}

if (leaked) {
  console.error('\n✗ VERIFICATION FAILED: Human-readable IPC channels leaked into build output.');
  process.exit(1);
} else {
  console.log('\n✓ All IPC channels successfully obfuscated.');
  process.exit(0);
}
```

---

## 7. Edge Cases & Risks

### 7.1 Prefix Collision: `scan-project` vs `scan-projects`

**Risk:** Naive `string.replace('scan-project', ...)` would corrupt `'scan-projects'` into `'0xD9174B5Cs'`.

**Mitigation:** The replacement function sorts entries by channel name length DESCENDING. Longer names are replaced first. Additionally, the regex matches the COMPLETE string literal including closing quote, so `'scan-project'` (with closing quote after `t`) cannot match inside `'scan-projects'` (where `s` follows `t` before the quote).

**Verdict:** Double-protected. Not a risk.

### 7.2 Channel Names in Log Strings

**Risk:** Strings like `'[IPC] select-folder error:'` contain the channel name as a substring.

**Mitigation:** The regex `(['"])select-folder\1` requires the channel to be the ENTIRE content between quotes. A string like `'[IPC] select-folder error:'` does NOT match because there's extra text before and after the channel name within the quotes.

**Verdict:** Safe. Log strings remain untouched (and get separately mangled by `javascript-obfuscator`'s `stringArray` transform anyway).

### 7.3 Template Literals

**Risk:** If esbuild converts strings to template literals (backticks), the regex won't match.

**Mitigation:** esbuild does NOT convert regular strings to template literals during bundling. It only uses template literals if the source already has them. All IPC channel usages in the source are plain string literals (`'channel-name'`). Furthermore, esbuild's minifier prefers regular quotes over template literals (they're shorter when no interpolation is used).

**Verdict:** Not a risk with current source code. If someone adds a template literal IPC call in the future, the build will fail with <44 replacements and alert the developer.

### 7.4 Comments Containing Channel Names

**Risk:** The source has comments like `// Wire this into the scan:cancel IPC handler`.

**Mitigation:** esbuild strips ALL comments during bundling (both in production with `minify: true` and with `minifySyntax`). The replacement runs on the post-esbuild output where no comments exist.

**Verdict:** Not a risk.

### 7.5 Dynamic Channel Construction

**Risk:** If any code builds a channel name dynamically (e.g., `` `scan-${type}` ``), the replacement won't catch it.

**Mitigation:** Searched entire codebase — all 44 channels use static string literals. No dynamic construction exists. The build-time sanity check (≥44 replacements) would catch missing channels if dynamic construction were ever introduced.

**Verdict:** Not a current risk. Future regression is caught by the build guard.

### 7.6 ASAR Signature / Determinism

**Risk:** If hex values were random per build, consecutive builds would produce different binaries, breaking code signing delta updates and reproducible builds.

**Mitigation:** The hex map is a static file committed to git. Same input → same output, every time.

**Verdict:** Fully deterministic.

### 7.7 Hot-Reload / Development Builds

**Risk:** The replacement only runs when `isProduction === true`. Development builds (`NODE_ENV !== 'production'`) skip it entirely.

**Mitigation:** This is intentional. Dev builds use human-readable channel names for debugging. The preload and main process always agree because they're built from the same source and the replacement (or lack thereof) is applied uniformly to both.

**Verdict:** Working as designed.

### 7.8 `splash-preload.js` Has Only 1 Channel

**Risk:** `splash-preload.js` contains only `'splash:data'`. If somehow esbuild inlines or tree-shakes it differently, the replacement might not find it.

**Mitigation:** The splash preload is a standalone bundle (`entryPoints` includes it separately). It will always contain the literal `'splash:data'`. The per-file replacement count isn't asserted — only the grand total across all files.

**Verdict:** Safe.

---

## 8. Implementation Checklist (Execution Order)

The JavaScript Expert shall execute these steps in EXACTLY this order:

### Step 1: Create `ipc-channel-map.js`

- Location: project root (`g:/Work/mygit/vulnsweep/ipc-channel-map.js`)
- Content: exactly as specified in Section 2
- File type: ES module (uses `export`)

### Step 2: Modify `build-main.js`

1. Add import of `IPC_CHANNEL_MAP` (Section 4.1) — after line 6
2. Add `replaceIpcChannels()` function (Section 4.2) — after the `obfuscateFile()` function
3. Add the IPC replacement build step (Section 4.3) — inside `build()`, after source map removal, before package.json copy

### Step 3: Modify `obfuscation.config.js`

1. Add import of `IPC_CHANNEL_MAP` at the top of the file (after the comment header)
2. Replace the static `IPC_CHANNELS` array (lines 14–60) with: `const IPC_CHANNELS = Object.values(IPC_CHANNEL_MAP);`
3. Keep the `EXTERNAL_MODULES` array and everything below it unchanged

### Step 4: Create `scripts/verify-ipc-obfuscation.js`

- Content: exactly as specified in Section 6.2
- This is a standalone verification tool, not part of the build

### Step 5: Verify

Run: `$env:NODE_ENV='production'; node build-main.js`

Expected output should include:

```
Obfuscating IPC channel identifiers...
  ✓ dist-main/main.js: XX replacements
  ✓ dist-main/preload/preload.js: XX replacements
  ✓ dist-main/preload/splash-preload.js: 1 replacements
✓ IPC obfuscation complete (XX total replacements)
```

Then run: `node scripts/verify-ipc-obfuscation.js`

Expected: `✓ All IPC channels successfully obfuscated.`

---

## 9. What This Does NOT Do (Scope Boundaries)

- Does NOT rename the `window.electronAPI` method names (e.g., `selectFolder`, `getCommercialStatus`). Those are already mangled by `minifyIdentifiers` + `javascript-obfuscator`.
- Does NOT affect the CLI build (`build-cli.js`). The CLI has zero IPC usage.
- Does NOT modify any source files under `src/`.
- Does NOT require changes to the renderer React components.
- Does NOT require `package.json` dependency additions — uses only `fs` (Node built-in) and the existing `esbuild` output.

---

## 10. Summary of Deliverables

| #   | File                                | Action | Lines of Change       |
| --- | ----------------------------------- | ------ | --------------------- |
| 1   | `ipc-channel-map.js`                | CREATE | ~55                   |
| 2   | `build-main.js`                     | MODIFY | ~50 added             |
| 3   | `obfuscation.config.js`             | MODIFY | ~48 removed, ~5 added |
| 4   | `scripts/verify-ipc-obfuscation.js` | CREATE | ~45                   |

**Total implementation effort:** ~150 lines of code. Four files. One build step. Zero source-code refactoring. This is how professionals make things disappear.
