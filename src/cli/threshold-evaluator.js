'use strict';

/**
 * Threshold evaluator for VulnSweep CLI.
 * Determines whether scan results exceed CI/CD failure thresholds.
 *
 * @module cli/threshold-evaluator
 */

/**
 * Severity levels in descending order of criticality.
 * Used to build cumulative threshold checks.
 */
const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'];

/**
 * Evaluates whether a scan summary exceeds the configured severity threshold.
 *
 * @param {object} summary - Aggregated severity counts
 * @param {number} summary.total - Total number of findings
 * @param {number} summary.critical - Count of critical severity
 * @param {number} summary.high - Count of high severity
 * @param {number} summary.medium - Count of medium severity
 * @param {number} summary.low - Count of low severity
 * @param {number} summary.info - Count of informational severity
 * @param {string} threshold - Threshold level: 'none' | 'critical' | 'high' | 'medium' | 'low' | 'any'
 * @returns {{passed: boolean, exitCode: 0|1, reason: string|null}}
 */
function evaluateThreshold(summary, threshold) {
  const safe = {
    total: summary?.total || 0,
    critical: summary?.critical || 0,
    high: summary?.high || 0,
    medium: summary?.medium || 0,
    low: summary?.low || 0,
    info: summary?.info || 0,
  };

  // 'none' always passes
  if (threshold === 'none') {
    return { passed: true, exitCode: 0, reason: null };
  }

  // 'any' fails if total > 0
  if (threshold === 'any') {
    if (safe.total > 0) {
      return {
        passed: false,
        exitCode: 1,
        reason: buildReason(safe, threshold),
      };
    }
    return { passed: true, exitCode: 0, reason: null };
  }

  // For named severity thresholds: fail if any severity at or above the threshold has findings
  const thresholdIdx = SEVERITY_LEVELS.indexOf(threshold);
  if (thresholdIdx === -1) {
    // Unknown threshold value — treat as pass to avoid false failures
    return { passed: true, exitCode: 0, reason: null };
  }

  // Check all levels from critical down to the threshold level
  const levelsToCheck = SEVERITY_LEVELS.slice(0, thresholdIdx + 1);
  const hasViolation = levelsToCheck.some((level) => safe[level] > 0);

  if (hasViolation) {
    return {
      passed: false,
      exitCode: 1,
      reason: buildReason(safe, threshold),
    };
  }

  return { passed: true, exitCode: 0, reason: null };
}

/**
 * Constructs a human-readable failure reason describing which severities exceeded the threshold.
 *
 * @param {object} summary - Severity counts
 * @param {string} threshold - Configured threshold
 * @returns {string} Descriptive failure reason
 */
function buildReason(summary, threshold) {
  const parts = [];

  if (summary.critical > 0) parts.push(`${summary.critical} critical`);
  if (summary.high > 0) parts.push(`${summary.high} high`);
  if (summary.medium > 0) parts.push(`${summary.medium} medium`);
  if (summary.low > 0) parts.push(`${summary.low} low`);
  if (summary.info > 0 && threshold === 'any') parts.push(`${summary.info} info`);

  const found = parts.length > 0 ? parts.join(', ') : `${summary.total} total`;

  return `Threshold exceeded: found ${found} vulnerabilities (threshold: ${threshold})`;
}

module.exports = { evaluateThreshold };
