import { render, screen, fireEvent } from '@testing-library/react';
import AboutTab from '../../../src/renderer/components/AboutTab';
import { createElectronAPIMock, OP } from '../../utils/electron-api-mock';

const defaultProps = {
  appVersion: '1.2.3',
};

beforeEach(() => {
  window.electronAPI = createElectronAPIMock({
    [OP.OP_OPEN_LOCAL_DOC]: () => Promise.resolve({ success: true }),
    [OP.OP_OPEN_EXTERNAL]: () => Promise.resolve(undefined),
  });
  jest.clearAllMocks();
});

describe('AboutTab — Documentation & Support', () => {
  it('renders Privacy Policy link button', () => {
    render(<AboutTab {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Privacy Policy/i })).toBeInTheDocument();
  });

  it('renders Disclaimer link button', () => {
    render(<AboutTab {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Disclaimer/i })).toBeInTheDocument();
  });

  it('calls openLocalDoc with PRIVACY_POLICY.md when Privacy Policy is clicked', () => {
    render(<AboutTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Privacy Policy/i }));
    expect(window.electronAPI.invoke).toHaveBeenCalledWith(
      OP.OP_OPEN_LOCAL_DOC,
      'PRIVACY_POLICY.md'
    );
  });

  it('calls openLocalDoc with DISCLAIMER.md when Disclaimer is clicked', () => {
    render(<AboutTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Disclaimer/i }));
    expect(window.electronAPI.invoke).toHaveBeenCalledWith(OP.OP_OPEN_LOCAL_DOC, 'DISCLAIMER.md');
  });

  it('renders GitHub issues link as an anchor with correct href', () => {
    render(<AboutTab {...defaultProps} />);
    const link = screen.getByRole('link', { name: /Report an issue/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/carlosgalveias/vulnsweep/issues');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does NOT call openExternal when GitHub issues link is present (native anchor)', () => {
    render(<AboutTab {...defaultProps} />);
    const link = screen.getByRole('link', { name: /Report an issue/i });
    fireEvent.click(link);
    expect(window.electronAPI.invoke).not.toHaveBeenCalledWith(
      OP.OP_OPEN_EXTERNAL,
      expect.anything()
    );
  });
});

describe('AboutTab — App Identity', () => {
  it('renders VulnSweep heading', () => {
    render(<AboutTab {...defaultProps} />);
    expect(screen.getByText('VulnSweep')).toBeInTheDocument();
  });

  it('renders appVersion prop when provided', () => {
    render(<AboutTab {...defaultProps} appVersion="2.0.0" />);
    expect(screen.getByText(/v2\.0\.0/)).toBeInTheDocument();
  });

  it('does not render version span when appVersion is empty', () => {
    render(<AboutTab {...defaultProps} appVersion="" />);
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });
});
