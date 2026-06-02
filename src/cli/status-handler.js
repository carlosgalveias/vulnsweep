'use strict';

const { getLicenseStatus } = require('./license-manager');

/**
 * Handle the `status` subcommand.
 * Displays license status, fix usage, and install information.
 *
 * @returns {Promise<void>}
 */
async function handleStatus() {
  const status = await getLicenseStatus();

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║           VulnSweep License Status           ║');
  console.log('╠══════════════════════════════════════════════╣');

  if (status.isLicensed && !status.isExpired) {
    console.log('║  Status: ✅ Licensed (Active)                ║');
  } else if (status.isExpired) {
    console.log('║  Status: ⚠️  License Expired                 ║');
  } else {
    console.log('║  Status: 🔓 Free Tier                       ║');
  }

  console.log(
    `║  Fixes used: ${String(status.fixesUsed).padEnd(4)}/ ${String(status.maxFixes).padEnd(26)}║`
  );

  if (!status.isLicensed || status.isExpired) {
    console.log(`║  Fixes remaining: ${String(status.fixesRemaining).padEnd(25)}║`);
  } else {
    console.log('║  Fixes remaining: ∞ (unlimited)              ║');
  }

  if (status.installDate) {
    const dateStr = new Date(status.installDate).toISOString().split('T')[0];
    console.log(`║  Installed: ${dateStr.padEnd(31)}║`);
    console.log(`║  Days active: ${String(status.daysInstalled).padEnd(29)}║`);
  }

  console.log('╚══════════════════════════════════════════════╝');

  if (!status.isLicensed && status.fixesRemaining === 0) {
    console.log('');
    console.log('Run "vulnsweep purchase" to buy a license and unlock unlimited fixes.');
  }
}

module.exports = { handleStatus };
