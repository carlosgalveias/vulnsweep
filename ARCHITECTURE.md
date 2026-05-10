# VulnSweep Architecture Documentation

This document provides a detailed technical overview of VulnSweep's architecture, design patterns, and implementation details.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Technology Stack](#technology-stack)
3. [Application Layers](#application-layers)
4. [Module Details](#module-details)
5. [Data Flow](#data-flow)
6. [State Management](#state-management)
7. [IPC Communication](#ipc-communication)
8. [Security Model](#security-model)
9. [Error Handling](#error-handling)
10. [Performance Considerations](#performance-considerations)
11. [Cross-Platform Storage](#cross-platform-storage)
12. [License and Date Control Files](#license-and-date-control-files)
13. [Build System and Packaging](#build-system-and-packaging)

## High-Level Architecture

VulnSweep follows Electron's multi-process architecture:

    +-------------------------------------------------------------+
    |                        Electron App                         |
    +-------------------------------------------------------------+
    |  +--------------------+         +----------------------+   |
    |  |   Main Process     |<--------|  Renderer Process    |   |
    |  |   (Node.js)        |  IPC    |  (Chromium/React)    |   |
    |  |                    |-------->|                      |   |
    |  +--------+-----------+         +----------+-----------+   |
    |           |                                |               |
    |  +--------+--------------------------------+----------+    |
    |  |         Preload Script (IPC Bridge)               |    |
    |  |      contextBridge.exposeInMainWorld()            |    |
    |  +----------------------------------------------------+    |
    +-------------------------------------------------------------+
    |                    Operating System APIs                    |
    |               (File System, Git, npm CLI)                   |
    +-------------------------------------------------------------+

## Technology Stack

### Frontend (Renderer Process)

- **React 18.2** — UI library with hooks-based architecture
- **Vite 5.0** — Build tool and development server
- **Tailwind CSS 3.4** — Utility-first CSS framework with custom compact utilities (v1.4.0+)
- **PostCSS** — CSS processing

**UI Design System (v1.4.0+)**:

- Compact desktop app aesthetic with 13px base font size
- Custom utility classes: `compact-cell`, `compact-header`, `compact-input`, `compact-btn`, `compact-text`, `compact-text-xs`
- Professional scrollbar styling for desktop environments
- Optimized for information-dense interfaces

### Backend (Main Process)

- **Electron 41.3** — Desktop application framework
- **Node.js** — JavaScript runtime
- **child_process** — CLI command execution
- **semver 7.6** — Semantic versioning library
- **secure-ls** — AES-encrypted file-backed key-value store (added in cross-platform migration)
- **sludge-crypt** — Asymmetric encryption for license payload binding
- **systeminformation** — Device identity for license anchoring

### Development

- **Concurrently** — Run multiple processes
- **wait-on** — Wait for resources before proceeding
- **cross-env** — Cross-platform environment variables
- **electron-builder** — Multi-platform packaging (Windows, macOS, Linux)

## Application Layers

### Layer 1: Renderer Process (UI Layer)

Located in `src/renderer/`, this layer handles all user interactions and visual presentation.

    src/renderer/
    +-- App.jsx                    # Root component, orchestrates workflows
    +-- main.jsx                   # React entry point
    +-- index.html                 # HTML shell
    +-- index.css                  # Global styles with compact utility classes
    +-- components/
    |   +-- Header.jsx             # Top navigation and controls
    |   +-- VulnerabilityGrid.jsx  # Data table with filtering/sorting
    |   +-- LogConsole.jsx         # Real-time log display
    |   +-- Modal.jsx              # Reusable confirmation dialog
    |   +-- Spinner.jsx            # Loading indicator component
    |   +-- Badge.jsx              # Severity/status/risk badge (v1.5.0+)
    |   +-- BuyModal.jsx           # Commercial purchase flow
    |   +-- StatisticsTab.jsx      # Scan statistics display
    |   +-- InfoTooltip.jsx        # Reusable tooltip component (v1.4.0+)
    |   +-- ErrorBoundary.jsx      # React error boundary
    +-- hooks/
        +-- useProjectDiscovery.js     # Project discovery state management
        +-- useVulnerabilityScanner.js # Vulnerability scanning logic
        +-- useFixApplication.js       # Fix application workflows
        +-- useGitOperations.js        # Git operations handling
        +-- useLogConsole.js           # Log console state management

**Key Responsibilities:** User interaction handling, state management (React hooks), data presentation, IPC communication initiation.

### Layer 2: Preload Script (Security Layer)

Located in `src/preload/preload.js`. Creates a secure bridge via `contextBridge.exposeInMainWorld()`.

**Key Responsibilities:** Security boundary enforcement, safe API exposure, IPC message routing, event listener management.

### Layer 3: Main Process (Backend Layer)

Located in `src/main/`, this layer handles all system operations and business logic.

    src/main/
    +-- main.js                 # Electron entry, window management, IPC handlers
    +-- config/
    |   +-- constants.js        # UI and PayPal configuration constants
    +-- modules/
    |   +-- discovery.js        # Project discovery logic
    |   +-- git.js              # Git operations wrapper
    |   +-- license.js          # License validation and activation
    |   +-- audit/              # npm audit analysis and fix strategies
    |       +-- index.js
    |       +-- parsers/        # Vulnerability output parsers
    |       +-- strategies/     # Fix strategy determination
    |       +-- commands/       # npm audit/install command wrappers
    |       +-- appliers/       # Fix application logic
    +-- utils/
        +-- secure-store.js     # Cross-platform encrypted key-value store
        +-- registry-cache.js   # npm registry response cache
        +-- result.js           # Result monad helper

**Key Responsibilities:** System resource access, CLI command execution (git, npm), business logic implementation, data processing.

## Module Details

### discovery.js

**Purpose**: Recursively discover Node.js projects in a directory tree.

**Key Functions**:

- `discoverProjects(basePath)` — Main entry point, returns Result object
- `isNodeProject(dir)` — Checks for package.json
- `getProjectName(packageJson)` — Extracts project name

### git.js

**Purpose**: Execute git operations on repositories.

**Operations**: `prepareRepository(path, allowReset)` (optional hard reset + pull), `commitAndPush(path, options)` (add + commit + push).

**Error Handling**: Captures stderr, returns structured Result objects, logs all command output.

### audit/ (index.js + sub-modules)

**Purpose**: Parse npm audit output and determine fix strategies.

**Fix Strategy Decision Tree**:

    For each vulnerability:
      Is it a direct dependency?
      +-- YES --> Scenario A: npm install package@fixedVersion   (Risk: semver diff)
      +-- NO
      +-- NO  --> Transient dependency
                  Can parent be updated?
                  +-- YES --> Scenario B: npm install parent@fixedVersion
                  +-- NO  --> Scenario C: Add overrides to package.json (Risk: LOW)

**Risk Assessment**: Major semver bump = HIGH; minor/patch = LOW.

### license.js

**Purpose**: License validation, activation, and install-date tracking for the commercial distribution.

| Function              | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| checkLicense()        | Validates device-bound license from store and .vsweep marker |
| activateLicense(data) | Generates and persists license after payment                 |
| generateLicense()     | Called after PayPal success URL detected                     |
| getInstallInfo()      | Returns promo pricing info based on install timestamp        |
| getPromoDefaults()    | Returns safe fallback object for IPC error paths             |

## Data Flow

1. **Select Folder** - select-folder IPC -> dialog -> path -> auto-triggers discover-projects
2. **Scan** - analyze-projects IPC -> npm audit per project -> parse -> strategies -> progress events
3. **Apply Fixes** - apply-fixes IPC -> npm install or package.json override per strategy
4. **Commit/Push** - prepare-repository (reset+pull) -> commit-and-push (add+commit+push)

## State Management

React hooks only (no Redux/MobX). Core state: selectedFolder, projects, vulnerabilities, selectedVulns (Set), logs, progress, isScanning, isApplying, isCommitting, allowReset, modalState.

**v1.6.0+ optimisations**: memo() on Badge/Spinner/InfoTooltip/Modal; useMemo on buttonsState; useCallback/useMemo on sort and selection in VulnerabilityGrid.

## IPC Communication

Active channels: select-folder, discover-projects, analyze-project, analyze-projects, apply-fixes, prepare-repository, commit-and-push, get-commercial-status, activate-license, get-install-info, open-payment-window.

All handlers return { success: true, content } or { success: false, error }. License handlers replace internal error messages with safe user-facing strings.

## Security Model

- contextIsolation: true, nodeIntegration: false, sandbox: true in all windows
- Only whitelisted APIs exposed via contextBridge
- User paths normalized via path.normalize + path.resolve before any file operations
- License/store IPC handlers catch all errors and return non-leaking fallbacks

## Error Handling

Main process: try/catch in every IPC handler. License handlers suppress err.message to prevent internal path or encryption details leaking.

Renderer: every IPC call checks result.success; failures are logged. ErrorBoundary catches uncaught React render errors.

## Performance Considerations

- Registry Cache (src/main/utils/registry-cache.js): caches npm registry responses per scan session
- React Optimizations: memo(), useCallback, useMemo at all significant boundaries (v1.6.0+)
- Dynamic Skeleton Rows: ResizeObserver drives skeleton count to match actual grid height (v1.6.0+)
- Sequential Audit: projects analysed sequentially to avoid overwhelming the npm process pool

---

## Cross-Platform Storage

> Added in the cross-platform migration (Phases 1 and 4).

### Module: src/main/utils/secure-store.js

**Purpose**: Cross-platform, AES-encrypted, persistent key-value store for the main process. Replaces the previous Windows-only REG.exe shell-call approach used in license.js.

**Technology**: secure-ls with AES encoding, backed by a JSON file (store.dat).

**Storage Location**:

| State                               | Path                          |
| ----------------------------------- | ----------------------------- |
| Normal (post app.ready)             | {Electron userData}/store.dat |
| Fallback (pre-ready / non-Electron) | ~/.vsweep-store/store.dat     |

A pre-warm call (storeGet('\_init')) is issued inside app.whenReady() in src/main/main.js to guarantee the store binds to the correct userData path before any license logic runs.

**Encryption Key Derivation**: SHA-256(first non-loopback MAC address), falling back to SHA-256('vs-fb-2024-xk') if no physical adapter is found. Derived once and cached in-process.

**Exported API** (all synchronous):

| Function             | Description                                          |
| -------------------- | ---------------------------------------------------- |
| storeGet(key)        | Returns decrypted value or null if absent/unreadable |
| storeSet(key, value) | Encrypts and persists value under key                |
| storeRemove(key)     | Deletes the entry for key                            |
| storeGetAll()        | Returns all stored key-value pairs as a plain object |

**Initialisation Guard**: \_initFailed = true is set ONLY on MODULE_NOT_FOUND (permanent — secure-ls not installed). All other errors leave \_lsInstance = null so subsequent calls can retry.

**Directory Resolution Logic**:

- \_storeDirResolved === true: return cached path (fast path)
- require('electron') throws: cache ~/.vsweep-store permanently (non-Electron env)
- app.getPath available: cache userData path permanently
- app not yet ready: return ~/.vsweep-store WITHOUT caching (retries after app.ready)

**Keys used by license.js**:

| Key | Contents                                             |
| --- | ---------------------------------------------------- |
| i   | Install timestamp (ms since epoch, stored as string) |
| p   | JSON-serialised public key (sludge-crypt)            |
| k   | JSON-serialised private key (sludge-crypt)           |
| v   | AES-encrypted license payload (device binding)       |

---

## License and Date Control Files

> Cross-platform .vsweep marker file — updated in Phase 2.

### Purpose

The .vsweep marker file is a zero-byte file whose filesystem creation timestamp is used as an additional factor in the license encryption/decryption process (sludge-crypt creationDate parameter). It serves as a tamper-evident anchor: deleting and re-creating the file changes its birthtimeMs, which invalidates any previously stored license payload.

### OS-Specific Paths

Each platform places the file in a different, non-obvious subdirectory:

| Platform | Path                                                        |
| -------- | ----------------------------------------------------------- |
| Windows  | %USERPROFILE%\AppData\Local\Microsoft\OneDrive\logs\.vsweep |
| macOS    | ~/Library/Caches/com.apple.helpd/.vsweep                    |
| Linux    | ~/.local/share/recently-used.xbel.d/.vsweep                 |
| Other    | ~/.config/.vsweep                                           |

The Windows path was chosen to sit inside the OneDrive log tree, which AV heuristics routinely ignore. The macOS path mimics Apple's help-daemon cache. The Linux path camouflages as a GTK recently-used auxiliary directory.

### Implementation Notes

- getVsweepFilePath() is a **pure function** — no filesystem I/O
- ensureVsweepDir(filePath) is a **separate function** called only from write paths (activateLicense, generateLicense)
- checkLicense() calls getVsweepFilePath() and reads the file, but never calls ensureVsweepDir()
- This separation ensures read-only callers never trigger unnecessary filesystem side effects

---

## Build System and Packaging

> Added in the cross-platform migration (Phase 3).

### Supported Platforms and Targets

| Platform | Targets            | Architectures             |
| -------- | ------------------ | ------------------------- |
| Windows  | NSIS installer     | x64                       |
| macOS    | DMG + ZIP          | x64, arm64                |
| Linux    | AppImage, deb, rpm | x64 (AppImage also arm64) |

### Build Scripts

| Script          | Description                                  |
| --------------- | -------------------------------------------- |
| build:win       | Windows NSIS installer (free tier)           |
| build:mac       | macOS DMG + ZIP (free tier)                  |
| build:linux     | Linux AppImage + deb + rpm (free tier)       |
| build:win:com   | Windows installer with COMMERCIAL_BUILD=true |
| build:mac:com   | macOS DMG + ZIP with COMMERCIAL_BUILD=true   |
| build:linux:com | Linux packages with COMMERCIAL_BUILD=true    |

Each build script runs three steps: vite build (renderer), node build-main.js (main process bundle), electron-builder (platform package).

### macOS Hardened Runtime

macOS builds have hardenedRuntime: true and reference build/entitlements.mac.plist for required entitlements. The gatekeeperAssess flag is set to false to allow distribution outside the Mac App Store.

### COMMERCIAL_BUILD Environment Variable

Set via cross-env in the com build scripts. Available at runtime via process.env.COMMERCIAL_BUILD for future feature-gating. Not currently read at runtime but reserved for commercial vs free tier divergence.

### Icon Asset Requirements

Platform-specific icon files must be generated from assets/logo.png before building:

| File             | Platform | Notes                                     |
| ---------------- | -------- | ----------------------------------------- |
| assets/icon.icns | macOS    | Required; must be generated from logo.png |
| assets/icon.ico  | Windows  | Required; must be generated from logo.png |
| assets/logo.png  | Linux    | Used directly as the Linux icon           |

See BUILDING.md for step-by-step icon generation instructions.
