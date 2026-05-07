/* eslint-disable import/order */
import { useRef, useEffect, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import Modal from './components/Modal';
import BuyModal from './components/BuyModal';
import VulnerabilityGrid from './components/VulnerabilityGrid';
// Custom Hooks
import useFixApplication from './hooks/useFixApplication';
import useGitOperations from './hooks/useGitOperations';
import useLogConsole from './hooks/useLogConsole';
import useProjectDiscovery from './hooks/useProjectDiscovery';
import useVulnerabilityScanner from './hooks/useVulnerabilityScanner';

function App() {
  const [licStatus, setLicStatus] = useState(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [installInfo, setInstallInfo] = useState(null);

  // Initialize hooks - each hook called EXACTLY ONCE
  const { logs, addLog, clearLogs } = useLogConsole();

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await window.electronAPI.getCommercialStatus();
        setLicStatus(status);
        const info = await window.electronAPI.getInstallInfo();
        setInstallInfo(info);
        if (status.isCommercial && !status.isLicensed) {
          setShowBuyModal(true);
        }
      } catch (err) {
        console.error('Failed to get commercial status', err);
        addLog('error', `Commercial status check failed: ${err.message}`);
      }
    };
    fetchStatus();
  }, [addLog]);

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

  // bumpVersion state: whether to bump patch version when applying fixes
  const [bumpVersion, setBumpVersion] = useState(true);

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

  // Wrapper for scan to count scans and prompt for license
  const handleScanAudit = async () => {
    if (licStatus?.isCommercial && !licStatus?.isLicensed) {
      const newCount = scanCount + 1;
      setScanCount(newCount);
      if (newCount % 10 === 0) {
        setShowBuyModal(true);
      }
    }
    await scanProjects();
  };

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
  } = useFixApplication(
    addLog,
    vulnerabilities,
    selectedVulns,
    setVulnerabilities,
    projects,
    bumpVersion
  );

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
          onScanAudit={handleScanAudit}
          onApplyFixes={applyFixes}
          onCommitPush={commitAndPush}
          buttonsState={buttonsState}
          allowReset={allowReset}
          onAllowResetChange={handleAllowResetChange}
          bumpVersion={bumpVersion}
          onBumpVersionChange={setBumpVersion}
          licStatus={licStatus}
          onBuyNow={() => setShowBuyModal(true)}
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

        {/* Promo countdown banner — shown only when unlicensed & within 30-day promo */}
        {licStatus?.isCommercial && !licStatus?.isLicensed && installInfo?.isPromo && (
          <div className="flex items-center justify-between px-4 py-1.5 bg-amber-900 bg-opacity-60 border-t border-amber-700 text-amber-200 text-xs">
            <span>
              🔥{' '}
              <strong>
                Promotion ends in {installInfo.daysRemaining} day
                {installInfo.daysRemaining !== 1 ? 's' : ''}!
              </strong>
              &nbsp;Get the full version for <strong>{installInfo.price}€</strong> — price rises to{' '}
              <strong>30.00€</strong> after the promo.
            </span>
            <button
              onClick={() => setShowBuyModal(true)}
              className="ml-4 px-3 py-0.5 bg-amber-500 hover:bg-amber-400 text-black rounded font-bold transition-colors whitespace-nowrap"
            >
              Buy Now
            </button>
          </div>
        )}
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

      {/* Commercial License Modal */}
      <BuyModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        installInfo={installInfo}
        onPaymentSuccess={async ({ licenseKey }) => {
          // generateLicense() was already called in the main process when the
          // PayPal success URL was detected. We only need to refresh UI state here.
          try {
            const status = await window.electronAPI.getCommercialStatus();
            setLicStatus(status);
            setShowBuyModal(false);
            addLog('info', `Commercial license activated! Key: ${licenseKey}`);
          } catch (err) {
            addLog('error', `Failed to refresh license status: ${err.message}`);
          }
        }}
      />
    </div>
  );
}

export default App;
