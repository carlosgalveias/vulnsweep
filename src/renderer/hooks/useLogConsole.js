import { OP_ON_LOG_MESSAGE } from '@shared/renderer-api-opcodes.js';
import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for managing log console state and operations
 * @returns {Object} Log console state and methods
 * @returns {Array} returns.logs - Array of log entries
 * @returns {Function} returns.addLog - Function to add a log entry
 * @returns {Function} returns.clearLogs - Function to clear all logs
 */
export default function useLogConsole() {
  const [logs, setLogs] = useState([]);

  /**
   * Add a log entry to the console
   * @param {string} level - Log level (info, success, warning, error)
   * @param {string} message - Log message
   */
  const addLog = useCallback((level, message) => {
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date().toISOString(),
        level,
        message,
      },
    ]);
  }, []);

  /**
   * Clear all logs from the console
   */
  const clearLogs = useCallback(() => {
    setLogs([]);
    addLog('info', 'Logs cleared');
  }, [addLog]);

  // Subscribe to backend log messages on mount
  useEffect(() => {
    addLog('info', 'VulnSweep initialized successfully');

    // Subscribe to backend log messages
    const unsubscribe = window.electronAPI.on(OP_ON_LOG_MESSAGE, (log) => {
      setLogs((prev) => [...prev, log]);
    });

    return () => unsubscribe();
  }, [addLog]);

  return {
    logs,
    addLog,
    clearLogs,
  };
}
