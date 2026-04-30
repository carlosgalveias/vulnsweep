import { useRef, useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import Modal from './components/Modal';
import VulnerabilityGrid from './components/VulnerabilityGrid';
// Custom Hooks
import useFixApplication from './hooks/useFixApplication';
import useGitOperations from './hooks/useGitOperations';
import useLogConsole from './hooks/useLogConsole';
import useProjectDiscovery from './hooks/useProjectDiscovery';
import useVulnerabilityScanner from './hooks/useVulnerabilityScanner';

function App() {
  // Initialize hooks - each hook called EXACTLY ONCE
  const { logs, addLog, clearLogs } = useLogConsole();

  /**
   * Use refs to store projects and vulnerabilities for accessing in useGitOperations.
   * This breaks circular dependencies between hooks:
   * - useGitOperations needs access to current vulnerabilities and projects
   * - useVulnerabilityScanner creates vulnerabilities but is called after useGitOperations
   *
   * By using refs, we can pass them to useGitOperations before the data exists,
   * then update the refs when the data changes.
   */
  const projectsRef = useRef([]);
  const vulnerabilitiesRef = useRef([]);

  // Git operations hook (defines allowReset state)
  // Receives refs instead of actual arrays to avoid circular dependency
  const { isCommitting, allowReset, handleAllowResetChange, commitAndPush } = useGitOperations(
    addLog,
    vulnerabilitiesRef,
    projectsRef
  );

  // Vulnerability scanner hook (uses allowReset from above, projectsRef)
  // Note: Receives a callback that accesses projectsRef.current for latest projects
  const {
    vulnerabilities,
    selectedVulns,
    progress,
    isScanning,
    scanProjects,
    toggleVulnerability,
    toggleAll,
    resetVulnerabilities,
    setVulnerabilities,
    showGitResetModal,
    confirmGitReset,
    cancelGitReset,
  } = useVulnerabilityScanner(addLog, () => projectsRef.current, allowReset);

  // Project discovery hook (uses resetVulnerabilities from above)
  const { selectedFolder, projects, browseFolder } = useProjectDiscovery(
    addLog,
    resetVulnerabilities
  );

  // Update refs whenever data changes
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    vulnerabilitiesRef.current = vulnerabilities;
  }, [vulnerabilities]);

  // Fix application hook
  const {
    isApplying,
    applyFixes,
    showHighRiskModal,
    highRiskCount,
    closeHighRiskModal,
    confirmHighRiskFixes,
  } = useFixApplication(addLog, vulnerabilities, selectedVulns, setVulnerabilities, projects);

  // Button states
  const buttonsState = {
    scanAudit: projects.length > 0 && !isScanning && !isApplying && !isCommitting,
    applyFixes: selectedVulns.size > 0 && !isApplying && !isScanning && !isCommitting,
    commitPush:
      vulnerabilities.some((v) => v.status === 'resolved') &&
      !isCommitting &&
      !isApplying &&
      !isScanning,
  };

  return (
    <div className="h-screen flex flex-col bg-surface text-gray-100">
      {/* Header */}
      <ErrorBoundary fallbackMessage="Failed to load header">
        <Header
          selectedFolder={selectedFolder}
          onBrowseFolder={browseFolder}
          progress={progress}
          onScanAudit={scanProjects}
          onApplyFixes={applyFixes}
          onCommitPush={commitAndPush}
          buttonsState={buttonsState}
          allowReset={allowReset}
          onAllowResetChange={handleAllowResetChange}
        />
      </ErrorBoundary>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Vulnerability Grid - Full width, 60% height */}
        <div className="h-[60%] overflow-hidden">
          <ErrorBoundary fallbackMessage="Failed to load vulnerability grid">
            <VulnerabilityGrid
              vulnerabilities={vulnerabilities}
              selectedVulns={selectedVulns}
              onToggleVuln={toggleVulnerability}
              onToggleAll={toggleAll}
              isLoading={isScanning}
              hasFolder={!!selectedFolder}
            />
          </ErrorBoundary>
        </div>

        {/* Log Console - Full width, 40% height */}
        <div className="h-[40%] overflow-hidden">
          <ErrorBoundary fallbackMessage="Failed to load log console">
            <LogConsole logs={logs} onClear={clearLogs} />
          </ErrorBoundary>
        </div>
      </div>

      {/* HIGH Risk Fixes Confirmation Modal */}
      <Modal
        isOpen={showHighRiskModal}
        onClose={closeHighRiskModal}
        onConfirm={confirmHighRiskFixes}
        title="Confirm HIGH Risk Fixes"
        message={`You are about to apply ${highRiskCount} HIGH risk fix(es). These involve major version updates that may introduce breaking changes. Are you sure you want to proceed?`}
        confirmText="Apply Fixes"
        confirmStyle="danger"
      />

      {/* Git Reset Confirmation Modal */}
      <Modal
        isOpen={showGitResetModal}
        onClose={cancelGitReset}
        onConfirm={confirmGitReset}
        title="Git Reset Warning"
        message='Git reset is ENABLED. VulnSweep will run "git reset --hard" on all repositories before scanning, which will discard any uncommitted changes. This action cannot be undone. Are you sure you want to proceed?'
        confirmText="Proceed with Scan"
        confirmStyle="danger"
      />
    </div>
  );
}

export default App;
