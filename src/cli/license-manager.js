'use strict';

const { TRIAL_CONFIG } = require('../main/config/constants');
const license = require('../main/modules/license');
const trialStore = require('../main/utils/trial-store');

/**
 * Check license and return status object.
 * Wraps the existing license/trial modules for CLI use.
 *
 * @returns {Promise<{
 *   isLicensed: boolean,
 *   isExpired: boolean,
 *   fixesUsed: number,
 *   fixesRemaining: number,
 *   maxFixes: number,
 *   installDate: string|null,
 *   daysInstalled: number
 * }>}
 */
async function getLicenseStatus() {
  const licenseInfo = await license.checkLicense();
  const trialData = trialStore.getTrialData();
  const maxFixes = TRIAL_CONFIG.MAX_FREE_FIXES; // 100
  const installInfo = license.getInstallInfo();

  return {
    isLicensed: licenseInfo.isLicensed || false,
    isExpired: licenseInfo.isExpired || false,
    fixesUsed: trialData.fixesConsumed,
    fixesRemaining: Math.max(0, maxFixes - trialData.fixesConsumed),
    maxFixes,
    installDate: installInfo.installDate || null,
    daysInstalled: installInfo.daysElapsed || 0,
  };
}

/**
 * Check if scanning is allowed (licensed OR has free fixes remaining).
 * Scanning is ALWAYS allowed — only autofix is gated by fix count.
 *
 * @returns {boolean}
 */
function canScan() {
  return true; // Scans are never gated, only fixes
}

/**
 * Check if autofix can be applied (licensed OR has fixes remaining).
 *
 * @returns {Promise<{ allowed: boolean, remaining?: number, reason?: string }>}
 */
async function canAutofix() {
  const status = await getLicenseStatus();
  if (status.isLicensed && !status.isExpired) return { allowed: true };
  if (status.fixesRemaining > 0) return { allowed: true, remaining: status.fixesRemaining };
  return {
    allowed: false,
    reason: `Free fix limit reached (${status.maxFixes}/${status.maxFixes}). Purchase a license to continue.`,
  };
}

/**
 * Consume fix credits (call after successfully applying fixes).
 * @param {number} count - Number of fixes to consume (default: 1)
 */
function consumeFixes(count = 1) {
  for (let i = 0; i < count; i++) {
    trialStore.incrementFixCount();
  }
}

module.exports = { getLicenseStatus, canScan, canAutofix, consumeFixes };
