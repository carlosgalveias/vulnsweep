/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface layers — dark desktop-app background hierarchy
        // Maps to existing: bg-black, bg-gray-900, bg-gray-800, bg-gray-700
        // and the non-standard bg-gray-850 used in Modal.jsx / VulnerabilityGrid.jsx
        surface: {
          DEFAULT: '#111827', // gray-900  — primary page / component background
          raised: '#1f2937', // gray-800  — elevated panels: header, thead, tooltip, search bar
          overlay: '#374151', // gray-700  — controls bg, disabled buttons, progress track
          sunken: '#000000', // black     — LogConsole log-output area
          mid: '#252f3f', // ~gray-850 — modal footer, alternating table row tint
        },

        // Brand / accent — primary interactive color
        // Scan & Browse buttons, focus rings, progress bar fill, info icon, CVE links
        brand: {
          DEFAULT: '#2563eb', // blue-600  — primary action buttons
          muted: '#3b82f6', // blue-500  — progress bar fill
          subtle: '#60a5fa', // blue-400  — info icon, links, hover states
        },

        // Severity badge colors — getSeverityBadge() in VulnerabilityGrid.jsx
        severity: {
          critical: '#dc2626', // red-600
          high: '#ea580c', // orange-600
          medium: '#eab308', // yellow-500  (text uses text-inverse for contrast)
          low: '#2563eb', // blue-600
          info: '#4b5563', // gray-600    — fallback / info level
        },

        // Status badge colors — getStatusBadge() + Modal confirmStyle
        status: {
          fixed: '#16a34a', // green-600  — resolved
          applying: '#2563eb', // blue-600   — in-progress
          pending: '#4b5563', // gray-600   — not yet processed
          failed: '#dc2626', // red-600    — failed
          skipped: '#374151', // gray-700   — nofix / disabled rows
        },

        // Teal accent — "resolves dependents" count & list in VulnerabilityGrid.jsx
        accent: {
          DEFAULT: '#2dd4bf', // teal-400
          subtle: '#5eead4', // teal-300
        },

        // Dependency type badges — WCAG AA compliant pairs (≥4.5:1)
        // direct:     blue-800 (#1e40af) bg / blue-100 (#dbeafe) text → ~5.2:1 ✓
        // transitive: purple-800 (#6b21a8) bg / purple-100 (#f3e8ff) text → ~5.8:1 ✓
        dep: {
          direct: {
            bg: '#1e40af', // blue-800
            text: '#dbeafe', // blue-100
          },
          transitive: {
            bg: '#6b21a8', // purple-800
            text: '#f3e8ff', // purple-100
          },
        },

        // Warning / destructive accent
        // yellow-400 warning icon in Header; amber bg for promoted-dependent badge
        warn: {
          DEFAULT: '#facc15', // yellow-400 — warning icon in Header
          strong: '#f59e0b', // amber-500  — stronger warning emphasis
          bg: '#78350f', // amber-900  — promoted-dependent badge background
          text: '#fcd34d', // amber-300  — promoted-dependent badge text
          border: '#92400e', // amber-700  — promoted-dependent badge border
        },

        // Semantic text hierarchy
        text: {
          primary: '#f3f4f6', // gray-100 — primary readable content
          secondary: '#e5e7eb', // gray-200 — column values, project names
          muted: '#9ca3af', // gray-400 — timestamps, secondary labels, filter count
          faint: '#6b7280', // gray-500 — disabled / placeholder text
          disabled: '#4b5563', // gray-600 — skeleton loaders, empty-state icons
          inverse: '#111827', // gray-900 — text on light-bg badges (medium severity)
        },

        // Semantic border hierarchy
        border: {
          DEFAULT: '#374151', // gray-700 — standard dividers: header, panels, tooltip
          muted: '#4b5563', // gray-600 — input borders, checkbox borders
          strong: '#1f2937', // gray-800 — subtle table-row separators
        },
      },

      // Typography — compact scale for 13px root font-size (set in index.css)
      // Line-heights are intentionally tight for desktop-app information density.
      // These extend (do not replace) Tailwind defaults so text-xs / text-sm
      // classes already in the codebase continue to resolve correctly.
      fontSize: {
        // Micro — used for monospace version strings, column sub-labels
        'app-2xs': ['0.625rem', { lineHeight: '1.2' }], // ~8.1px at 13px root
        // Extra-small — table cell content, badge labels, log lines
        'app-xs': ['0.6875rem', { lineHeight: '1.25' }], // ~8.9px at 13px root
        // Small — body copy, input text, button text
        'app-sm': ['0.8125rem', { lineHeight: '1.35' }], // ~10.6px at 13px root
        // Base — default body, matches body { font-size: 0.9rem } in index.css
        'app-base': ['0.9rem', { lineHeight: '1.4' }], // ~11.7px at 13px root
        // Medium — section labels, column headers
        'app-md': ['0.9375rem', { lineHeight: '1.4' }], // ~12.2px at 13px root
        // Large — modal titles, panel headings
        'app-lg': ['1.0625rem', { lineHeight: '1.45' }], // ~13.8px at 13px root
        // Extra-large — reserved for prominent headings
        'app-xl': ['1.1875rem', { lineHeight: '1.5' }], // ~15.4px at 13px root
      },

      // Border radius — consistent rounding scale matching current component usage
      // Existing classes: rounded (0.25rem), rounded-lg (0.5rem), rounded-full
      // These tokens add semantic names without overriding Tailwind defaults.
      borderRadius: {
        'app-sm': '0.25rem', // rounded   — badges, checkboxes, small buttons
        'app-md': '0.375rem', // rounded-md — inputs, filter bar
        'app-lg': '0.5rem', // rounded-lg — modals, tooltip panels
        'app-full': '9999px', // rounded-full — progress bar pill
      },
    },
  },
  plugins: [],
};
