import PropTypes from 'prop-types';
import { useState } from 'react';
import Spinner from './Spinner';

const CREDENTIAL_SOURCES = [
  {
    id: 'github-advisory',
    label: 'GitHub Advisory',
    description:
      'Personal Access Token (no scopes required). Raises rate limit from 60 req/hr to 5,000 req/hr.',
    placeholder: 'ghp_...',
    docsUrl: 'https://github.com/settings/tokens',
  },
  {
    id: 'nvd',
    label: 'NVD (National Vulnerability Database)',
    description:
      'API key raises rate limit from 5 req/30s to 50 req/30s — a 10x improvement for large scans.',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    docsUrl: 'https://nvd.nist.gov/developers/request-an-api-key',
  },
];

function buildMaskedDisplay(maskedHint) {
  if (!maskedHint) return 'Configured';
  return `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${maskedHint}`;
}

function CredentialsPanel({ credentials, onSave, onDelete }) {
  const [rowState, setRowState] = useState(() =>
    Object.fromEntries(
      CREDENTIAL_SOURCES.map((s) => [
        s.id,
        { inputValue: '', editMode: false, saving: false, error: null },
      ])
    )
  );

  const patchRow = (id, patch) =>
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleSave = async (id) => {
    const row = rowState[id];
    if (!row || !row.inputValue.trim()) return;
    const captured = row.inputValue;
    patchRow(id, { inputValue: '', saving: true, error: null });
    const result = await onSave(id, captured);
    if (result.success) {
      patchRow(id, { saving: false, editMode: false });
    } else {
      patchRow(id, { saving: false, error: result.error || 'Failed to save credential' });
    }
  };

  const handleDelete = async (id) => {
    patchRow(id, { saving: true, error: null });
    const result = await onDelete(id);
    if (result.success) {
      patchRow(id, { saving: false, editMode: false, inputValue: '' });
    } else {
      patchRow(id, { saving: false, error: result.error || 'Failed to delete credential' });
    }
  };

  const handleStartReplace = (id) => patchRow(id, { editMode: true, inputValue: '', error: null });
  const handleCancelReplace = (id) =>
    patchRow(id, { editMode: false, inputValue: '', error: null });

  const card = 'bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3';
  const inputCls =
    'w-full px-3 py-2 bg-surface-overlay border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono';
  const btnPrimary =
    'px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const btnSecondary =
    'px-3 py-1.5 text-xs rounded bg-surface-overlay hover:bg-gray-600 text-gray-200 border border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const btnDanger =
    'px-3 py-1.5 text-xs rounded bg-red-900 hover:bg-red-800 text-red-200 border border-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="space-y-4">
      {CREDENTIAL_SOURCES.map((source) => {
        const credState = credentials[source.id] ?? { configured: false, maskedHint: null };
        const row = rowState[source.id];
        const isConfigured = credState.configured;
        const isBusy = row.saving;
        const showInput = !isConfigured || row.editMode;
        const canSave = row.inputValue.trim().length > 0 && !isBusy;
        return (
          <div key={source.id} className={card}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-sm font-semibold text-gray-100">{source.label}</span>
                {isConfigured && !row.editMode && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-green-900 text-green-300 border border-green-700">
                    Active
                  </span>
                )}
              </div>
              <a
                href={source.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-xs underline"
              >
                Get token
              </a>
            </div>
            <p className="text-xs text-gray-400">{source.description}</p>
            {isConfigured && !row.editMode && (
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs font-mono text-gray-300 bg-surface-overlay px-2 py-1 rounded border border-gray-700">
                  {buildMaskedDisplay(credState.maskedHint)}
                </code>
                <button
                  className={btnSecondary}
                  disabled={isBusy}
                  onClick={() => handleStartReplace(source.id)}
                >
                  Replace
                </button>
                <button
                  className={btnDanger}
                  disabled={isBusy}
                  onClick={() => handleDelete(source.id)}
                >
                  {isBusy ? <Spinner size="sm" className="text-red-300" /> : 'Delete'}
                </button>
              </div>
            )}{' '}
            {showInput && (
              <div className="space-y-2">
                <input
                  type="password"
                  className={inputCls}
                  placeholder={source.placeholder}
                  value={row.inputValue}
                  autoComplete="off"
                  onChange={(e) => patchRow(source.id, { inputValue: e.target.value, error: null })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave(source.id);
                    if (e.key === 'Escape' && isConfigured) handleCancelReplace(source.id);
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    className={btnPrimary}
                    disabled={!canSave}
                    onClick={() => handleSave(source.id)}
                  >
                    {isBusy ? <Spinner size="sm" className="text-white" /> : 'Save'}
                  </button>
                  {isConfigured && row.editMode && (
                    <button
                      className={btnSecondary}
                      disabled={isBusy}
                      onClick={() => handleCancelReplace(source.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
            {row.error && <p className="text-xs text-red-400">{row.error}</p>}
          </div>
        );
      })}
    </div>
  );
}

CredentialsPanel.propTypes = {
  credentials: PropTypes.objectOf(
    PropTypes.shape({
      configured: PropTypes.bool.isRequired,
      maskedHint: PropTypes.string,
    })
  ).isRequired,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

export default CredentialsPanel;
