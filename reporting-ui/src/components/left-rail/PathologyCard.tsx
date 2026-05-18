/**
 * PathologyCard — Displays a pathology report in the left rail.
 *
 * Layout:
 *   Row 1: Report title (left) + date (right)
 *   Row 2: Status text (only if NOT "final")
 *
 * Clicking the card toggles full-text display in the main stage,
 * following the same toggle pattern as NoteCard.
 */

import { useCallback } from 'react';
import './PathologyCard.css';
import type { EhrPathologyReport } from '../../types/ehrTypes';
import { useCockpit } from '../../context/CockpitContext';

/** Format an ISO date like "2025-07-02T00:00:00-07:00" → "07/02/25" */
function formatShortDate(isoDate: string): string {
  if (!isoDate) return '';
  // Handle ISO datetime strings by splitting on 'T' first
  const dateOnly = isoDate.split('T')[0];
  const parts = dateOnly.split('-');
  if (parts.length < 3) return '';
  const yy = parts[0].slice(2);
  const mm = parts[1];
  const dd = parts[2].slice(0, 2);
  return `${mm}/${dd}/${yy}`;
}

export function PathologyCard({ report }: { report: EhrPathologyReport }) {
  const { state, selectPathology, clearPathology } = useCockpit();
  const isSelected = state.selectedPathologyId === report.id;
  const isFinal = (report.status || '').toLowerCase() === 'final';
  const shortDate = formatShortDate(report.date);

  const handleClick = useCallback(() => {
    if (isSelected) {
      clearPathology();
    } else {
      selectPathology(report.id);
    }
  }, [selectPathology, clearPathology, report.id, isSelected]);

  return (
    <div
      className={`pathology-card${isSelected ? ' selected' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={report.title}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="pathc-body">
        {/* Row 1: Title + date */}
        <div className="pathc-name-row">
          <span className="pathc-name">{report.title}</span>
          {shortDate && <span className="pathc-date">{shortDate}</span>}
        </div>

        {/* Row 2: Status (only for non-final reports) */}
        {!isFinal && report.status && (
          <div className="pathc-status">{report.status}</div>
        )}
      </div>
    </div>
  );
}
