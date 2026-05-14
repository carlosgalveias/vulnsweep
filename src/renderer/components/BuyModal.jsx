/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import Spinner from './Spinner';

/**
 * BuyModal — PayPal "Success URL" payment flow with dynamic yearly pricing.
 *
 * Clicking "Pay with PayPal" delegates to the main process via
 * window.electronAPI.openPaymentWindow(), which opens a managed BrowserWindow
 * pointing at the PayPal payment link. When PayPal redirects the buyer to the
 * configured success URL, the main process closes that window, calls
 * generateLicense(), and resolves the IPC promise with { ok, key }.
 *
 * Props:
 *   isOpen            {boolean}   — whether the modal is visible
 *   onClose           {function}  — called when the modal should close
 *   onPaymentSuccess  {function}  — called with { licenseKey } on successful payment
 *   installInfo       {object}    — { isPromo, price, daysRemaining } from getInstallInfo()
 *   isExpired         {boolean}   — true when the user has an expired annual license
 */
const BuyModal = ({ isOpen, onClose, onPaymentSuccess, installInfo, isExpired = false }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  /**
   * Dynamic price state fetched from the main process via getActivePrice().
   * Falls back to promo defaults so the UI is never blank while the IPC call
   * is in-flight or if it fails.
   * @type {{ price: number, isPromo: boolean, promoEndsAt: string|null }}
   */
  const [priceInfo, setPriceInfo] = useState({ price: 9.99, isPromo: true, promoEndsAt: null });

  // Fetch live pricing from the main process each time the modal is opened.
  // This ensures the displayed price is always correct even after the promo
  // window expires between app launches without re-mounting App.
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
  // Prefer live data from installInfo; fall back to the known constant.
  const fullPriceDisplay =
    installInfo?.price && !installInfo?.isPromo ? Number(installInfo.price).toFixed(2) : '29.99';

  /**
   * Format a UTC ISO date string to a locale-aware, human-readable date.
   * Returns null if the input is falsy or unparseable.
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

  const handlePayWithPayPal = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const result = await window.electronAPI.openPaymentWindow(isPromo);

      if (result?.ok === true) {
        // Payment confirmed — notify parent and close modal
        onPaymentSuccess({ licenseKey: result.key });
        onClose();
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
                    Limited time offer. Price rises to <strong>€{fullPriceDisplay}/year</strong>{' '}
                    after the promotion.
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
            application, git commit/push, and all future features. Bound to this device for 365
            days.
          </p>

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
