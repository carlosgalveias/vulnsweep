const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const sludge = require('sludge-crypt');
const systeminformation = require('systeminformation');
const { LICENSE_CONFIG } = require('../config/constants');
const { storeGet, storeSet } = require('../utils/secure-store');

// Backup/Restore constants — v2 format uses AES-256-GCM with hardware-derived key
const BACKUP_MAGIC = Buffer.from([0x56, 0x53, 0x57, 0x42]); // ASCII "VSWB"
const BACKUP_VERSION = 0x02;
const APP_SALT = 'vulnsweep-backup-v2-2026'; // non-secret PBKDF2 domain separator

/**
 * Derives a 256-bit AES key from hardware identifiers that survive OS reinstalls.
 * Identifiers used: motherboard serial, BIOS UUID, CPU brand+cores.
 * MAC address and hostname are excluded — they change on NIC swap / user rename.
 * @returns {Promise<Buffer>} 32-byte key
 */
async function getHardwareKey() {
  const [baseboard, bios, cpu] = await Promise.all([
    systeminformation.baseboard(),
    systeminformation.bios(),
    systeminformation.cpu(),
  ]);
  const GENERIC = new Set([
    '',
    'default string',
    'to be filled by o.e.m.',
    'not specified',
    'none',
    '0',
  ]);
  function norm(s) {
    if (s == null) return '';
    const t = String(s).trim();
    return GENERIC.has(t.toLowerCase()) ? '' : t.toUpperCase();
  }
  const parts = [
    norm(baseboard.serial),
    norm(bios.serial),
    norm((cpu.brand || '') + String(cpu.physicalCores || '')),
  ].filter((p) => p.length > 0);
  const hw = parts.length > 0 ? parts.join('|') : 'VSWEEP-GENERIC-HW';
  // 200,000 iterations meets OWASP 2024 minimum for PBKDF2-SHA256
  return crypto.pbkdf2Sync(hw, APP_SALT, 200_000, 32, 'sha256');
}

function restoreVsweepFileWithBirthtime(vsweepPath, targetBirthtimeMs) {
  // Step 1: Ensure directory exists
  const dir = path.dirname(vsweepPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Step 2: Delete existing file FIRST — overwrite does NOT reset birthtimeMs on NTFS
  if (fs.existsSync(vsweepPath)) {
    fs.unlinkSync(vsweepPath);
  }

  // Step 3: Create new zero-byte file
  fs.writeFileSync(vsweepPath, Buffer.alloc(0));

  // Step 4: Set CreationTimeUtc via PowerShell using a static script file with typed
  // -ArgumentList parameters. The path is NEVER interpolated into the script string —
  // PowerShell receives it as a typed [string] parameter, eliminating command injection.
  // Windows FILETIME = (Unix ms + 11644473600000) * 10000
  const windowsFileTime = (targetBirthtimeMs + 11644473600000) * 10000;
  const scriptPath = path.join(__dirname, 'scripts', 'set-birthtime.ps1');
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-FilePath',
      vsweepPath,
      '-WindowsFileTime',
      String(windowsFileTime),
    ],
    { shell: false, windowsHide: true, timeout: 10000 }
  );
  if (result.status !== 0) {
    const errMsg = result.stderr ? result.stderr.toString().trim() : 'unknown error';
    throw new Error(`CreationTime could not be set on this system: ${errMsg}`);
  }

  // Step 5: Post-set verification — read back birthtimeMs and verify within tolerance
  const stat = fs.statSync(vsweepPath);
  const actual = stat.birthtimeMs;
  const tolerance = 1000; // 1-second tolerance
  if (Math.abs(actual - targetBirthtimeMs) > tolerance) {
    try {
      fs.unlinkSync(vsweepPath);
    } catch {
      /* ignore cleanup errors */
    }
    throw new Error(
      `License restore failed: CreationTime could not be set on this system. ` +
        `Expected ${targetBirthtimeMs}, got ${actual}. ` +
        `Your environment may not support file creation time modification.`
    );
  }
}

function getVsweepFilePath() {
  const { resolveDataDir } = require('../utils/resolve-data-dir');
  const newPath = path.join(resolveDataDir(), '.vsweep');

  // Migration: if old ~/.vulnsweep/.vsweep exists but the new location does NOT,
  // copy the old file over preserving timestamps (critical for license validation).
  // Do NOT delete the old file.
  const oldPath = path.join(os.homedir(), '.vulnsweep', '.vsweep');
  try {
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      const dir = path.dirname(newPath);
      fs.mkdirSync(dir, { recursive: true });

      if (process.platform === 'linux') {
        // On Linux, birthtimeMs cannot be preserved on copy — copying creates a new
        // birthtimeMs/ctimeMs which breaks license validation (uses birthtimeMs as salt).
        // Use a symlink instead to maintain the original file's timestamps.
        try {
          fs.symlinkSync(oldPath, newPath);
        } catch {
          // If symlink fails (permissions), don't migrate — license will still
          // validate from old path since getVsweepFilePath checks existence.
        }
      } else {
        // Windows/macOS: copy is safe (birthtimeMs preserved by filesystem)
        fs.copyFileSync(oldPath, newPath);
        const stat = fs.statSync(oldPath);
        fs.utimesSync(newPath, stat.atime, stat.mtime);
      }
    }
  } catch {
    /* migration is best-effort */
  }

  return newPath;
}

function ensureVsweepDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

const PROMO_DAYS = 30;
const PROMO_PRICE = '9.00';
const FULL_PRICE = '30.00';

function getPromoDefaults() {
  return {
    installDate: null,
    daysElapsed: 0,
    daysRemaining: PROMO_DAYS,
    isPromo: true,
    price: PROMO_PRICE,
  };
}

function initInstallDate() {
  if (!storeGet('i')) storeSet('i', String(Date.now()));
}

function getInstallInfo() {
  initInstallDate();
  const raw = storeGet('i');
  const installTs = raw ? parseInt(raw, 10) : Date.now();
  const now = Date.now();
  const daysElapsed = Math.floor((now - installTs) / 86400000);
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

function getActivePrice() {
  const installTs = parseInt(storeGet('i'), 10);
  if (!installTs || isNaN(installTs))
    return { price: LICENSE_CONFIG.PROMO_PRICE_EUR, isPromo: true, promoEndsAt: null };
  const now = Date.now();
  const promoDaysMs = LICENSE_CONFIG.PROMO_DAYS * 86400000;
  const promoEndsAt = new Date(installTs + promoDaysMs).toISOString();
  const isPromo = (now - installTs) / 86400000 < LICENSE_CONFIG.PROMO_DAYS;
  return {
    price: isPromo ? LICENSE_CONFIG.PROMO_PRICE_EUR : LICENSE_CONFIG.FULL_PRICE_EUR,
    isPromo,
    promoEndsAt: isPromo ? promoEndsAt : null,
  };
}

async function getDeviceData() {
  const [baseboard, networkInterfaces] = await Promise.all([
    systeminformation.baseboard(),
    systeminformation.networkInterfaces(),
  ]);
  const network = Array.isArray(networkInterfaces) ? networkInterfaces : [networkInterfaces];
  const mac1 = network.length > 0 ? network[0].mac : '00:00:00:00:00:00';
  return { serialNumber: baseboard.serial || 'unknown', mac1 };
}

async function checkLicense() {
  initInstallDate();
  const vsweepFile = getVsweepFilePath();
  if (!fs.existsSync(vsweepFile)) {
    console.log('[License] Not licensed.');
    return { isCommercial: true, isLicensed: false };
  }
  const v = storeGet('v');
  const k = storeGet('k');
  if (!v || !k) {
    console.log('[License] Not licensed.');
    return { isCommercial: true, isLicensed: false };
  }
  try {
    const stat = fs.statSync(vsweepFile);
    const creationDate = Math.floor(stat.birthtimeMs || stat.ctimeMs);
    const privateKey = JSON.parse(k);
    const decrypted = await sludge.decompose(v, privateKey, creationDate);
    let parsed;
    try {
      parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    } catch (e) {
      console.warn('[License] JSON.parse failed:', e.message);
      parsed = decrypted;
    }
    const deviceData = await getDeviceData();
    if (parsed && parsed.serialNumber === deviceData.serialNumber) {
      console.log('[License] License activated.');
      if (parsed.expiryDate) {
        const expiryEndOfDay = new Date(parsed.expiryDate);
        expiryEndOfDay.setHours(23, 59, 59, 999);
        if (Date.now() > expiryEndOfDay.getTime()) {
          return {
            isCommercial: true,
            isLicensed: false,
            isExpired: true,
            expiryDate: parsed.expiryDate,
            serialNumber: parsed.serialNumber,
          };
        }
        const daysUntilRenewal = Math.ceil((expiryEndOfDay.getTime() - Date.now()) / 86400000);
        return {
          isCommercial: true,
          isLicensed: true,
          serialNumber: parsed.serialNumber,
          expiryDate: parsed.expiryDate,
          daysUntilRenewal,
          licenseType: parsed.licenseType || 'annual',
        };
      }
      return { isCommercial: true, isLicensed: true, scans: 0 };
    } else {
      console.log('[License] Not licensed.');
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
    storeSet('p', JSON.stringify(keys.publicKey));
    storeSet('k', JSON.stringify(keys.privateKey));
    const deviceData = await getDeviceData();
    const payload = {
      serialNumber: deviceData.serialNumber,
      mac1: deviceData.mac1,
      paymentId: paymentData.id,
      timestamp: Date.now(),
      expiryDate: new Date(
        Date.now() + LICENSE_CONFIG.LICENSE_DURATION_DAYS * 86400000
      ).toISOString(),
      licenseType: 'annual',
    };
    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);
    storeSet('v', encrypted);
    return { success: true };
  } catch (err) {
    console.error('License activation failed:', err);
    return { success: false, error: err.message };
  }
}

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
      expiryDate: new Date(
        Date.now() + LICENSE_CONFIG.LICENSE_DURATION_DAYS * 86400000
      ).toISOString(),
      licenseType: 'annual',
    };
    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);
    storeSet('v', encrypted);
    const serialB64 = Buffer.from(deviceData.serialNumber, 'utf8')
      .toString('base64')
      .replace(/[+/=]/g, '')
      .toUpperCase()
      .slice(0, 8);
    const tsHex = Date.now().toString(16).toUpperCase();
    return { ok: true, key: `VS-${serialB64}-${tsHex}` };
  } catch (err) {
    console.error('[License] generateLicense() failed:', err);
    return { ok: false, error: err.message };
  }
}

async function createLicenseBackup(outputPath) {
  try {
    const vsweepFile = getVsweepFilePath();
    if (!fs.existsSync(vsweepFile)) return { success: false, error: 'Marker file not found' };
    const stat = fs.statSync(vsweepFile);
    const birthtimeMs = Math.floor(stat.birthtimeMs || stat.ctimeMs);
    const v = storeGet('v');
    const k = storeGet('k');
    if (!v || !k) return { success: false, error: 'License data not found' };
    const payload = {
      version: 2,
      createdAt: new Date().toISOString(),
      vsweep: { birthtimeMs },
      store: { v, k },
    };
    const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    const key = await getHardwareKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const versionBuf = Buffer.alloc(1);
    versionBuf[0] = BACKUP_VERSION;
    fs.writeFileSync(
      outputPath,
      Buffer.concat([BACKUP_MAGIC, versionBuf, iv, authTag, ciphertext])
    );
    return { success: true };
  } catch (err) {
    console.error('[License] createLicenseBackup failed:', err);
    return { success: false, error: err.message };
  }
}

async function restoreLicenseBackup(backupPath) {
  try {
    const raw = fs.readFileSync(backupPath);
    if (raw.length < 5 || !raw.slice(0, 4).equals(BACKUP_MAGIC)) {
      return { success: false, error: 'Invalid backup file: not a VulnSweep backup file.' };
    }
    const version = raw[4];
    if (version !== BACKUP_VERSION) {
      return {
        success: false,
        error: `Unrecognised backup format version (${version}). This backup cannot be restored.`,
      };
    }
    if (raw.length < 33) {
      return { success: false, error: 'Backup data is incomplete or corrupted.' };
    }
    const iv = raw.slice(5, 17);
    const authTag = raw.slice(17, 33);
    const ciphertext = raw.slice(33);
    const key = await getHardwareKey();
    let plaintext;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return {
        success: false,
        error:
          'This backup was created on a different device and cannot be restored here. Create a new backup on this machine after re-activating your license.',
      };
    }
    const backupObj = JSON.parse(zlib.gunzipSync(plaintext).toString('utf8'));
    if (!backupObj.vsweep?.birthtimeMs || !backupObj.store?.v || !backupObj.store?.k) {
      return { success: false, error: 'Backup data is incomplete or corrupted.' };
    }
    const { birthtimeMs } = backupObj.vsweep;
    const { v, k } = backupObj.store;
    const vsweepFile = getVsweepFilePath();
    if (fs.existsSync(vsweepFile)) fs.unlinkSync(vsweepFile);
    ensureVsweepDir(vsweepFile);
    restoreVsweepFileWithBirthtime(vsweepFile, birthtimeMs);
    storeSet('v', v);
    storeSet('k', k);
    const check = await checkLicense();
    if (!check.isLicensed)
      return {
        success: false,
        error:
          'License verification failed after restore. The backup may be for a different device.',
      };
    return { success: true };
  } catch (err) {
    console.error('[License] restoreLicenseBackup failed:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  checkLicense,
  activateLicense,
  generateLicense,
  getInstallInfo,
  getPromoDefaults,
  getActivePrice,
  createLicenseBackup,
  restoreLicenseBackup,
};
