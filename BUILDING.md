# Building VulnSweep

Practical guide for producing platform-specific distributable packages.

VulnSweep is distributed under the [Apache License 2.0](LICENSE.md). There is a
single build path — every packaging script produces the same fully functional
app; building and running it involves no license key or activation step.

**Last verified against source:** 2026-11-05 (`package.json` scripts, `build`
config, and installed devDependency engines).

## Prerequisites

| Requirement      | Version          | Notes                                                    |
| ---------------- | ---------------- | -------------------------------------------------------- |
| Node.js          | 20.19+ or 22.12+ | Required by Vite 8 (`build:renderer`); 22 LTS recommended |
| npm              | 8.3.0+           | Required for `overrides` support                         |
| electron-builder | bundled          | Installed via `npm install`                              |

## Platform Host Requirements

> **Important — macOS builds must run on macOS.**
> `electron-builder` cannot cross-compile macOS packages (`.dmg`, `.zip`) from Windows or Linux. Use a macOS machine or a macOS CI runner (e.g. GitHub Actions `macos-latest`).

> **Linux builds** can be produced natively on Linux or via Docker on other platforms using the `electronuserland/builder` image. Running `build:linux` from Windows will fail.

> **Windows builds** (`build:win`) can be produced from any platform, but native Windows is recommended to avoid path handling edge cases.

## Icon Assets

Platform icons are committed to the repository and referenced directly by the
`build` config in [`package.json`](package.json):

| File                          | Referenced by  |
| ----------------------------- | -------------- |
| `assets/icons/win/icon.ico`   | `build.win.icon`   |
| `assets/icons/mac/icon.icns`  | `build.mac.icon`   |
| `assets/logo.png`             | `build.icon`, `build.linux.icon` (used directly) |

If you fork the project and want your own artwork, regenerate the set from a
source PNG with:

```
npx electron-icon-builder --input=assets/logo.png --output=assets
```

This writes `icon.ico` / `icon.icns` (and PNG sizes) under `assets/icons/`,
matching the paths above. The source PNG should be square and at least
1024x1024 px for best results. Do not change the file names without also
updating `package.json`.

## Build Scripts Reference

The build and packaging scripts this guide covers. [`package.json`](package.json)
is the source of truth for the complete list — it also defines unrelated helper
scripts (tests, linting, CLI run helpers) not listed here:

| Script                     | Platform        | Output                                        |
| -------------------------- | --------------- | --------------------------------------------- |
| `npm run build`            | Host OS         | `dist/` (electron-builder default target)     |
| `npm run build:win`        | Windows         | `dist/*.exe` (NSIS installer)                 |
| `npm run build:mac`        | macOS           | `dist/*.dmg`, `dist/*.zip`                    |
| `npm run build:linux`      | Linux           | `dist/*.AppImage`, `dist/*.deb`, `dist/*.rpm` |
| `npm run build:main:debug` | Any host        | `dist-main/main.js` (production-mode bundle — step 2 only) |
| `npm run build:main`       | Any host        | `dist-main/main.js` (development-mode bundle) |
| `npm run build:cli`        | Any host        | `dist-cli/vulnsweep.js` (CLI bundle)          |

The platform scripts each run three steps in sequence:

1. `npm run build:renderer` — production Vite build of the renderer
   (React/Tailwind) into `dist-renderer/`
2. `node build-main.js` with `NODE_ENV=production` — bundles the main process
   into `dist-main/`
3. `electron-builder --win|--mac|--linux` — packages the app into `dist/`

`npm run build:main:debug` runs step 2 only (`node build-main.js` with
`NODE_ENV=production`, per `build-main.js`'s production branch: minified, no
sourcemaps). `npm run build:main` bundles the main process into `dist-main/`
WITHOUT `NODE_ENV=production`, producing a development-mode bundle (unminified,
with sourcemaps) — useful when iterating on the main process. `npm run build:cli`
bundles the CLI (`src/cli`) into `dist-cli/`. Build artifacts (`dist/`,
`dist-main/`, `dist-renderer/`) are inputs/outputs of packaging, not committed
source.

## Linux Maintainer Field

Before shipping Linux packages (`.deb`, `.rpm`), make sure the
`linux.maintainer` field in [`package.json`](package.json) is a real, monitored
contact address — Debian/RPM packaging standards require a reachable maintainer
string. Replace any placeholder before publishing packages to end users.

## macOS Hardened Runtime

macOS builds have `hardenedRuntime: true`. The required entitlements are
declared in [`build/entitlements.mac.plist`](build/entitlements.mac.plist). Both
`entitlements` and `entitlementsInherit` point to this file.

For notarisation (required for distribution outside the Mac App Store),
configure the `notarize` option in `electron-builder` with your Apple Developer
credentials. Notarisation is not configured in this repository by default —
unsigned `.dmg`/`.zip` builds will trigger Gatekeeper warnings on first launch.

## Development Build (No Packaging)

To run the app locally without producing a distributable:

```
npm run dev
```

This starts the Vite dev server and launches Electron pointing at
`http://localhost:5173`.
