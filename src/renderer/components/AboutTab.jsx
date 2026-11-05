/* eslint-disable react/prop-types */
import { OP_OPEN_LOCAL_DOC } from '@shared/renderer-api-opcodes.js';

function AboutTab({ appVersion }) {
  const card = 'bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3';
  const hd = 'text-xs font-semibold text-gray-400 uppercase tracking-wider';
  const lk =
    'text-blue-400 hover:text-blue-300 text-sm underline cursor-pointer bg-transparent border-none p-0 text-left';

  return (
    <div className="max-w-2xl mx-auto space-y-5 text-gray-100">
      <div className={card}>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">VulnSweep</h1>
          {appVersion && <span className="text-xs text-gray-400 font-mono">v{appVersion}</span>}
        </div>
        <p className="text-sm text-gray-400">Automated dependency vulnerability orchestrator</p>
      </div>

      <div className={card}>
        <h2 className={hd}>Documentation</h2>
        <div className="flex flex-col gap-2">
          <button
            className={lk}
            onClick={() => window.electronAPI.invoke(OP_OPEN_LOCAL_DOC, 'PRIVACY_POLICY.md')}
          >
            Privacy Policy
          </button>
          <button
            className={lk}
            onClick={() => window.electronAPI.invoke(OP_OPEN_LOCAL_DOC, 'DISCLAIMER.md')}
          >
            Disclaimer
          </button>
        </div>
        <p className="text-red-400 font-bold text-xs mt-3">
          🔒 Your code never leaves your machine. All scanning and analysis is performed locally.
        </p>
      </div>

      <div className={card}>
        <h2 className={hd}>Support</h2>
        <a
          href="https://github.com/carlosgalveias/vulnsweep-releases/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-sm underline"
        >
          Report an issue on GitHub
        </a>
      </div>
    </div>
  );
}

export default AboutTab;
