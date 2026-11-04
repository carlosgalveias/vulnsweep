import { OP_APPLY_FIXES, OP_INCREMENT_TRIAL_FIX } from '@shared/renderer-api-opcodes.js';
import { useState, useCallback } from 'react';

/**
 * Custom hook for managing fix application workflow
 * @param {Function} addLog - Function to add log entries
 * @param {Array} vulnerabilities - Array of vulnerabilities
 * @param {Set} selectedVulns - Set of selected vulnerability IDs
 * @param {Function} setVulnerabilities - Function to update vulnerabilities state
 * @param {Array} projects - Array of discovered projects
 * @param {boolean} bumpVersion - Whether to bump patch version when applying fixes
 * @param {Function|null} onTrialUpdated - Optional callback invoked after a successful fix
 *   application so the caller can refresh the trial status shown in the footer.
 * @param {Function|null} onRepoDirtied - Optional callback when a repo gets dirty fixes applied.
 * @param {boolean} removePackageLock - Whether to delete package-lock.json before applying fixes
 * @param {boolean} removeOverrides - Whether to strip overrides/resolutions from package.json
 * @returns {Object} Fix application state and methods
 */
export default function useFixApplication(
  addLog,
  vulnerabilities,
  selectedVulns,
  setVulnerabilities,
  projects,
  bumpVersion = true,
  onTrialUpdated = null,
  onRepoDirtied = null,
  removePackageLock = false,
  removeOverrides = false
) {
  const [isApplying, setIsApplying] = useState(false);
  const [showHighRiskModal, setShowHighRiskModal] = useState(false);
  const [highRiskCount, setHighRiskCount] = useState(0);

  /**
   * Internal function to apply fixes (called after confirmation or directly)
   */
  const applyFixesInternal = useCallback(async () => {
    setIsApplying(true);
    addLog('info', `Applying fixes for ${selectedVulns.size} selected vulnerability(ies)...`);

    // Group vulnerabilities by project
    const vulnsByProject = new Map();
    vulnerabilities.forEach((vuln) => {
      if (selectedVulns.has(vuln.id)) {
        if (!vulnsByProject.has(vuln.projectPath)) {
          vulnsByProject.set(vuln.projectPath, []);
        }
        vulnsByProject.get(vuln.projectPath).push(vuln);
      }
    });

    // Apply fixes per project
    let anySucceeded = false;
    for (const [projectPath, projectVulns] of vulnsByProject.entries()) {
      const projectName = projects.find((p) => p.path === projectPath)?.name || 'Unknown';
      addLog('info', `Applying ${projectVulns.length} fix(es) to ${projectName}...`);

      // Update status to 'applying'
      setVulnerabilities((prev) =>
        prev.map((v) =>
          projectVulns.find((pv) => pv.id === v.id) ? { ...v, status: 'applying' } : v
        )
      );

      try {
        const strategies = projectVulns
          .map((v) => v.strategy)
          .filter((s) => s && s.type !== 'NO_FIX');

        if (strategies.length === 0) {
          addLog('warning', `No applicable fixes for ${projectName}`);
          setVulnerabilities((prev) =>
            prev.map((v) =>
              projectVulns.find((pv) => pv.id === v.id) ? { ...v, status: 'failed' } : v
            )
          );
          continue;
        }

        const result = await window.electronAPI.invoke(OP_APPLY_FIXES, projectPath, strategies, {
          bumpVersion,
          removePackageLock,
          removeOverrides,
        });

        if (result.success) {
          anySucceeded = true;
          // Update status to 'resolved' for applied fixes
          setVulnerabilities((prev) =>
            prev.map((v) =>
              projectVulns.find((pv) => pv.id === v.id) ? { ...v, status: 'resolved' } : v
            )
          );
          addLog(
            'success',
            `Successfully applied ${result.content.applied?.length || 0} fix(es) to ${projectName}`
          );

          if (result.content.failed?.length > 0) {
            addLog('warning', `${result.content.failed.length} fix(es) failed in ${projectName}`);
          }

          // Mark this repository as dirty (has uncommitted changes).
          if (typeof onRepoDirtied === 'function') {
            onRepoDirtied(projectPath);
          }
        } else if (result.trialExhausted) {
          // Trial exhausted — reset status back to 'pending' so the vulnerability remains
          // visible and actionable once the user upgrades.
          setVulnerabilities((prev) =>
            prev.map((v) =>
              projectVulns.find((pv) => pv.id === v.id) ? { ...v, status: 'pending' } : v
            )
          );
          addLog('error', result.error || 'Free fixes exhausted. Please upgrade to continue.');
        } else {
          // Update status to 'failed'
          setVulnerabilities((prev) =>
            prev.map((v) =>
              projectVulns.find((pv) => pv.id === v.id) ? { ...v, status: 'failed' } : v
            )
          );
          addLog('error', `Failed to apply fixes to ${projectName}: ${result.error}`);
        }
      } catch (error) {
        setVulnerabilities((prev) =>
          prev.map((v) =>
            projectVulns.find((pv) => pv.id === v.id) ? { ...v, status: 'failed' } : v
          )
        );
        addLog('error', `Error applying fixes to ${projectName}: ${error.message}`);
        console.error('Apply fixes error:', error);
      }
    }

    // Increment the trial counter exactly once for this entire operation,
    // only if at least one repository was fixed successfully.
    if (anySucceeded) {
      await window.electronAPI.invoke(OP_INCREMENT_TRIAL_FIX);
      if (typeof onTrialUpdated === 'function') onTrialUpdated();
    }

    setIsApplying(false);
    addLog('success', 'Fix application complete');
  }, [
    addLog,
    vulnerabilities,
    selectedVulns,
    setVulnerabilities,
    projects,
    bumpVersion,
    removePackageLock,
    removeOverrides,
    onTrialUpdated,
    onRepoDirtied,
  ]);

  /**
   * Apply fixes to selected vulnerabilities (with HIGH risk confirmation)
   */
  const applyFixes = useCallback(async () => {
    if (selectedVulns.size === 0) {
      addLog('warning', 'No vulnerabilities selected. Please select at least one vulnerability.');
      return;
    }

    // Check if any HIGH risk vulnerabilities are selected
    const highRiskVulns = vulnerabilities.filter(
      (v) => selectedVulns.has(v.id) && v.riskLevel === 'HIGH'
    );

    if (highRiskVulns.length > 0) {
      // Show confirmation modal for HIGH risk fixes
      setHighRiskCount(highRiskVulns.length);
      setShowHighRiskModal(true);
      return;
    }

    // Proceed with applying fixes directly if no HIGH risk
    await applyFixesInternal();
  }, [addLog, vulnerabilities, selectedVulns, applyFixesInternal]);

  /**
   * Close the HIGH risk confirmation modal
   */
  const closeHighRiskModal = useCallback(() => {
    setShowHighRiskModal(false);
    setHighRiskCount(0);
  }, []);

  /**
   * Confirm and proceed with HIGH risk fixes
   */
  const confirmHighRiskFixes = useCallback(async () => {
    closeHighRiskModal();
    await applyFixesInternal();
  }, [closeHighRiskModal, applyFixesInternal]);

  return {
    isApplying,
    applyFixes,
    showHighRiskModal,
    highRiskCount,
    closeHighRiskModal,
    confirmHighRiskFixes,
  };
}
