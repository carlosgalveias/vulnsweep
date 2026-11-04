'use strict';
const crypto = require('crypto');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// v2 fixture generation helpers
// These mirror the exact algorithm in src/main/modules/license.js so we can
// pre-build test buffers that will pass the restore validation.
// ---------------------------------------------------------------------------
const BACKUP_MAGIC = Buffer.from([0x56, 0x53, 0x57, 0x42]); // "VSWB"
const BACKUP_VERSION = 0x02;
const APP_SALT = 'vulnsweep-backup-v2-2026';

// Mock hardware values — must match the systeminformation mock below
const MOCK_BASEBOARD_SERIAL = 'SN-001';
const MOCK_BIOS_SERIAL = 'BIOS-001';
const MOCK_CPU_BRAND = 'Intel';
const MOCK_CPU_CORES = 4;

function buildHardwareKey() {
  // Mirrors getHardwareKey() in license.js exactly
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
    norm(MOCK_BASEBOARD_SERIAL),
    norm(MOCK_BIOS_SERIAL),
    norm(MOCK_CPU_BRAND + String(MOCK_CPU_CORES)),
  ].filter((p) => p.length > 0);
  const hw = parts.length > 0 ? parts.join('|') : 'VSWEEP-GENERIC-HW';
  return crypto.pbkdf2Sync(hw, APP_SALT, 200_000, 32, 'sha256');
}

function buildV2Buf(payload) {
  const key = buildHardwareKey();
  const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const versionBuf = Buffer.alloc(1);
  versionBuf[0] = BACKUP_VERSION;
  return Buffer.concat([BACKUP_MAGIC, versionBuf, iv, authTag, ciphertext]);
}

// VALID_BUF: complete valid v2 backup payload
const VALID_BUF = buildV2Buf({
  version: 2,
  createdAt: new Date().toISOString(),
  vsweep: { birthtimeMs: 1700000000000 },
  store: { v: 'enc-v', k: 'enc-k' },
});

// NO_BIRTH_BUF: v2 backup missing vsweep.birthtimeMs (incomplete payload)
const NO_BIRTH_BUF = buildV2Buf({
  version: 2,
  createdAt: new Date().toISOString(),
  vsweep: {},
  store: { v: 'enc-v', k: 'enc-k' },
});

// BAD_MAGIC_BUF: buffer with wrong magic bytes
const BAD_MAGIC_BUF = Buffer.from('AAAAAAE=', 'base64');

// ---------------------------------------------------------------------------
// Test module loader
// ---------------------------------------------------------------------------
function load({
  existsVsweep = false,
  readBuf = Buffer.alloc(0),
  birthtimeMs = 1700000000000,
  hasV = true,
  hasK = true,
  serial = 'SN-001',
  mismatchTime = false,
} = {}) {
  let mockFsExistsSync,
    mockFsReadFileSync,
    mockFsStatSync,
    mockFsWriteFileSync,
    mockFsUnlinkSync,
    mockFsMkdirSync;
  let mockSpawnSync,
    mockStoreGet,
    mockStoreSet,
    mockDecompose,
    mockBaseboard,
    mockNetworkInterfaces;
  let writtenBuf = null;
  let lic;
  jest.isolateModules(() => {
    mockFsExistsSync = jest.fn().mockReturnValue(existsVsweep);
    mockFsReadFileSync = jest.fn().mockReturnValue(readBuf);
    const actualBirthtime = mismatchTime ? 9999999999999 : birthtimeMs;
    mockFsStatSync = jest
      .fn()
      .mockReturnValue({ birthtimeMs: actualBirthtime, ctimeMs: actualBirthtime });
    mockFsWriteFileSync = jest.fn().mockImplementation((_, b) => {
      if (b instanceof Buffer) writtenBuf = b;
    });
    mockFsUnlinkSync = jest.fn();
    mockFsMkdirSync = jest.fn();
    // license.js uses spawnSync (not execSync) from child_process
    mockSpawnSync = jest.fn().mockReturnValue({ status: 0, stderr: null });
    mockStoreGet = jest.fn().mockImplementation((k) => {
      if (k === 'v') return hasV ? 'enc-v' : null;
      if (k === 'k') return hasK ? JSON.stringify({ d: 'priv' }) : null;
      if (k === 'p') return 'pub-p';
      if (k === 'i') return String(Date.now());
      return null;
    });
    mockStoreSet = jest.fn();
    mockDecompose = jest.fn().mockResolvedValue(JSON.stringify({ serialNumber: serial }));
    mockBaseboard = jest.fn().mockResolvedValue({ serial: MOCK_BASEBOARD_SERIAL });
    mockNetworkInterfaces = jest.fn().mockResolvedValue([{ mac: 'aa:bb:cc' }]);
    jest.doMock('fs', () => ({
      existsSync: mockFsExistsSync,
      readFileSync: mockFsReadFileSync,
      statSync: mockFsStatSync,
      writeFileSync: mockFsWriteFileSync,
      unlinkSync: mockFsUnlinkSync,
      mkdirSync: mockFsMkdirSync,
    }));
    jest.doMock('child_process', () => ({
      spawnSync: mockSpawnSync,
    }));
    jest.doMock('sludge-crypt', () => ({
      decompose: mockDecompose,
      compose: jest.fn().mockResolvedValue('mock-enc'),
      generateBilePair: jest
        .fn()
        .mockResolvedValue({ publicKey: { n: 'pub' }, privateKey: { d: 'priv' } }),
    }));
    jest.doMock('systeminformation', () => ({
      baseboard: mockBaseboard,
      bios: jest.fn().mockResolvedValue({ serial: MOCK_BIOS_SERIAL }),
      cpu: jest.fn().mockResolvedValue({ brand: MOCK_CPU_BRAND, physicalCores: MOCK_CPU_CORES }),
      networkInterfaces: mockNetworkInterfaces,
    }));
    jest.doMock('../../../src/main/utils/secure-store', () => ({
      storeGet: mockStoreGet,
      storeSet: mockStoreSet,
    }));
    jest.doMock('../../../src/main/config/constants', () => ({
      LICENSE_CONFIG: {
        PROMO_PRICE_EUR: '9.99',
        FULL_PRICE_EUR: '29.99',
        PROMO_DAYS: 30,
        LICENSE_DURATION_DAYS: 365,
      },
    }));
    lic = require('../../../src/main/modules/license');
  });
  return { lic, writtenBuf: () => writtenBuf, mockFsUnlinkSync, mockStoreSet };
}

afterEach(() => {
  jest.resetModules();
  jest.resetAllMocks();
});

describe('createLicenseBackup()', () => {
  it('returns {success:false} when .vsweep marker absent', async () => {
    const { lic } = load({ existsVsweep: false });
    const r = await lic.createLicenseBackup('/tmp/out.vsbak');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/[Mm]arker|not found/);
  });
  it('returns {success:false} when store v missing', async () => {
    const { lic } = load({ existsVsweep: true, hasV: false });
    const r = await lic.createLicenseBackup('/tmp/out.vsbak');
    expect(r.success).toBe(false);
  });
  it('returns {success:false} when store k missing', async () => {
    const { lic } = load({ existsVsweep: true, hasK: false });
    const r = await lic.createLicenseBackup('/tmp/out.vsbak');
    expect(r.success).toBe(false);
  });
  it('output starts with BACKUP_MAGIC [0x56,0x53,0x57,0x42]', async () => {
    const { lic, writtenBuf } = load({ existsVsweep: true });
    const r = await lic.createLicenseBackup('/tmp/out.vsbak');
    expect(r.success).toBe(true);
    const buf = writtenBuf();
    expect(buf[0]).toBe(0x56);
    expect(buf[1]).toBe(0x53);
    expect(buf[2]).toBe(0x57);
    expect(buf[3]).toBe(0x42);
  });
  it('payload decodes to contain version:2, vsweep.birthtimeMs, store.v', async () => {
    const { lic, writtenBuf } = load({ existsVsweep: true, birthtimeMs: 1700000000000 });
    await lic.createLicenseBackup('/tmp/out.vsbak');
    const buf = writtenBuf();
    expect(buf[4]).toBe(0x02);
    const key = buildHardwareKey();
    const iv = buf.slice(5, 17);
    const authTag = buf.slice(17, 33);
    const ciphertext = buf.slice(33);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const obj = JSON.parse(zlib.gunzipSync(plaintext).toString('utf8'));
    expect(obj.version).toBe(2);
    expect(obj.vsweep.birthtimeMs).toBe(1700000000000);
    expect(obj.store.v).toBe('enc-v');
  });
});

describe('restoreLicenseBackup()', () => {
  it('returns {success:false} for bad magic header', async () => {
    const { lic } = load({ readBuf: BAD_MAGIC_BUF });
    const r = await lic.restoreLicenseBackup('/tmp/bad.vsbak');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/[Ii]nvalid backup/);
  });
  it('returns {success:false} for missing required fields', async () => {
    const { lic } = load({ readBuf: NO_BIRTH_BUF });
    const r = await lic.restoreLicenseBackup('/tmp/nb.vsbak');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/[Ii]ncomplete|[Cc]orrupt/);
  });
  it('calls fs.unlinkSync when .vsweep pre-exists (C-2)', async () => {
    const { lic, mockFsUnlinkSync } = load({ readBuf: VALID_BUF, existsVsweep: true });
    await lic.restoreLicenseBackup('/tmp/valid.vsbak');
    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });
  it('does NOT call fs.unlinkSync when .vsweep absent', async () => {
    const { lic, mockFsUnlinkSync } = load({ readBuf: VALID_BUF, existsVsweep: false });
    await lic.restoreLicenseBackup('/tmp/valid.vsbak');
    expect(mockFsUnlinkSync).not.toHaveBeenCalled();
  });
  it('calls storeSet for v and k after successful restore', async () => {
    const { lic, mockStoreSet } = load({ readBuf: VALID_BUF, existsVsweep: false });
    await lic.restoreLicenseBackup('/tmp/valid.vsbak');
    expect(mockStoreSet).toHaveBeenCalledWith('v', 'enc-v');
    expect(mockStoreSet).toHaveBeenCalledWith('k', 'enc-k');
  });
  it('returns {success:false} for wrong device serial', async () => {
    const { lic } = load({ readBuf: VALID_BUF, existsVsweep: false, serial: 'WRONG-DEVICE' });
    const r = await lic.restoreLicenseBackup('/tmp/valid.vsbak');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/[Vv]erification|different device/);
  });
});

describe('C-1: birthtimeMs mismatch throws and cleans up', () => {
  it('returns error and calls unlinkSync when birthtimeMs mismatch > 1000ms', async () => {
    const { lic, mockFsUnlinkSync } = load({
      readBuf: VALID_BUF,
      existsVsweep: false,
      mismatchTime: true,
    });
    const r = await lic.restoreLicenseBackup('/tmp/valid.vsbak');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/CreationTime|could not be set|Environment/);
    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });
});
