'use strict';

const { PAYPAL_CONFIG, LICENSE_API_CONFIG } = require('../main/config/constants');
const license = require('../main/modules/license');

/**
 * Handle the purchase subcommand.
 * Prints pricing and payment instructions — no browser required.
 */
async function handlePurchase() {
  const installInfo = license.getInstallInfo();
  const isPromo = installInfo.isPromo;
  const price = isPromo ? '€9.99/year' : '€29.99/year';
  const paypalUrl = isPromo ? PAYPAL_CONFIG.PAYMENT_URL_PROMO : PAYPAL_CONFIG.PAYMENT_URL_FULL;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              VulnSweep Pro — License Purchase                ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log(`║  Price: ${price.padEnd(52)}║`);
  if (isPromo) {
    console.log('║  🎉 Early-bird discount applied!                             ║');
    const daysLeft = installInfo.daysRemaining || 0;
    console.log(
      `║  (${String(daysLeft).padStart(2)} days remaining at promo price)                      ║`
    );
  }
  console.log('║                                                              ║');
  console.log('║  License includes:                                           ║');
  console.log('║  • Unlimited vulnerability auto-fixes                        ║');
  console.log('║  • 1 year of updates                                         ║');
  console.log('║  • Works in both Desktop App & CLI                           ║');
  console.log('║                                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log('║  Step 1: Pay via PayPal (open on any device):                ║');
  console.log(`║  ${paypalUrl.padEnd(60)}║`);
  console.log('║                                                              ║');
  console.log('║  Step 2: Get your Transaction ID from the PayPal             ║');
  console.log('║          confirmation email or receipt page.                  ║');
  console.log('║                                                              ║');
  console.log('║  Step 3: Activate your license:                              ║');
  console.log('║  vulnsweep activate --email you@email.com --txn TXN_ID       ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  return { ok: true };
}

/**
 * Handle the activate subcommand.
 * Verifies payment with the license server, then generates local license.
 *
 * @param {string} email - Email used for PayPal payment
 * @param {string} transactionId - PayPal transaction ID from receipt
 * @returns {Promise<{ ok: boolean, key?: string }>}
 */
async function handleActivate(email, transactionId) {
  if (!email || !transactionId) {
    console.error('');
    console.error('Usage: vulnsweep activate --email <email> --txn <transaction-id>');
    console.error('');
    console.error('  --email   Email address used for PayPal payment');
    console.error('  --txn     Transaction ID from PayPal receipt/confirmation email');
    console.error('');
    return { ok: false };
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Error: Invalid email format.');
    return { ok: false };
  }

  // Basic transaction ID validation (alphanumeric, 10-30 chars)
  if (!/^[A-Za-z0-9]{10,30}$/.test(transactionId)) {
    console.error('Error: Invalid transaction ID format. Check your PayPal receipt.');
    return { ok: false };
  }

  // I5: Always use constants — no ENV var override
  const apiUrl = LICENSE_API_CONFIG.URL;
  const verifyUrl = `${apiUrl}${LICENSE_API_CONFIG.VERIFY_ENDPOINT}`;

  console.log('');
  console.log('Verifying payment...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_API_CONFIG.TIMEOUT_MS);

    // I2: Include X-API-Key header for authentication
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': LICENSE_API_CONFIG.CLIENT_API_KEY,
      },
      body: JSON.stringify({ email, transactionId }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const result = await response.json();

    if (!result.verified) {
      const messages = {
        transaction_not_found:
          'Transaction not found. Please verify your Transaction ID from the PayPal receipt.',
        amount_mismatch: 'Payment amount does not match the license price.',
        already_used: 'This transaction has already been used by a different email address.',
        verification_in_progress:
          'Verification already in progress. Please wait a moment and try again.',
        invalid_status: 'Payment is still processing. Please wait a few minutes and try again.',
        missing_fields: 'Missing email or transaction ID.',
        unauthorized: 'Client authentication failed. Please update VulnSweep.',
      };
      console.error(
        `✗ Verification failed: ${messages[result.error] || result.error || 'Unknown error'}`
      );
      return { ok: false };
    }

    // C3: Validate activation token structure before trusting it
    if (!result.activationToken || !result.activationToken.includes('.')) {
      console.error('✗ Invalid activation response from server.');
      return { ok: false };
    }

    const [payloadB64] = result.activationToken.split('.');
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
      if (payload.exp && payload.exp < Date.now()) {
        console.error('✗ Activation token expired. Please try again.');
        return { ok: false };
      }
      if (payload.email !== email || payload.txn !== transactionId) {
        console.error('✗ Activation token mismatch. Please try again.');
        return { ok: false };
      }
    } catch {
      console.error('✗ Malformed activation token. Please try again.');
      return { ok: false };
    }

    // Payment verified! Generate local license.
    console.log('✓ Payment verified.');
    console.log('Generating license...');

    const licenseResult = await license.generateLicense();

    if (licenseResult && licenseResult.ok) {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║          ✅ License Activated Successfully!                   ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log(`║  Key: ${(licenseResult.key || 'N/A').substring(0, 54).padEnd(54)}║`);
      console.log('║                                                              ║');
      console.log('║  Valid for: 1 year                                           ║');
      console.log('║  Shared between: Desktop App + CLI                           ║');
      console.log('║  Unlimited vulnerability auto-fixes enabled.                 ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
      return { ok: true, key: licenseResult.key };
    } else {
      console.error('License generation failed. Please try again or contact support.');
      return { ok: false };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(
        '✗ License server timed out. Please check your internet connection and try again.'
      );
    } else if (
      err.code === 'ENOTFOUND' ||
      err.code === 'ECONNREFUSED' ||
      err.message?.includes('fetch')
    ) {
      console.error('✗ Cannot reach the license server. Please check your internet connection.');
    } else {
      console.error(`✗ Activation error: ${err.message}`);
    }
    return { ok: false };
  }
}

module.exports = { handlePurchase, handleActivate };
