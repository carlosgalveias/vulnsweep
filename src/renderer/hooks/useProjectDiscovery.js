import { useState, useCallback } from 'react';

/**
 * Custom hook for managing project discovery workflow
 * @param {Function} addLog - Function to add log entries
 * @param {Function} onProjectsDiscovered - Callback when projects are discovered (for resetting vulnerabilities)
 * @returns {Object} Project discovery state and methods
 * @returns {string} returns.selectedFolder - Currently selected folder path
 * @returns {Array} returns.projects - Array of discovered projects
 * @returns {Function} returns.browseFolder - Function to browse and discover projects
 */
export default function useProjectDiscovery(addLog, onProjectsDiscovered) {
  const [selectedFolder, setSelectedFolder] = useState('');
  const [projects, setProjects] = useState([]);

  /**
   * Browse for folder and automatically discover Node.js projects
   */
  const browseFolder = useCallback(async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      addLog('info', `[DEBUG] Folder selection response: ${JSON.stringify(folder)}`);

      if (folder && folder.content) {
        setSelectedFolder(folder.content);
        addLog('info', `Selected folder: ${folder.content}`);

        // Automatically discover projects
        addLog('info', 'Discovering Node.js projects...');
        const result = await window.electronAPI.discoverProjects(folder.content);

        if (result.success) {
          setProjects(result.content);
          addLog('success', `Found ${result.content.length} Node.js project(s)`);

          // Notify parent to reset vulnerabilities when new folder is selected
          if (onProjectsDiscovered) {
            onProjectsDiscovered();
          }
        } else {
          addLog('error', `Failed to discover projects: ${result.error}`);
        }
      }
    } catch (error) {
      addLog('error', `Error selecting folder: ${error.message}`);
      console.error('Folder selection error:', error);
    }
  }, [addLog, onProjectsDiscovered]);

  return {
    selectedFolder,
    projects,
    browseFolder,
  };
}
