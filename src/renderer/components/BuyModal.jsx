/* eslint-disable react/prop-types */
import { useState } from 'react';
import Spinner from './Spinner';

/**
 * BuyModal — PayPal "Success URL" payment flow.
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
 */
const BuyModal = ({ isOpen, onClose, onPaymentSuccess, installInfo }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const isPromo = installInfo?.isPromo ?? true;
  const price = installInfo?.price ?? '9.00';
  const fullPrice = '30.00';
  const daysRemaining = installInfo?.daysRemaining ?? 30;

  const handlePayWithPayPal = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const result = await window.electronAPI.openPaymentWindow(installInfo?.isPromo ?? true);

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
            <span>🚀</span> Upgrade to Full Version
          </h2>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 space-y-4">
          {/* Promo / regular price copy */}
          {isPromo ? (
            <div>
              <p className="text-gray-300 mb-1">
                🔥 <strong className="text-amber-400">Limited-time offer!</strong> Get the full
                version for only <strong className="text-green-400">{price}€</strong> — one-time
                purchase, lifetime updates.
              </p>
              <p className="text-xs text-amber-300">
                Promotion ends in{' '}
                <strong>
                  {daysRemaining} day{daysRemaining !== 1 ? 's' : ''}
                </strong>
                . Price rises to <strong>{fullPrice}€</strong> after the promotion.
              </p>
            </div>
          ) : (
            <p className="text-gray-300">
              Get the full version for <strong className="text-green-400">{price}€</strong> —
              one-time purchase, lifetime updates.
            </p>
          )}

          {/* Feature description */}
          <p className="text-sm text-gray-400">
            <strong className="text-gray-200">VulnSweep Commercial License</strong> — unlocks fix
            application, git commit/push, and all future features. Permanently bound to this device.
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
                <span>Pay {price}€ with PayPal</span>
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
