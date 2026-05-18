/**
 * ProblemCard — Displays a clinical problem in the left rail.
 *
 * Layout:
 *   Row 1: Problem name (left) + "Dx MM/DD/YY" (right)
 *   Row 2: Status text (only if NOT "active")
 *   Row 3: Note annotation (if present, clamped to 3 lines)
 */

import './ProblemCard.css';
import { useCockpit } from '../../context/CockpitContext';
import type { EhrProblem } from '../../types/ehrTypes';

interface ProblemCardProps {
  problem: EhrProblem;
}

/** Format an ISO date like "2025-09-16" → "09/16/25" */
function formatShortDate(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length < 3) return '';
  const yy = parts[0].slice(2);
  const mm = parts[1];
  const dd = parts[2].slice(0, 2);
  return `${mm}/${dd}/${yy}`;
}

export function ProblemCard({ problem }: ProblemCardProps) {
  const { state, selectProblem, clearProblem } = useCockpit();
  const isSelected = state.selectedProblemId === problem.id;

  const handleClick = () => {
    if (isSelected) {
      clearProblem();
    } else {
      selectProblem(problem.id);
    }
  };

  const isActive = (problem.status || '').toLowerCase() === 'active';
  const dxDate = formatShortDate(problem.recordedDate);

  return (
    <div
      className={`problem-card${isSelected ? ' selected' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={problem.text}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="pc-body">
        {/* Row 1: Problem name + Dx date */}
        <div className="pc-name-row">
          <span className="pc-name">{problem.text}</span>
          {dxDate && <span className="pc-dx-date">{dxDate}</span>}
        </div>

        {/* Row 2: Status (only for non-active problems) */}
        {!isActive && problem.status && (
          <div className="pc-status">{problem.status}</div>
        )}

        {/* Row 3: Note annotation (clamped to 3 lines) */}
        {problem.note && (
          <div className="pc-note">{problem.note}</div>
        )}
      </div>
    </div>
  );
}
