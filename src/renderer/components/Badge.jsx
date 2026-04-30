import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  Minus,
  CheckCircle,
  Loader,
  Clock,
  XCircle,
  MinusCircle,
  Circle,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import PropTypes from 'prop-types';

/** Shared icon props for compact badge sizing */
const ICON_PROPS = { size: 10, strokeWidth: 2.5, className: 'mr-1 shrink-0' };

/**
 * Returns the icon element to render for a given variant + normalized value.
 * Returns null for `promoted` (children may contain complex nested markup in
 * VulnerabilityGrid, so we skip prepending an icon to avoid breaking layouts).
 *
 * @param {string} variant
 * @param {string} normalizedValue - lower-cased value string
 * @returns {React.ReactElement|null}
 */
function getIcon(variant, normalizedValue) {
  switch (variant) {
    case 'severity': {
      const map = {
        critical: <ShieldAlert {...ICON_PROPS} />,
        high: <AlertTriangle {...ICON_PROPS} />,
        medium: <AlertCircle {...ICON_PROPS} />,
        moderate: <AlertCircle {...ICON_PROPS} />,
        low: <Info {...ICON_PROPS} />,
        info: <Minus {...ICON_PROPS} />,
      };
      return map[normalizedValue] ?? <Minus {...ICON_PROPS} />;
    }

    case 'status': {
      const spinProps = { ...ICON_PROPS, className: `${ICON_PROPS.className} animate-spin` };
      const map = {
        fixed: <CheckCircle {...ICON_PROPS} />,
        resolved: <CheckCircle {...ICON_PROPS} />,
        applying: <Loader {...spinProps} />,
        pending: <Clock {...ICON_PROPS} />,
        failed: <XCircle {...ICON_PROPS} />,
        skipped: <MinusCircle {...ICON_PROPS} />,
      };
      return map[normalizedValue] ?? <Circle {...ICON_PROPS} />;
    }

    case 'risk': {
      const map = {
        high: <TrendingUp {...ICON_PROPS} />,
        low: <TrendingDown {...ICON_PROPS} />,
      };
      return map[normalizedValue] ?? <Minus {...ICON_PROPS} />;
    }

    // 'promoted' variant: children may contain complex nested spans in VulnerabilityGrid,
    // so we intentionally skip prepending an icon to avoid breaking layouts.
    case 'promoted':
    default:
      return null;
  }
}

/**
 * Badge Component
 * Renders a styled badge pill for severity levels, fix statuses, risk levels,
 * and promoted-dependent warnings. Uses semantic design tokens from tailwind.config.js.
 *
 * Icons are automatically prepended (left of the text) for severity, status, and risk
 * variants. The promoted variant does not render an icon because its children may
 * contain complex nested markup.
 *
 * @param {'severity'|'status'|'risk'|'promoted'} variant - Controls the color mapping set
 * @param {string} [value] - The value to display and map to a color (case-insensitive)
 * @param {string} [className] - Optional extra Tailwind classes
 * @param {React.ReactNode} [children] - If provided, renders instead of value text
 */
function Badge({ variant, value, className, children }) {
  const base =
    'inline-flex items-center justify-center px-1.5 py-0.5 text-app-2xs font-semibold uppercase tracking-wide rounded-app-sm';

  const normalized = (value || '').toLowerCase();

  const getColorClasses = () => {
    switch (variant) {
      case 'severity': {
        const map = {
          critical: 'bg-severity-critical text-white',
          high: 'bg-severity-high text-white',
          medium: 'bg-severity-medium text-text-inverse',
          moderate: 'bg-severity-medium text-text-inverse', // npm audit alias for medium
          low: 'bg-severity-low text-white',
          info: 'bg-severity-info text-white',
        };
        return map[normalized] ?? 'bg-severity-info text-white';
      }

      case 'status': {
        const map = {
          fixed: 'bg-status-fixed text-white',
          resolved: 'bg-status-fixed text-white', // legacy alias used in VulnerabilityGrid
          applying: 'bg-status-applying text-white',
          pending: 'bg-status-pending text-white',
          failed: 'bg-status-failed text-white',
          skipped: 'bg-status-skipped text-white',
        };
        return map[normalized] ?? 'bg-status-pending text-white';
      }

      case 'risk': {
        const map = {
          high: 'bg-severity-critical text-white',
          low: 'bg-status-fixed text-white',
        };
        return map[normalized] ?? 'bg-severity-info text-white';
      }

      case 'promoted':
        return 'bg-warn-bg text-warn-text border border-warn-border';

      default:
        return 'bg-severity-info text-white';
    }
  };

  const colorClasses = getColorClasses();
  const allClasses = [base, colorClasses, className].filter(Boolean).join(' ');
  const icon = getIcon(variant, normalized);
  const content = children !== undefined ? children : value;

  return (
    <span className={allClasses}>
      {icon}
      {content}
    </span>
  );
}

Badge.propTypes = {
  /** Controls which color-mapping set is used */
  variant: PropTypes.oneOf(['severity', 'status', 'risk', 'promoted']).isRequired,
  /** Value to display and map to a color (case-insensitive). Not required for 'promoted' variant. */
  value: PropTypes.string,
  /** Optional additional Tailwind classes */
  className: PropTypes.string,
  /** If provided, renders as badge content instead of value text */
  children: PropTypes.node,
};

Badge.defaultProps = {
  value: undefined,
  className: undefined,
  children: undefined,
};

export default Badge;
