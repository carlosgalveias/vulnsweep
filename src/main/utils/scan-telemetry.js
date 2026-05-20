'use strict';
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// T6: Initialize Maps unconditionally — the if(!_enabled) guards in each
// function already prevent mutations when telemetry is disabled, so null
// Maps are an unnecessary null-deref trap.
const _enabled = process.env.NODE_ENV === 'development';
const _timers = new Map(); // label → { totalMs, callCount, startedAt, endedAt }
const _counts = new Map(); // label → number
const _marks = new Map(); // token → { startTime, label }  (T3)
let _nextToken = 0; // auto-incrementing opaque token counter (T3)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _pad(value, width, align) {
  const s = String(value);
  if (s.length >= width) return s.slice(0, width);
  const padding = ' '.repeat(width - s.length);
  return align === 'right' ? padding + s : s + padding;
}

// T2: Remove spurious internal whitespace from template literals.
function _fmtMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

// T2: Rewrite _printTable() to reduce dense interpolation chains and improve
// readability — same output, cleaner source.
function _printTable(r) {
  const W = { label: 44, calls: 7, total: 10, avg: 10 };
  const sl = W.label + W.calls + W.total + W.avg + 9;
  const sep = '-'.repeat(sl);

  console.log('\n[scan-telemetry] SCAN TIMING REPORT');
  console.log(`  Generated : ${r.generatedAt}`);
  console.log(`  Total scan: ${_fmtMs(r.totalScanMs)}`);

  const hLabel = _pad('Label', W.label);
  const hCalls = _pad('Calls', W.calls, 'right');
  const hTotal = _pad('Total', W.total, 'right');
  const hAvg = _pad('Avg/call', W.avg, 'right');
  console.log(`\n  ${hLabel} | ${hCalls} | ${hTotal} | ${hAvg}`);
  console.log(`  ${sep}`);

  const sorted = Object.entries(r.timers).sort((a, b) => b[1].durationMs - a[1].durationMs);
  for (const [label, e] of sorted) {
    const avg = e.callCount > 1 ? _fmtMs(e.avgMs) : '--';
    const col1 = _pad(label, W.label);
    const col2 = _pad(e.callCount, W.calls, 'right');
    const col3 = _pad(_fmtMs(e.durationMs), W.total, 'right');
    const col4 = _pad(avg, W.avg, 'right');
    console.log(`  ${col1} | ${col2} | ${col3} | ${col4}`);
  }

  const ce = Object.entries(r.counts);
  if (ce.length > 0) {
    console.log(`\n  ${'-- Counts '.padEnd(sl, '-')}`);
    for (const [k, v] of ce) {
      console.log(`  ${_pad(k, W.label + W.calls + 3)} : ${v}`);
    }
  }

  if (r.slowestOperations.length > 0) {
    console.log('\n  Top slowest operations:');
    for (const op of r.slowestOperations) {
      console.log(`    ${_fmtMs(op.durationMs).padStart(10)}  ${op.label}`);
    }
  }

  console.log('[scan-telemetry] END OF REPORT\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function isEnabled() {
  return _enabled;
}

/**
 * Start timing for a label.
 *
 * T3: Returns an opaque integer token that MUST be passed to end().
 * Each call gets its own token so concurrent invocations with the same label
 * do not overwrite each other's start time.
 *
 * Returns null when telemetry is disabled so callers can safely pass the
 * return value straight into end() without an extra guard.
 *
 * @param {string} label
 * @returns {number|null} token
 */
function start(label) {
  if (!_enabled) return null;

  const token = _nextToken++;
  const nowIso = new Date().toISOString();

  // Per-invocation mark (T3): keyed by opaque token, never overwritten.
  _marks.set(token, { startTime: performance.now(), label });

  // Per-label aggregation entry: created once, accumulates across all calls.
  if (!_timers.has(label)) {
    _timers.set(label, { totalMs: 0, callCount: 0, startedAt: nowIso, endedAt: nowIso });
  }

  return token;
}

/**
 * Stop timing and accumulate into the label's aggregation entry.
 *
 * T3/T4: Token-based signature replaces the old label-only signature.
 * - Unknown / already-consumed token → warn + return 0 (handles "never
 *   started", "already ended", and "double-end" cases naturally).
 * - token === null (disabled path from start()) → silent no-op.
 *
 * @param {number|null} token  Opaque token returned by start()
 * @param {string}      label  Human-readable label (used in warn message only)
 * @returns {number} elapsed milliseconds, or 0 on no-op
 */
function end(token, label) {
  if (!_enabled || token === null) return 0;

  const mark = _marks.get(token);
  if (!mark) {
    console.warn('[scan-telemetry] end() called with unknown token for label:', label);
    return 0;
  }

  const durationMs = performance.now() - mark.startTime;
  _marks.delete(token); // T4: cleanup — prevents double-end reuse

  const entry = _timers.get(mark.label);
  if (entry) {
    entry.totalMs += durationMs;
    entry.callCount += 1;
    entry.endedAt = new Date().toISOString();
  }

  return durationMs;
}

/**
 * Increment a named counter by `value` (defaults to 1).
 *
 * @param {string} label
 * @param {number} [value=1]
 */
function count(label, value) {
  if (!_enabled) return;
  const delta = typeof value === 'number' ? value : 1;
  _counts.set(label, (_counts.get(label) || 0) + delta);
}

/** Clear all timers, marks, and counts. Safe to call at the start of each scan. */
function reset() {
  if (!_enabled) return;
  _timers.clear();
  _counts.clear();
  _marks.clear();
}

/**
 * Build and emit the timing report. Writes a JSON file to outputDir (or
 * ./tmp) as a fire-and-forget side effect.
 *
 * T5: Uses async fs.promises.mkdir instead of the blocking existsSync +
 * mkdirSync combo, so the event loop is never stalled on a disk stat.
 *
 * @param {string} [outputDir]
 * @returns {Promise<string|null>} path to written JSON file, or null
 */
async function report(outputDir) {
  if (!_enabled) return null;

  const nowIso = new Date().toISOString();
  const timers = {};

  for (const [label, entry] of _timers) {
    const avgMs = entry.callCount > 0 ? Math.round(entry.totalMs / entry.callCount) : 0;
    timers[label] = {
      durationMs: Math.round(entry.totalMs),
      callCount: entry.callCount,
      avgMs,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    };
  }

  const counts = {};
  for (const [label, val] of _counts) {
    counts[label] = val;
  }

  const totalScanMs = timers['scan:total'] ? timers['scan:total'].durationMs : 0;
  const allOps = Object.entries(timers).map(([label, e]) => ({ label, durationMs: e.durationMs }));
  allOps.sort((a, b) => b.durationMs - a.durationMs);
  const slowestOperations = allOps.slice(0, 10);

  const reportObj = { generatedAt: nowIso, totalScanMs, timers, counts, slowestOperations };
  _printTable(reportObj);

  const dir = outputDir || path.join(process.cwd(), 'tmp');
  try {
    // T5: fs.promises.mkdir with recursive:true is idempotent — no existence
    // check needed, and it never blocks the event loop.
    await fs.promises.mkdir(dir, { recursive: true });
    const safeTs = nowIso.replace(/[:.]/g, '-');
    const filePath = path.join(dir, `scan-telemetry-${safeTs}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(reportObj, null, 2), 'utf8');
    console.log(`[scan-telemetry] Report written to: ${filePath}`);
    return filePath;
  } catch (err) {
    console.warn(`[scan-telemetry] Failed to write report: ${err.message}`);
    return null;
  }
}

module.exports = { isEnabled, start, end, count, reset, report };
