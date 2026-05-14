import { render, screen, fireEvent } from '@testing-library/react';
import AboutTab from '../../../src/renderer/components/AboutTab';

const LIC_VALID = {
  isLicensed: true,
  isExpired: false,
  serialNumber: 'SN-TEST-1234',
  expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
  daysUntilRenewal: 60,
};

const LIC_RENEW_TODAY = {
  isLicensed: true,
  isExpired: false,
  serialNumber: 'SN-TODAY',
  expiryDate: new Date().toISOString(),
  daysUntilRenewal: 1,
};

const LIC_EXPIRED = {
  isLicensed: false,
  isExpired: true,
  serialNumber: 'SN-EXPIRED',
  expiryDate: new Date(Date.now() - 86400000).toISOString(),
};

const defaultProps = {
  licStatus: null,
  appVersion: '1.2.3',
  analyticsOptOut: false,
  onAnalyticsOptOutChange: jest.fn(),
  onLicenseRestored: jest.fn(),
};

beforeEach(() => {
  window.electronAPI = {
    licenseBackup: jest.fn().mockResolvedValue({ success: true }),
    licenseRestore: jest.fn().mockResolvedValue({ success: true }),
    openLocalDoc: jest.fn().mockResolvedValue({ success: true }),
    openExternal: jest.fn().mockResolvedValue(undefined),
  };
  jest.clearAllMocks();
});

describe('AboutTab — License Status', () => {
  it('renders green Licensed badge when isLicensed is true and not expired', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_VALID} />);
    expect(screen.getByText('✓ Licensed')).toBeInTheDocument();
  });

  it('renders serialNumber when licStatus.serialNumber is present', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_VALID} />);
    expect(screen.getByText(/SN-TEST-1234/)).toBeInTheDocument();
  });

  it('renders expiry date and daysUntilRenewal when licensed', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_VALID} />);
    expect(screen.getByText(/Renews/)).toBeInTheDocument();
  });

  it('renders "Renews today" when daysUntilRenewal === 1', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_RENEW_TODAY} />);
    expect(screen.getByText(/⚠ Renews today/)).toBeInTheDocument();
  });

  it('renders red Expired badge when licStatus.isExpired is true', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_EXPIRED} />);
    expect(screen.getByText('✗ License Expired')).toBeInTheDocument();
  });

  it('renders gray Unlicensed badge when licStatus is null', () => {
    render(<AboutTab {...defaultProps} licStatus={null} />);
    expect(screen.getByText(/Unlicensed \(Trial Mode\)/)).toBeInTheDocument();
  });

  it('does NOT render Licensed badge when licStatus is null', () => {
    render(<AboutTab {...defaultProps} licStatus={null} />);
    expect(screen.queryByText('✓ Licensed')).not.toBeInTheDocument();
  });

  it('does NOT render Licensed badge when license is expired', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_EXPIRED} />);
    expect(screen.queryByText('✓ Licensed')).not.toBeInTheDocument();
  });
});

describe('AboutTab — Backup & Restore', () => {
  it('shows Backup button only when licStatus.isLicensed === true', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_VALID} />);
    expect(screen.getByRole('button', { name: /Backup License/i })).toBeInTheDocument();
  });

  it('does NOT show Backup button when unlicensed', () => {
    render(<AboutTab {...defaultProps} licStatus={null} />);
    expect(screen.queryByRole('button', { name: /Backup License/i })).not.toBeInTheDocument();
  });

  it('does NOT show Backup button when expired', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_EXPIRED} />);
    expect(screen.queryByRole('button', { name: /Backup License/i })).not.toBeInTheDocument();
  });

  it('always shows Restore button regardless of license state', () => {
    render(<AboutTab {...defaultProps} licStatus={null} />);
    expect(screen.getByRole('button', { name: /Restore License/i })).toBeInTheDocument();
  });

  it('shows Restore button when licensed', () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_VALID} />);
    expect(screen.getByRole('button', { name: /Restore License/i })).toBeInTheDocument();
  });

  it('calls licenseBackup IPC when Backup button is clicked', async () => {
    render(<AboutTab {...defaultProps} licStatus={LIC_VALID} />);
    fireEvent.click(screen.getByRole('button', { name: /Backup License/i }));
    expect(window.electronAPI.licenseBackup).toHaveBeenCalledTimes(1);
  });

  it('calls licenseRestore IPC when Restore button is clicked', async () => {
    render(<AboutTab {...defaultProps} licStatus={null} />);
    fireEvent.click(screen.getByRole('button', { name: /Restore License/i }));
    expect(window.electronAPI.licenseRestore).toHaveBeenCalledTimes(1);
  });
});

describe('AboutTab — Analytics Toggle', () => {
  it('renders analytics checkbox checked when analyticsOptOut is false', () => {
    render(<AboutTab {...defaultProps} analyticsOptOut={false} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('renders analytics checkbox unchecked when analyticsOptOut is true', () => {
    render(<AboutTab {...defaultProps} analyticsOptOut={true} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('calls onAnalyticsOptOutChange with toggled value when checkbox changes', () => {
    const onChange = jest.fn();
    render(
      <AboutTab {...defaultProps} analyticsOptOut={false} onAnalyticsOptOutChange={onChange} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onAnalyticsOptOutChange(false) when checkbox is unchecked from opted-out state', () => {
    const onChange = jest.fn();
    render(
      <AboutTab {...defaultProps} analyticsOptOut={true} onAnalyticsOptOutChange={onChange} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
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
    expect(window.electronAPI.openLocalDoc).toHaveBeenCalledWith('PRIVACY_POLICY.md');
  });

  it('calls openLocalDoc with DISCLAIMER.md when Disclaimer is clicked', () => {
    render(<AboutTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Disclaimer/i }));
    expect(window.electronAPI.openLocalDoc).toHaveBeenCalledWith('DISCLAIMER.md');
  });

  it('renders GitHub issues link button', () => {
    render(<AboutTab {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Report an issue/i })).toBeInTheDocument();
  });

  it('calls openExternal with GitHub issues URL when link is clicked', () => {
    render(<AboutTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Report an issue/i }));
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith(
      'https://github.com/carlosgalveias/vulnsweep-releases/issues'
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
