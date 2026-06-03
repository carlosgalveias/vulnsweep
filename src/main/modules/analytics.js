'use strict';

// NOTE: analytics.init() must be called before app.whenReady() fires so the
// Aptabase SDK registers its internal event queue before the ready event resolves.

const { storeGet } = require('../utils/secure-store');

const APP_KEY = 'A-EU-9601263447';

let _initialize = null;
let _trackEvent = null;
let _initialized = false;

function _loadSdk() {
  try {
    const sdk = require('@aptabase/electron/main');

    if (typeof sdk.initialize === 'function' && typeof sdk.trackEvent === 'function') {
      _initialize = sdk.initialize;
      _trackEvent = sdk.trackEvent;
      return true;
    }

    if (sdk.default && typeof sdk.default.initialize === 'function') {
      _initialize = sdk.default.initialize.bind(sdk.default);
      _trackEvent = sdk.default.trackEvent.bind(sdk.default);
      return true;
    }

    console.warn('[Analytics] @aptabase/electron API shape unrecognised — analytics disabled');
    return false;
  } catch (err) {
    console.warn('[Analytics] Failed to load @aptabase/electron:', err.message);
    return false;
  }
}

function isOptedOut() {
  try {
    const val = storeGet('ao');
    return val === '1';
  } catch {
    return false;
  }
}

function init() {
  if (_initialized) {
    return;
  }
  if (!_loadSdk()) {
    return;
  }

  // _initialized is set to true immediately after _initialize() is called (before
  // the Promise resolves) because the SDK buffers events internally (S[]) before
  // its Promise resolves and flushes them via $() once app.whenReady() completes.
  try {
    const initPromise = _initialize(APP_KEY);
    _initialized = true;

    if (initPromise && typeof initPromise.then === 'function') {
      initPromise.catch((err) => {
        console.warn('[Analytics] Failed to initialize Aptabase:', err.message);
      });
    }
  } catch (err) {
    console.warn('[Analytics] Failed to initialize Aptabase:', err.message);
  }
}

function trackEvent(eventName, props) {
  if (!props) props = {};
  props.source = 'ui';

  if (!_trackEvent) {
    return;
  }

  if (isOptedOut()) {
    return;
  }

  try {
    const result = _trackEvent(eventName, props);
    if (result && typeof result.then === 'function') {
      result.catch((err) => {
        console.warn(`[Analytics] Failed to track event "${eventName}":`, err.message);
      });
    }
  } catch (err) {
    console.warn(`[Analytics] Failed to track event "${eventName}":`, err.message);
  }
}

module.exports = { init, trackEvent, isOptedOut };
