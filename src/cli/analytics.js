'use strict';

/**
 * CLI Analytics — lightweight Aptabase HTTP client.
 * Fire-and-forget telemetry for CLI usage tracking.
 *
 * Opt-out: set VULNSWEEP_NO_TELEMETRY=1 or DO_NOT_TRACK=1
 */

const { randomUUID } = require('node:crypto');

const APP_KEY = 'A-EU-9601263447';
const INGESTION_URL = 'https://eu.aptabase.com/api/v0/event';

// Lazy-loaded to avoid startup cost
let _sessionId = null;

const _pending = [];

function _getSessionId() {
  if (!_sessionId) {
    // Random session ID per CLI invocation (matches Aptabase SDK behavior)
    _sessionId = randomUUID();
  }
  return _sessionId;
}

function isOptedOut() {
  return process.env.VULNSWEEP_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1';
}

/**
 * Tracks an event to Aptabase. Fire-and-forget — never throws, never blocks.
 *
 * @param {string} eventName - Event name (e.g. 'app_initialized')
 * @param {object} [props={}] - Event properties
 */
function trackEvent(eventName, props) {
  if (isOptedOut()) return;
  if (!eventName) return;

  const payload = {
    timestamp: new Date().toISOString(),
    sessionId: _getSessionId(),
    eventName,
    systemProps: {
      osName: process.platform,
      osVersion: process.version,
      appVersion: _getVersion(),
      sdkVersion: 'vulnsweep-cli/1.0.0',
    },
    props: { ...props, source: 'cli' },
  };

  const promise = fetch(INGESTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'App-Key': APP_KEY,
    },
    body: JSON.stringify(payload),
    signal: globalThis.AbortSignal.timeout(5000),
  }).catch(() => {
    // Silently swallow. Analytics must NEVER break CLI operation.
  });

  _pending.push(promise);
  return promise;
}

let _version = null;
function _getVersion() {
  if (!_version) {
    try {
      const { readFileSync } = require('node:fs');
      const { resolve } = require('node:path');
      const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
      _version = pkg.version || 'unknown';
    } catch {
      _version = 'unknown';
    }
  }
  return _version;
}

async function flush() {
  if (_pending.length === 0) return;
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
  await Promise.race([Promise.allSettled(_pending), timeout]);
  _pending.splice(0);
}

module.exports = { trackEvent, isOptedOut, flush };
