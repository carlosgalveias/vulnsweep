'use strict';

/**
 * VulnSweep - Severity Merger
 *
 * Merges severity signals from npm audit, OSV.dev, and NVD into a single
 * "merged severity" string. Also detects discrepancies between npm and NVD.
 *
 * Severity scale (used internally for comparison):
 *   CRITICAL=5, HIGH=4, MEDIUM=3, MODERATE=3, LOW=2, NONE=1, UNKNOWN=0
 *
 * NVD CVSS v3 base score → category mapping (official NVD thresholds):
 *   0.0       → NONE
 *   0.1–3.9   → LOW
 *   4.0–6.9   → MEDIUM
 *   7.0–8.9   → HIGH
 *   9.0–10.0  → CRITICAL
 *
 * npm uses: critical / high / moderate / low  (no MEDIUM or NONE)
 * OSV uses:  CRITICAL / HIGH / MEDIUM / MODERATE / LOW / UNKNOWN
 * NVD uses:  CRITICAL / HIGH / MEDIUM / LOW / NONE
 *
 * Normalisation maps "MODERATE" → "MEDIUM" for comparison purposes only;
 * the original label is preserved in the returned object.
 */

const SCORE = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, MODERATE: 3, LOW: 2, NONE: 1, UNKNOWN: 0 };

/** Normalise a raw severity string to uppercase; return 'UNKNOWN' if absent. */
function norm(s) {
  return s ? s.toUpperCase() : 'UNKNOWN';
}

/** Numeric score for a severity label. */
function score(s) {
  return SCORE[norm(s)] || 0;
}

/**
 * Map a CVSS v3 base score (0–10) to a severity category string.
 * Returns null for invalid/missing input.
 *
 * @param {number|null|undefined} cvssScore
 * @returns {string|null}
 */
function cvssScoreToCategory(cvssScore) {
  if (cvssScore === null || cvssScore === undefined || typeof cvssScore !== 'number') return null;
  if (cvssScore === 0.0) return 'NONE';
  if (cvssScore < 4.0) return 'LOW';
  if (cvssScore < 7.0) return 'MEDIUM';
  if (cvssScore < 9.0) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Merge severity signals from multiple sources into a single result.
 *
 * Strategy:
 *   1. Derive a category from nvdCvssScore (authoritative numeric source).
 *   2. Collect all non-null severity strings: nvdCategory, osvSeverity, npmSeverity.
 *   3. The "merged severity" is the highest scoring label across all sources.
 *   4. A "severity discrepancy" exists when npmSeverity differs from nvdCategory
 *      by more than one level AND both are known.
 *
 * @param {string|null} npmSeverity    - Raw npm audit severity (critical/high/moderate/low)
 * @param {string|null} osvSeverity    - Severity from OSV.dev
 * @param {number|null} nvdCvssScore   - NVD CVSS v3 base score (0–10) or null
 * @returns {{
 *   mergedSeverity: string|null,
 *   nvdCategory: string|null,
 *   severityDiscrepancy: boolean,
 *   discrepancyDetails: string|null
 * }}
 */
function mergeSeverity(npmSeverity, osvSeverity, nvdCvssScore) {
  const nvdCategory = cvssScoreToCategory(nvdCvssScore);

  const candidates = [npmSeverity, osvSeverity, nvdCategory].filter(Boolean);

  let mergedSeverity = null;
  for (const c of candidates) {
    if (score(c) > score(mergedSeverity)) mergedSeverity = norm(c);
  }

  // Discrepancy: npm and NVD both known, and they differ by more than one tier
  let severityDiscrepancy = false;
  let discrepancyDetails = null;

  if (npmSeverity && nvdCategory) {
    const npmScore = score(npmSeverity);
    const nvdScore = score(nvdCategory);
    const diff = Math.abs(npmScore - nvdScore);
    if (diff > 1) {
      severityDiscrepancy = true;
      discrepancyDetails = `npm reports ${norm(npmSeverity)} but NVD CVSS score ${
        nvdCvssScore !== null ? nvdCvssScore.toFixed(1) : '?'
      } maps to ${nvdCategory}`;
    }
  }

  return { mergedSeverity, nvdCategory, severityDiscrepancy, discrepancyDetails };
}

module.exports = { mergeSeverity, cvssScoreToCategory, score };
