/* eslint-disable react/prop-types */
import React, { useEffect } from 'react';

function DependencyUpdatesTab({
  candidates = [],
  isScanning = false,
  scanError = null,
  selectedPackages = new Set(),
  onSelectionChange,
  applyStatus = 'idle',
  applyError = null,
  commitMessage = null,
  appliedPackages = new Set(),
}) {
  const allPairs = candidates.flatMap((repo) =>
    (repo.candidates || []).map((c) => ({ repoPath: repo.repoPath, candidate: c }))
  );
  function makeKey(rp, n) {
    return `${rp}:${n}`;
  }
  useEffect(() => {
    if (candidates.length === 0) return;
    const auto = new Set(
      allPairs
        .filter(({ candidate: c }) => c.riskLevel === 'Low')
        .map(({ repoPath, candidate: c }) => makeKey(repoPath, c.name))
    );
    onSelectionChange?.(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);
  function handleRowToggle(repoPath, name, checked) {
    const key = makeKey(repoPath, name);
    const next = new Set(selectedPackages);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    onSelectionChange?.(next);
  }
  function handleSelectAll(checked) {
    onSelectionChange?.(
      checked
        ? new Set(allPairs.map(({ repoPath, candidate: c }) => makeKey(repoPath, c.name)))
        : new Set()
    );
  }
  const totalCandidates = allPairs.length;
  const allSelected =
    totalCandidates > 0 &&
    allPairs.every(({ repoPath, candidate: c }) => selectedPackages.has(makeKey(repoPath, c.name)));
  const someSelected = allPairs.some(({ repoPath, candidate: c }) =>
    selectedPackages.has(makeKey(repoPath, c.name))
  );
  const multiRepo = candidates.length > 1;
  return (
    <div className="flex flex-col h-full p-4 overflow-auto bg-surface text-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-100">Dependency Updates</h2>
      </div>
      {isScanning && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-8 justify-center">
          <svg className="w-4 h-4 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          Scanning dependencies...
        </div>
      )}
      {!isScanning && scanError && (
        <div className="mb-3 px-3 py-2 bg-red-900 bg-opacity-50 border border-red-700 rounded text-xs text-red-300">
          Scan error: {scanError}
        </div>
      )}
      {applyError && (
        <div className="mb-3 px-3 py-2 bg-red-900 bg-opacity-50 border border-red-700 rounded text-xs text-red-300">
          Apply error: {applyError}
        </div>
      )}
      {applyStatus === 'done' && commitMessage && (
        <div className="mb-3 px-3 py-2 bg-green-900 bg-opacity-50 border border-green-700 rounded text-xs text-green-300">
          Updates applied — click Commit &amp; Push to commit: {commitMessage}
        </div>
      )}
      {!isScanning && !scanError && totalCandidates === 0 && (
        <div className="text-center text-gray-400 text-xs py-8">
          Select a project folder and click Scan for Updates to check for dependency updates.
        </div>
      )}
      {!isScanning && totalCandidates > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-1.5 pr-2 font-medium w-6">
                  <input
                    type="checkbox"
                    aria-label="Select all packages"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="w-3.5 h-3.5 cursor-pointer"
                  />
                </th>
                <th className="py-1.5 pr-3 font-medium">Library</th>
                <th className="py-1.5 pr-3 font-medium">Current Version</th>
                <th className="py-1.5 pr-3 font-medium">Suggested Version</th>
                <th className="py-1.5 pr-3 font-medium">Risk Level</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((repo) => (
                <React.Fragment key={repo.repoPath}>
                  {multiRepo && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-1 px-2 text-gray-400 font-semibold text-xs border-b border-gray-700 bg-surface-raised"
                      >
                        {repo.repoName}
                      </td>
                    </tr>
                  )}
                  {(repo.candidates || []).map((candidate) => {
                    const key = makeKey(repo.repoPath, candidate.name);
                    const isApplied = appliedPackages.has(key);
                    return (
                      <tr
                        key={key}
                        className={`border-b border-gray-800 hover:bg-surface-raised${isApplied ? ' opacity-60' : ''}`}
                      >
                        <td className="py-1.5 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${candidate.name}`}
                            checked={selectedPackages.has(key)}
                            onChange={(e) =>
                              handleRowToggle(repo.repoPath, candidate.name, e.target.checked)
                            }
                            disabled={applyStatus === 'applying' || isApplied}
                            className="w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-gray-100">{candidate.name}</td>
                        <td className="py-1.5 pr-3 font-mono text-gray-300">
                          {candidate.currentVersion}
                        </td>
                        <td className="py-1.5 pr-3">
                          {candidate.availableVersions && candidate.availableVersions.length > 0 ? (
                            <select
                              value={candidate.selectedVersion}
                              onChange={(e) => {
                                void e.target.value;
                              }}
                              disabled={applyStatus === 'applying' || isApplied}
                              className="bg-surface text-gray-100 text-xs rounded border border-gray-600 px-1 py-0.5"
                            >
                              {candidate.availableVersions
                                .slice()
                                .reverse()
                                .map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="text-gray-500">Up to date</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {candidate.riskLevel && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-xs font-medium ${candidate.riskLevel === 'Low' ? 'bg-green-900 bg-opacity-60 text-green-300' : 'bg-red-900 bg-opacity-60 text-red-300'}`}
                            >
                              {candidate.riskLevel}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5">
                          {isApplied ? (
                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-900 bg-opacity-60 text-blue-300">
                              Applied
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400">
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DependencyUpdatesTab;
