/**
 * ReasonForStudyCard — Top card in the left rail showing the reason
 * for the current examination.
 *
 * Displays only the "Reason for Study" label and the clinical indication
 * from the CurrentStudy metadata. The study name is intentionally omitted
 * since it's already visible in the header dropdown.
 */

import './CurrentStudyCard.css';
import type { CurrentStudy } from '../../types/api';

interface ReasonForStudyCardProps {
  /** The full current study object with labels and clinical context */
  currentStudy: CurrentStudy;
}

export function ReasonForStudyCard({ currentStudy }: ReasonForStudyCardProps) {
  return (
    <div className="current-study-card">
      <div className="csc-top-row">
        <span className="csc-section-label">Reason for Study</span>
      </div>

      <div className="csc-reason-text">
        {currentStudy.clinicalIndication}
      </div>
    </div>
  );
}
