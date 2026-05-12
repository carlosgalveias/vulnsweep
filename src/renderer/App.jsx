/* eslint-disable import/order */
import { useRef, useEffect, useState, useCallback } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import Modal from './components/Modal';
import BuyModal from './components/BuyModal';
import VulnerabilityGrid from './components/VulnerabilityGrid';
import StatisticsTab from './components/StatisticsTab';
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
  const [activeTab, setActiveTab] = useState('scanner');
  const [trialStatus, setTrialStatus] = useState(null);

  // F1 — CVE enrichment state
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentProgress, setEnrichmentProgress] = useState({
    current: 0,
    total: 0,
    packageName: '',
  });

  // Tracks which repo paths have had fixes applied but not yet committed.
  // Persists across re-scans so the commit button stays available.
  const [dirtyRepos, setDirtyRepos] = useState(new Set());

  const addDirtyRepo = useCallback((repoPath) => {
    setDirtyRepos((prev) => {
      const next = new Set(prev);
      next.add(repoPath);
      return next;
    });
  }, []);

  const removeDirtyRepo = useCallback((repoPath) => {
    setDirtyRepos((prev) => {
      const next = new Set(prev);
      next.delete(repoPath);
      return next;
    });
  }, []);

  const clearAllDirtyRepos = useCallback(() => {
    setDirtyRepos(new Set());
  }, []);

  // Initialize hooks - each hook called EXACTLY ONCE
  const { logs, addLog, clearLogs } = useLogConsole();

  /** Fetches and caches the current trial status from the main process. */
  const refreshTrialStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getTrialStatus();
      setTrialStatus(status);
    } catch (err) {
      console.error('Failed to get trial status', err);
    }
  }, []);

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
    refreshTrialStatus();
  }, [addLog, refreshTrialStatus]);

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
    projectsRef,
    removeDirtyRepo
  );

  // Vulnerability scanner hook (uses allowReset from above, projectsRef)
  // Note: Receives a callback that accesses projectsRef.current for latest projects
  const {
    vulnerabilities,
    selectedVulns,
    progress,
    isScanning,
    hasScanned,
    scanProjects,
    toggleVulnerability,
    toggleAll,
    resetVulnerabilities,
    setVulnerabilities,
    showGitResetModal,
    confirmGitReset,
    cancelGitReset,
  } = useVulnerabilityScanner(addLog, () => projectsRef.current, allowReset, clearAllDirtyRepos);

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

  // F1 — Auto-trigger CVE enrichment after a scan completes with results.
  // Enrichment is treated as a continuation of the scan phase:
  // the Header progress indicator shows enrichment status until it finishes.
  useEffect(() => {
    if (!hasScanned || isScanning || vulnerabilities.length === 0 || isEnriching) return;
    // Check if any vulnerabilities are still missing enrichment data
    const needsEnrichment = vulnerabilities.some((v) => !v.enrichment);
    if (!needsEnrichment) return;

    let unsubscribe = null;

    const runEnrichment = async () => {
      setIsEnriching(true);
      setEnrichmentProgress({ current: 0, total: vulnerabilities.length, packageName: '' });

      // Subscribe to per-vuln progress events
      unsubscribe = window.electronAPI.onEnrichmentProgress((data) => {
        setEnrichmentProgress(data);
      });

      try {
        const result = await window.electronAPI.enrichVulnerabilities(vulnerabilities);
        if (result.success && Array.isArray(result.content)) {
          setVulnerabilities(result.content);
        }
      } catch (err) {
        console.error('CVE enrichment failed:', err);
      } finally {
        setIsEnriching(false);
        setEnrichmentProgress({ current: 0, total: 0, packageName: '' });
        if (unsubscribe) unsubscribe();
      }
    };

    runEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScanned, isScanning, vulnerabilities.length]);

  // Derive a progress object that covers both scan and enrichment phases so the
  // Header progress indicator never goes dark while enrichment is still running.
  const combinedProgress = isEnriching
    ? {
        current: enrichmentProgress.current,
        total: enrichmentProgress.total || vulnerabilities.length,
        message: enrichmentProgress.packageName
          ? `Enriching CVE data… (${enrichmentProgress.current}/${enrichmentProgress.total || vulnerabilities.length}) — ${enrichmentProgress.packageName}`
          : `Enriching with NVD/OSV data… (${enrichmentProgress.current}/${enrichmentProgress.total || vulnerabilities.length})`,
      }
    : progress;

  // Fix application hook — passes refreshTrialStatus so the footer updates
  // immediately after each successful fix application.
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
    bumpVersion,
    refreshTrialStatus,
    addDirtyRepo
  );

  // Button states — enriching counts as a "busy" state that blocks scan/apply/commit
  const buttonsState = {
    scanAudit: projects.length > 0 && !isScanning && !isApplying && !isCommitting && !isEnriching,
    applyFixes:
      selectedVulns.size > 0 && !isApplying && !isScanning && !isCommitting && !isEnriching,
    // commitPush is driven by dirtyRepos so the button stays enabled after a re-scan
    // that shows 0 vulnerabilities (fixes already applied, just need committing).
    commitPush: dirtyRepos.size > 0 && !isCommitting && !isApplying && !isScanning && !isEnriching,
  };

  // Derived trial footer values (safe fallbacks while status loads)
  const isUnlicensed = licStatus?.isCommercial && !licStatus?.isLicensed;
  const fixesLeft = trialStatus?.fixesRemaining ?? 10;
  const daysLeft = trialStatus?.daysUntilPriceChange ?? installInfo?.daysRemaining ?? 30;
  const trialExhausted = trialStatus?.trialExhausted === true;

  return (
    <div className="h-screen flex flex-col bg-surface text-gray-100">
      {/* Header */}
      <ErrorBoundary fallbackMessage="Failed to load header">
        <Header
          selectedFolder={selectedFolder}
          onBrowseFolder={browseFolder}
          progress={combinedProgress}
          onScanAudit={handleScanAudit}
          onApplyFixes={applyFixes}
          onCommitPush={commitAndPush}
          buttonsState={buttonsState}
          allowReset={allowReset}
          onAllowResetChange={handleAllowResetChange}
          bumpVersion={bumpVersion}
          onBumpVersionChange={setBumpVersion}
          licStatus={licStatus}
          trialStatus={trialStatus}
          onBuyNow={() => setShowBuyModal(true)}
        />
      </ErrorBoundary>

      {/* Tab Bar */}
      <div className="flex items-end bg-surface-raised border-b border-gray-700 px-4 pt-1 flex-shrink-0">
        {[
          { id: 'scanner', label: 'Scanner' },
          { id: 'statistics', label: 'Statistics' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-t transition-colors duration-150 mr-1 border-b-2 ${
              activeTab === tab.id
                ? 'bg-surface text-white border-blue-500'
                : 'bg-transparent text-gray-400 border-transparent hover:text-gray-200 hover:bg-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'scanner' && (
          <>
            <div className="h-[60%] overflow-hidden">
              <ErrorBoundary fallbackMessage="Failed to load vulnerability grid">
                <VulnerabilityGrid
                  vulnerabilities={vulnerabilities}
                  selectedVulns={selectedVulns}
                  onToggleVuln={toggleVulnerability}
                  onToggleAll={toggleAll}
                  isLoading={isScanning}
                  hasFolder={!!selectedFolder}
                  hasScanned={hasScanned}
                  isEnriching={isEnriching}
                  enrichmentProgress={enrichmentProgress}
                />
              </ErrorBoundary>
            </div>
            <div className="h-[40%] overflow-hidden">
              <ErrorBoundary fallbackMessage="Failed to load log console">
                <LogConsole logs={logs} onClear={clearLogs} />
              </ErrorBoundary>
            </div>
          </>
        )}

        {activeTab === 'statistics' && (
          <div className="flex-1 overflow-hidden">
            <ErrorBoundary fallbackMessage="Failed to load statistics">
              <StatisticsTab vulnerabilities={vulnerabilities} hasScanned={hasScanned} />
            </ErrorBoundary>
          </div>
        )}

        {/* Trial / promo footer — only shown for unlicensed commercial users */}
        {isUnlicensed && (
          <div className="flex items-center justify-between px-4 py-1.5 bg-amber-900 bg-opacity-60 border-t border-amber-700 text-amber-200 text-xs flex-shrink-0">
            {trialExhausted ? (
              <>
                <span>
                  🚫 <strong>Free fixes exhausted</strong>
                  {' · '}Upgrade to continue applying fixes
                </span>
                <button
                  onClick={() => setShowBuyModal(true)}
                  className="ml-4 px-3 py-0.5 bg-amber-500 hover:bg-amber-400 text-black rounded font-bold transition-colors whitespace-nowrap"
                >
                  Upgrade Now
                </button>
              </>
            ) : (
              <>
                <span>
                  🔥{' '}
                  <strong>
                    You have {fixesLeft} {fixesLeft !== 1 ? 'fixes' : 'fix'} left
                  </strong>
                  {' · '}
                  <strong>
                    {daysLeft} {daysLeft !== 1 ? 'days' : 'day'} until price changes
                  </strong>
                </span>
                <button
                  onClick={() => setShowBuyModal(true)}
                  className="ml-4 px-3 py-0.5 bg-amber-500 hover:bg-amber-400 text-black rounded font-bold transition-colors whitespace-nowrap"
                >
                  Buy Now
                </button>
              </>
            )}
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
