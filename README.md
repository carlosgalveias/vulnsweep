# VulnSweep - Dependency Vulnerability Orchestrator

VulnSweep is a desktop application that automates the detection and resolution of npm security vulnerabilities across multiple Node.js repositories. Built to handle bulk vulnerability management for teams managing 20+ projects simultaneously.

![VulnSweep Dashboard](screenshots/vulnsweep-dashboard.png)

## Features

- **Automated Multi-Project Scanning** - Discovers and analyzes all Node.js projects within a directory tree
- **Intelligent Fix Strategy Determination** - Automatically determines the best fix approach:
  - Direct dependency updates
  - Parent dependency updates
  - npm overrides for transient dependencies
- **Risk Assessment** - Categorizes fixes as LOW or HIGH risk based on semver changes
- **Bulk Git Operations** - Automated git reset, pull, commit, and push across repositories
- **Real-Time Progress Tracking** - Visual progress indicators and detailed logging
- **Safety Confirmations** - Warns before applying HIGH risk fixes or destructive git operations
- **Selective Fix Application** - Choose which vulnerabilities to fix with checkbox selection
- **Auto-Selection** - Automatically selects LOW risk vulnerabilities for quick fixes
- **Compact Desktop UI** - Professional, information-dense interface optimized for desktop use (v1.4.0+)
- **Contextual Tooltips** - Hover over info icons to see detailed CVE information and fix strategies (v1.4.0+)

## Prerequisites

- **Node.js 18+** - Required for running the application
- **npm** (not yarn/pnpm) - VulnSweep only supports npm package manager
- **Git** - Must be installed and configured for repository operations
- **Repository Access** - Read/write access to repositories you want to scan

## Installation

### Quick Start (Development Mode)

```bash
# Clone the repository
git clone <repository-url>
cd dependency_updater

# Install dependencies
npm install

# Run in development mode
npm run dev
```

The application will launch with hot-reload enabled for development.

### Production Build

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Run the production build
npm start
```

For distributable packages, the built application will be in the `dist` directory.

## Usage Guide

### 1. Select Base Directory

Click the **Browse** button in the header to select a directory containing your Node.js projects. VulnSweep will automatically discover all subdirectories with `package.json` files.

```
Selected: C:\Projects\my-repositories
Found 15 Node.js project(s)
```

### 2. Configure Git Reset Toggle

Before scanning, decide whether to enable the **Allow Git Reset** option (enabled by default):

- **Enabled (⚠️ Destructive)**: Runs `git reset --hard` before pulling, discarding uncommitted changes
- **Disabled (Safe)**: Only runs `git pull` without reset

**Recommendation**: Keep enabled for clean automated workflows, disable if repositories may have uncommitted work.

### 3. Scan & Audit Projects

Click **Scan & Audit** to analyze all discovered projects:

1. VulnSweep runs `npm audit --json` on each project
2. Parses vulnerability data and dependency trees
3. Determines optimal fix strategies for each vulnerability
4. Calculates risk levels based on semver changes
5. Displays results in the vulnerability grid

**Progress bar** shows real-time scanning status.

### 4. Review Vulnerabilities

The vulnerability grid displays:

- **Project Name**: Which repository contains the vulnerability
- **Severity**: Critical, High, Moderate, or Low (color-coded badges)
- **Vulnerable Package**: Package name with current version
- **Installed Version**: Current version installed in the project
- **Vulnerable Range**: Version range affected by the vulnerability
- **Fixed Version** ⓘ: Target version for the fix (hover for details on fix strategy)
- **Dependency Type**: Direct or transient (indirect)
- **CVEs** ⓘ: Number of CVE identifiers (hover for full list with titles and advisory links)
- **Risk Level**: LOW (patch/minor) or HIGH (major version change)
- **Status**: Pending, Applying, Resolved, or Failed

**Tooltip Features (v1.4.0+)**:
- Hover over the **ⓘ** icon in the "Fixed Version" column to see:
  - Detailed fix strategy description
  - Target version number
  - Fix type (direct update, parent update, or override)
- Hover over the **ⓘ** icon in the "CVEs" column to see:
  - Complete list of CVE identifiers with titles
  - Clickable advisory URLs for vulnerability details
  - CWE (Common Weakness Enumeration) identifiers

**Filtering**: Use the search bar to filter by project name, package, or severity.

**Sorting**: Click column headers to sort by that field.

**Auto-Selection**: LOW risk vulnerabilities are automatically selected. Review and adjust selections as needed.

### 5. Apply Fixes

Click **Apply Selected Fixes** to remediate selected vulnerabilities:

- **HIGH Risk Confirmation**: If HIGH risk fixes are selected, a confirmation dialog appears
- **Fix Application**: VulnSweep applies fixes based on the determined strategy:
  - **Scenario A**: Direct dependency updates using `npm install <package>@<version>`
  - **Scenario B**: Parent dependency updates to pull in fixed transient dependencies
  - **Scenario C**: npm overrides added to `package.json` for unresolvable transient dependencies
- **Status Updates**: Watch the Status column and log console for real-time updates

### 6. Commit & Push Changes

After fixes are applied, click **Commit & Push** to save changes:

1. **Commit & Push**:
   - Stages all changes with `git add -A`
   - Creates a commit following [Conventional Commits](https://www.conventionalcommits.org/) specification
   - Pushes to remote repository

**Commit Message Format**:

VulnSweep generates detailed commit messages in Conventional Commits format:

```
fix(security): update vulnerable dependencies

Dependency vulnerabilities fixed:

| Library | From Version | To Version | CVE(s) | Vulnerability Description |
|---------|--------------|------------|--------|---------------------------|
| axios | 0.21.1 | 1.6.0 | CVE-2021-3749 | Axios Regular Expression Denial of Service |
| lodash | 4.17.19 | 4.17.21 | CVE-2020-8203, CVE-2021-23337 | Prototype pollution vulnerabilities |
```

The commit includes:
- **Title**: `fix(security):` prefix following Conventional Commits specification
- **Body**: A markdown table with vulnerability details:
  - **Library**: Name of the vulnerable package
  - **From Version**: Previously installed version
  - **To Version**: Updated version with fixes applied
  - **CVE(s)**: Comma-separated list of CVE identifiers
  - **Vulnerability Description**: Brief description of the security issue

**Log Console**: Monitor detailed output for each repository operation.

## Architecture Overview

### Project Structure

```
/src
  /main                     # Electron main process (Node.js backend)
    main.js                 # Entry point, IPC handlers, window management
    /modules
      discovery.js          # Project discovery logic
      git.js                # Git operations (reset, pull, commit, push)
      audit.js              # npm audit parsing and fix strategies
  
  /renderer                 # React frontend (UI)
    App.jsx                 # Main application component
    /components
      Header.jsx            # Top bar with controls and progress
      VulnerabilityGrid.jsx # Data table with vulnerabilities
      LogConsole.jsx        # Real-time logging panel
      Modal.jsx             # Confirmation dialogs
      Spinner.jsx           # Loading indicators
  
  /preload                  # IPC bridge (security boundary)
    preload.js              # Exposes safe APIs to renderer
```

### Key Technologies

- **Electron** - Desktop application framework combining Node.js and Chromium
- **React** - UI library for component-based interface
- **Vite** - Fast build tool and development server
- **Tailwind CSS** - Utility-first styling framework
- **Node.js child_process** - Executes git and npm CLI commands
- **semver** - Semantic versioning for risk assessment

### Fix Strategy Decision Tree

VulnSweep analyzes dependency relationships to determine the optimal fix:

**Scenario A: Direct Dependency**
```
vulnerable-package (direct dependency)
└─ Fix: npm install vulnerable-package@latest
```

**Scenario B: Transient with Updateable Parent**
```
parent-package@1.0.0 (direct)
└─ vulnerable-package@1.0.0 (transient)

parent-package@1.1.0 (available)
└─ vulnerable-package@1.0.5 (fixed)

Fix: npm install parent-package@1.1.0
```

**Scenario C: Transient Requiring Override**
```
parent-package@1.0.0 (direct, no update available)
└─ vulnerable-package@1.0.0 (transient, vulnerable)

Fix: Add npm override to package.json:
{
  "overrides": {
    "vulnerable-package": "1.0.5"
  }
}
```

### IPC Communication Flow

```
Renderer (React UI)
    ↓ User Action
window.electronAPI.analyzeProjects()
    ↓ IPC Channel
Main Process (Electron)
    ↓ Execute Operations
audit.js, git.js, discovery.js
    ↓ Results
Main Process
    ↓ IPC Channel
Renderer (Update UI)
```

## Configuration

### Git Reset Toggle

Located in the header next to the folder selector:

- **Purpose**: Controls whether `git reset --hard` is executed before pulling
- **Default**: Enabled (ON)
- **When to Disable**: 
  - Repositories may have uncommitted work
  - You want to manually review changes before reset
  - Testing/development workflows

### npm Overrides

VulnSweep automatically adds npm overrides when necessary (Scenario C). These require:

- **npm v8.3.0+** - Overrides feature availability
- **Compatible with**: npm, not supported by yarn/pnpm

Overrides force npm to use a specific package version throughout the dependency tree, even when parent packages request different versions.

## Known Limitations

- **npm Only**: Version 1 only supports npm package manager (not yarn or pnpm)
- **npm v8+ Required**: Overrides feature requires npm 8.3.0 or higher
- **Clean Working Directory**: Git operations assume clean working state
- **No Rollback**: Applied fixes cannot be automatically rolled back
- **Windows-Focused**: Developed primarily for Windows, but should work on Mac/Linux
- **No Dependency Lock**: Does not validate that fixes resolve all vulnerability chains
- **Single Branch**: Always works with the current branch, no branch switching

## Troubleshooting

### Common Issues

**"No projects found"**
- Ensure the selected directory contains subdirectories with `package.json` files
- Check that package.json files are valid JSON

**"npm audit failed"**
- Verify npm is installed: `npm --version`
- Ensure `node_modules` exists (run `npm install` first)
- Check network connectivity for npm registry access

**"Git operation failed"**
- Confirm git is installed: `git --version`
- Ensure you have write access to repositories
- Check that repositories have remote origins configured
- Verify you're authenticated with git (SSH keys or credentials)

**"Override not working"**
- Upgrade npm: `npm install -g npm@latest`
- Verify npm version supports overrides: `npm --version` (should be 8.3.0+)
- Delete `node_modules` and `package-lock.json`, then run `npm install`

**Application won't start**
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Clear Electron cache: `rm -rf ~/AppData/Roaming/vulnsweep` (Windows)
- Check Node.js version: `node --version` (should be 18+)

**High risk fixes causing issues**
- Review the **Proposed Fix** column before applying HIGH risk fixes
- Test fixes in a separate branch first
- Disable auto-selection and manually review each HIGH risk fix

## Development

### Running Tests

```bash
# No tests currently implemented
# TODO: Add unit tests for audit.js logic
# TODO: Add integration tests for git operations
```

### Adding New Features

1. **Backend Module**: Add to `src/main/modules/`
2. **IPC Handler**: Register in `src/main/main.js`
3. **Preload API**: Expose in `src/preload/preload.js`
4. **Frontend Component**: Add to `src/renderer/components/`
5. **Use in App**: Import and use in `src/renderer/App.jsx`

### Code Style

- Use functional React components with hooks
- Follow existing patterns for async/await error handling
- Log important operations to the console
- Maintain IPC security boundary (no Node.js APIs in renderer)

## Building & Distribution

### Building the Installer

To create distributable installers for VulnSweep:

```bash
npm run build
```

This command performs two steps:
1. Builds the renderer (React UI) using Vite → outputs to [`dist-renderer/`](dist-renderer)
2. Packages the application with electron-builder → outputs installers to [`dist/`](dist)

The build process automatically includes all necessary files, assets, and dependencies required for the application to run standalone.

### Platform-Specific Installers

electron-builder generates platform-specific installers based on your operating system:

- **Windows**: NSIS installer (`.exe`)
  - Full installer with automatic shortcuts
  - Uninstaller included
  
- **macOS**: Application bundle (`.app`)
  - Signed and notarized (if certificates configured)
  - Drag-and-drop installation
  
- **Linux**: AppImage and Debian package
  - AppImage (`.AppImage`) - Portable, no installation required
  - Debian package (`.deb`) - For Ubuntu/Debian-based systems

**Note**: Cross-platform builds require additional configuration. By default, electron-builder creates installers for your current platform only.

### Build Process Overview

The build process follows these steps:

1. **Vite Build** - Compiles and optimizes the React renderer
   - Bundles JavaScript and CSS
   - Optimizes assets (images, fonts)
   - Outputs to [`dist-renderer/`](dist-renderer) directory

2. **electron-builder Packaging** - Packages the Electron application
   - Bundles main process ([`src/main/main.js`](src/main/main.js))
   - Includes preload scripts ([`src/preload/preload.js`](src/preload/preload.js), [`src/preload/splash-preload.js`](src/preload/splash-preload.js))
   - Copies renderer build from [`dist-renderer/`](dist-renderer)
   - Embeds application icon ([`assets/mini_logo.png`](assets/mini_logo.png))
   - Creates platform-specific installer

3. **Installer Generation** - Creates distributable packages
   - Generates installers in [`dist/`](dist) directory
   - Includes all runtime dependencies
   - Configures auto-update mechanism (if enabled)

### Distribution Notes

- **Version Display**: The splash screen dynamically displays the current version from [`package.json`](package.json) (currently v1.0.0)
- **Application Icon**: Uses [`assets/mini_logo.png`](assets/mini_logo.png) for the app icon and installer branding
- **App ID**: `com.vulnsweep.app` - Used for application identification on the system
- **Installation Size**: Approximately 200-300 MB (includes Chromium runtime and Node.js)
- **Auto-Updates**: Configured but requires update server setup for production deployment

### Configuration

The electron-builder configuration is defined in [`package.json`](package.json:82) under the `"build"` key:

```json
{
  "build": {
    "appId": "com.vulnsweep.app",
    "productName": "VulnSweep",
    "directories": {
      "output": "dist"
    },
    "files": [
      "dist-renderer/**/*",
      "src/main/**/*",
      "src/preload/**/*",
      "assets/**/*",
      "package.json"
    ]
  }
}
```

**Customization Options**:
- Modify `appId` for different deployment environments
- Add code signing certificates for Windows/macOS
- Configure target platforms in `build.win`, `build.mac`, `build.linux`
- Customize installer appearance and behavior
- Enable/disable auto-update functionality

For advanced configuration options, refer to the [electron-builder documentation](https://www.electron.build/).

## Troubleshooting

### Build Error: ERR_ELECTRON_BUILDER_CANNOT_EXECUTE

**Error Message:**
```
Error: app-builder.exe process failed ERR_ELECTRON_BUILDER_CANNOT_EXECUTE
```

**Root Cause:**
This error occurs when Windows lacks permission to create symbolic links while electron-builder extracts its cache files (specifically when extracting `winCodeSign-2.6.0.7z` which contains macOS symbolic links).

**Solutions:**

#### Solution 1: Enable Windows Developer Mode (Recommended)

This is the simplest and safest solution:

1. Open Windows Settings (Win + I)
2. Go to **Privacy & Security** → **For developers**
3. Turn ON **Developer Mode**
4. Restart your terminal/VSCode
5. Clear the electron-builder cache and rebuild:
   ```cmd
   rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
   npm run build
   ```

#### Solution 2: Assign "Create symbolic links" Privilege

If you cannot enable Developer Mode (e.g., company policy):

1. Press **Win + R**, type `secpol.msc` and press Enter (requires local admin access)
2. Navigate to: **Local Policies** → **User Rights Assignment**
3. Find **"Create symbolic links"** policy
4. Double-click it and click **"Add User or Group"**
5. Click **"Advanced"** → **"Find Now"**
6. Select your username from the list
7. Click **OK** on all dialogs
8. **Restart your computer** (required for the policy to take effect)
9. After restart, clear cache and rebuild:
   ```cmd
   rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
   npm run build
   ```

**Note:** `secpol.msc` is not available on Windows Home edition.

#### Solution 3: Skip Code Signing (Development Only)

If you only need to build for local testing without code signing, add to the `"win"` section in [`package.json`](package.json:95):

```json
"win": {
  "icon": "assets/mini_logo.png",
  "target": ["nsis"],
  "sign": null
}
```

Then clear cache and rebuild:
```cmd
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
npm run build
```

#### Solution 4: Run as Administrator (Temporary Workaround)

1. Close VSCode
2. Right-click VSCode icon → **"Run as administrator"**
3. Open your project
4. Run:
   ```cmd
   rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
   npm run build
   ```

**Caution:** Running VSCode as admin is not recommended for regular development.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Credits

Built to automate npm vulnerability resolution across 20+ repositories, saving hours of manual dependency management.

**Author**: [Your Name]

**Technologies**: Electron, React, Vite, Tailwind CSS, Node.js