# Changelog

All notable changes to VulnSweep will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Removed

- **Usage telemetry** — all anonymous usage analytics removed from the desktop app and the CLI: the Aptabase client modules [`src/main/modules/analytics.js`](src/main/modules/analytics.js) and [`src/cli/analytics.js`](src/cli/analytics.js), every `trackEvent()` call site, the `set-analytics-opt-out` / `get-analytics-opt-out` IPC pair with its preload opcode pair, the Analytics opt-out toggle in the About tab, the CLI `TELEMETRY` help section, and the `@aptabase/electron` dependency.
- **Licensing and paywall** — device-bound key issuance and the purchase UI removed: [`src/main/modules/license.js`](src/main/modules/license.js) with its CLI wrappers [`license-manager.js`](src/cli/license-manager.js), [`purchase-handler.js`](src/cli/purchase-handler.js), [`status-handler.js`](src/cli/status-handler.js) and the trial counter store [`trial-store.js`](src/main/utils/trial-store.js); the `BuyModal` purchase dialog, the Header Buy Now / LICENSED badges, the footer quota banner and the splash LICENSED badge; the license IPC channels (`get-commercial-status`, `activate-license`, `get-install-info`, `get-active-price`, `open-payment-window`, `verify-and-activate`, `seed-dev-transaction`, `increment-trial-fix`, `get-trial-status`, `license-backup`, `license-restore`) with their preload opcodes and obfuscation-map entries; the `apply-fixes` quota gate, so fix application is now unconditional.
- **Commercial configuration constants** — the PayPal payment-link block (`PAYPAL_CONFIG`), the license-verification API block with its XOR-split client key (`LICENSE_API_CONFIG`), the pricing/duration block (`LICENSE_CONFIG`) and the trial fix quota (`TRIAL_CONFIG`) were removed from [`src/main/config/constants.js`](src/main/config/constants.js); only git, cache, API, UI, enrichment, dependency-update, scanner and scan-cache configuration remains.
- **Electron Fuses hardening** — the `build.electronFuses` block in [`package.json`](package.json) (`runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`, `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`, `grantFileProtocolExtraPrivileges`, `enableCookieEncryption`) was removed; packaged builds now use standard electron-builder asar packaging (`"asar": true` with `"asarUnpack": ["**/*.node"]` unchanged). Renderer process isolation (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) is untouched.

---

## [1.3.5] - 2026-06-08

> **Bug Fixes — GHSA Enrichment & Independent Advisory Discovery**

### Fixed

- **GHSA URL regex** — Expanded to match repo-specific advisory URLs (`github.com/<owner>/<repo>/security/advisories/GHSA-...`) in addition to global URLs. Previously, vulnerabilities with repo-specific GHSA references (e.g., brace-expansion) were not enriched.
- **False fix version detection** — Added conservative GHSA/NVD reconciliation: when GHSA suggests a fix version that NVD says is still affected, the contradictory fix is rejected. Prevents suggesting non-existent versions like `5.0.7` for brace-expansion.
- **fixedIn validation safety net** — Post-merge validation ensures the final fix version is actually outside the vulnerable range. Catches edge cases where heuristics produce invalid fix versions.
- **Independent GHSA discovery** — Rewrote the `github-advisory` scanner source to query the GitHub Advisory API directly by package name (`?affects=<pkg>`), removing the dependency on OSV for vulnerability discovery. Fixes the morgan@1.10.1 detection failure in optimal mode.
- **Multi-branch advisory fix versions** — `extractFixedInFromAdvisory` now correctly selects the fix version for the user's installed branch (e.g., 4.x users get the 4.x fix, not a 3.x fix from the same advisory).
- **API pagination** — Added `per_page=100` to GitHub Advisory package queries to prevent truncated results for heavily-affected packages.

---

## [1.3.0] - 2026-06-02

> **Sprint 2 — CLI Integration, Cloudflare Worker Payment Verification, Unified License Activation, Three-Phase UI Payment Flow, Security Hardening**

### Added

- **CLI Interface** — Full command-line interface for headless/SSH environments (`vulnsweep scan`, `vulnsweep activate`, `vulnsweep status`, `vulnsweep purchase`)
- **Cloudflare Worker Payment Verification** — Server-side PayPal payment verification replacing the honor system. Prevents transaction reuse, rate limiting, HMAC-signed activation tokens
- **Unified License Activation** — Both UI and CLI now verify purchases through the Worker before generating a license locally (sludge-crypt + file birthdate encryption preserved)
- **Three-Phase UI Payment Flow** — BuyModal redesigned with email collection, PayPal payment, and transaction verification phases
- **Security Hardening** — Pessimistic transaction locking, write-first rate limiting, structured token validation, restricted CORS, X-API-Key authentication

### Fixed

- Removed unused `os` import in scan-cache.js
- ESLint configuration: Added Cloudflare Worker globals, CLI no-console override, AbortController global

---

## [1.2.0] - 2025-06-02

> **CLI Implementation — Full CLI interface for VulnSweep scanner (cross-platform Windows + Linux)**

### Added

- Full CLI interface for VulnSweep scanner (`src/cli/`) — cross-platform (Windows + Linux)
- 14 CLI parameters with short/long forms: `--dir`, `--type`, `--output`, `--sbom`, `--sbom-format`, `--html`, `--threshold`, `--autofix`, `--fix-risk`, `--update-level`, `--no-color`, `--json`, `--verbose`, `--help`
- CycloneDX v1.6 and SPDX v2.3 SBOM export from CLI ([`src/cli/sbom-writer.js`](src/cli/sbom-writer.js))
- Self-contained HTML report generation with Chart.js graphs ([`src/cli/html-report-generator.js`](src/cli/html-report-generator.js))
- CI/CD threshold evaluation with granular exit codes (0=pass, 1=threshold exceeded, 2=bad args, 3=scan error, 4=no projects, 130=SIGINT)
- Autofix handler with shell-injection prevention using `execFile` ([`src/cli/autofix-handler.js`](src/cli/autofix-handler.js))
- esbuild-based CLI bundler with minification/obfuscation ([`build-cli.js`](build-cli.js))
- Platform-specific launcher scripts generated during build (`.cmd` for Windows, shell script for Unix)
- npm global install support from `dist-cli/` directory
- 40 unit tests across 5 test files (`__tests__/cli/`)
- CLI implementation specification ([`plans/cli-implementation-spec.md`](plans/cli-implementation-spec.md))

### Fixed

- Shell injection vulnerability in autofix subprocess calls (switched from `exec` to `execFile`)
- Debug `console.log` statements in `src/main/modules/discovery.js` polluting stdout
- `noColor` option not being read correctly from parsed args in runner.js
- Exit codes incorrectly all being 2 regardless of error type
- Duplicated `extractUpdatesFromArray` utility function (consolidated into `src/cli/utils.js`)
- Path resolution bug where relative-looking absolute paths (e.g., `mnt/c/...`) were resolved against CWD instead of root
- Duplicate shebang in esbuild bundle causing SyntaxError on Windows

### Changed

- `package.json` updated with `build:cli`, `cli`, `cli:dev`, `cli:prod` scripts and `bin` field
- `.gitignore` updated to exclude `dist-cli/` directory

---

## [1.1.0] - 2026-05-20

> **Sprints 3, 4 & 5 — Modular Scanner Pipeline, Scan Cache, EPSS, Settings Tab, API Credentials, Rate-Limit Resilience, Cancel Scan**

### Added

- Replaced OSV-dependent NVD source with a direct NVD keyword-search implementation ([`nvd-keyword-source`](src/main/modules/enrichment/sources/nvd-keyword-source.js)) that detects CVEs independently of OSV, adds CVSS 4.0 support, and fixes version safety filtering with full CPE range evaluation.

#### Sprint 5 — Feature A: Settings Tab

- **New Settings tab** added to the left of the About tab ([`src/renderer/components/SettingsTab.jsx`](src/renderer/components/SettingsTab.jsx) NEW, [`src/renderer/hooks/useSettings.js`](src/renderer/hooks/useSettings.js) NEW)
- **Scan Mode selector**: `Fast` (npm-audit + OSV only — dramatically faster for quick checks) vs `Full` (all 6 sources: OSV, NVD, GitHub Advisory, npm-audit, CISA-KEV, EPSS)
- **Vulnerability Sources toggles**: per-source enable/disable for `osv`, `nvd`, `github-advisory`, `cisa-kev`, `epss`; `npm-audit` is always active (non-disableable, shown with tooltip)
- **API Credentials panel** embedded in Settings (see Feature B)
- **Scan Options panel**: four checkboxes migrated from Header — Allow Git Reset, Bump patch version on fix, Remove `package-lock.json`, Remove overrides
- [`useSettings`](src/renderer/hooks/useSettings.js) hook: loads/saves `scanMode` and `enabledSources` via `settings:get` / `settings:set` IPC; defaults to `{ scanMode: 'full', enabledSources: ALL_SOURCES }` on first run
- Settings **auto-persist on change** — no manual save step required
- `settings:get` IPC handler ([`src/main/main.js`](src/main/main.js)): reads `app:settings` from secure store; returns safe empty object on parse failure
- `settings:set` IPC handler ([`src/main/main.js`](src/main/main.js)): validates `scanMode` against `['fast','full']` and all `enabledSources` entries against known source IDs before persisting
- `scan-projects` and `scan-project` IPC handlers updated to read `enabledSources` and `scanMode` from store and pass as `scanOptions` to `scanProject()`
- [`src/preload/preload.js`](src/preload/preload.js): `getSettings` and `setSettings` exposed via `contextBridge`

#### Sprint 5 — Feature B: API Credentials Panel

- **New `<CredentialsPanel>` component** ([`src/renderer/components/CredentialsPanel.jsx`](src/renderer/components/CredentialsPanel.jsx) NEW): masked credential display (`••••••••••••<last4>`); plaintext never shown after initial entry
- **GitHub Advisory credential row**: Replace + Delete when configured; password input + Save when not configured; link to [https://github.com/settings/tokens](https://github.com/settings/tokens)
- **Security rule**: plaintext cleared from renderer state to `''` **before** the async IPC call resolves — plaintext never persists in renderer memory after the save click; no credential-read IPC channel exposed to renderer
- [`useCredentials`](src/renderer/hooks/useCredentials.js) hook ([`src/renderer/hooks/useCredentials.js`](src/renderer/hooks/useCredentials.js) NEW): manages credential status; exposes `saveCredential` and `deleteCredential` callbacks
- `credentials:set` IPC handler: validates source against `ALLOWED_CREDENTIAL_SOURCES` allowlist; rejects values over 500 chars; stores token and last-4-chars hint — both AES-256 encrypted at rest via `secure-ls`
- `credentials:delete` IPC handler: removes both credential and hint keys from secure store
- `credentials:getStatus` IPC handler: returns `{ configured: boolean, maskedHint: string|null }` — **plaintext never returned to renderer under any code path**
- **NVD API key support**: when configured, NVD rate limit increases from 5 req/30s to 50 req/30s
- `GITHUB_TOKEN` getter updated: lazy-reads from encrypted secure store first, falls back to `process.env.GITHUB_TOKEN`
- [`src/preload/preload.js`](src/preload/preload.js): `setCredential`, `deleteCredential`, `getCredentialStatus` exposed via `contextBridge`

#### Sprint 5 — Feature C: GitHub Advisory Rate-Limit Singleton

- **New module [`src/main/utils/github-rate-limiter.js`](src/main/utils/github-rate-limiter.js)**: singleton Promise-chain queue serialising all GitHub Advisory requests — eliminates thundering-herd where N concurrent rate-limited requests computed independent backoffs
- `enqueue(fn)`: appends async function to module-scoped chain; waits if `_rateLimitedUntil > Date.now()` before executing
- `setRateLimited(waitMs)`: sets shared `_rateLimitedUntil` so all queued requests share one wait period
- [`github-advisory-source.js`](src/main/modules/enrichment/sources/github-advisory-source.js): `queryGitHubAdvisory()` rewritten to wrap retry loop in `rateLimiter.enqueue()`; calls `rateLimiter.setRateLimited(delay)` on 429/403

#### Sprint 5 — Feature D: Cancel Scan

- **Cancel Scan**: "Scan & Audit" button becomes "Cancel" while scanning; clicking aborts all in-progress operations, clears partial results, resets UI to pre-scan state
- `scan:cancel` IPC handler ([`src/main/main.js`](src/main/main.js)): calls `_activeScanAbortController.abort()`
- `_activeScanAbortController` created fresh per `scan-projects` invocation; `signal.aborted` checked before each project loop iteration; returns `{ success: false, cancelled: true }` when aborted
- `cancelScan` and `isCancelling` added to [`useVulnerabilityScanner.js`](src/renderer/hooks/useVulnerabilityScanner.js)
- [`src/preload/preload.js`](src/preload/preload.js): `cancelScan` exposed via `contextBridge`

#### Sprint 4 — EPSS for Non-KEV CVEs ([`src/main/modules/scanner/sources/epss-source.js`](src/main/modules/scanner/sources/epss-source.js) NEW)

- **Standalone `epss` source plugin**: decoupled EPSS scoring from CISA KEV membership — CVEs not in the CISA KEV catalog now receive EPSS probability scores (previously showed `—` in the Exploit column)
- EPSS scores propagated through `result-aggregator.js` and surfaced in the vulnerability grid for all CVEs regardless of KEV status
- `epss` registered as a sixth source in `scanner-orchestrator.js`; `result-aggregator.js` updated to merge EPSS fields from the standalone source

#### Sprint 4 — `resolvesDependents` B

#### Sprint 4 -- resolvesDependents BFS Fix

- Fixed `resolvesDependents` field in [`npm-audit-source.js`](src/main/modules/scanner/sources/npm-audit-source.js): BFS traversal now correctly computes which root-cause packages are resolved transitively; previously always empty in the modular scanner
- Two new module-level Maps added: `auditCache` (memoised raw audit per project) and `dependentsCache` (BFS dependents map per project); `clearCache()` clears both

#### Sprint 4 -- Progress Bar Finalizing State

- [`useVulnerabilityScanner.js`](src/renderer/hooks/useVulnerabilityScanner.js): `finalizing` progress phase added â€” progress bar shows "Finalizing results..." at 100% while the IPC call resolves; eliminates the stuck-at-100%-while-isScanning-is-true visual glitch

#### Sprint 4 -- Scan Cache Soft Invalidation

- [`src/main/config/constants.js`](src/main/config/constants.js): `SCAN_CACHE_CONFIG` extended with `HARD_EXPIRE_DAYS` (365), `SOFT_STALE_DAYS` (30), `MAX_ENTRIES` (500), `EVICTION_BATCH_SIZE` (50)
- [`scan-cache.js`](src/main/modules/scanner/scan-cache.js): `isHardExpired()`, `isSoftStale()`, `evictOldest()`, `loadWithEviction()` functions added; hard-delete at 365 days, stale-while-revalidate at 30 days (network fetch attempted; cached result returned on failure)
- npm-audit source is explicitly excluded from the cache code path (existing guard preserved)

#### Sprint 3 -- Modular Scanner Architecture

- **Three-phase parallel pipeline** replacing the former two-phase gated model: [`package-lock.json`](src/main/modules/scanner/package-universe-builder.js) drives a complete package universe; all enabled sources run in parallel per package; results merged by [`result-aggregator.js`](src/main/modules/scanner/result-aggregator.js)
- **[`package-universe-builder.js`](src/main/modules/scanner/package-universe-builder.js)** (NEW): builds complete `PackageDescriptor[]` from `package-lock.json` (lockfileVersion 1, 2, and 3 supported); eliminates the npm-audit gate that previously excluded packages absent from npm's advisory database
- **Five scanner source plugins** under `src/main/modules/scanner/sources/`: [`npm-audit-source.js`](src/main/modules/scanner/sources/npm-audit-source.js), [`osv-source.js`](src/main/modules/scanner/sources/osv-source.js), [`nvd-source.js`](src/main/modules/scanner/sources/nvd-source.js), [`github-advisory-source.js`](src/main/modules/scanner/sources/github-advisory-source.js), [`cisa-kev-source.js`](src/main/modules/scanner/sources/cisa-kev-source.js)
- **[`result-aggregator.js`](src/main/modules/scanner/result-aggregator.js)** (NEW): CVE-based deduplication via Union-Find algorithm; severity conflict resolution priority: NVD CVSS v3 > GitHub Advisory > OSV > npm-audit
- **[`scanner-orchestrator.js`](src/main/modules/scanner/scanner-orchestrator.js)** (NEW): batched parallel execution with per-plugin timeouts; emits `scan-progress` events per package enabling streaming display of results
- `SCANNER_CONFIG` in [`constants.js`](src/main/config/constants.js): `ENABLED_SOURCES`, `MAX_CONCURRENT_PACKAGES` (10), `PER_PACKAGE_TIMEOUT_MS` (30000), `BATCH_PAUSE_MS` (100), `DEFAULT_SCAN_MODE` ('fast')
- `scan-project` and `scan-projects` IPC handlers replace the former `analyze-project` and `analyze-projects` handlers
- `GITHUB_TOKEN` environment variable support: authenticated requests raise GitHub Advisory rate limit from 60 req/hr to 5,000 req/hr
- `computeBackoffDelay(attempt)` helper: exponential backoff (`base x 2^attempt`, capped at max) plus random jitter â€” used on all GitHub Advisory retry paths
- `Retry-After` header support on HTTP 429/403 responses: VulnSweep waits the server-specified duration before retrying
- CISA KEV and EPSS score integration into the unified scan result
- `fetchOsvRaw()` and `extractFixedIn()` added to [`src/main/modules/enrichment/sources/osv-source.js`](src/main/modules/enrichment/sources/osv-source.js); `extractSeverity`, `extractAliases`, `extractUrl` exported for scanner plugin use
- 12 new behavioural tests for GitHub Advisory source: authenticated header injection, unauthenticated fallback, `Retry-After` respect, exponential backoff computation, jitter bounds, max-retry exhaustion, graceful degradation

### Changed

- GitHub Advisory retry limit increased from **3 to 100** with exponential backoff + jitter (`GITHUB_MAX_RETRIES` in [`constants.js`](src/main/config/constants.js))
- Scan options (Allow Git Reset, Bump Version, Remove package-lock.json, Remove overrides) moved from Header toolbar into Settings tab; Header now contains only folder selector, Browse button, progress bar, and action buttons
- Scanner resolves plugins from `enabledSources` only â€” scan mode preset drives source selection
- [`useVulnerabilityScanner.js`](src/renderer/hooks/useVulnerabilityScanner.js) migrated to `scanProjects` IPC + `onScanProgress` event listener; `isEnriching` state and enrichment `useEffect` removed from [`App.jsx`](src/renderer/App.jsx)
- Scan pipeline: replaced two-phase `analyze-project` + `enrich-vulnerabilities` with single `scan-project` call
- **Recursive project discovery**: root folder containing package.json is now included as a project, and nested subdirectories with package.json use relative path naming (e.g., 'my_proj/demo')
- **NVD enrichment with GitHub advisory data**: when NVD CVE references contain GitHub advisory URLs, queries GitHub Advisory for additional patched version information

### Fixed

- **Fast preset source selection bug**: `enabledSources` from settings now correctly limits scanner to selected sources only â€” stale dual-hook settings bug fixed
- **GitHub Advisory thundering-herd**: rate limiting no longer causes cascading independent backoff delays across concurrent requests (singleton queue shares one wait period)
- [`VulnerabilityGrid.jsx`](src/renderer/components/VulnerabilityGrid.jsx): removed dead `isEnriching` / `enrichmentProgress` props
- Fixed NVD keyword source ([`nvd-keyword-source.js`](src/main/modules/enrichment/sources/nvd-keyword-source.js)) to correctly match CVEs by CPE package identity, extract vulnerable version ranges and `fixedIn` versions from NVD API CPE data, and eliminate false-positive matches for unrelated packages.
- Fixed NVD keyword source false positive where CPE entries with a pinned exact version (e.g. `cpe:...:1.5.1:*`) incorrectly flagged all installed versions as vulnerable instead of only matching the exact pinned version via `semver.eq()`.
- Fixed `scripts/full-scan-proj0.js` returning 0 vulnerabilities due to NVD rate-limit queue starvation; [`scanner-orchestrator.js`](src/main/modules/scanner/scanner-orchestrator.js) now accepts a `perPackageTimeoutMs` override for CLI scripts operating at the free-tier rate limit.
- **Aliases tooltip links fixed**: each CVE/GHSA ID in the Sources column now links to its correct specific URL (CVE to NVD, GHSA to GitHub Advisories) instead of all links incorrectly pointing to the first CVE's NVD page
- **Cancel scan now aborts in-flight HTTP requests**: AbortSignal propagation added to NVD, GitHub Advisory, OSV, and CISA KEV sources for immediate termination when cancel is pressed
- **Multi-repo commit state fixed**: resolved vulnerabilities are now removed from the list after successful commit, preventing duplicate commit attempts on the same fixes

### Security

- API credentials stored with AES-256 encryption via `secure-ls` in [`secure-store.js`](src/main/utils/secure-store.js)
- Credential plaintext cleared from renderer memory immediately after submission â€” before the IPC promise resolves
- No credential-read IPC channel exposed to renderer process; `credentials:getStatus` returns only masked hint
- `GITHUB_TOKEN` getter lazy-reads from encrypted store before environment variable fallback

### Added

- **Recursive project discovery**: root folder containing package.json is now included as a project, and nested subdirectories with package.json use relative path naming (e.g., 'my_proj/demo')
- **NVD enrichment with GitHub advisory data**: when NVD CVE references contain GitHub advisory URLs, queries GitHub Advisory for additional patched version information

### Deprecated

- `enrich-vulnerabilities` IPC channel â€” removed; callers must use `scan-project`
- [`cve-enricher.js`](src/main/modules/enrichment/cve-enricher.js) â€” deprecated; preserved for test migration; do not add new callers

---

## [1.1.0] - 2026-05-14

### Added

#### Feature D -- Usage Analytics ([`src/main/modules/analytics.js`](src/main/modules/analytics.js) NEW

- **New module** [`src/main/modules/analytics.js`](src/main/modules/analytics.js): anonymous usage analytics via Aptabase (EU free tier, GDPR-compliant); app key: `A-EU-9601263447`
- Events tracked: `app_initialized`, `repo_scanned`, `sbom_generated`, `dependency_updated`, `vulnerability_fixed`, `purchase_completed`
- Opt-out: toggle in the About tab; preference persisted across sessions via `secure-store`

#### Feature A -- Annual Pricing ([`src/main/modules/license.js`](src/main/modules/license.js) MODIFIED)

- Annual per-device license replacing the previous session-count model
- Early-adopter price: EUR 9.99/year for the first 30 days after initial install
- Standard price: EUR 29.99/year after the 30-day early-adopter window closes
- `LICENSE_CONFIG` constants in [`constants.js`](src/main/config/constants.js): `EARLY_ADOPTER_PRICE`, `STANDARD_PRICE`, `EARLY_ADOPTER_WINDOW_DAYS`
- [`getActivePrice()`](src/main/modules/license.js): returns correct price tier based on install timestamp
- [`checkLicense()`](src/main/modules/license.js): extended with expiry logic; expired licenses return `{ isLicensed: false, isExpired: true }`
- Backward compatibility: legacy licenses without `expiresAt` treated as perpetual

#### Feature B -- About Tab ([`src/renderer/components/AboutTab.jsx`](src/renderer/components/AboutTab.jsx) NEW)

- New component: right-aligned tab visible at all times
- Displays: app name and version, license status (Licensed/Expired/Trial), masked serial number, renewal countdown
- Links: Privacy Policy and Disclaimer via `open-local-doc` IPC; GitHub Issues link
- Analytics opt-out toggle; License Backup button (licensed only); License Restore button (always)
- New IPC handlers: `get-app-version`, `open-local-doc`

#### Feature C -- License Backup/Restore

- `backupLicense()`: reads all four license keys, serialises to JSON, gzip compresses, XOR obfuscates, prepends `VSWB` magic header, writes as `.vsbak` file via save dialog
- `restoreVsweepFileWithBirthtime()`: reverses the process; recreates `.vsweep` marker file with exact original creation timestamp preserved via PowerShell `EncodedCommand` on Windows
- C-1 safeguard: Backup button only shown when licensed
- C-2 safeguard: Restore dialog requires explicit confirmation before overwriting existing license
- New IPC handlers: `backup-license`, `restore-license`

### Changed

- Pricing changed from session-count to annual subscription model
- Free tier fix-and-commit sessions (10) unchanged for unlicensed users

---

## [1.7.0] - 2026-05-07

### Breaking Changes

Previous releases stored license data in the Windows Registry via REG.exe. This release removes all Registry-based storage. **Existing Windows installations will lose stored license data on upgrade** â€” users with active commercial licenses must re-activate. There is no automatic migration path.

### Added

- **New module [`src/main/utils/secure-store.js`](src/main/utils/secure-store.js)**: cross-platform AES-encrypted key-value store replacing Windows-only REG.exe calls; uses `secure-ls` backed by `store.dat` in Electron `userData` directory
- Encryption key derived from SHA-256(first non-loopback MAC address); falls back to static seed
- Exports: `storeGet`, `storeSet`, `storeRemove`, `storeGetAll` (all synchronous)
- Lazy initialisation with `_initFailed` guard; falls back to `~/.vsweep-store/store.dat` pre-app.ready
- Cross-platform `.vsweep` marker file paths unified to Electron `userData` on all platforms
- Multi-platform Electron Builder config: Windows NSIS, macOS DMG+ZIP (x64+arm64), Linux AppImage+deb+rpm
- New file [`build/entitlements.mac.plist`](build/entitlements.mac.plist): macOS hardened runtime entitlements
- Store pre-warm: `storeGet('_init')` called inside `app.whenReady()` in [`main.js`](src/main/main.js)
- IPC handlers hardened with try/catch and safe non-leaking fallbacks

### Dependencies

- Added **`secure-ls`** (`^2.0.0`) to `dependencies`

---

## [1.6.0] - 2026-04-30

### Added

- Dynamic skeleton loading in [`VulnerabilityGrid.jsx`](src/renderer/components/VulnerabilityGrid.jsx): `ResizeObserver`-based row count calculation; row count formula: `Math.min(20, Math.max(3, Math.floor((containerHeight - 36) / 32)))`
- Column header tooltips via [`<InfoTooltip>`](src/renderer/components/InfoTooltip.jsx) on Severity, Status, Risk Level, and Dependency Type headers
- Rich empty states: folder icon for no project, shield icon for no vulnerabilities, search icon for no filter results

### Changed

- React performance optimisations: `memo()` on [`Badge`](src/renderer/components/Badge.jsx), [`Spinner`](src/renderer/components/Spinner.jsx), [`InfoTooltip`](src/renderer/components/InfoTooltip.jsx), [`Modal`](src/renderer/components/Modal.jsx); `useMemo` on `buttonsState` in [`App.jsx`](src/renderer/App.jsx); `useCallback`/`useMemo` on sort and selection in [`VulnerabilityGrid.jsx`](src/renderer/components/VulnerabilityGrid.jsx)
- Table column reorder: `Checkbox | Severity | Status | Package | Project | Risk | Dep Type | Fixed | Installed | Vulnerable Range | CVEs | Resolves`

### Fixed

- 6 pre-existing `toHaveBeenCalledTimes` test assertions corrected for React Strict Mode

---

## [1.5.0] - 2026-04-30

### Added

- Full semantic design token system in [`tailwind.config.js`](tailwind.config.js): `surface.*`, `brand.*`, `severity.*`, `status.*`, `accent.*`, `warn.*`, `text.*`, `border.*`, `dep.*` tokens; compact typography scale; border-radius tokens
- New reusable [`<Badge>`](src/renderer/components/Badge.jsx) component: `severity`, `status`, `risk`, `promoted` variants with lucide-react icons; case-insensitive value matching

### Changed

- Replaced all arbitrary `bg-gray-*` / `bg-black` classes with semantic `bg-surface-*` / `bg-brand-*` tokens across 6 files
- Icon system via `luc
  ide-react icons added to Badge component (severity, status, risk icons)
- Eliminated `bg-gray-850` (non-existent class); replaced with `bg-surface-mid`

### Fixed

- Dependency-type badge contrast: `direct` raised from ~3.5:1 to ~5.2:1; `transitive` from ~3.5:1 to ~5.8:1 (WCAG AA compliant)
- Disabled button text contrast: `text-gray-500` to `text-text-muted`
- Timestamp and stack trace text contrast fixes in LogConsole and ErrorBoundary

---

## [1.4.0] - 2026-04-27

### Added

- **[`InfoTooltip`](src/renderer/components/InfoTooltip.jsx)** component: hover-triggered tooltip for contextual information
- **Fixed Version column**: tooltip showing proposed fix strategy, target version, fix type
- **CVEs column**: tooltip showing CVE identifiers with titles, clickable advisory URLs, CWE IDs

### Changed

- Global font size reduced to 13px for professional desktop app aesthetic
- Custom compact utility classes: `compact-cell`, `compact-header`, `compact-input`, `compact-btn`, `compact-text`, `compact-text-xs`
- Professional thin scrollbar styling throughout
- Removed "Proposed Fix" column; replaced with Fixed Version tooltip approach
- Column count updated from 10 to 11

---

## [1.0.0] - 2026-04-22

### Added

- Multi-project discovery: recursively finds all Node.js projects in a directory tree
- npm Audit Parser: parses `npm audit --json` output to extract vulnerability data
- Intelligent Fix Strategy Engine: direct dependency updates, parent updates, npm overrides
- Risk Assessment System: LOW (patch/minor) vs HIGH (major version) risk classification
- Bulk Git Operations: optional hard reset, pull, staged commit, push across all repos
- Real-time progress tracking with visual progress bars
- Vulnerability Grid: sortable columns, search/filter, checkbox selection, color-coded badges
- Log Console: real-time streaming, color-coded log levels, copy to clipboard, auto-scroll
- Modal Component: HIGH risk fix warnings, destructive git reset confirmations
- Header Component: folder selection, Git reset toggle, action buttons, progress bar
- Electron multi-process architecture with secure contextBridge IPC
- React frontend with hooks-based state management
- Vite build system with hot module reload
- Tailwind CSS utility-first styling

---

**Legend:** `Added` - New features | `Changed` - Changes to existing functionality | `Deprecated` - Soon-to-be removed | `Removed` - Removed features | `Fixed` - Bug fixes | `Security` - Security-related changes
