/* eslint-disable no-console, import/order, no-unused-vars */
/**
 * Shielded License Generator
 * Protects global console from tampering by aggressive modules.
 */

const fs = require('fs');
const path = require('path');
const systeminformation = require('systeminformation');

// 1. PRESERVE ORIGINAL CONSOLE & PROCESS STATE IMMEDIATELY
const nativeConsole = { ...console };
const originalExit = process.exit;

// Create a safe logging utility that bypasses global console hijacking
// We use sync writes to ensure they appear even if the process crashes immediately after
const safeLog = (msg) => {
  fs.writeSync(1, `[SYSTEM] ${msg}\n`);
};

const safeError = (msg) => {
  fs.writeSync(2, `\x1b[31m[SYSTEM-ERROR]\x1b[0m ${msg}\n`);
};

/**
 * Restore console if it was hijacked
 */
function protectEnvironment() {
  // Check if console.log is native or a stub
  const logStr = console.log.toString();
  const isTampered = !logStr.includes('[native code]') || logStr.length < 50;

  if (isTampered) {
    safeLog('Detected console tampering. Restoring environment...');
    Object.keys(nativeConsole).forEach((key) => {
      try {
        Object.defineProperty(console, key, {
          value: nativeConsole[key],
          configurable: true,
          writable: true,
          enumerable: true,
        });
      } catch (e) {
        console[key] = nativeConsole[key];
      }
    });
  }
}

// Global reference for the crypt module
let sludge;

safeLog('--- Initializing Shielded Environment ---');

// 2. SET UP AGGRESSIVE EXIT MONITORING
// We do this BEFORE the require so we can catch an exit inside the module's constructor
process.exit = (code) => {
  const stack = new Error().stack;
  safeError(`INTERNAL EXIT DETECTED! Exit code: ${code}`);
  safeError(`Call stack:\n${stack}`);
  // We actually prevent the exit for a moment to allow logs to flush
  setTimeout(() => originalExit(code), 500);
};

process.on('uncaughtException', (err) => {
  safeError('UNCAUGHT EXCEPTION DURING LOAD:');
  safeError(err.stack || err);
});

try {
  safeLog('Attempting to require("sludge-crypt")...');

  // 3. REQUIRE MODULE
  sludge = require('sludge-crypt');

  // 4. IMMEDIATELY REVERT TAMPERING
  protectEnvironment();
  safeLog('Module loaded and environment protected.');
} catch (error) {
  safeError(`Failed to import sludge-crypt: ${error.message}`);
  originalExit(1);
}

async function getDeviceData() {
  console.log('1. Getting device data...');
  const [baseboard, networkInterfaces] = await Promise.all([
    systeminformation.baseboard(),
    systeminformation.networkInterfaces(),
  ]);

  const network = Array.isArray(networkInterfaces) ? networkInterfaces : [networkInterfaces];
  const mac1 = network.length > 0 ? network[0].mac : '00:00:00:00:00:00';
  const mac2 = network.length > 1 ? network[1].mac : null;

  return {
    serialNumber: baseboard.serial || 'unknown',
    mac1,
    mac2,
  };
}

function getVsweepFilePath() {
  return path.join(require('os').homedir(), 'AppData', 'Roaming', '.vsweep');
}

const { execSync } = require('child_process');

function setRegistryValue(keyName, value) {
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  console.log('setting registry value: ', keyName, b64);
  execSync(`REG ADD HKCU\\Software\\vsweep /v ${keyName} /t REG_SZ /d "${b64}" /f`, {
    stdio: 'ignore',
  });
}

function getRegistryValue(keyName) {
  console.log('getting registry value: ', keyName);
  try {
    const output = execSync(`REG QUERY HKCU\\Software\\vsweep /v ${keyName}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = output.split('\n');
    let val = null;
    for (const line of lines) {
      console.log('line: ', line);
      if (line.includes(keyName) && line.includes('REG_SZ')) {
        val = line.substring(line.indexOf('REG_SZ') + 6).trim();
        break;
      }
    }
    console.log('val: ', val);
    if (val) {
      const decoded = Buffer.from(val, 'base64').toString('utf8');
      console.log('decoded: ', decoded);
      return decoded;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('Starting commercial license generation...');
  try {
    const vsweepFile = getVsweepFilePath();
    if (!fs.existsSync(vsweepFile)) {
      console.log('Creating vsweep marker file...');
      fs.writeFileSync(vsweepFile, '');
    }

    const stat = fs.statSync(vsweepFile);
    const creationDate = stat.birthtimeMs || stat.ctimeMs;

    let pStr = getRegistryValue('p');
    let kStr = getRegistryValue('k');
    let keys;

    if (!pStr || !kStr) {
      console.log('Generating new bile pair keys...');
      keys = await sludge.generateBilePair();

      pStr = JSON.stringify(keys.publicKey);
      kStr = JSON.stringify(keys.privateKey);
      setRegistryValue('p', pStr);
      setRegistryValue('k', kStr);
    } else {
      console.log('Using existing keys from registry...');
      keys = {
        publicKey: JSON.parse(pStr),
        privateKey: JSON.parse(kStr),
      };
    }
    console.log(keys);
    const deviceData = await getDeviceData();
    console.log('Device data retrieved.');

    const payload = {
      serialNumber: deviceData.serialNumber,
      mac1: deviceData.mac1,
      paymentId: 'generated-via-script',
      timestamp: Date.now(),
    };

    console.log('Composing license with sludge-crypt...');

    if (!sludge || typeof sludge.compose !== 'function') {
      throw new Error('sludge-crypt is loaded but .compose function is missing.');
    }

    const encrypted = await sludge.compose(payload, keys.publicKey, creationDate);

    console.log('Saving license to registry...');
    setRegistryValue('v', encrypted);

    console.log('License generated successfully in registry!');
  } catch (error) {
    console.error('CRITICAL ERROR in main loop:', error);
    process.exit(1);
  }
}

// EXECUTION
main()
  .then(() => {
    console.log('Script execution finished.');
  })
  .catch((error) => {
    safeError('Fatal script error:');
    safeError(error.stack || error);
    originalExit(1);
  });
