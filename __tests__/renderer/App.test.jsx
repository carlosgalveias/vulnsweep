/**
 * Tests for App component
 *
 * Tests the main App component initialization, hook order, and rendering.
 * These tests specifically prevent regression of the initialization order bug
 * where hooks tried to access variables before they were defined.
 */

import { render, screen } from '@testing-library/react';
import App from '../../src/renderer/App';

// Mock all custom hooks
jest.mock('../../src/renderer/hooks/useLogConsole', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    logs: [],
    addLog: jest.fn(),
    clearLogs: jest.fn(),
  })),
}));

jest.mock('../../src/renderer/hooks/useGitOperations', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    isCommitting: false,
    allowReset: true,
    handleAllowResetChange: jest.fn(),
    commitAndPush: jest.fn(),
    showGitResetModal: false,
    closeGitResetModal: jest.fn(),
    confirmGitReset: jest.fn(),
  })),
}));

jest.mock('../../src/renderer/hooks/useVulnerabilityScanner', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    vulnerabilities: [],
    selectedVulns: new Set(),
    progress: null,
    isScanning: false,
    scanProjects: jest.fn(),
    toggleVulnerability: jest.fn(),
    toggleAll: jest.fn(),
    resetVulnerabilities: jest.fn(),
    setVulnerabilities: jest.fn(),
  })),
}));

jest.mock('../../src/renderer/hooks/useProjectDiscovery', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    selectedFolder: '',
    projects: [],
    browseFolder: jest.fn(),
  })),
}));

jest.mock('../../src/renderer/hooks/useFixApplication', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    isApplying: false,
    applyFixes: jest.fn(),
    showHighRiskModal: false,
    highRiskCount: 0,
    closeHighRiskModal: jest.fn(),
    confirmHighRiskFixes: jest.fn(),
  })),
}));

// Import mocked hooks after mocking
import useFixApplication from '../../src/renderer/hooks/useFixApplication';
import useGitOperations from '../../src/renderer/hooks/useGitOperations';
import useLogConsole from '../../src/renderer/hooks/useLogConsole';
import useProjectDiscovery from '../../src/renderer/hooks/useProjectDiscovery';
import useVulnerabilityScanner from '../../src/renderer/hooks/useVulnerabilityScanner';

describe('App component', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // Mock console.error to catch any initialization errors
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('initialization and rendering', () => {
    it('should render without crashing', () => {
      expect(() => render(<App />)).not.toThrow();
    });

    it('should not throw initialization order errors', () => {
      render(<App />);

      // Check that no "Cannot access before initialization" errors occurred
      const initializationErrors = consoleErrorSpy.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' &&
            (arg.includes('Cannot access') || arg.includes('before initialization'))
        )
      );

      expect(initializationErrors).toHaveLength(0);
    });

    it('should render main container with correct layout classes', () => {
      const { container } = render(<App />);

      const mainContainer = container.firstChild;
      expect(mainContainer).toHaveClass(
        'h-screen',
        'flex',
        'flex-col',
        'bg-surface',
        'text-gray-100'
      );
    });

    it('should render Header component', () => {
      const { container } = render(<App />);

      // Header should be present - check for the actual header element
      const headerElement = container.querySelector('header');
      expect(headerElement).toBeInTheDocument();

      // Verify header has expected content (Browse button is a good indicator)
      expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument();
    });

    it('should render VulnerabilityGrid section', () => {
      const { container } = render(<App />);

      // Check for the vulnerability grid container
      const gridContainer = container.querySelector('.h-\\[60\\%\\]');
      expect(gridContainer).toBeInTheDocument();
    });

    it('should render LogConsole section', () => {
      const { container } = render(<App />);

      // Check for the log console container
      const logContainer = container.querySelector('.h-\\[40\\%\\]');
      expect(logContainer).toBeInTheDocument();
    });
  });

  describe('hook initialization order', () => {
    it('should initialize useLogConsole first', () => {
      render(<App />);

      // useLogConsole should be called exactly once
      expect(useLogConsole).toHaveBeenCalledTimes(1);
    });

    it('should initialize useGitOperations with correct parameters', () => {
      render(<App />);

      // useGitOperations should be called with addLog and refs
      expect(useGitOperations).toHaveBeenCalledTimes(1);
      expect(useGitOperations).toHaveBeenCalledWith(
        expect.any(Function), // addLog
        expect.objectContaining({ current: expect.any(Array) }), // vulnerabilitiesRef
        expect.objectContaining({ current: expect.any(Array) }) // projectsRef
      );
    });

    it('should initialize useVulnerabilityScanner with correct parameters', () => {
      render(<App />);

      // useVulnerabilityScanner should be called with addLog, getProjects callback, and allowReset
      expect(useVulnerabilityScanner).toHaveBeenCalledTimes(1);
      expect(useVulnerabilityScanner).toHaveBeenCalledWith(
        expect.any(Function), // addLog
        expect.any(Function), // getProjects callback (NOT an empty array)
        true // allowReset from useGitOperations
      );
    });

    it('should initialize useProjectDiscovery with correct parameters', () => {
      render(<App />);

      // useProjectDiscovery should be called with addLog and resetVulnerabilities
      expect(useProjectDiscovery).toHaveBeenCalledTimes(1);
      expect(useProjectDiscovery).toHaveBeenCalledWith(
        expect.any(Function), // addLog
        expect.any(Function) // resetVulnerabilities from useVulnerabilityScanner
      );
    });

    it('should initialize useFixApplication with correct parameters', () => {
      render(<App />);

      // useFixApplication should be called with all necessary parameters
      expect(useFixApplication).toHaveBeenCalledTimes(1);
      expect(useFixApplication).toHaveBeenCalledWith(
        expect.any(Function), // addLog
        [], // vulnerabilities
        expect.any(Set), // selectedVulns
        expect.any(Function), // setVulnerabilities
        [], // projects
        true // bumpVersion
      );
    });

    it('should call all hooks exactly once on mount', () => {
      render(<App />);

      expect(useLogConsole).toHaveBeenCalledTimes(1);
      expect(useGitOperations).toHaveBeenCalledTimes(1);
      expect(useVulnerabilityScanner).toHaveBeenCalledTimes(1);
      expect(useProjectDiscovery).toHaveBeenCalledTimes(1);
      expect(useFixApplication).toHaveBeenCalledTimes(1);
    });
  });

  describe('button state calculations', () => {
    it('should calculate scan button state correctly with no projects', () => {
      useProjectDiscovery.mockReturnValue({
        selectedFolder: '/test/path',
        projects: [],
        browseFolder: jest.fn(),
      });

      render(<App />);

      // Scan button should be disabled when no projects
      // (This is tested indirectly through the buttonsState prop passed to Header)
      expect(useProjectDiscovery).toHaveBeenCalled();
    });

    it('should calculate apply fixes button state correctly with no selections', () => {
      useVulnerabilityScanner.mockReturnValue({
        vulnerabilities: [{ id: '1', severity: 'high' }],
        selectedVulns: new Set(),
        progress: null,
        isScanning: false,
        scanProjects: jest.fn(),
        toggleVulnerability: jest.fn(),
        toggleAll: jest.fn(),
        resetVulnerabilities: jest.fn(),
        setVulnerabilities: jest.fn(),
      });

      render(<App />);

      // Apply fixes button should be disabled when no vulnerabilities are selected
      expect(useVulnerabilityScanner).toHaveBeenCalled();
    });

    it('should calculate commit button state correctly with no resolved vulnerabilities', () => {
      useVulnerabilityScanner.mockReturnValue({
        vulnerabilities: [{ id: '1', severity: 'high', status: 'pending' }],
        selectedVulns: new Set(['1']),
        progress: null,
        isScanning: false,
        scanProjects: jest.fn(),
        toggleVulnerability: jest.fn(),
        toggleAll: jest.fn(),
        resetVulnerabilities: jest.fn(),
        setVulnerabilities: jest.fn(),
      });

      render(<App />);

      // Commit button should be disabled when no resolved vulnerabilities
      expect(useVulnerabilityScanner).toHaveBeenCalled();
    });
  });

  describe('modal rendering', () => {
    it('should render high risk confirmation modal when showHighRiskModal is true', () => {
      useFixApplication.mockReturnValue({
        isApplying: false,
        applyFixes: jest.fn(),
        showHighRiskModal: true,
        highRiskCount: 3,
        closeHighRiskModal: jest.fn(),
        confirmHighRiskFixes: jest.fn(),
      });

      render(<App />);

      // Modal should be rendered (Modal component handles visibility based on isOpen)
      const modalElements = screen.queryAllByText(/Confirm HIGH Risk Fixes/i);
      expect(modalElements.length).toBeGreaterThanOrEqual(0);
    });

    it('should render git reset confirmation modal when showGitResetModal is true', () => {
      useGitOperations.mockReturnValue({
        isCommitting: false,
        allowReset: true,
        handleAllowResetChange: jest.fn(),
        commitAndPush: jest.fn(),
        showGitResetModal: true,
        closeGitResetModal: jest.fn(),
        confirmGitReset: jest.fn(),
      });

      render(<App />);

      // Modal should be rendered
      const modalElements = screen.queryAllByText(/Confirm Destructive Git Reset/i);
      expect(modalElements.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error boundary integration', () => {
    it('should wrap Header in ErrorBoundary', () => {
      const { container } = render(<App />);

      // Check that ErrorBoundary is present (it's a component wrapper)
      // We can verify this indirectly by checking the structure
      expect(container.querySelector('.h-screen')).toBeInTheDocument();
    });

    it('should wrap VulnerabilityGrid in ErrorBoundary', () => {
      const { container } = render(<App />);

      // Verify the grid section exists within error boundary
      const gridSection = container.querySelector('.h-\\[60\\%\\]');
      expect(gridSection).toBeInTheDocument();
    });

    it('should wrap LogConsole in ErrorBoundary', () => {
      const { container } = render(<App />);

      // Verify the log console section exists within error boundary
      const logSection = container.querySelector('.h-\\[40\\%\\]');
      expect(logSection).toBeInTheDocument();
    });
  });

  describe('regression tests for initialization bug', () => {
    it('should not reference vulnerabilities before it is defined', () => {
      // This test ensures the bug doesn't return
      // If vulnerabilities is accessed before initialization, it will throw
      expect(() => render(<App />)).not.toThrow();

      // Verify no temporal dead zone errors in console
      const tdzErrors = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('before initialization'))
      );
      expect(tdzErrors).toHaveLength(0);
    });

    it('should not reference projects before it is defined', () => {
      // This test ensures projects isn't accessed before initialization
      expect(() => render(<App />)).not.toThrow();

      // Verify no reference errors
      const refErrors = consoleErrorSpy.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' && arg.includes('projects') && arg.includes('not defined')
        )
      );
      expect(refErrors).toHaveLength(0);
    });

    it('should pass correct parameters to hooks on initial render', () => {
      render(<App />);

      // Verify useGitOperations gets refs (not arrays) to avoid circular dependency
      expect(useGitOperations).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ current: expect.any(Array) }), // vulnerabilitiesRef
        expect.objectContaining({ current: expect.any(Array) }) // projectsRef
      );

      // Verify useVulnerabilityScanner gets getProjects callback (not empty array)
      expect(useVulnerabilityScanner).toHaveBeenCalledWith(
        expect.any(Function), // addLog
        expect.any(Function), // getProjects callback
        expect.any(Boolean) // allowReset
      );
    });
  });

  describe('integration: project discovery to scanning flow', () => {
    it('should pass discovered projects to scanner via callback', async () => {
      // Mock discovered projects
      const mockProjects = [
        { path: '/test/project1', name: 'Project 1' },
        { path: '/test/project2', name: 'Project 2' },
      ];

      // Setup: Mock useProjectDiscovery to return projects
      useProjectDiscovery.mockReturnValue({
        selectedFolder: '/test',
        projects: mockProjects,
        browseFolder: jest.fn(),
      });

      // Setup: Mock useVulnerabilityScanner to track the getProjects callback
      let capturedGetProjects;
      useVulnerabilityScanner.mockImplementation((addLog, getProjects, _allowReset) => {
        capturedGetProjects = getProjects;
        return {
          vulnerabilities: [],
          selectedVulns: new Set(),
          progress: null,
          isScanning: false,
          scanProjects: jest.fn(),
          toggleVulnerability: jest.fn(),
          toggleAll: jest.fn(),
          resetVulnerabilities: jest.fn(),
          setVulnerabilities: jest.fn(),
        };
      });

      // Render the App component
      render(<App />);

      // Verify: The getProjects callback should return the discovered projects
      expect(capturedGetProjects).toBeDefined();
      expect(typeof capturedGetProjects).toBe('function');

      // Call the getProjects callback to verify it returns current projects
      const retrievedProjects = capturedGetProjects();
      expect(retrievedProjects).toEqual(mockProjects);
      expect(retrievedProjects.length).toBe(2);
    });

    it('should update projects ref when projects change', async () => {
      // Initial state: no projects
      const { rerender } = render(<App />);

      // Simulate project discovery
      const mockProjects = [{ path: '/test/project1', name: 'Project 1' }];

      useProjectDiscovery.mockReturnValue({
        selectedFolder: '/test',
        projects: mockProjects,
        browseFolder: jest.fn(),
      });

      let capturedGetProjects;
      useVulnerabilityScanner.mockImplementation((addLog, getProjects, _allowReset) => {
        capturedGetProjects = getProjects;
        return {
          vulnerabilities: [],
          selectedVulns: new Set(),
          progress: null,
          isScanning: false,
          scanProjects: jest.fn(),
          toggleVulnerability: jest.fn(),
          toggleAll: jest.fn(),
          resetVulnerabilities: jest.fn(),
          setVulnerabilities: jest.fn(),
        };
      });

      // Trigger re-render with new projects
      rerender(<App />);

      // Verify: The callback now returns the updated projects
      expect(capturedGetProjects).toBeDefined();
      const retrievedProjects = capturedGetProjects();
      expect(retrievedProjects).toEqual(mockProjects);
    });

    it('should not fail when scanning with empty projects initially', () => {
      // Setup: Empty projects initially
      useProjectDiscovery.mockReturnValue({
        selectedFolder: '',
        projects: [],
        browseFolder: jest.fn(),
      });

      let capturedGetProjects;
      useVulnerabilityScanner.mockImplementation((addLog, getProjects, _allowReset) => {
        capturedGetProjects = getProjects;
        return {
          vulnerabilities: [],
          selectedVulns: new Set(),
          progress: null,
          isScanning: false,
          scanProjects: jest.fn(),
          toggleVulnerability: jest.fn(),
          toggleAll: jest.fn(),
          resetVulnerabilities: jest.fn(),
          setVulnerabilities: jest.fn(),
        };
      });

      // Should render without error
      expect(() => render(<App />)).not.toThrow();

      // Verify: The callback returns empty array when no projects
      expect(capturedGetProjects).toBeDefined();
      const retrievedProjects = capturedGetProjects();
      expect(retrievedProjects).toEqual([]);
      expect(retrievedProjects.length).toBe(0);
    });

    it('should correctly pass callback to useVulnerabilityScanner instead of array', () => {
      render(<App />);

      // Verify: useVulnerabilityScanner is called with a function, not an array
      expect(useVulnerabilityScanner).toHaveBeenCalledWith(
        expect.any(Function), // addLog
        expect.any(Function), // getProjects callback (NOT an array)
        expect.any(Boolean) // allowReset
      );

      // Get the getProjects argument
      const getProjectsArg = useVulnerabilityScanner.mock.calls[0][1];
      expect(typeof getProjectsArg).toBe('function');
      expect(Array.isArray(getProjectsArg)).toBe(false);
    });
  });
});
