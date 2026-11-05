/**
 * Renderer API Opcodes
 *
 * Numeric dispatch codes for window.electronAPI.invoke() / .on() / .off()
 *
 * RULES:
 * - 0x01–0x7F: Request-response (ipcRenderer.invoke) operations
 * - 0x80–0xFE: Push-event (ipcRenderer.on) subscriptions
 * - 0xF0–0xFE: Reserved for splash preload
 * - NEVER reuse or change a deployed opcode value
 */

// ═══════════════════════════════════════════
// REQUEST-RESPONSE OPCODES (invoke)
// ═══════════════════════════════════════════

// Project Discovery
export const OP_SELECT_FOLDER = 0x01;
export const OP_DISCOVER_PROJECTS = 0x02;

// Git Operations
export const OP_PREPARE_REPOSITORY = 0x03;
export const OP_COMMIT_AND_PUSH = 0x04;

// Audit / Scan Operations
export const OP_ANALYZE_PROJECT = 0x05;
export const OP_ANALYZE_PROJECTS = 0x06;
export const OP_SCAN_PROJECT = 0x07;
export const OP_SCAN_PROJECTS = 0x08;
export const OP_CANCEL_SCAN = 0x09;
export const OP_GET_SCAN_SETTINGS = 0x0a;
export const OP_APPLY_FIXES = 0x0b;

// Dependency Updates
export const OP_SCAN_DEP_UPDATES = 0x0c;
export const OP_APPLY_DEP_UPDATES = 0x0d;

// License Scan & SBOM
export const OP_SCAN_LICENSES = 0x0e;
export const OP_SBOM_GET_SAVE_PATH = 0x0f;
export const OP_SBOM_EXPORT = 0x10;

// App Info & Docs
export const OP_GET_APP_VERSION = 0x1c;
export const OP_OPEN_LOCAL_DOC = 0x1d;

// Scan Cache
export const OP_CACHE_CLEAR = 0x20;
export const OP_CACHE_GET_STATS = 0x21;

// Credentials
export const OP_GET_CREDENTIAL_STATUS = 0x22;
export const OP_SET_CREDENTIAL = 0x23;
export const OP_DELETE_CREDENTIAL = 0x24;

// Settings
export const OP_GET_SETTINGS = 0x25;
export const OP_SET_SETTINGS = 0x26;

// Dependency Paths
export const OP_GET_DEPENDENCY_PATHS = 0x27;

// Shell (special — uses shell.openExternal, NOT ipcRenderer.invoke)
export const OP_OPEN_EXTERNAL = 0x28;

// ═══════════════════════════════════════════
// PUSH-EVENT OPCODES (on/off)
// ═══════════════════════════════════════════

export const OP_ON_LOG_MESSAGE = 0x80;
export const OP_ON_SCAN_PROGRESS = 0x81;
export const OP_ON_ANALYSIS_PROGRESS = 0x82;
export const OP_ON_DEP_UPDATE_PROGRESS = 0x83;

// ═══════════════════════════════════════════
// SPLASH-SPECIFIC OPCODES
// ═══════════════════════════════════════════

export const OP_ON_SPLASH_DATA = 0xf0;
