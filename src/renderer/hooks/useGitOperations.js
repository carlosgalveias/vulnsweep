import { useState, useCallback } from 'react';
import { DEFAULT_COMMIT_MESSAGE } from '../constants.js';

/**
 * Custom hook for managing git operations (commit and push)
 * @param {Function} addLog - Function to add log entries
 * @param {React.MutableRefObject} vulnerabilitiesRef - Ref to vulnerabilities array
 * @param {React.MutableRefObject} projectsRef - Ref to projects array
 * @returns {Object} Git operations state and methods
 */
export default function useGitOperations(
  addLog,
  vulnerabilitiesRef,
  projectsRef,
  onRepoCommitted = null
) {
  const [isCommitting, setIsCommitting] = useState(false);
  const [allowReset, setAllowReset] = useState(true);

  /**
   * Toggle git reset allowance
   * @param {boolean} enabled - Whether git reset is enabled
   */
  const handleAllowResetChange = useCallback(
    (enabled) => {
      setAllowReset(enabled);
      addLog(
        'info',
        `Git reset ${enabled ? 'enabled' : 'disabled'} - ${enabled ? 'DESTRUCTIVE mode ON' : 'Safe mode ON'}`
      );
    },
    [addLog]
  );

  /**
   * Internal function to commit and push (called after confirmation or directly)
   */
  const commitPushInternal = useCallback(async () => {
    setIsCommitting(true);
    addLog('info', 'Starting commit and push operations...');

    // Get current vulnerabilities and projects from refs
    const vulnerabilities = vulnerabilitiesRef.current;
    const projects = projectsRef.current;

    // Get unique projects that have resolved vulnerabilities
    const projectsToCommit = new Set(
      vulnerabilities.filter((v) => v.status === 'resolved').map((v) => v.projectPath)
    );

    if (projectsToCommit.size === 0) {
      addLog('warning', 'No resolved vulnerabilities to commit');
      setIsCommitting(false);
      return;
    }

    for (const projectPath of projectsToCommit) {
      const projectName = projects.find((p) => p.path === projectPath)?.name || 'Unknown';

      try {
        // Get all resolved vulnerabilities for this project
        const projectVulnerabilities = vulnerabilities.filter(
          (v) => v.status === 'resolved' && v.projectPath === projectPath
        );

        // Commit and push changes with vulnerability data
        addLog('info', `Committing and pushing ${projectName}...`);
        const pushResult = await window.electronAPI.commitAndPush(projectPath, {
          message: DEFAULT_COMMIT_MESSAGE,
          vulnerabilities: projectVulnerabilities,
        });

        if (pushResult.success) {
          addLog('success', `Successfully committed and pushed ${projectName}`);
          // Clear dirty state for this repo now that changes are committed.
          if (typeof onRepoCommitted === 'function') {
            onRepoCommitted(projectPath);
          }
        } else {
          addLog('error', `Failed to commit/push ${projectName}: ${pushResult.error}`);
        }
      } catch (error) {
        addLog('error', `Error with git operations for ${projectName}: ${error.message}`);
        console.error('Git operation error:', error);
      }
    }

    setIsCommitting(false);
    addLog('success', 'Commit and push operations complete');
  }, [addLog, vulnerabilitiesRef, projectsRef, onRepoCommitted]);

  /**
   * Commit and push changes
   */
  const commitAndPush = useCallback(async () => {
    await commitPushInternal();
  }, [commitPushInternal]);

  return {
    isCommitting,
    allowReset,
    handleAllowResetChange,
    commitAndPush,
  };
}
