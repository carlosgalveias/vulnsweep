import { GitBranch, Package, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect } from 'react';

/**
 * DependencyPathModal - Displays the full dependency path from project root
 * to a vulnerable transitive package.
 *
 * Read-only modal (no confirm action). Shows one or more paths as tree visualizations.
 */
function DependencyPathModal({ isOpen, onClose, packageName, paths, loading }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasPaths = Array.isArray(paths) && paths.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dep-path-modal-title"
    >
      <div
        className="bg-surface-raised rounded-lg shadow-2xl border border-border max-w-lg w-full mx-4 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 id="dep-path-modal-title" className="text-sm font-semibold text-gray-100">
            Dependency Path &mdash; {packageName}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-overlay text-text-muted hover:text-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin" />
              <span className="ml-2 text-xs text-text-muted">Loading dependency paths...</span>
            </div>
          ) : !hasPaths ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <GitBranch size={28} strokeWidth={1.5} className="mb-2 opacity-50" />
              <p className="text-xs">Dependency path information not available.</p>
            </div>
          ) : (
            /* Path Tree(s) */
            <div className="space-y-3">
              {paths.map((pathArray, pathIndex) => (
                <div key={pathIndex}>
                  {paths.length > 1 && (
                    <div className="text-[0.6rem] uppercase tracking-wider text-text-muted mb-1.5 font-semibold">
                      Path {pathIndex + 1}
                    </div>
                  )}
                  <div className="py-2.5 px-3 rounded bg-surface/60">
                    {pathArray.map((node, nodeIndex) => {
                      const isRoot = nodeIndex === 0;
                      const isLeaf = nodeIndex === pathArray.length - 1;

                      return (
                        <div
                          key={nodeIndex}
                          className="font-mono text-app-xs flex items-center"
                          style={{ paddingLeft: `${nodeIndex * 1.25}rem` }}
                        >
                          {isRoot ? (
                            <span className="flex items-center gap-1 text-text-primary font-semibold">
                              <Package size={11} strokeWidth={2} />
                              {node}
                            </span>
                          ) : isLeaf ? (
                            <span className="flex items-center gap-1">
                              <span className="text-text-muted">└─</span>
                              <span className="text-severity-high font-semibold px-1.5 py-0.5 bg-orange-900/30 rounded">
                                {node}
                              </span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-text-muted">
                              <span>└─</span>
                              <span>{node}</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

DependencyPathModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  packageName: PropTypes.string,
  paths: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.string)),
  loading: PropTypes.bool,
};

DependencyPathModal.defaultProps = {
  packageName: '',
  paths: [],
  loading: false,
};

export default DependencyPathModal;
