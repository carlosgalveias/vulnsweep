
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

## High-Level Architecture

VulnSweep follows Electron's multi-process architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                        Electron App                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────┐         ┌──────────────────────┐   │
│  │   Main Process     │◄────────┤  Renderer Process    │   │
│  │   (Node.js)        │  IPC    │  (Chromium/React)    │   │
│  │                    ├────────►│                      │   │
│  └────────┬───────────┘         └──────────┬───────────┘   │
│           │                                 │               │
│           │                                 │               │
│  ┌────────▼────────────────────────────────▼──────────┐    │
│  │            Preload Script (IPC Bridge)             │    │
│  │         contextBridge.exposeInMainWorld()          │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Operating System APIs                    │
│               (File System, Git, npm CLI)                   │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend (Renderer Process)
- **React 18.2** - UI library with hooks-based architecture
- **Vite 5.0** - Build tool and development server
- **Tailwind CSS 3.4** - Utility-first CSS framework with custom compact utilities (v1.4.0+)
- **PostCSS** - CSS processing

**UI Design System (v1.4.0+)**:
- Compact desktop app aesthetic with 13px base font size
- Custom utility classes: `compact-cell`, `compact-header`, `compact-input`, `compact-btn`, `compact-text`, `compact-text-xs`
- Professional scrollbar styling for desktop environments
- Optimized for information-dense interfaces

### Backend (Main Process)
- **Electron 28.2** - Desktop application framework
- **Node.js** - JavaScript runtime
- **child_process** - CLI command execution
- **semver 7.6** - Semantic versioning library

### Development
- **Concurrently** - Run multiple processes
- **wait-on** - Wait for resources before proceeding
- **cross-env** - Cross-platform environment variables

## Application Layers

### Layer 1: Renderer Process (UI Layer)

Located in `src/renderer/`, this layer handles all user interactions and visual presentation.

```
src/renderer/
├── App.jsx                 # Root component, orchestrates workflows
├── main.jsx                # React entry point
├── index.html              # HTML shell
├── index.css               # Global styles with compact utility classes
├── components/
│   ├── Header.jsx          # Top navigation and controls
│   ├── VulnerabilityGrid.jsx  # Data table with filtering/sorting
│   ├── LogConsole.jsx      # Real-time log display
│   ├── Modal.jsx           # Reusable confirmation dialog
│   ├── Spinner.jsx         # Loading indicator component
│   └── InfoTooltip.jsx     # Reusable tooltip component (v1.4.0+)
└── hooks/
    ├── useProjectDiscovery.js     # Project discovery state management
    ├── useVulnerabilityScanner.js # Vulnerability scanning logic
    ├── useFixApplication.js       # Fix application workflows
    ├── useGitOperations.js        # Git operations handling
    └── useLogConsole.js           # Log console state management
```

**Key Responsibilities:**
- User interaction handling
- State management (React hooks)
- Data presentation and visualization
- IPC communication initiation

### Layer 2: Preload Script (Security Layer)

Located in `src/preload/preload.js`, this layer creates a secure bridge between renderer and main processes.

```javascript
// Exposes limited, safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  discoverProjects: (basePath) => ipcRenderer.invoke('discovery:scan', basePath),
  analyzeProjects: (paths) => ipcRenderer.invoke('audit:analyze', paths),
  // ... more APIs
});
```

**Key Responsibilities:**
- Security boundary enforcement
- API exposure with type safety
- IPC message routing
- Event listener management

### Layer 3: Main Process (Backend Layer)

Located in `src/main/`, this layer handles all system operations and business logic.

```
src/main/
├── main.js                 # Electron entry, window management, IPC handlers
└── modules/
    ├── discovery.js        # Project discovery logic
    ├── git.js              # Git operations wrapper
    └── audit.js            # npm audit analysis and fix strategies
```

**Key Responsibilities:**
- System resource access (file system, processes)
- CLI command execution (git, npm)
- Business logic implementation
- Data processing and transformation

## Module Details

### discovery.js

**Purpose**: Recursively discover Node.js projects in a directory tree.

**Algorithm**:
```
function discoverProjects(basePath):
  results = []
  
  for each directory in basePath:
    if directory contains package.json:
      results.add({
        name: package.json.name,
        path: directory path,
        hasNodeModules: check for node_modules/
      })
    
    recurse into subdirectories
  
  return results
```

**Key Functions**:
- `discoverProjects(basePath)` - Main entry point
- `isNodeProject(dir)` - Checks for package.json
- `getProjectName(packageJson)` - Extracts project name

### git.js

**Purpose**: Execute git operations on repositories.

**Operations**:
```javascript
// Reset to clean state (destructive)
async resetRepository(projectPath) {
  exec('git reset --hard HEAD')
}

// Pull latest changes
async pullRepository(projectPath) {
  exec('git pull')
}

// Commit all changes
async commitChanges(projectPath, message) {
  exec('git add -A')
  exec(`git commit -m "${message}"`)
}

// Push to remote
async pushChanges(projectPath) {
  exec('git push')
}
```

**Error Handling**:
- Captures stderr output
- Returns structured error objects
- Logs git command output

### audit.js

**Purpose**: Parse npm audit output and determine fix strategies.

**Core Algorithm**:

```javascript
async function analyzeProject(projectPath) {
  // 1. Run npm audit
  const auditOutput = await execCommand('npm audit --json')
  
  // 2. Parse vulnerabilities
  const vulnerabilities = parseAuditOutput(auditOutput)
  
  // 3. Determine fix strategies
  const strategies = await determineFixStrategies(
    vulnerabilities,
    projectPath
  )
  
  return { vulnerabilities, strategies }
}
```

**Fix Strategy Decision Tree**:

```
For each vulnerability:
  
  Is it a direct dependency?
  │
  ├─ YES ──► Scenario A: Direct Update
  │          Strategy: npm install <package>@<version>
  │          Risk: Check semver diff
  │
  └─ NO ───► It's a transient dependency
             │
             Check parent dependencies
             │
             Can parent be updated to fix it?
             │
             ├─ YES ──► Scenario B: Parent Update
             │          Strategy: npm install <parent>@<version>
             │          Risk: Check parent semver diff
             │
             └─ NO ───► Scenario C: Override Required
                        Strategy: Add npm override
                        Risk: LOW (forces specific version)
```

**Risk Assessment Logic**:

```javascript
function assessRisk(currentVersion, targetVersion) {
  const current = semver.parse(currentVersion)
  const target = semver.parse(targetVersion)
  
  // Major version change = HIGH risk
  if (target.major > current.major) {
    return 'HIGH'
  }
  
  // Minor or patch = LOW risk
  return 'LOW'
}
```

## Data Flow

### Complete Workflow Data Flow

```
1. USER ACTION: Select Folder
   │
   ├─► Renderer: handleBrowseFolder()
   │   └─► IPC: dialog:selectFolder
   │       └─► Main: Open folder dialog
   │           └─► IPC: Return folder path
   │               └─► Renderer: setSelectedFolder(path)
   │
   ├─► Renderer: Auto-trigger discovery
   │   └─► IPC: discovery:scan
   │       └─► Main: discoverProjects(basePath)
   │           └─► Traverse file system
   │               └─► Find package.json files
   │                   └─► IPC: Return project list
   │                       └─► Renderer: setProjects(projects)

2. USER ACTION: Scan & Audit
   │
   ├─► Renderer: handleScanAudit()
   │   └─► Set isScanning = true
   │   └─► IPC: audit:analyze (project paths)
   │       └─► Main: For each project:
   │           ├─► Execute: npm audit --json
   │           ├─► Parse vulnerabilities
   │           ├─► Determine fix strategies
   │           ├─► Assess risk levels
   │           └─► IPC: Send progress events
   │               └─► Renderer: Update progress bar
   │           └─► IPC: Return analysis results
   │               └─► Renderer: Transform to UI format
   │                   └─► setVulnerabilities(vulns)
   │                   └─► Auto-select LOW risk
   │                   └─► Set isScanning = false

3. USER ACTION: Apply Fixes
   │
   ├─► Renderer: handleApplyFixes()
   │   ├─► Check for HIGH risk vulnerabilities
   │   ├─► If HIGH risk: Show confirmation modal
   │   │   └─► User confirms
   │   │
   │   └─► applyFixesInternal()
   │       └─► Group by project
   │       └─► For each project:
   │           └─► IPC: audit:applyFixes (strategies)
   │               └─► Main: For each strategy:
   │                   ├─► Type A: npm install <package>@<version>
   │                   ├─► Type B: npm install <parent>@<version>
   │                   └─► Type C: Add override to package.json
   │                       └─► IPC: Return applied/failed counts
   │                           └─► Renderer: Update vulnerability status

4. USER ACTION: Commit & Push
   │
   ├─► Renderer: handleCommitPush()
   │   ├─► Check allowReset flag
   │   ├─► If enabled: Show confirmation modal
   │   │   └─► User confirms
   │   │
   │   └─► commitPushInternal()
   │       └─► Get projects with resolved vulnerabilities
   │       └─► For each project:
   │           ├─► IPC: git:prepare (allowReset)
   │           │   └─► Main: 
   │           │       ├─► git reset --hard (if enabled)
   │           │       └─► git pull
   │           │           └─► IPC: Return success/error
   │           │
   │           └─► IPC: git:commitPush (message)
   │               └─► Main:
   │                   ├─► git add -A
   │                   ├─► git commit -m "message"
   │                   └─► git push
   │                       └─► IPC: Return success/error
   │                           └─► Renderer: Update logs
```

## State Management

VulnSweep uses React's built-in state management with hooks (no Redux/MobX).

### Core State Structure

```javascript
// App.jsx state
const [selectedFolder, setSelectedFolder] = useState('')
const [projects, setProjects] = useState([])
const [vulnerabilities, setVulnerabilities] = useState([])
const [selectedVulns, setSelectedVulns] = useState(new Set())
const [logs, setLogs] = useState([])
const [progress, setProgress] = useState(null)
const [isScanning, setIsScanning] = useState(false)
const [isApplying, setIsApplying] = useState(false)
const [isCommitting, setIsCommitting] = useState(false)
const [allowReset, setAllowReset] = useState(true)
const [modalState, setModalState] = useState({
  isOpen: false,
  type: null,
  data: null
})
```

### State Update Patterns

**Immutable Updates**:
```javascript
// Adding to array
setLogs(prev => [...prev, newLog])

// Updating specific items
setVulnerabilities(prev => prev.map(v => 
  v.id === targetId ? { ...v, status: 'resolved' } : v
))

// Set operations
setSelectedVulns(prev => {
  const newSet = new Set(prev)
  newSet.add(id)
  return newSet
})
```

**Derived State**:
```javascript
// Computed from existing state
const buttonsState = {
  scanAudit: projects.length > 0 && !isScanning && !isApplying && !isCommitting,
  applyFixes: selectedVulns.size > 0 && !isApplying && !isScanning && !isCommitting,
  commitPush: vulnerabilities.some(v => v.status === 'resolved') && !isCommitting && !isApplying && !isScanning
}
```

## IPC Communication

### Channel Naming Convention

Format: `<module>:<action>`

Examples:
- `dialog:selectFolder`
- `discovery:scan`
- `audit:analyze`
- `audit:applyFixes`
- `git:prepare`
- `git:commitPush`

### IPC Handler Pattern

**Main Process** (src/main/main.js):
```javascript
ipcMain.handle('audit:analyze', async (event, projectPaths) => {
  try {
    const results = await analyzeProjects(projectPaths)
    return { success: true,  results }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
```

**Preload Script** (src/preload/preload.js):
```javascript
analyzeProjects: (paths) => ipcRenderer.invoke('audit:analyze', paths)
```

**Renderer** (src/renderer/App.jsx):
```javascript
const result = await window.electronAPI.analyzeProjects(projectPaths)
if (result.success) {
  // Handle data
} else {
  // Handle error
}
```

### Event-Based Communication (Progress Updates)

**Main Process**:
```javascript
// Send progress event
mainWindow.webContents.send('audit:progress', {
  current: 5,
  total: 10,
  projectName: 'my-project'
})

// Send log event
mainWindow.webContents.send('log:message', {
  timestamp: new Date().toISOString(),
  level: 'info',
  message: 'Processing...'
})
```

**Preload Script**:
```javascript
onAnalysisProgress: (callback) => {
  const subscription = (event, data) => callback(data)
  ipcRenderer