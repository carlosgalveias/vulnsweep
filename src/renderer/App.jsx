/* eslint-disable import/order */
import { useRef, useEffect, useState, useCallback } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import Modal from './components/Modal';
import BuyModal from './components/BuyModal';
import VulnerabilityGrid from './components/VulnerabilityGrid';
import StatisticsTab from './components/StatisticsTab';
import DependencyUpdatesTab from './components/DependencyUpdatesTab';
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

  // F13 — Dependency Updates state
  const [depUpdateCandidates, setDepUpdateCandidates] = useState([]);
  const [selectedDepUpdates, setSelectedDepUpdates] = useState(new Set());
  const [isDepScanning, setIsDepScanning] = useState(false);
  const [depScanError, setDepScanError] = useState(null);
  const [depApplyStatus, setDepApplyStatus] = useState('idle');
  const [depApplyError, setDepApplyError] = useState(null);
  const [depCommitMessage, setDepCommitMessage] = useState(null);
  // True after npm install succeeds — enables Commit & Push button for dep updates
  const [depUpdatesDirty, setDepUpdatesDirty] = useState(false);
  // Composite keys (repoPath:name) of packages that have been successfully applied
  const [appliedDepPackages, setAppliedDepPackages] = useState(new Set());

  // F1 — CVE enrichment state
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentProgress, setEnrichmentProgress] = useState({
    current: 0,
    total: 0,
    packageName: '',
  });

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

  const { logs, addLog, clearLogs } = useLogConsole();

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

  const projectsRef = useRef([]);
  const vulnerabilitiesRef = useRef([]);

  const [bumpVersion, setBumpVersion] = useState(true);
  const [removePackageLock, setRemovePackageLock] = useState(false);
  const [removeOverrides, setRemoveOverrides] = useState(false);

  const {
    isCommitting,
    allowReset,
    handleAllowResetChange,
    commitAndPush: commitAndPushVulns,
  } = useGitOperations(addLog, vulnerabilitiesRef, projectsRef, removeDirtyRepo);

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
  } = useVulnerabilityScanner(
    addLog,
    () => projectsRef.current,
    allowReset,
    clearAllDirtyRepos,
    removePackageLock,
    removeOverrides
  );

  const { selectedFolder, projects, browseFolder } = useProjectDiscovery(
    addLog,
    resetVulnerabilities
  );

  // Commit & Push — handles both dep-updates dirty repos and vuln-fix dirty repos.
  // MUST be declared after selectedFolder is available from useProjectDiscovery.
  const commitAndPush = useCallback(async () => {
    if (depUpdatesDirty && depCommitMessage) {
      const repoPathsSet = new Set(
        depUpdateCandidates.length > 0
          ? depUpdateCandidates.map((r) => r.repoPath)
          : [selectedFolder]
      );
      for (const repoPath of repoPathsSet) {
        addLog('info', `Committing dep updates in ${repoPath}...`);
        try {
          const result = await window.electronAPI.commitAndPush(repoPath, {
            message: depCommitMessage,
            vulnerabilities: [],
          });
          if (result.success) {
            addLog('success', `Dep updates committed in ${repoPath}`);
          } else {
            addLog('error', `Commit failed for ${repoPath}: ${result.error}`);
          }
        } catch (err) {
          addLog('error', `Commit error for ${repoPath}: ${err.message}`);
        }
      }
      setDepUpdatesDirty(false);
    }
    await commitAndPushVulns();
  }, [
    depUpdatesDirty,
    depCommitMessage,
    depUpdateCandidates,
    selectedFolder,
    addLog,
    commitAndPushVulns,
  ]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  useEffect(() => {
    vulnerabilitiesRef.current = vulnerabilities;
  }, [vulnerabilities]);
  useEffect(() => {
    if (!hasScanned || isScanning || vulnerabilities.length === 0 || isEnriching) return;
    if (!vulnerabilities.some((v) => !v.enrichment)) return;
    let unsub = null;
    const run = async () => {
      setIsEnriching(true);
      setEnrichmentProgress({ current: 0, total: vulnerabilities.length, packageName: '' });
      unsub = window.electronAPI.onEnrichmentProgress((d) => setEnrichmentProgress(d));
      try {
        const r = await window.electronAPI.enrichVulnerabilities(vulnerabilities);
        if (r.success && Array.isArray(r.content)) setVulnerabilities(r.content);
      } catch (err) {
        console.error('CVE enrichment failed:', err);
      } finally {
        setIsEnriching(false);
        setEnrichmentProgress({ current: 0, total: 0, packageName: '' });
        if (unsub) unsub();
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScanned, isScanning, vulnerabilities.length]);

  const combinedProgress = isEnriching
    ? {
        current: enrichmentProgress.current,
        total: enrichmentProgress.total || vulnerabilities.length,
        message: enrichmentProgress.packageName
          ? `Enriching CVE data (${enrichmentProgress.current}/${enrichmentProgress.total || vulnerabilities.length}) - ${enrichmentProgress.packageName}`
          : `Enriching with NVD/OSV data (${enrichmentProgress.current}/${enrichmentProgress.total || vulnerabilities.length})`,
      }
    : progress;

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
    addDirtyRepo,
    removePackageLock,
    removeOverrides
  );

  // Reset all dep-updates state when the selected folder changes — skip on initial mount.
  const prevFolderRef = useRef(undefined);
  useEffect(() => {
    if (prevFolderRef.current === undefined) {
      prevFolderRef.current = selectedFolder;
      return;
    }
    if (prevFolderRef.current === selectedFolder) return;
    prevFolderRef.current = selectedFolder;
    setDepUpdateCandidates([]);
    setSelectedDepUpdates(new Set());
    setDepUpdatesDirty(false);
    setAppliedDepPackages(new Set());
    setDepScanError(null);
    setDepApplyStatus('idle');
    setDepApplyError(null);
    setDepCommitMessage(null);
  }, [selectedFolder]);

  const handleDepScan = async () => {
    if (!selectedFolder) return;
    setIsDepScanning(true);
    setDepScanError(null);
    setDepApplyStatus('idle');
    setDepApplyError(null);
    setDepCommitMessage(null);
    setSelectedDepUpdates(new Set());
    // When git reset is enabled, the repos are hard-reset — any previously applied
    // (but uncommitted) changes are gone. Clear dirty state and applied tracking so the
    // UI correctly reflects that there is nothing pending to commit.
    if (allowReset) {
      setDepUpdateCandidates([]);
      setDepUpdatesDirty(false);
      setAppliedDepPackages(new Set());
    }
    try {
      const r = await window.electronAPI.scanDepUpdates(selectedFolder, allowReset, {
        removeOverrides,
        removePackageLock,
      });
      if (r.success) {
        setDepUpdateCandidates(r.content);
      } else {
        setDepScanError(r.error || 'Scan failed');
      }
    } catch (err) {
      setDepScanError(err.message);
    } finally {
      setIsDepScanning(false);
    }
  };

  const handleDepApply = async () => {
    // depUpdateCandidates is Array<RepoUpdateResult> — flatten and include repoPath per update
    const updates = depUpdateCandidates.flatMap((repo) =>
      (repo.candidates || [])
        .filter((c) => selectedDepUpdates.has(`${repo.repoPath}:${c.name}`))
        .map((c) => ({
          name: c.name,
          fromVersion: c.currentVersion,
          toVersion: c.selectedVersion,
          repoPath: repo.repoPath,
        }))
    );
    if (updates.length === 0) return;
    setDepApplyStatus('applying');
    setDepApplyError(null);
    try {
      const r = await window.electronAPI.applyDepUpdates(selectedFolder, updates);
      if (r.success) {
        const msg = r.commitMessage || updates.map((u) => `${u.name}@${u.toVersion}`).join(', ');
        setDepCommitMessage(msg);
        setDepApplyStatus('done');
        // Mark applied packages so the Status column shows "Applied" — do NOT clear the table
        setAppliedDepPackages((prev) => {
          const next = new Set(prev);
          updates.forEach((u) => next.add(`${u.repoPath}:${u.name}`));
          return next;
        });
        setSelectedDepUpdates(new Set());
        // Mark dirty so Commit & Push button becomes active.
        // The user triggers the commit manually — we do NOT auto-commit here.
        setDepUpdatesDirty(true);
      } else {
        setDepApplyError(r.error || 'Apply failed');
        setDepApplyStatus('error');
      }
    } catch (err) {
      setDepApplyError(err.message);
      setDepApplyStatus('error');
    }
  };

  const handleScanAudit = async () => {
    if (activeTab === 'dep-updates') {
      await handleDepScan();
      return;
    }
    if (licStatus?.isCommercial && !licStatus?.isLicensed) {
      const n = scanCount + 1;
      setScanCount(n);
      if (n % 10 === 0) setShowBuyModal(true);
    }
    await scanProjects();
  };

  const handleApplyFixes = async () => {
    if (activeTab === 'dep-updates') {
      await handleDepApply();
      return;
    }
    await applyFixes();
  };

  const isDepUpdatesTab = activeTab === 'dep-updates';
  const scanButtonLabel = isDepUpdatesTab ? 'Scan for Updates' : 'Scan & Audit';
  const applyButtonLabel = isDepUpdatesTab ? 'Apply Updates' : 'Apply Selected Fixes';

  const buttonsState = {
    scanAudit: isDepUpdatesTab
      ? !!selectedFolder && !isDepScanning && !isApplying && !isCommitting
      : projects.length > 0 && !isScanning && !isApplying && !isCommitting && !isEnriching,
    applyFixes: isDepUpdatesTab
      ? selectedDepUpdates.size > 0 && depApplyStatus !== 'applying' && !isCommitting
      : selectedVulns.size > 0 && !isApplying && !isScanning && !isCommitting && !isEnriching,
    commitPush:
      (dirtyRepos.size > 0 || depUpdatesDirty) &&
      !isCommitting &&
      !isApplying &&
      !isScanning &&
      !isEnriching,
  };

  const isUnlicensed = licStatus?.isCommercial && !licStatus?.isLicensed;
  const fixesLeft = trialStatus?.fixesRemaining ?? 10;
  const daysLeft = trialStatus?.daysUntilPriceChange ?? installInfo?.daysRemaining ?? 30;
  const trialExhausted = trialStatus?.trialExhausted === true;

  return (
    <div className="h-screen flex flex-col bg-surface text-gray-100">
      <ErrorBoundary fallbackMessage="Failed to load header">
        <Header
          selectedFolder={selectedFolder}
          onBrowseFolder={browseFolder}
          progress={combinedProgress}
          onScanAudit={handleScanAudit}
          onApplyFixes={handleApplyFixes}
          onCommitPush={commitAndPush}
          buttonsState={buttonsState}
          scanButtonLabel={scanButtonLabel}
          applyButtonLabel={applyButtonLabel}
          allowReset={allowReset}
          onAllowResetChange={handleAllowResetChange}
          bumpVersion={bumpVersion}
          onBumpVersionChange={setBumpVersion}
          removePackageLock={removePackageLock}
          onRemovePackageLockChange={setRemovePackageLock}
          removeOverrides={removeOverrides}
          onRemoveOverridesChange={setRemoveOverrides}
          licStatus={licStatus}
          trialStatus={trialStatus}
          onBuyNow={() => setShowBuyModal(true)}
        />
      </ErrorBoundary>

      <div className="flex items-end bg-surface-raised border-b border-gray-700 px-4 pt-1 flex-shrink-0">
        {[
          { id: 'scanner', label: 'Scanner' },
          { id: 'statistics', label: 'Statistics' },
          { id: 'dep-updates', label: 'Dep Updates' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-t transition-colors duration-150 mr-1 border-b-2 ${activeTab === tab.id ? 'bg-surface text-white border-blue-500' : 'bg-transparent text-gray-400 border-transparent hover:text-gray-200 hover:bg-surface'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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

        {activeTab === 'dep-updates' && (
          <>
            <div className="h-[60%] overflow-hidden">
              <ErrorBoundary fallbackMessage="Failed to load dependency updates">
                <DependencyUpdatesTab
                  candidates={depUpdateCandidates}
                  isScanning={isDepScanning}
                  scanError={depScanError}
                  selectedPackages={selectedDepUpdates}
                  onSelectionChange={setSelectedDepUpdates}
                  applyStatus={depApplyStatus}
                  applyError={depApplyError}
                  commitMessage={depCommitMessage}
                  appliedPackages={appliedDepPackages}
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
        {isUnlicensed && (
          <div className="flex items-center justify-between px-4 py-1.5 bg-amber-900 bg-opacity-60 border-t border-amber-700 text-amber-200 text-xs flex-shrink-0">
            {trialExhausted ? (
              <>
                <span>Free fixes exhausted - Upgrade to continue applying fixes</span>
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
                  You have {fixesLeft} {fixesLeft !== 1 ? 'fixes' : 'fix'} left - {daysLeft}{' '}
                  {daysLeft !== 1 ? 'days' : 'day'} until price changes
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

      <Modal
        isOpen={showHighRiskModal}
        onClose={closeHighRiskModal}
        onConfirm={confirmHighRiskFixes}
        title="Confirm HIGH Risk Fixes"
        message={`You are about to apply ${highRiskCount} HIGH risk fix(es). These involve major version updates that may introduce breaking changes. Are you sure you want to proceed?`}
        confirmText="Apply Fixes"
        confirmStyle="danger"
      />

      <Modal
        isOpen={showGitResetModal}
        onClose={cancelGitReset}
        onConfirm={confirmGitReset}
        title="Git Reset Warning"
        message="Git reset is ENABLED. VulnSweep will run git reset --hard on all repositories before scanning, which will discard any uncommitted changes. This action cannot be undone. Are you sure you want to proceed?"
        confirmText="Proceed with Scan"
        confirmStyle="danger"
      />

      <BuyModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        installInfo={installInfo}
        onPaymentSuccess={async ({ licenseKey }) => {
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
