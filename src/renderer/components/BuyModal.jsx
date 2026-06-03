/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import Spinner from './Spinner';

/**
 * BuyModal — Worker-verified PayPal payment flow with dynamic yearly pricing.
 *
 * Three-phase state machine:
 *   1. checkout    — Email input + "Pay with PayPal" button
 *   2. verification — Transaction ID input + "Verify & Activate" button
 *   3. activating  — Spinner while Worker verification is in progress
 *
 * Props:
 *   isOpen            {boolean}   — whether the modal is visible
 *   onClose           {function}  — called when the modal should close
 *   onPaymentSuccess  {function}  — called with { licenseKey } on successful payment
 *   installInfo       {object}    — { isPromo, price, daysRemaining } from getInstallInfo()
 *   isExpired         {boolean}   — true when the user has an expired annual license
 */
const BuyModal = ({ isOpen, onClose, onPaymentSuccess, installInfo, isExpired = false }) => {
  const isDevMode = !!window.electronAPI?.seedDevTransaction;

  const [phase, setPhase] = useState('checkout');
  const [email, setEmail] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  /**
   * Dynamic price state fetched from the main process via getActivePrice().
   * Falls back to promo defaults so the UI is never blank while the IPC call
   * is in-flight or if it fails.
   * @type {{ price: number, isPromo: boolean, promoEndsAt: string|null }}
   */
  const [priceInfo, setPriceInfo] = useState({ price: 9.99, isPromo: true, promoEndsAt: null });

  // Reset to initial state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase('checkout');
      setEmail('');
      setTransactionId('');
      setErrorMsg('');
      setLoading(false);
    }
  }, [isOpen]);

  // Fetch live pricing from the main process each time the modal is opened.
  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI
      .getActivePrice()
      .then((info) => {
        if (info) setPriceInfo(info);
      })
      .catch(() => {
        // Silently fall back to the default promo price already in state.
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const { price, isPromo, promoEndsAt } = priceInfo;
  const displayPrice = typeof price === 'number' ? price.toFixed(2) : String(price);

  // The full (non-promo) price shown as the "after-promotion" reference.
  const fullPriceDisplay =
    installInfo?.price && !installInfo?.isPromo ? Number(installInfo.price).toFixed(2) : '29.99';

  /**
   * Format a UTC ISO date string to a locale-aware, human-readable date.
   * @param {string|null} isoDate
   * @returns {string|null}
   */
  function formatPromoEnd(isoDate) {
    if (!isoDate) return null;
    try {
      return new Date(isoDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return null;
    }
  }

  const promoEndFormatted = formatPromoEnd(promoEndsAt);

  /**
   * Phase 1 handler: Validate email and open PayPal payment window.
   * On success URL detection, advance to verification phase.
   */
  const handlePayWithPayPal = async () => {
    // Validate email before opening payment window
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter the email address you will use for PayPal payment.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const result = await window.electronAPI.openPaymentWindow(isPromo);

      if (result?.needsVerification) {
        // Payment success detected — advance to verification phase
        setPhase('verification');
        setErrorMsg('');
      } else if (result?.cancelled) {
        setErrorMsg('Payment was cancelled. You can try again whenever you are ready.');
      } else {
        setErrorMsg(result?.error ?? 'An unexpected error occurred. Please try again.');
      }
    } catch (err) {
      setErrorMsg(`Payment failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Dev mode handler: Seed a test transaction and advance to verification.
   */
  const handleSimulatePayment = async () => {
    if (!email) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const result = await window.electronAPI.seedDevTransaction(email, '29.99');
      if (!result.success) {
        setErrorMsg(result.error || 'Seed failed');
        return;
      }
      setTransactionId(result.transactionId);
      setPhase('verification');
    } catch (err) {
      setErrorMsg(err.message || 'Seed failed');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Phase 2 handler: Validate transaction ID format and call Worker verification.
   * On success, fire onPaymentSuccess callback and close modal.
   */
  const handleVerify = async () => {
    // Client-side format validation (mirrors CLI)
    const trimmedTxn = transactionId.trim();
    if (!/^[A-Za-z0-9]{10,30}$/.test(trimmedTxn)) {
      setErrorMsg(
        'Invalid Transaction ID format. Check your PayPal receipt email for the Transaction ID.'
      );
      return;
    }

    setPhase('activating');
    setLoading(true);
    setErrorMsg('');

    try {
      const result = await window.electronAPI.verifyAndActivate(email.trim(), trimmedTxn);

      if (result?.ok === true) {
        onPaymentSuccess({ licenseKey: result.key });
        onClose();
      } else {
        // Show error and allow retry (stay in verification phase)
        setPhase('verification');
        setErrorMsg(
          result?.error ?? 'Verification failed. Please check your Transaction ID and try again.'
        );
      }
    } catch (err) {
      setPhase('verification');
      setErrorMsg(`Verification error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Renders the checkout phase: pricing info, email input, and Pay button.
   */
  function renderCheckoutPhase() {
    return (
      <>
        {/* Expired license notice */}
        {isExpired && (
          <div className="rounded-md bg-amber-900 bg-opacity-50 border border-amber-700 px-4 py-3 text-sm text-amber-200">
            ⚠️ Your annual license has expired. Renew now to continue applying fixes and accessing
            all features.
          </div>
        )}

        {/* Promo / regular price copy */}
        {isPromo ? (
          <div>
            <p className="text-gray-300 mb-1">
              🔥 <strong className="text-amber-400">Early adopter price!</strong> Get an annual
              license for only <strong className="text-green-400">€{displayPrice}/year</strong> —
              limited time offer.
            </p>
            <p className="text-xs text-amber-300">
              {promoEndFormatted ? (
                <>
                  Offer ends on <strong>{promoEndFormatted}</strong>. Price rises to{' '}
                  <strong>€{fullPriceDisplay}/year</strong> after that.
                </>
              ) : (
                <>
                  Limited time offer. Price rises to <strong>€{fullPriceDisplay}/year</strong> after
                  the promotion.
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="text-gray-300">
            Get an annual license for{' '}
            <strong className="text-green-400">€{displayPrice}/year</strong> — renews annually,
            includes all features and future updates.
          </p>
        )}

        {/* Feature description */}
        <p className="text-sm text-gray-400">
          <strong className="text-gray-200">VulnSweep Annual License</strong> — unlocks fix
          application, git commit/push, and all future features. Bound to this device for 365 days.
        </p>

        {/* Email input */}
        <div>
          <label htmlFor="payment-email" className="block text-sm font-medium text-gray-300 mb-1">
            PayPal Email Address
          </label>
          <input
            id="payment-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={loading}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            Enter the email associated with your PayPal account.
          </p>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="rounded-md bg-red-900 bg-opacity-50 border border-red-700 px-4 py-3 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Pay button */}
        <button
          onClick={handlePayWithPayPal}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {loading ? (
            <>
              <Spinner size="sm" className="text-white" />
              <span>Opening PayPal…</span>
            </>
          ) : (
            <>
              <span>💳</span>
              <span>Pay €{displayPrice}/year with PayPal</span>
            </>
          )}
        </button>

        {loading && (
          <p className="text-xs text-center text-gray-500">
            Complete the payment in the PayPal window. This dialog will update automatically once
            payment is confirmed.
          </p>
        )}

        <p className="text-xs text-center text-gray-500">
          You&apos;ll enter your Transaction ID after payment to verify.
        </p>

        {isDevMode && (
          <div
            style={{
              background: '#2d1b69',
              border: '1px solid #7c3aed',
              borderRadius: '8px',
              padding: '16px',
              marginTop: '16px',
            }}
          >
            <p style={{ color: '#a78bfa', fontWeight: 600, marginBottom: '8px' }}>
              🧪 Dev Mode — Sandbox
            </p>
            <p style={{ color: '#c4b5fd', fontSize: '0.85rem', marginBottom: '12px' }}>
              No real payment required. A test transaction will be seeded.
            </p>
            <button
              onClick={handleSimulatePayment}
              disabled={!email || loading}
              style={{
                background: '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {loading ? 'Seeding...' : 'Simulate Payment'}
            </button>
          </div>
        )}
      </>
    );
  }

  /**
   * Renders the verification phase: success banner, transaction ID input, verify button.
   */
  function renderVerificationPhase() {
    return (
      <>
        {/* Success banner */}
        <div className="rounded-md bg-green-900 bg-opacity-50 border border-green-700 px-4 py-3 text-sm text-green-300">
          ✓ Payment detected! Enter your Transaction ID to verify and activate your license.
        </div>

        {/* Transaction ID input */}
        <div>
          <label htmlFor="transaction-id" className="block text-sm font-medium text-gray-300 mb-1">
            Transaction ID
          </label>
          <input
            id="transaction-id"
            type="text"
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            placeholder="e.g. 5TY12345AB678901C"
            disabled={loading}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            Find this in your PayPal confirmation email or receipt page. It&apos;s a 13-20 character
            alphanumeric code.
          </p>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="rounded-md bg-red-900 bg-opacity-50 border border-red-700 px-4 py-3 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Verify button */}
        <button
          onClick={handleVerify}
          disabled={loading || !transactionId.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <span>🔐</span>
          <span>Verify &amp; Activate</span>
        </button>
      </>
    );
  }

  /**
   * Renders the activating phase: spinner with progress message.
   */
  function renderActivatingPhase() {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <Spinner size="lg" className="text-blue-400" />
        <p className="text-gray-300 text-sm">Verifying your payment with our server...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-lg shadow-xl max-w-md w-full border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            {isExpired ? (
              <>
                <span>🔄</span> Renew Your Annual License
              </>
            ) : (
              <>
                <span>🔓</span> Upgrade to Full Version
              </>
            )}
          </h2>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 space-y-4">
          {phase === 'checkout' && renderCheckoutPhase()}
          {phase === 'verification' && renderVerificationPhase()}
          {phase === 'activating' && renderActivatingPhase()}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Continue without license
          </button>
        </div>
      </div>
    </div>
  );
};

export default BuyModal;
