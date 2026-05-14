'use strict';
const zlib = require('zlib');
const VALID_BUF = Buffer.from(
  'VlNXQknYX0VWU1dFVlkSz+dZlXVCU6igsBcJz3bvmkomICX2o9L2ndB3keSyjBJUaj3vpGDJsleBVlrLf4jin7sLBkNPpQnHwSNBlPloRvy2O7IgwIPadLAp+LQ39NXD1a++ywSEO9r98o93r9U0u6PfdOTytL9W6+xWFbzaasxWU1c=',
  'base64'
);
const NO_BIRTH_BUF = Buffer.from(
  'VlNXQknYX0VWU1dFVln8E3wYem+Yn5gW5GGDFBx9HQh6Gho0egLlF2RhZ3eHZmeRY2NbdGbjVWZrUFTGfvYNRexKm4piU1dF',
  'base64'
);
const BAD_MAGIC_BUF = Buffer.from('AAAAAAE=', 'base64');

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
  let mockExecSync, mockStoreGet, mockStoreSet, mockDecompose, mockBaseboard, mockNetworkInterfaces;
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
    mockExecSync = jest.fn().mockReturnValue(Buffer.alloc(0));
    mockStoreGet = jest.fn().mockImplementation((k) => {
      if (k === 'v') return hasV ? 'enc-v' : null;
      if (k === 'k') return hasK ? JSON.stringify({ d: 'priv' }) : null;
      if (k === 'p') return 'pub-p';
      if (k === 'i') return String(Date.now());
      return null;
    });
    mockStoreSet = jest.fn();
    mockDecompose = jest.fn().mockResolvedValue(JSON.stringify({ serialNumber: serial }));
    mockBaseboard = jest.fn().mockResolvedValue({ serial: 'SN-001' });
    mockNetworkInterfaces = jest.fn().mockResolvedValue([{ mac: 'aa:bb:cc' }]);
    jest.doMock('fs', () => ({
      existsSync: mockFsExistsSync,
      readFileSync: mockFsReadFileSync,
      statSync: mockFsStatSync,
      writeFileSync: mockFsWriteFileSync,
      unlinkSync: mockFsUnlinkSync,
      mkdirSync: mockFsMkdirSync,
    }));
    jest.doMock('child_process', () => ({ execSync: mockExecSync }));
    jest.doMock('sludge-crypt', () => ({
      decompose: mockDecompose,
      compose: jest.fn().mockResolvedValue('mock-enc'),
      generateBilePair: jest
        .fn()
        .mockResolvedValue({ publicKey: { n: 'pub' }, privateKey: { d: 'priv' } }),
    }));
    jest.doMock('systeminformation', () => ({
      baseboard: mockBaseboard,
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
  it('payload decodes to contain version:1, vsweep.birthtimeMs, store.v', async () => {
    const { lic, writtenBuf } = load({ existsVsweep: true, birthtimeMs: 1700000000000 });
    await lic.createLicenseBackup('/tmp/out.vsbak');
    const KEY = Buffer.from([0x56, 0x53, 0x57, 0x45]);
    const body = writtenBuf().slice(4);
    const x = Buffer.allocUnsafe(body.length);
    for (let i = 0; i < body.length; i++) x[i] = body[i] ^ KEY[i % 4];
    const obj = JSON.parse(zlib.gunzipSync(x).toString('utf8'));
    expect(obj.version).toBe(1);
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
