function Modal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  confirmStyle,
  children,
}) {
  if (!isOpen) return null;

  const confirmButtonClass =
    confirmStyle === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-blue-600 hover:bg-blue-700 text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
      <div className="bg-surface-raised rounded-lg shadow-2xl border border-gray-700 max-w-md w-full mx-4 animate-fadeIn">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {children || <p className="text-gray-300 text-sm leading-relaxed">{message}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-mid rounded-b-lg border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 font-medium rounded-lg transition-colors ${confirmButtonClass}`}
          >
            {confirmText || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Modal;
