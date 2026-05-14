'use strict';

/**
 * Tests for src/main/modules/analytics.js
 * Uses jest.isolateModules() + jest.doMock() (not hoisted) to reset module
 * state between scenarios. Covers all 8 spec cases from T-D.
 */

describe('analytics module', () => {
  let mockTrack, mockInit, mockStoreGet;

  function load(sdkAvail, namedExp, aoVal, initThrows, trackThrows, storeThrows) {
    mockTrack = jest.fn(() => {
      if (trackThrows) throw new Error('track');
    });
    mockInit = jest.fn(() => {
      if (initThrows) throw new Error('init');
    });
    mockStoreGet = jest.fn((k) => {
      if (storeThrows) throw new Error('store');
      return k === 'ao' ? aoVal : null;
    });
    jest.doMock('@aptabase/electron/main', () => {
      if (!sdkAvail) throw new Error('MODULE_NOT_FOUND');
      if (namedExp) return { initialize: mockInit, trackEvent: mockTrack };
      return { default: { initialize: mockInit, trackEvent: mockTrack } };
    });
    jest.doMock('../../../src/main/utils/secure-store', () => {
      return { storeGet: mockStoreGet };
    });

    return require('../../../src/main/modules/analytics');
  }

  afterEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
  });

  it('init() does not throw when SDK init throws', () => {
    jest.isolateModules(() => {
      expect(() => {
        load(true, true, null, true, false, false).init();
      }).not.toThrow();
    });
  });

  it('init() sets initialized — trackEvent fires after init', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, false, false);
      a.init();
      a.trackEvent('e');
      expect(mockTrack).toHaveBeenCalledTimes(1);
    });
  });

  it('trackEvent() does NOT call SDK when opted out (ao="1")', () => {
    jest.isolateModules(() => {
      const a = load(true, true, '1', false, false, false);
      a.init();
      a.trackEvent('e');
      expect(mockTrack).not.toHaveBeenCalled();
    });
  });

  it('trackEvent() DOES call SDK when opted in (ao=null)', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, false, false);
      a.init();
      a.trackEvent('e', { x: 1 });
      expect(mockTrack).toHaveBeenCalledWith('e', { x: 1 });
    });
  });

  it('trackEvent() does not throw when SDK throws internally', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, true, false);
      a.init();
      expect(() => {
        a.trackEvent('e');
      }).not.toThrow();
    });
  });

  it('isOptedOut() returns false when storeGet(ao) is null', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, false, false);
      a.init();
      a.trackEvent('e');
      expect(mockTrack).toHaveBeenCalledTimes(1);
    });
  });

  it('isOptedOut() returns true when storeGet(ao) is "1"', () => {
    jest.isolateModules(() => {
      const a = load(true, true, '1', false, false, false);
      a.init();
      a.trackEvent('e');
      expect(mockTrack).not.toHaveBeenCalled();
    });
  });

  it('isOptedOut() returns false when storeGet throws (fail-open)', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, false, true);
      a.init();
      a.trackEvent('e');
      expect(mockTrack).toHaveBeenCalledTimes(1);
    });
  });

  it('init() does not throw when SDK unavailable (MODULE_NOT_FOUND)', () => {
    jest.isolateModules(() => {
      expect(() => {
        load(false, true, null, false, false, false).init();
      }).not.toThrow();
    });
  });

  it('init() works with default-export SDK shape (fallback path)', () => {
    jest.isolateModules(() => {
      const a = load(true, false, null, false, false, false);
      a.init();
      expect(mockInit).toHaveBeenCalledWith('A-EU-9601263447');
    });
  });

  it('init() calls SDK initialize with correct app key A-EU-9601263447', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, false, false);
      a.init();
      expect(mockInit).toHaveBeenCalledTimes(1);
      expect(mockInit).toHaveBeenCalledWith('A-EU-9601263447');
    });
  });

  it('init() only initializes once on repeated calls', () => {
    jest.isolateModules(() => {
      const a = load(true, true, null, false, false, false);
      a.init();
      a.init();
      a.init();
      expect(mockInit).toHaveBeenCalledTimes(1);
    });
  });
});
