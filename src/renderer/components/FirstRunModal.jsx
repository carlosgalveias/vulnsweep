import PropTypes from 'prop-types';

export default function FirstRunModal({ onAccept }) {
  return (
    <div className="first-run-overlay">
      <div className="first-run-modal">
        <div className="first-run-logo">
          <h1>VulnSweep</h1>
        </div>
        <div className="first-run-content">
          <p>
            By using this application, you accept our{' '}
            <a
              href="https://github.com/carlosgalveias/vulnsweep/blob/main/PRIVACY_POLICY.md"
              target="_blank"
              rel="noreferrer"
            >
              Privacy Policy
            </a>{' '}
            and{' '}
            <a
              href="https://github.com/carlosgalveias/vulnsweep/blob/main/DISCLAIMER.md"
              target="_blank"
              rel="noreferrer"
            >
              Disclaimer
            </a>
            .
          </p>
        </div>
        <button className="first-run-accept-btn" onClick={onAccept}>
          I Accept &amp; Continue
        </button>
      </div>
    </div>
  );
}

FirstRunModal.propTypes = {
  onAccept: PropTypes.func.isRequired,
};
