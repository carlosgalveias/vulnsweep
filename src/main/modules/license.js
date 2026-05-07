const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sludge = require('sludge-crypt');
const systeminformation = require('systeminformation');

// Registry helper functions
function setRegistryValue(keyName, value) {
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  execSync(`REG ADD HKCU\\Software\\vsweep /v ${keyName} /t REG_SZ /d "${b64}" /f`, {
    stdio: 'ignore',
  });
}

function getRegistryValue(keyName) {
  try {
    const output = execSync(`REG QUERY HKCU\\Software\\vsweep /v ${keyName}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = output.split('\n');
    let val = null;
    for (const line of lines) {
      if (line.includes(keyName) && line.includes('REG_SZ')) {
        val = line.substring(line.indexOf('REG_SZ') + 6).trim();
        break;
      }
    }
    if (val) {
      return Buffer.from(val, 'base64').toString('utf8');
    }
    return null;
  } catch (e) {
    console.log(e);
    return null;
  }
}

function getVsweepFilePath() {
  return path.join(os.homedir(), 'AppData', 'Roaming', '.vsweep');
}

const PROMO_DAYS = 30;
const PROMO_PRICE = '9.00';
const FULL_PRICE = '30.00';

/**
 * Stores the install timestamp in registry on first run.
 * Key 'i' holds the ms timestamp as a plain number string (base64-wrapped like all others).
 */
function initInstallDate() {
  const existing = getRegistryValue('i');
  if (!existing) {
    setRegistryValue('i', String(Date.now()));
  }
}

/**
 * Returns promotion / pricing info based on installation date.
 */
function getInstallInfo() {
  initInstallDate();
  const raw = getRegistryValue('i');
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

  const vsweepFile = getVsweepFilePath();
  console.log('[License] Checking vsweep marker at:', vsweepFile);
  if (!fs.existsSync(vsweepFile)) {
    console.log('[License] Marker file not found.');
    return { isCommercial: true, isLicensed: false };
  }

  const v = getRegistryValue('v');
  const k = getRegistryValue('k');

  if (!v || !k) {
    console.log('[License] Registry keys missing.');
    return { isCommercial: true, isLicensed: false };
  }

  try {
    const stat = fs.statSync(vsweepFile);
    const creationDate = stat.birthtimeMs || stat.ctimeMs;
    console.log(
      '[License] Decrypting license payload with marker date:',
      new Date(creationDate).toISOString()
    );

    const privateKey = JSON.parse(k);
    const decrypted = await sludge.decompose(v, privateKey, creationDate);

    let parsed;
    try {
      parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    } catch (e) {
      console.log(e);
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
      fs.writeFileSync(vsweepFile, '');
    }

    const stat = fs.statSync(vsweepFile);
    const creationDate = stat.birthtimeMs || stat.ctimeMs;

    const keys = await sludge.generateBilePair();
    const pStr = JSON.stringify(keys.publicKey);
    const kStr = JSON.stringify(keys.privateKey);

    setRegistryValue('p', pStr);
    setRegistryValue('k', kStr);

    const deviceData = await getDeviceData();
    const payload = {
      serialNumber: deviceData.serialNumber,
      mac1: deviceData.mac1,
      paymentId: paymentData.id,
      timestamp: Date.now(),
    };

    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);
    setRegistryValue('v', encrypted);

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
      fs.writeFileSync(vsweepFile, '');
    }

    const stat = fs.statSync(vsweepFile);
    const creationDate = stat.birthtimeMs || stat.ctimeMs;

    const keys = await sludge.generateBilePair();
    setRegistryValue('p', JSON.stringify(keys.publicKey));
    setRegistryValue('k', JSON.stringify(keys.privateKey));

    const deviceData = await getDeviceData();
    const payload = {
      serialNumber: deviceData.serialNumber,
      mac1: deviceData.mac1,
      timestamp: Date.now(),
    };

    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);
    setRegistryValue('v', encrypted);

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
};
