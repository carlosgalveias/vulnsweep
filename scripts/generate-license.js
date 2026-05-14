/* eslint-disable no-console, no-unused-vars */
// Developer License Generator - Windows-only developer utility.
// Writes a valid device-bound license into the encrypted store.
// Store : %APPDATA%\VulnSweep\store.dat
// Marker: %USERPROFILE%\AppData\Local\Microsoft\OneDrive\logs\.vsweep
// Usage : node scripts/generate-license.js

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const systeminformation = require('systeminformation');

const nativeConsole = { ...console };
const originalExit = process.exit;

const safeLog = (msg) => fs.writeSync(1, `[SYSTEM] ${msg}\n`);
const safeError = (msg) => fs.writeSync(2, `\x1b[31m[SYSTEM-ERROR]\x1b[0m ${msg}\n`);

function protectEnvironment() {
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
      } catch (_e) {
        console[key] = nativeConsole[key];
      }
    });
  }
}

process.exit = (code) => {
  const stack = new Error().stack;
  safeError(`INTERNAL EXIT DETECTED! Exit code: ${code}`);
  safeError(`Call stack:\n${stack}`);
  setTimeout(() => originalExit(code), 500);
};

process.on('uncaughtException', (err) => {
  safeError('UNCAUGHT EXCEPTION DURING LOAD:');
  safeError(err.stack || String(err));
});

let sludge;
safeLog('--- Initializing Shielded Environment ---');
safeLog('Attempting to require("sludge-crypt")...');
try {
  sludge = require('sludge-crypt');
  protectEnvironment();
  safeLog('sludge-crypt loaded and environment protected.');
} catch (error) {
  safeError(`Failed to import sludge-crypt: ${error.message}`);
  originalExit(1);
}

// Windows store path: %APPDATA%\VulnSweep\store.dat
const STORE_DIR = path.join(process.env.APPDATA, 'VulnSweep');
const STORE_FILE = path.join(STORE_DIR, 'store.dat');

// Vsweep marker file path (exact Windows path from license.js)
const VSWEEP_FILE = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'Microsoft',
  'OneDrive',
  'logs',
  '.vsweep'
);

// Encryption secret - replicates _deriveEncryptionSecret() from secure-store.js
function deriveEncryptionSecret() {
  let raw = 'vs-fb-2024-xk';
  try {
    const ifaces = os.networkInterfaces();
    outer: for (const name of Object.keys(ifaces)) {
      for (const addr of ifaces[name] || []) {
        if (addr.internal) continue;
        if (!addr.mac || addr.mac === '00:00:00:00:00:00') continue;
        raw = addr.mac;
        break outer;
      }
    }
  } catch (_e) {
    /* use fallback */
  }
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  console.log(`  MAC raw material : ${raw}`);
  console.log(`  Encryption secret: ${hashed.slice(0, 8)}...`);
  return hashed;
}

// File-backed storage adapter - mirrors _buildFileStorageAdapter() in secure-store.js
function buildAdapter(filePath) {
  return {
    getItem(key) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data[key] !== undefined ? data[key] : null;
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    setItem(key, value) {
      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }

      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      data[key] = value;
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
    },
    removeItem(key) {
      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') return;
      }
      delete data[key];
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
    },
  };
}

function createSecureLS(storePath) {
  const SecureLS = require('secure-ls').default;
  const secret = deriveEncryptionSecret();
  const adapter = buildAdapter(storePath);
  return new SecureLS({
    encodingType: 'AES',
    isCompression: false,
    encryptionSecret: secret,
    storage: adapter,
  });
}

async function getDeviceData() {
  console.log('  Querying system hardware...');
  const [baseboard, networkInterfaces] = await Promise.all([
    systeminformation.baseboard(),
    systeminformation.networkInterfaces(),
  ]);
  const network = Array.isArray(networkInterfaces) ? networkInterfaces : [networkInterfaces];
  const mac1 = network.length > 0 ? network[0].mac : '00:00:00:00:00:00';
  return { serialNumber: baseboard.serial || 'unknown', mac1 };
}

async function main() {
  console.log('\n=== VulnSweep Developer License Generator ===\n');
  console.log('Step 1: Ensuring store directory...');
  fs.mkdirSync(STORE_DIR, { recursive: true });
  console.log(`  Store dir  : ${STORE_DIR}`);
  console.log(`  Store file : ${STORE_FILE}`);
  console.log('\nStep 2: Ensuring .vsweep marker file...');
  fs.mkdirSync(path.dirname(VSWEEP_FILE), { recursive: true });
  if (!fs.existsSync(VSWEEP_FILE)) {
    fs.writeFileSync(VSWEEP_FILE, '');
    console.log(`  Created    : ${VSWEEP_FILE}`);
  } else {
    console.log(`  Exists     : ${VSWEEP_FILE}`);
  }
  const stat = fs.statSync(VSWEEP_FILE);
  const creationDate = stat.birthtimeMs || stat.ctimeMs;
  console.log(`  Date used  : ${new Date(creationDate).toISOString()}`);
  console.log('\nStep 3: Deriving encryption secret and building store instance...');
  let ls;
  try {
    ls = createSecureLS(STORE_FILE);
    console.log('  SecureLS instance created successfully.');
  } catch (err) {
    safeError(`Failed to create SecureLS: ${err.message}`);
    originalExit(1);
  }
  console.log('\nStep 4: Generating bile-pair keys with sludge-crypt...');
  if (!sludge || typeof sludge.generateBilePair !== 'function')
    throw new Error('sludge-crypt: .generateBilePair missing');
  const keys = await sludge.generateBilePair();
  const pStr = JSON.stringify(keys.publicKey);
  const kStr = JSON.stringify(keys.privateKey);
  console.log('  Keys generated.');
  console.log('\nStep 5: Collecting device data...');
  const deviceData = await getDeviceData();
  console.log(`  Serial : ${deviceData.serialNumber}`);
  console.log(`  MAC1   : ${deviceData.mac1}`);
  console.log('\nStep 6: Composing license payload...');
  if (typeof sludge.compose !== 'function') throw new Error('sludge-crypt: .compose missing');
  const payload = {
    serialNumber: deviceData.serialNumber,
    mac1: deviceData.mac1,
    paymentId: 'generated-via-script',
    timestamp: Date.now(),
  };
  const encrypted = await sludge.compose(payload, keys.publicKey, Math.floor(creationDate));
  console.log('  Payload composed and encrypted.');
  console.log('  creationDate passed to compose:', Math.floor(creationDate));
  console.log('\nStep 7: Writing keys to encrypted store...');
  ls.set('p', pStr);
  ls.set('k', kStr);
  ls.set('v', encrypted);
  console.log(`  Wrote key p  (public key,  ${pStr.length} chars)`);
  console.log(`  Wrote key k  (private key, ${kStr.length} chars)`);
  console.log(`  Wrote key v  (license,     ${encrypted.length} chars)`);
  const serialB64 = Buffer.from(deviceData.serialNumber, 'utf8')
    .toString('base64')
    .replace(/[+/=]/g, '')
    .toUpperCase()
    .slice(0, 8);
  const licenseKey = `VS-${serialB64}-${Date.now().toString(16).toUpperCase()}`;
  console.log('\n=== SUCCESS ===');
  console.log(`License key  : ${licenseKey}`);
  console.log(`Store path   : ${STORE_FILE}`);
  console.log(`Marker path  : ${VSWEEP_FILE}`);
  console.log('Keys written : p, k, v');
}

main()
  .then(() => {
    console.log('Script execution finished.');
  })
  .catch((error) => {
    safeError('Fatal script error:');
    safeError(error.stack || String(error));
    originalExit(1);
  });
