# Building VulnSweep

Practical guide for producing platform-specific distributable packages.

## Prerequisites

| Requirement      | Version | Notes                            |
| ---------------- | ------- | -------------------------------- |
| Node.js          | 18+     | 20 LTS recommended               |
| npm              | 8.3.0+  | Required for `overrides` support |
| electron-builder | bundled | Installed via `npm install`      |

## Platform Host Requirements

> **Important — macOS builds must run on macOS.**
> `electron-builder` cannot cross-compile macOS packages (`.dmg`, `.zip`) from Windows or Linux. Use a macOS machine or a macOS CI runner (e.g. GitHub Actions `macos-latest`).

> **Linux builds** can be produced natively on Linux or via Docker on other platforms using the `electronuserland/builder` image. Running `build:linux` from Windows will fail.

> **Windows builds** (`build:win`) can be produced from any platform, but native Windows is recommended to avoid path handling edge cases.

## Icon Asset Requirements

Platform-specific icon files must exist before running any build. They are **not** committed to the repository and must be generated from [`assets/logo.png`](assets/logo.png).

| File               | Platform | Required                               |
| ------------------ | -------- | -------------------------------------- |
| `assets/icon.icns` | macOS    | Yes — `build:mac` will fail without it |
| `assets/icon.ico`  | Windows  | Yes — `build:win` will fail without it |
| `assets/logo.png`  | Linux    | Already present; used directly         |

### Generating Icon Files

**Option A — electron-icon-builder (recommended):**

```
npx electron-icon-builder --input=assets/logo.png --output=assets
```

This generates both `icon.icns` and `icon.ico` from a single PNG source.
Requires the source PNG to be at least 1024x1024 px for best results.

**Option B — Online converters:**

- `.icns`: use [CloudConvert](https://cloudconvert.com) or [iConvert Icons](https://iconverticons.com)
- `.ico`: use [ICO Convert](https://icoconvert.com) — select all standard sizes (16, 32, 48, 64, 128, 256 px)

## Build Scripts Reference

| Script                    | Platform | Commercial                    | Output                                        |
| ------------------------- | -------- | ----------------------------- | --------------------------------------------- |
| `npm run build:win`       | Windows  | No                            | `dist/*.exe` (NSIS installer)                 |
| `npm run build:mac`       | macOS    | No                            | `dist/*.dmg`, `dist/*.zip`                    |
| `npm run build:linux`     | Linux    | No                            | `dist/*.AppImage`, `dist/*.deb`, `dist/*.rpm` |
| `npm run build:win:com`   | Windows  | Yes (`COMMERCIAL_BUILD=true`) | `dist/*.exe`                                  |
| `npm run build:mac:com`   | macOS    | Yes (`COMMERCIAL_BUILD=true`) | `dist/*.dmg`, `dist/*.zip`                    |
| `npm run build:linux:com` | Linux    | Yes (`COMMERCIAL_BUILD=true`) | `dist/*.AppImage`, `dist/*.deb`, `dist/*.rpm` |

Each script runs three steps in sequence:

1. `vite build` — compiles the renderer (React/Tailwind) into `dist-renderer/`
2. `node build-main.js` — bundles the main process into `dist-main/`
3. `electron-builder --platform` — packages the app into `dist/`

## Linux Maintainer Field

Before shipping Linux packages (`.deb`, `.rpm`), update the `linux.maintainer` field in [`package.json`](package.json):

```json
"linux": {
  "maintainer": "Your Name <your@email.com>"
}
```

The current placeholder value (`VulnSweep <support@vulnsweep.app>`) must be replaced with a real contact address to comply with Debian/RPM packaging standards.

## macOS Hardened Runtime

macOS builds have `hardenedRuntime: true`. The required entitlements are declared in [`build/entitlements.mac.plist`](build/entitlements.mac.plist). Both `entitlements` and `entitlementsInherit` point to this file.

For notarisation (required for distribution outside the Mac App Store), configure the `notarize` option in `electron-builder` with your Apple Developer credentials. Notarisation is not configured in this repository by default.

## Development Build (No Packaging)

To run the app locally without producing a distributable:

```
npm run dev
```

This starts the Vite dev server and launches Electron pointing at `http://localhost:5173`.
