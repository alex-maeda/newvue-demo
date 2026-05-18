/**
 * ProcedureCard — Displays a clinical procedure in the left rail.
 *
 * Layout:
 *   Row 1: Procedure name (left) + date (right)
 *   Row 2: Body site (if present)
 *   Row 3: Status text (only if NOT "completed")
 *   Row 4: Note annotation (if present, clamped to 3 lines)
 */

import './ProcedureCard.css';
import type { EhrProcedure } from '../../types/ehrTypes';

interface ProcedureCardProps {
  procedure: EhrProcedure;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

/** Format an ISO date like "2025-07-02" → "07/02/25" */
function formatShortDate(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length < 3) return '';
  const yy = parts[0].slice(2);
  const mm = parts[1];
  const dd = parts[2].slice(0, 2);
  return `${mm}/${dd}/${yy}`;
}

export function ProcedureCard({ procedure, selected = false, onSelect }: ProcedureCardProps) {
  const handleClick = () => {
    onSelect?.(procedure.id);
  };

  const isCompleted = (procedure.status || '').toLowerCase() === 'completed';
  const shortDate = formatShortDate(procedure.date);

  return (
    <div
      className={`procedure-card${selected ? ' selected' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={procedure.text}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="procc-body">
        {/* Row 1: Procedure name + date */}
        <div className="procc-name-row">
          <span className="procc-name">{procedure.text}</span>
          {shortDate && <span className="procc-date">{shortDate}</span>}
        </div>

        {/* Row 2: Body site (when present) */}
        {procedure.bodySite && (
          <div className="procc-body-site">{procedure.bodySite}</div>
        )}

        {/* Row 3: Status (only for non-completed procedures) */}
        {!isCompleted && procedure.status && (
          <div className="procc-status">{procedure.status}</div>
        )}

        {/* Row 4: Note annotation (clamped to 3 lines) */}
        {procedure.note && (
          <div className="procc-note">{procedure.note}</div>
        )}
      </div>
    </div>
  );
}
