/**
 * CockpitFooter — Bottom bar with worklist stats and QA panel trigger.
 *
 * The QA trigger button (right side) replaces the previous "Hold" button
 * and serves as the primary way to expand/collapse the Quality Review
 * overlay panel (ActionPanel). The trigger was moved here from the
 * ActionPanel's edge chip to keep it always visible and accessible.
 */

import './CockpitFooter.css';
import { useCockpit } from '../../context/CockpitContext';

export function CockpitFooter() {
  const { state, toggleRightRail, toggleEhrIntegration, toggleSimilarPresentations } = useCockpit();

  return (
    <footer className="zone-cockpit-footer">
      <div className="footer-left">
        <div className="footer-stat">
          <span className="footer-stat-n">0</span>
          <span className="footer-stat-l">Unsign</span>
        </div>
        <div className="footer-stat">
          <span className="footer-stat-n">0</span>
          <span className="footer-stat-l">Filed</span>
        </div>
        <div className="footer-stat alert">
          <span className="footer-stat-n">0</span>
          <span className="footer-stat-l">Stat</span>
        </div>
        <div className="footer-stat">
          <span className="footer-stat-n">0</span>
          <span className="footer-stat-l">Appoint</span>
        </div>
        <div className="footer-stat">
          <span className="footer-stat-n">0</span>
          <span className="footer-stat-l">Routine</span>
        </div>
      </div>

      <div className="footer-center" />

      <div className="footer-right">
        {/* Similar Presentations Toggle (A/B testing) */}
        <div className="ehr-toggle">
          <span className="ehr-toggle-label">Similar Presentations</span>
          <button
            className={`ehr-toggle-pill ${state.showSimilarPresentations ? 'ehr-toggle-pill--on' : ''}`}
            onClick={toggleSimilarPresentations}
            role="switch"
            aria-checked={state.showSimilarPresentations}
            aria-label={state.showSimilarPresentations ? 'Hide Similar Presentations' : 'Show Similar Presentations'}
            title={state.showSimilarPresentations ? 'Hide Similar Presentations' : 'Show Similar Presentations'}
            id="cockpit-similar-presentations-toggle"
          >
            <span className="ehr-toggle-knob" />
          </button>
        </div>
        {/* EHR Integration Toggle */}
        <div className="ehr-toggle">
          <span className="ehr-toggle-label">EHR Integration</span>
          <button
            className={`ehr-toggle-pill ${state.ehrIntegrationEnabled ? 'ehr-toggle-pill--on' : ''}`}
            onClick={toggleEhrIntegration}
            role="switch"
            aria-checked={state.ehrIntegrationEnabled}
            aria-label={state.ehrIntegrationEnabled ? 'Disable EHR Integration' : 'Enable EHR Integration'}
            title={state.ehrIntegrationEnabled ? 'Disable EHR Integration' : 'Enable EHR Integration'}
            id="cockpit-ehr-toggle"
          >
            <span className="ehr-toggle-knob" />
          </button>
        </div>
        <button
          className={`cockpit-qa-btn ${state.rightRailExpanded ? 'cockpit-qa-btn--active' : ''}`}
          onClick={toggleRightRail}
          title={state.rightRailExpanded ? 'Close Quality Review' : 'Open Quality Review'}
          aria-label={state.rightRailExpanded ? 'Close Quality Review' : 'Open Quality Review'}
          id="cockpit-qa-trigger"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="cockpit-qa-btn-icon"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span className="cockpit-qa-btn-label">Quality Review</span>
        </button>
      </div>
    </footer>
  );
}
