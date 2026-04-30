import { AlertTriangle } from 'lucide-react';
import PropTypes from 'prop-types';
import React from 'react';

/**
 * ErrorBoundary component to catch and handle errors gracefully in React components.
 * Prevents the entire application from crashing when a single component fails.
 *
 * @class ErrorBoundary
 * @extends {React.Component}
 *
 * @prop {React.ReactNode} children - The child components to be wrapped
 * @prop {string} [fallbackMessage] - Custom message to display when an error occurs
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Static method called when an error is thrown in a descendant component.
   * Updates state to trigger fallback UI rendering.
   *
   * @static
   * @param {Error} error - The error that was thrown
   * @returns {Object} New state object
   */
  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Lifecycle method called after an error has been thrown by a descendant component.
   * Logs the error details for debugging purposes.
   *
   * @param {Error} error - The error that was thrown
   * @param {Object} errorInfo - Object with componentStack key containing stack trace
   */
  componentDidCatch(error, errorInfo) {
    // Log error details to console for debugging
    console.error('ErrorBoundary caught an error:', {
      error,
      errorInfo,
      componentStack: errorInfo.componentStack,
    });

    // Store error info in state for potential display
    this.setState({
      errorInfo,
    });

    // Future: Send to error tracking service (e.g., Sentry, LogRocket)
    // this.reportErrorToService(error, errorInfo);
  }

  /**
   * Reset error state to attempt recovery.
   * This will re-render the children components.
   */
  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Render fallback UI
      return (
        <div className="flex items-center justify-center min-h-[200px] bg-surface-raised rounded-lg p-6 m-2">
          <div className="text-center max-w-2xl">
            {/* Error Icon + Title */}
            <div className="flex items-center justify-center gap-2 mb-2">
              <AlertTriangle size={20} strokeWidth={2} className="text-yellow-400 shrink-0" />
              <h2 className="text-xl font-semibold text-white">
                {this.props.fallbackMessage || 'Something went wrong'}
              </h2>
            </div>

            {/* Error Description */}
            <p className="text-gray-400 mb-4">
              An error occurred in this section. Please try again or contact support if the problem
              persists.
            </p>

            {/* Development Mode: Show Error Details */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="text-left mb-4 bg-surface rounded p-4">
                <summary className="text-blue-400 cursor-pointer hover:text-blue-300 font-medium mb-2">
                  🔍 Error details (Development Mode)
                </summary>
                <div className="mt-2 space-y-2">
                  {/* Error Message */}
                  <div>
                    <span className="text-red-400 font-semibold">Error: </span>
                    <span className="text-gray-300">{this.state.error.toString()}</span>
                  </div>

                  {/* Error Stack */}
                  {this.state.error.stack && (
                    <div>
                      <span className="text-red-400 font-semibold">Stack Trace:</span>
                      <pre className="text-xs text-text-muted mt-1 overflow-auto max-h-40 bg-surface-sunken p-2 rounded">
                        {this.state.error.stack}
                      </pre>
                    </div>
                  )}

                  {/* Component Stack */}
                  {this.state.errorInfo && this.state.errorInfo.componentStack && (
                    <div>
                      <span className="text-red-400 font-semibold">Component Stack:</span>
                      <pre className="text-xs text-text-muted mt-1 overflow-auto max-h-40 bg-surface-sunken p-2 rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Reset Button */}
            <button
              onClick={this.handleReset}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors duration-200 shadow-lg hover:shadow-xl"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    // No error, render children normally
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  /** Child components to wrap */
  children: PropTypes.node.isRequired,
  /** Custom error message to display in the heading */
  fallbackMessage: PropTypes.string,
};

ErrorBoundary.defaultProps = {
  fallbackMessage: undefined,
};

export default ErrorBoundary;
