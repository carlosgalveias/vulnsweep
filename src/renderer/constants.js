export const DEFAULT_COMMIT_MESSAGE = 'fix(security): update vulnerable dependencies';

/**
 * Colour map for SBOM/license risk tiers.
 * Used by LicensesTab donut chart and risk badges.
 */
export const LICENSE_TIER_COLORS = {
  safe: '#22c55e', // green-500  — permissive licenses (MIT, Apache-2.0, etc.)
  warning: '#eab308', // yellow-500 — weak copyleft (LGPL, MPL, EPL, etc.)
  dangerous: '#dc2626', // red-600    — strong copyleft (GPL, AGPL, SSPL)
  unknown: '#6b7280', // gray-500   — unrecognised or UNKNOWN
};

/**
 * Human-readable labels for each SBOM export format.
 */
export const SBOM_FORMAT_LABELS = {
  cyclonedx: 'CycloneDX JSON v1.6',
  spdx: 'SPDX JSON v2.3',
  csv: 'CSV',
};

/**
 * File extensions for each SBOM export format.
 */
export const SBOM_FORMAT_EXT = {
  cyclonedx: 'json',
  spdx: 'json',
  csv: 'csv',
};
