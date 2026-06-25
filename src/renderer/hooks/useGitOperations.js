import { OP_COMMIT_AND_PUSH } from '@shared/renderer-api-opcodes.js';
import { useState, useCallback } from 'react';
import { DEFAULT_COMMIT_MESSAGE } from '../constants.js';

/**
 * Custom hook for managing git operations (commit and push)
 * @param {Function} addLog - Function to add log entries
 * @param {React.MutableRefObject} vulnerabilitiesRef - Ref to vulnerabilities array
 * @param {Function} onRepoCommitted - Optional callback when a repo is committed
 * @returns {Object} Git operations state and methods
 */
export default function useGitOperations(addLog, vulnerabilitiesRef, onRepoCommitted = null) {
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

    // Get current vulnerabilities from ref
    const vulnerabilities = vulnerabilitiesRef.current;

    // Get unique projects that have resolved vulnerabilities
    const resolvedVulns = vulnerabilities.filter((v) => v.status === 'resolved');
    const projectsToCommit = new Set(resolvedVulns.map((v) => v.projectPath));

    if (projectsToCommit.size === 0) {
      addLog('warning', 'No resolved vulnerabilities to commit');
      setIsCommitting(false);
      return;
    }

    const projects = vulnerabilitiesRef.current.reduce((acc, v) => {
      if (!acc.some((p) => p.path === v.projectPath)) {
        acc.push({ path: v.projectPath, name: v.projectName });
      }
      return acc;
    }, []);

    // Track successfully committed vulnerability IDs for removal
    const committedVulnIds = [];

    for (const projectPath of projectsToCommit) {
      const projectName = projects.find((p) => p.path === projectPath)?.name || 'Unknown';

      try {
        // Get all resolved vulnerabilities for this project
        const projectVulnerabilities = resolvedVulns.filter((v) => v.projectPath === projectPath);

        // Commit and push changes with vulnerability data
        addLog('info', `Committing and pushing ${projectName}...`);
        const pushResult = await window.electronAPI.invoke(OP_COMMIT_AND_PUSH, projectPath, {
          message: DEFAULT_COMMIT_MESSAGE,
          vulnerabilities: projectVulnerabilities,
        });

        if (pushResult.success) {
          committedVulnIds.push(...projectVulnerabilities.map((v) => v.id));
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

    // Return committed IDs so caller can remove them from state
    return committedVulnIds;
  }, [addLog, vulnerabilitiesRef, onRepoCommitted]);

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
