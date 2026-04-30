# VulnSweep v1.x — Post-Implementation Code Review

**Review Date**: 2026-04-30  
**Scope**: Full codebase review following completion of VERSION_1_PLAN.md  
**Status**: 6 findings requiring action before next release

---

## Summary

The v1.x refactor is largely successful. The modular audit architecture, `Result` pattern, registry cache, and hook decomposition are all solid work. Six issues were found — none require architectural changes. All are targeted fixes.

---

## Findings Overview

| #   | Severity | Title                                                            | File                                             | Line |
| --- | -------- | ---------------------------------------------------------------- | ------------------------------------------------ | ---- |
| 1   | HIGH     | DEBUG log left in production                                     | `src/renderer/hooks/useProjectDiscovery.js`      | 22   |
| 2   | MEDIUM   | Hardcoded commit message contradicts constants file              | `src/renderer/hooks/useGitOperations.js`         | 65   |
| 3   | MEDIUM   | Splash window uses JS string injection instead of IPC            | `src/main/main.js`                               | 118  |
| 4   | MEDIUM   | `npm install` runs unconditionally before every audit            | `src/main/modules/audit/index.js`                | 59   |
| 5   | HIGH     | Version bump is silent, undisclosed, and uses hand-rolled semver | `src/main/modules/audit/appliers/fix-applier.js` | 88   |
| 6   | LOW      | Backup file is never cleaned up after successful fix             | `src/main/modules/audit/appliers/fix-applier.js` | 79   |

---

## Finding 1 — DEBUG Log Left in Production Code

**Severity**: HIGH  
**File**: `src/renderer/hooks/useProjectDiscovery.js` — Line 22

### Problem

```js
addLog('info', `[DEBUG] Folder selection response: ${JSON.stringify(folder)}`);
```

A `[DEBUG]`-tagged log entry renders directly in the user-facing log console. This is the first log a user sees when selecting a folder. Phase 2 Task 2.2 ("Remove Production DEBUG Logs") was checked off as complete. It was not.

### Fix

Delete line 22. Nothing else required.

---

## Finding 2 — Hardcoded Commit Message Contradicts the Constants File

**Severity**: MEDIUM  
**Files**:

- `src/renderer/hooks/useGitOperations.js` — Line 65
- `src/main/config/constants.js` — Line 37

### Problem

The renderer hardcodes:

```js
message: 'fix(security): update vulnerable dependencies',
```

The constants file defines:

```js
DEFAULT_COMMIT_MESSAGE: 'chore(security): update vulnerable dependencies',
```

Two different conventional commit prefixes (`fix` vs `chore`). The git history will be inconsistent. Two sources of truth, zero consistency.

### Fix

1. Decide on one prefix. Security updates should be `fix` — it triggers patch releases in semantic versioning tools.
2. Create `src/renderer/constants.js`:
   ```js
   export const DEFAULT_COMMIT_MESSAGE = 'fix(security): update vulnerable dependencies';
   ```
3. Import and use it in `useGitOperations.js`.
4. Update `constants.js` `DEFAULT_COMMIT_MESSAGE` to match.

---

## Finding 3 — Splash Window Uses JS String Injection Instead of IPC

**Severity**: MEDIUM  
**File**: `src/main/main.js` — Line 118

### Problem

```js
splashWindow.webContents.executeJavaScript(`
    window.splashAPI = {
      version: '${appVersion}',
      appName: '${appName}'
    };
    ...
  `);
```

String interpolation directly into `executeJavaScript()`. The rest of the application correctly uses `contextBridge` + `ipcRenderer` for all communication. The splash window already has `splash-preload.js` loaded. Use it.

### Fix

**In `src/preload/splash-preload.js`**, add:

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('splashAPI', {
  onData: (cb) => ipcRenderer.on('splash:data', (_, data) => cb(data)),
});
```

**In `src/main/main.js`**, replace the `executeJavaScript` block with:

```js
splashWindow.webContents.on('did-finish-load', () => {
  splashWindow.webContents.send('splash:data', {
    version: app.getVersion(),
    appName: app.getName(),
  });
});
```

**In the splash HTML script**, consume it:

```js
window.splashAPI.onData(({ version }) => {
  const el = document.getElementById('version');
  if (el) el.textContent = `v${version}`;
});
```

---

## Finding 4 — `npm install` Runs Unconditionally Before Every Audit

**Severity**: MEDIUM
**File**: `src/main/modules/audit/index.js` — Line 59

### Problem

```js
// Step 1: Run npm install
const installResult = await runNpmInstall(projectPath);
```

Every project. Every scan. No check for whether `node_modules` exists or whether dependencies have changed. On 20 projects this is 20 sequential `npm install` calls. This directly undermines the performance benefit of the registry cache built in Phase 1.

### Why a simple existence check is NOT enough

A naive `node_modules` presence check would break the following scenario — which is the primary use case of this tool:

1. `git pull` runs (either via the "Allow Git Reset" flow or manually before scanning).
2. A teammate updated `package-lock.json` in the pulled commits.
3. `node_modules` exists on disk but is now **stale** — it reflects the old lockfile.
4. `npm audit` runs against stale `node_modules` and produces incorrect results.

Simply checking for `node_modules` existence would skip the install in step 3 and silently audit the wrong dependency tree.

### Correct Fix — Compare `package-lock.json` mtime against `node_modules` mtime

The correct heuristic is: **"is `node_modules` older than `package-lock.json`?"** If yes, the lockfile has changed since the last install and `npm install` must run. If no, `node_modules` is current and the install can be skipped. This is the same approach used by `make`, `tup`, and most build systems since the 1970s.

```js
// In src/main/modules/audit/index.js, replace the unconditional runNpmInstall call:

const fs = require('fs').promises;
const path = require('path');

async function isInstallRequired(projectPath) {
  const nodeModulesPath = path.join(projectPath, 'node_modules');
  const lockfilePath = path.join(projectPath, 'package-lock.json');

  try {
    const [nmStat, lockStat] = await Promise.all([fs.stat(nodeModulesPath), fs.stat(lockfilePath)]);
    // node_modules is stale if lockfile was modified after the last install
    return lockStat.mtimeMs > nmStat.mtimeMs;
  } catch {
    // node_modules or package-lock.json does not exist — install required
    return true;
  }
}

// Step 1: Run npm install only when node_modules is missing or stale
console.log('[audit] Step 1: Checking if npm install is required...');
const installRequired = await isInstallRequired(projectPath);

if (installRequired) {
  console.log('[audit] Step 1: node_modules missing or stale, running npm install...');
  const installResult = await runNpmInstall(projectPath);
  if (!installResult.success) {
    console.warn(`[audit] npm install had issues: ${installResult.error}`);
  }
} else {
  console.log('[audit] Step 1: node_modules is current, skipping npm install.');
}
```

### Edge case: no `package-lock.json`

If the project has no lockfile, `fs.stat(lockfilePath)` throws and `isInstallRequired` returns `true`, so `npm install` always runs — which is the correct and safe behaviour for unlocked projects.

### Note on the "Allow Git Reset" interaction

When `allowReset` is `true`, `git reset --hard` + `git pull` run before the audit (via `audit/index.js` Step 0). A `git pull` that updates `package-lock.json` will change its `mtime`, correctly triggering an install on the next `isInstallRequired` check. The mtime heuristic is therefore safe in the context of VulnSweep's existing git flow.

---

## Finding 5 — Version Bump Is Silent, Undisclosed, and Uses Hand-Rolled semver

**Severity**: HIGH  
**File**: `src/main/modules/audit/appliers/fix-applier.js` — Lines 25–100

### Problem A — Silent version bump with no user disclosure

```js
if (modifiedPackageJson.version) {
  const oldVersion = modifiedPackageJson.version;
  modifiedPackageJson.version = incrementPatchVersion(oldVersion);
  await fs.writeFile(packageJsonPath, JSON.stringify(modifiedPackageJson, null, 2));
}
```

After applying fixes, the tool silently increments the `version` field of every project's `package.json`. There is no UI disclosure, no user confirmation, and no mention in any modal. If the project is a published npm package, a versioned internal library, or uses the version field for CI/CD pipelines, this tool just changed it without asking.

This is either a feature or a bug — but in its current state it is an **undisclosed side effect** of clicking "Apply Selected Fixes."

### Problem B — Hand-rolled semver parser ignores pre-release identifiers

```js
function incrementPatchVersion(version) {
  const parts = version.split('.');
  if (parts.length !== 3) return version; // silently returns unchanged on any pre-release version
  const [major, minor, patch] = parts;
  const newPatch = parseInt(patch, 10) + 1;
  return `${major}.${minor}.${newPatch}`;
}
```

`semver` is already in the project's runtime dependencies. Using `string.split('.')` instead of it is not clever — it is lazy. `"1.0.0-alpha.1".split('.')` produces `["1","0","0-alpha","1"]` — four parts — so the guard fires, the function returns the version unchanged, and the version field is never bumped. This silently breaks the feature on any project using pre-release versioning.

### Fix

**Fix A — Disclose the version bump to the user.** Add a toggle in the `Header` component alongside the existing "Allow Git Reset" toggle:

```jsx
<label>
  <input
    type="checkbox"
    checked={bumpVersion}
    onChange={(e) => onBumpVersionChange(e.target.checked)}
  />
  Bump patch version on fix
</label>
```

Pass `bumpVersion` down to `applyFixes` and only call `incrementPatchVersion` when the toggle is enabled. Default it to `true` to preserve current behaviour, but make it visible.

**Fix B — Replace the hand-rolled parser with `semver`.** In `fix-applier.js`:

```js
const semver = require('semver'); // already a runtime dependency

// Replace incrementPatchVersion entirely:
const newVersion = semver.inc(oldVersion, 'patch');
if (newVersion) {
  modifiedPackageJson.version = newVersion;
  await fs.writeFile(packageJsonPath, JSON.stringify(modifiedPackageJson, null, 2));
  console.log(`[audit] Bumped project version from ${oldVersion} to ${newVersion}`);
} else {
  console.warn(`[audit] Could not bump version — '${oldVersion}' is not valid semver`);
}
```

The entire `incrementPatchVersion` function can be deleted.

---

## Finding 6 — Backup File Is Never Cleaned Up After a Successful Fix

**Severity**: LOW
**File**: `src/main/modules/audit/appliers/fix-applier.js` — Line 79

### Problem

```js
const backupPath = path.join(projectPath, 'package.json.backup');
await fs.writeFile(backupPath, JSON.stringify(currentPackageJson, null, 2));
```

`package.json.backup` is written before every fix operation. After a **successful** fix, it is never deleted. After a **failed** fix (restore path at line 106), it is also never deleted — the original content is restored to `package.json` but the `.backup` file remains on disk.

Run this tool on 20 projects and there are now 20 `package.json.backup` files polluting every repository. They will show up in `git status`, get accidentally committed, and confuse anyone who encounters them.

The backup strategy itself is correct. The cleanup is simply missing.

### Fix

After a successful `npm install`, delete the backup:

```js
// After successful install
try {
  await fs.unlink(backupPath);
  console.log('[audit] Removed package.json backup');
} catch (cleanupError) {
  console.warn(`[audit] Could not remove backup file: ${cleanupError.message}`);
}
```

After restoring from backup on failure, also delete the backup:

```js
// After restoring backup on failure
await fs.writeFile(packageJsonPath, JSON.stringify(currentPackageJson, null, 2));
try {
  await fs.unlink(backupPath);
} catch {
  /* best effort */
}
console.error('[audit] npm install failed, restored original package.json');
```

Also add `package.json.backup` to the project `.gitignore` as a safety net.

---

## Action Items

| Priority | Finding                                                    | Owner | Effort |
| -------- | ---------------------------------------------------------- | ----- | ------ |
| 1        | Delete debug log (`useProjectDiscovery.js:22`)             | Any   | 1 min  |
| 2        | Silent version bump — add user toggle + use `semver.inc()` | Dev   | 2h     |
| 3        | Align commit message constants                             | Dev   | 30 min |
| 4        | Splash window IPC refactor                                 | Dev   | 1h     |
| 5        | Conditional `npm install` check                            | Dev   | 30 min |
| 6        | Cleanup backup file after fix                              | Dev   | 30 min |

Total estimated effort: **~4.5 hours** to close all six findings.

---

_This review covers the state of the codebase as of 2026-04-30. All findings are scoped to correctness, consistency, and user-facing behaviour. No architectural changes are required._
