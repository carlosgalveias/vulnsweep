import { render, screen, fireEvent, act } from '@testing-library/react';
import DependencyUpdatesTab from '../../../src/renderer/components/DependencyUpdatesTab';

// New grouped shape: Array<RepoUpdateResult>
const REPO_PATH = '/repos/myrepo';
const FLAT_CANDS = [
  {
    name: 'lodash',
    currentVersion: '4.0.0',
    availableVersions: ['4.1.0', '4.2.0'],
    recommendedVersion: '4.2.0',
    selectedVersion: '4.2.0',
    riskLevel: 'Low',
    depType: 'dependencies',
  },
  {
    name: 'axios',
    currentVersion: '0.21.0',
    availableVersions: ['1.0.0'],
    recommendedVersion: '1.0.0',
    selectedVersion: '1.0.0',
    riskLevel: 'High',
    depType: 'dependencies',
  },
];
const CANDS = [{ repoPath: REPO_PATH, repoName: 'myrepo', candidates: FLAT_CANDS }];
// Composite keys for selectedPackages
const KEY_LODASH = `${REPO_PATH}:lodash`;
const KEY_AXIOS = `${REPO_PATH}:axios`;
const noop = () => {};

describe('idle/empty state', () => {
  it('renders heading', () => {
    render(<DependencyUpdatesTab onSelectionChange={noop} />);
    expect(screen.getByText('Dependency Updates')).toBeInTheDocument();
  });
  it('shows idle prompt when no candidates and not scanning', () => {
    render(<DependencyUpdatesTab candidates={[]} isScanning={false} onSelectionChange={noop} />);
    expect(screen.getByText(/Scan for Updates/)).toBeInTheDocument();
  });
  it('no table when candidates empty', () => {
    render(<DependencyUpdatesTab candidates={[]} onSelectionChange={noop} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('no standalone path input', () => {
    render(<DependencyUpdatesTab onSelectionChange={noop} />);
    expect(screen.queryByPlaceholderText(/project path/i)).not.toBeInTheDocument();
  });
  it('no standalone scan button', () => {
    render(<DependencyUpdatesTab onSelectionChange={noop} />);
    expect(screen.queryByRole('button', { name: /^Scan/i })).not.toBeInTheDocument();
  });
});

describe('scanning state', () => {
  it('shows scanning text when isScanning true', () => {
    render(<DependencyUpdatesTab isScanning={true} onSelectionChange={noop} />);
    expect(screen.getByText(/Scanning dependencies/)).toBeInTheDocument();
  });
  it('hides idle prompt while scanning', () => {
    render(<DependencyUpdatesTab isScanning={true} onSelectionChange={noop} />);
    expect(screen.queryByText(/Scan for Updates/)).not.toBeInTheDocument();
  });
  it('hides table while scanning', () => {
    render(
      <DependencyUpdatesTab
        isScanning={true}
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('error states', () => {
  it('shows scan error text', () => {
    render(<DependencyUpdatesTab scanError="oops" onSelectionChange={noop} />);
    expect(screen.getByText(/Scan error/)).toBeInTheDocument();
  });
  it('includes scan error detail', () => {
    render(<DependencyUpdatesTab scanError="timeout" onSelectionChange={noop} />);
    expect(screen.getByText(/timeout/)).toBeInTheDocument();
  });
  it('shows apply error', () => {
    render(<DependencyUpdatesTab applyError="disk full" onSelectionChange={noop} />);
    expect(screen.getByText(/Apply error/)).toBeInTheDocument();
  });
  it('includes apply error detail', () => {
    render(<DependencyUpdatesTab applyError="no space" onSelectionChange={noop} />);
    expect(screen.getByText(/no space/)).toBeInTheDocument();
  });
});

describe('apply done state', () => {
  it('shows Committed label when applyStatus done', () => {
    render(
      <DependencyUpdatesTab
        applyStatus="done"
        commitMessage="lodash@4.2.0"
        onSelectionChange={noop}
      />
    );
    expect(screen.getByText(/Updates applied/)).toBeInTheDocument();
  });
  it('includes commit message text', () => {
    render(
      <DependencyUpdatesTab applyStatus="done" commitMessage="pkg@1.0.0" onSelectionChange={noop} />
    );
    expect(screen.getByText(/pkg@1\.0\.0/)).toBeInTheDocument();
  });
  it('no commit banner when commitMessage is null', () => {
    render(
      <DependencyUpdatesTab applyStatus="done" commitMessage={null} onSelectionChange={noop} />
    );
    expect(screen.queryByText(/Committed:/)).not.toBeInTheDocument();
  });
});
describe('results table', () => {
  it('renders table when candidates provided', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
  it('shows library name', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByText('lodash')).toBeInTheDocument();
  });
  it('shows current version', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByText('4.0.0')).toBeInTheDocument();
  });
  it('shows Low risk badge', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByText('Low')).toBeInTheDocument();
  });
  it('shows High risk badge', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByText('High')).toBeInTheDocument();
  });
  it('renders version dropdown', () => {
    render(
      <DependencyUpdatesTab
        candidates={[{ repoPath: REPO_PATH, repoName: 'myrepo', candidates: [FLAT_CANDS[0]] }]}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
  it('renders select-all checkbox', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select all packages')).toBeInTheDocument();
  });
  it('renders per-row checkbox for lodash', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select lodash')).toBeInTheDocument();
  });
  it('renders per-row checkbox for axios', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select axios')).toBeInTheDocument();
  });
  it('row checkbox reflects checked state from selectedPackages', () => {
    render(
      <DependencyUpdatesTab
        candidates={[CANDS[0]]}
        selectedPackages={new Set([KEY_LODASH])}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select lodash')).toBeChecked();
  });
  it('row checkbox unchecked when not in selectedPackages', () => {
    render(
      <DependencyUpdatesTab
        candidates={[CANDS[0]]}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select lodash')).not.toBeChecked();
  });
  it('select-all checked when all selected', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set([KEY_LODASH, KEY_AXIOS])}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select all packages')).toBeChecked();
  });
  it('select-all unchecked when none selected', () => {
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={noop}
      />
    );
    expect(screen.getByLabelText('Select all packages')).not.toBeChecked();
  });
});

describe('checkbox interactions', () => {
  it('calls onSelectionChange adding package on check', () => {
    const onChange = jest.fn();
    render(
      <DependencyUpdatesTab
        candidates={[CANDS[0]]}
        selectedPackages={new Set()}
        onSelectionChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Select lodash'));
    expect(onChange).toHaveBeenCalled();
    const lastArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastArg.has(KEY_LODASH)).toBe(true);
  });
  it('calls onSelectionChange removing package on uncheck', () => {
    const onChange = jest.fn();
    render(
      <DependencyUpdatesTab
        candidates={[CANDS[0]]}
        selectedPackages={new Set([KEY_LODASH])}
        onSelectionChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Select lodash'));
    expect(onChange).toHaveBeenCalled();
    const lastArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastArg.has(KEY_LODASH)).toBe(false);
  });
  it('select-all calls onSelectionChange with all names', () => {
    const onChange = jest.fn();
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set()}
        onSelectionChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Select all packages'));
    expect(onChange).toHaveBeenCalled();
    const lastSet = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastSet.has(KEY_LODASH)).toBe(true);
    expect(lastSet.has(KEY_AXIOS)).toBe(true);
  });
  it('select-all deselect calls onSelectionChange with empty set', () => {
    const onChange = jest.fn();
    render(
      <DependencyUpdatesTab
        candidates={CANDS}
        selectedPackages={new Set([KEY_LODASH, KEY_AXIOS])}
        onSelectionChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Select all packages'));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].size).toBe(0);
  });
});

describe('auto-selection on candidates change', () => {
  it('calls onSelectionChange with Low-risk names when candidates populate', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <DependencyUpdatesTab
        candidates={[]}
        selectedPackages={new Set()}
        onSelectionChange={onChange}
      />
    );
    act(() => {
      rerender(
        <DependencyUpdatesTab
          candidates={CANDS}
          selectedPackages={new Set()}
          onSelectionChange={onChange}
        />
      );
    });
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const s = lastCall[0];
    expect(s.has(KEY_LODASH)).toBe(true);
    expect(s.has(KEY_AXIOS)).toBe(false);
  });
});
