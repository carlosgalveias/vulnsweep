const fs = require('fs');
const os = require('os');
const path = require('path');
const sludge = require('sludge-crypt');
const systeminformation = require('systeminformation');
const { storeGet, storeSet } = require('../utils/secure-store');

// COMMERCIAL_BUILD environment variable (set via cross-env in build scripts):
//   cross-env COMMERCIAL_BUILD=true
// Currently available for future feature-gating (e.g. disabling free-tier
// scan limits in commercial distributions). Not yet read at runtime.
// To branch on it: const isCommercialBuild = process.env.COMMERCIAL_BUILD === 'true';

/**
 * Returns the OS-specific path to the .vsweep marker file.
 *
 * Each platform uses a different, non-obvious subdirectory so that no
 * single "delete this file to reset the trial" tip works cross-platform:
 *
 *   Windows  → %LOCALAPPDATA%\Microsoft\OneDrive\logs\.vsweep
 *              Buried inside the OneDrive log tree; routinely ignored by AV
 *              heuristics because real OneDrive log noise already lives there.
 *              The previous path (AppData\Local\Microsoft\Windows\) sits inside
 *              a directory that Windows Defender actively monitors — a random
 *              dotfile there would be flagged or silently removed on many systems.
 *
 *   macOS    → ~/Library/Caches/com.apple.helpd/.vsweep
 *              Looks like Apple's help-daemon cache; not a typical user location.
 *
 *   Linux    → ~/.local/share/recently-used.xbel.d/.vsweep
 *              Camouflaged as a GTK recently-used auxiliary directory.
 *
 *   Other    → ~/.config/.vsweep  (safe fallback)
 *
 * IMPORTANT: This function is a pure path resolver. It performs NO filesystem
 * I/O. Call ensureVsweepDir() before any write that requires the directory to
 * exist. These two concerns must remain separated.
 *
 * @returns {string} Absolute path to the .vsweep marker file.
 */
function getVsweepFilePath() {
  const home = os.homedir();

  switch (process.platform) {
    case 'win32':
      return path.join(home, 'AppData', 'Local', 'Microsoft', 'OneDrive', 'logs', '.vsweep');
    case 'darwin':
      return path.join(home, 'Library', 'Caches', 'com.apple.helpd', '.vsweep');
    case 'linux':
      return path.join(home, '.local', 'share', 'recently-used.xbel.d', '.vsweep');
    default:
      return path.join(home, '.config', '.vsweep');
  }
}

/**
 * Ensures the parent directory of the vsweep marker file exists, creating it
 * recursively if necessary. Must be called explicitly before any write to the
 * marker file. Separated from getVsweepFilePath() so that read-only callers
 * (e.g. checkLicense) never trigger unnecessary filesystem side effects, and
 * so that failures during directory creation are attributed to the write path,
 * not to a function whose name implies it only returns a string.
 *
 * @param {string} filePath - Absolute path whose parent directory must exist.
 * @throws {Error} Propagates the underlying fs error (e.g. EACCES on a
 *   read-only filesystem) so callers can handle or surface it appropriately.
 */
function ensureVsweepDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

const PROMO_DAYS = 30;
const PROMO_PRICE = '9.00';
const FULL_PRICE = '30.00';

/**
 * Returns the safe promo-defaults object used as a fallback when getInstallInfo()
 * throws. Exported so main.js IPC handlers can reference canonical constants
 * rather than duplicating magic numbers in error fallback branches.
 * @returns {{ installDate: null, daysElapsed: number, daysRemaining: number, isPromo: boolean, price: string }}
 */
function getPromoDefaults() {
  return {
    installDate: null,
    daysElapsed: 0,
    daysRemaining: PROMO_DAYS,
    isPromo: true,
    price: PROMO_PRICE,
  };
}

/**
 * Stores the install timestamp in the encrypted store on first run.
 * Key 'i' holds the ms timestamp as a plain number string.
 */
function initInstallDate() {
  const existing = storeGet('i');
  if (!existing) {
    storeSet('i', String(Date.now()));
  }
}

/**
 * Returns promotion / pricing info based on installation date.
 */
function getInstallInfo() {
  initInstallDate();
  const raw = storeGet('i');
  const installTs = raw ? parseInt(raw, 10) : Date.now();
  const now = Date.now();
  const msElapsed = now - installTs;
  const daysElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, PROMO_DAYS - daysElapsed);
  const isPromo = daysRemaining > 0;
  return {
    installDate: new Date(installTs).toISOString(),
    daysElapsed,
    daysRemaining,
    isPromo,
    price: isPromo ? PROMO_PRICE : FULL_PRICE,
  };
}

async function getDeviceData() {
  const [baseboard, networkInterfaces] = await Promise.all([
    systeminformation.baseboard(),
    systeminformation.networkInterfaces(),
  ]);

  const network = Array.isArray(networkInterfaces) ? networkInterfaces : [networkInterfaces];
  const mac1 = network.length > 0 ? network[0].mac : '00:00:00:00:00:00';

  return {
    serialNumber: baseboard.serial || 'unknown',
    mac1,
  };
}

async function checkLicense() {
  const isCommercial = true;
  console.log('[License] Commercial flag:', isCommercial);

  // Always ensure install date is recorded
  initInstallDate();

  // Pure path resolution — no filesystem side effect on a read-only check path.
  const vsweepFile = getVsweepFilePath();
  console.log('[License] Checking vsweep marker at:', vsweepFile);
  if (!fs.existsSync(vsweepFile)) {
    console.log('[License] Marker file not found.');
    return { isCommercial: true, isLicensed: false };
  }

  const v = storeGet('v');
  const k = storeGet('k');

  if (!v || !k) {
    console.log('[License] Store keys missing.');
    return { isCommercial: true, isLicensed: false };
  }

  try {
    const stat = fs.statSync(vsweepFile);
    const creationDate = Math.floor(stat.birthtimeMs || stat.ctimeMs);
    console.log(
      '[License] Decrypting license payload with marker date:',
      new Date(creationDate).toISOString(),
      '| creationDate (ms):',
      creationDate
    );

    const privateKey = JSON.parse(k);
    const decrypted = await sludge.decompose(v, privateKey, creationDate);

    let parsed;
    try {
      parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    } catch (e) {
      console.warn('[License] Failed to JSON.parse decrypted payload, using raw value:', e.message);
      parsed = decrypted;
    }

    const deviceData = await getDeviceData();
    if (parsed && parsed.serialNumber === deviceData.serialNumber) {
      console.log('[License] Validation passed for serial:', deviceData.serialNumber);
      return { isCommercial: true, isLicensed: true, scans: 0 };
    } else {
      console.log('[License] Validation failed or serial mismatch.');
      return { isCommercial: true, isLicensed: false };
    }
  } catch (err) {
    console.error('[License] check failed:', err);
    return { isCommercial: true, isLicensed: false };
  }
}

async function activateLicense(paymentData) {
  try {
    const vsweepFile = getVsweepFilePath();
    if (!fs.existsSync(vsweepFile)) {
      ensureVsweepDir(vsweepFile);
      fs.writeFileSync(vsweepFile, '');
    }

    const stat = fs.statSync(vsweepFile);
    const creationDate = Math.floor(stat.birthtimeMs || stat.ctimeMs);

    const keys = await sludge.generateBilePair();
    const pStr = JSON.stringify(keys.publicKey);
    const kStr = JSON.stringify(keys.privateKey);

    storeSet('p', pStr);
    storeSet('k', kStr);

    const deviceData = await getDeviceData();
    const payload = {
      serialNumber: deviceData.serialNumber,
      mac1: deviceData.mac1,
      paymentId: paymentData.id,
      timestamp: Date.now(),
    };

    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);
    storeSet('v', encrypted);

    return { success: true };
  } catch (err) {
    console.error('License activation failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Generates and persists a device-bound license after a confirmed payment.
 * Called by the main process when the PayPal success URL is detected in the
 * payment BrowserWindow — no payment ID is needed because the URL redirect
 * itself acts as the payment confirmation signal.
 *
 * @returns {Promise<{ ok: true, key: string } | { ok: false, error: string }>}
 */
async function generateLicense() {
  try {
    const vsweepFile = getVsweepFilePath();
    if (!fs.existsSync(vsweepFile)) {
      ensureVsweepDir(vsweepFile);
      fs.writeFileSync(vsweepFile, '');
    }

    const stat = fs.statSync(vsweepFile);
    const creationDate = Math.floor(stat.birthtimeMs || stat.ctimeMs);

    const keys = await sludge.generateBilePair();
    storeSet('p', JSON.stringify(keys.publicKey));
    storeSet('k', JSON.stringify(keys.privateKey));

    const deviceData = await getDeviceData();
    const payload = {
      serialNumber: deviceData.serialNumber,
      mac1: deviceData.mac1,
      timestamp: Date.now(),
    };

    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);
    storeSet('v', encrypted);

    // Build a human-readable license key string for display/confirmation.
    // Format: VS-<base64url-truncated-serial>-<timestamp-hex>
    const serialB64 = Buffer.from(deviceData.serialNumber, 'utf8')
      .toString('base64')
      .replace(/[+/=]/g, '')
      .toUpperCase()
      .slice(0, 8);
    const tsHex = Date.now().toString(16).toUpperCase();
    const licenseKey = `VS-${serialB64}-${tsHex}`;

    console.log('[License] generateLicense() succeeded, key:', licenseKey);
    return { ok: true, key: licenseKey };
  } catch (err) {
    console.error('[License] generateLicense() failed:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  checkLicense,
  activateLicense,
  generateLicense,
  getInstallInfo,
  getPromoDefaults,
};
