import PropTypes from 'prop-types';
import { useRef, useEffect } from 'react';

function LogConsole({ logs, onClear }) {
  const consoleRef = useRef(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopyLogs = async () => {
    const logsText = logs
      .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(logsText);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const getLogColor = (level) => {
    const colors = {
      info: 'text-gray-100',
      warning: 'text-yellow-400',
      error: 'text-red-400',
      success: 'text-green-400',
    };
    return colors[level] || 'text-gray-100';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full bg-surface-sunken border-l border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between compact-header bg-surface border-b border-gray-700">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Log Console</h3>
        <div className="flex compact-gap-sm">
          <button
            onClick={handleCopyLogs}
            disabled={logs.length === 0}
            className={`compact-btn-sm rounded transition-colors ${
              logs.length > 0
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            Copy
          </button>
          <button
            onClick={onClear}
            disabled={logs.length === 0}
            className={`compact-btn-sm rounded transition-colors ${
              logs.length > 0
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log Display */}
      <div
        ref={consoleRef}
        className="flex-1 overflow-auto compact-header font-mono text-[0.65rem] leading-tight"
      >
        {logs.length === 0 ? (
          <div className="text-gray-600 italic text-xs">
            No logs yet. Start a scan to see activity...
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="mb-0.5 hover:bg-gray-900 px-1.5 py-0.5 rounded">
              <span className="text-text-muted">[{formatTimestamp(log.timestamp)}]</span>{' '}
              <span className={`font-semibold ${getLogColor(log.level)}`}>
                [{log.level.toUpperCase()}]
              </span>{' '}
              <span className={getLogColor(log.level)}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

LogConsole.propTypes = {
  logs: PropTypes.arrayOf(
    PropTypes.shape({
      timestamp: PropTypes.string.isRequired,
      level: PropTypes.string.isRequired,
      message: PropTypes.string.isRequired,
    })
  ).isRequired,
  onClear: PropTypes.func.isRequired,
};

export default LogConsole;
