import { useState, useRef, useEffect } from 'react';

/**
 * InfoTooltip Component
 * Displays an info icon that shows a tooltip/modal with detailed information on click
 */
function InfoTooltip({ content, title }) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipRef = useRef(null);

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block" ref={tooltipRef}>
      {/* Info Icon Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
        aria-label="Show information"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {/* Tooltip Content */}
      {isOpen && (
        <div className="absolute z-50 left-0 mt-1 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-xl animate-fadeIn">
          {/* Header */}
          {title && (
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-gray-200">{title}</h4>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-200"
                aria-label="Close"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Body */}
          <div className="px-3 py-2 text-xs text-gray-300 max-h-64 overflow-y-auto">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

export default InfoTooltip;