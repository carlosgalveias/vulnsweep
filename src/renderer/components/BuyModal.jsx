/* eslint-disable react/prop-types */
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';

const BuyModal = ({ isOpen, onClose, onPaymentSuccess }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-lg shadow-xl max-w-md w-full border border-gray-700 flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-gray-100 flex items-center">
            <span className="mr-2">🚀</span> Upgrade to Full Version
          </h2>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <p className="text-gray-300 mb-4">
            For full version please buy the license. Price is $30 but in promotion for{' '}
            <strong className="text-green-400">$9.99</strong> per device.
          </p>
          <p className="text-sm text-gray-400 mb-6">
            The full version allows you to apply fixes and commit changes directly from the
            application.
          </p>

          <div className="mt-4 flex justify-center">
            <PayPalScriptProvider options={{ 'client-id': 'test', currency: 'USD' }}>
              <PayPalButtons
                style={{ layout: 'vertical' }}
                createOrder={(data, actions) => {
                  return actions.order.create({
                    purchase_units: [
                      {
                        amount: {
                          value: '9.99',
                        },
                        payee: {
                          email_address: 'carlos.galveias@gmail.com',
                        },
                      },
                    ],
                  });
                }}
                onApprove={(data, actions) => {
                  return actions.order.capture().then((details) => {
                    onPaymentSuccess(details);
                  });
                }}
              />
            </PayPalScriptProvider>
          </div>
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-between">
          <button
            onClick={() => onPaymentSuccess({ id: 'test-payment-bypass' })}
            className="px-4 py-2 bg-purple-900 bg-opacity-30 hover:bg-opacity-50 text-purple-400 border border-purple-700 rounded font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors text-xs"
            title="For testing the commercial version without payment"
          >
            Test Bypass
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
          >
            Continue with Free Version
          </button>
        </div>
      </div>
    </div>
  );
};

export default BuyModal;
