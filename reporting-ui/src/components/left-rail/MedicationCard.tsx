/**
 * MedicationCard — Displays a medication entry in the left rail.
 *
 * Layout:
 *   Row 1: Medication name (from medicationCodeableConcept.text)
 *   Row 2: Dosage instruction (free-text sig, truncated at 2 lines)
 *   Row 3: Last administration date/time (optional, italic with clock prefix)
 *   Row 4: Note annotation (optional, italic)
 *   Row 5: Status text (only if NOT "active")
 */

import './MedicationCard.css';
import type { EhrMedication } from '../../types/ehrTypes';

/** Format an ISO datetime string into "MMM D, YYYY h:mm A" for clinical display. */
function formatLastGiven(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day}, ${year}  ${time}`;
}

export function MedicationCard({ medication }: { medication: EhrMedication }) {
  const isActive = (medication.status || '').toLowerCase() === 'active';
  const lastGivenLabel = medication.lastGiven ? formatLastGiven(medication.lastGiven) : '';

  return (
    <div className="medication-card">
      <div className="medc-body">
        {/* Row 1: Medication name */}
        <div className="medc-name">{medication.name}</div>

        {/* Row 2: Dosage instruction */}
        {medication.dosageInstruction && (
          <div className="medc-dosage">{medication.dosageInstruction}</div>
        )}

        {/* Row 3: Last administration date/time */}
        {lastGivenLabel && (
          <div className="medc-last-given">Last: {lastGivenLabel}</div>
        )}

        {/* Row 4: Note annotation */}
        {medication.note && (
          <div className="medc-note">{medication.note}</div>
        )}

        {/* Row 5: Status (only for non-active medications) */}
        {!isActive && medication.status && (
          <div className="medc-status">{medication.status}</div>
        )}
      </div>
    </div>
  );
}
