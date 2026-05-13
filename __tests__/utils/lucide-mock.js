/**
 * Lucide React Mock for Jest
 *
 * Provides a generic mock React component for all lucide-react icon imports.
 * This prevents Jest from failing when it encounters ESM-only lucide-react
 * in the test environment.
 *
 * Usage (via jest.config.js moduleNameMapper):
 *   'lucide-react': '<rootDir>/__tests__/utils/lucide-mock.js'
 */

const PropTypes = require('prop-types');
const React = require('react');

/**
 * Generic icon component factory.
 * Returns a simple <svg> element with the icon name as a data attribute,
 * forwarding className and other props so snapshot / accessibility tests work.
 */
const createIcon = (displayName) => {
  const Icon = ({ className, size, strokeWidth, ...rest }) =>
    React.createElement('svg', {
      'data-testid': `icon-${displayName}`,
      'data-icon': displayName,
      className,
      width: size,
      height: size,
      strokeWidth,
      ...rest,
    });
  Icon.displayName = displayName;
  Icon.propTypes = {
    className: PropTypes.string,
    size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    strokeWidth: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  };
  return Icon;
};

// Export every icon used in the codebase as a named export.
// Add new entries here if more icons are imported in future.
module.exports = {
  ShieldAlert: createIcon('ShieldAlert'),
  AlertTriangle: createIcon('AlertTriangle'),
  AlertCircle: createIcon('AlertCircle'),
  Info: createIcon('Info'),
  Minus: createIcon('Minus'),
  CheckCircle: createIcon('CheckCircle'),
  Loader: createIcon('Loader'),
  Clock: createIcon('Clock'),
  XCircle: createIcon('XCircle'),
  MinusCircle: createIcon('MinusCircle'),
  Circle: createIcon('Circle'),
  TrendingUp: createIcon('TrendingUp'),
  TrendingDown: createIcon('TrendingDown'),
  ArrowUpCircle: createIcon('ArrowUpCircle'),
  XOctagon: createIcon('XOctagon'),
};
