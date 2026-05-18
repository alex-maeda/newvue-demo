/**
 * LabCategoryCard — Displays a lab panel category card in the left rail.
 *
 * Each card represents a clinical lab grouping (e.g., CBC, Chemistry, Coags, LFTs).
 * Shows up to N=4 abnormal lab values from the most recent draw, with directional
 * arrows indicating whether the value is above (▲) or below (▼) the reference range.
 *
 * Layout:
 *   Row 1: Panel name (e.g., "CBC")
 *   Rows 2–5: Abnormal analyte summaries (name, value, arrow, timestamp)
 *   Footer: "X of Y abnormal" footnote when more than N abnormals exist,
 *           or "Most recent values normal" when none are abnormal.
 */

import './LabCategoryCard.css';
import type { LabPanel } from '../../types/ehrTypes';

/** Maximum number of abnormal analytes to show in the card. */
const MAX_ABNORMAL_DISPLAY = 4;

/** Parse a reference range string (e.g., "4.5-11.0") into numeric bounds. */
function parseRefRange(range: string): { low: number; high: number } | null {
  const m = range.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/);
  if (!m) return null;
  const low = parseFloat(m[1]);
  const high = parseFloat(m[2]);
  if (isNaN(low) || isNaN(high)) return null;
  return { low, high };
}

/** Extract the first numeric value from a cell string, ignoring flags like '*' and text. */
function extractNumericValue(cell: string): number | null {
  // Handle pipe-separated multi-values: take the first one
  const primary = cell.split('|')[0].trim();
  const m = /[-+]?[0-9]*\.?[0-9]+/.exec(primary);
  return m ? parseFloat(m[0]) : null;
}

/** Check if a cell is flagged as abnormal (contains '*'). */
function isAbnormalCell(cell: string): boolean {
  return cell.includes('*');
}

/** Check if a cell is a missing/empty value. */
function isMissingCell(cell: string): boolean {
  return cell.trim() === '--' || cell.trim() === '';
}

/**
 * Format a column timestamp string (e.g., "09/18/25 0222") into display format.
 * Returns "MM/DD/YY  H:MMa/p" for compact card display.
 */
function formatColumnTimestamp(col: string): string {
  const parts = col.match(/^(\d{2})\/(\d{2})\/(\d{2})\s*(\d{2})(\d{2})$/);
  if (!parts) return col;
  const [, mm, dd, yy, hh24, min] = parts;
  const hour = parseInt(hh24, 10);
  const ampm = hour >= 12 ? 'p' : 'a';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${mm}/${dd}/${yy} ${h12}:${min}${ampm}`;
}

interface AbnormalSummary {
  analyte: string;
  value: number;
  direction: '▲' | '▼';
  timestamp: string;
}

interface LabCategoryCardProps {
  panelName: string;
  panel: LabPanel;
  isSelected: boolean;
  onClick: () => void;
}

export function LabCategoryCard({ panelName, panel, isSelected, onClick }: LabCategoryCardProps) {
  // Find abnormal analytes from the most recent column
  const abnormals: AbnormalSummary[] = [];

  for (const row of panel.rows) {
    // Find the most recent non-missing value
    let mostRecentIdx = -1;
    for (let i = 0; i < row.values.length; i++) {
      if (!isMissingCell(row.values[i])) {
        mostRecentIdx = i;
        break;
      }
    }
    if (mostRecentIdx < 0) continue;

    const cell = row.values[mostRecentIdx];
    if (!isAbnormalCell(cell)) continue;

    const numVal = extractNumericValue(cell);
    if (numVal == null) continue;

    const ref = parseRefRange(row.referenceRange);
    let direction: '▲' | '▼';
    if (ref) {
      direction = numVal > ref.high ? '▲' : '▼';
    } else {
      // Fallback: if no reference range, default to ▲ (abnormal-high)
      direction = '▲';
    }

    const timestamp = panel.columns[mostRecentIdx] || '';

    abnormals.push({
      analyte: row.name,
      value: numVal,
      direction,
      timestamp: formatColumnTimestamp(timestamp),
    });
  }

  const totalAbnormal = abnormals.length;
  const displayAbnormals = abnormals.slice(0, MAX_ABNORMAL_DISPLAY);
  const totalRows = panel.rows.length;

  return (
    <div
      className={`lab-card${isSelected ? ' lab-card--selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="labc-body">
        {/* Panel title */}
        <div className="labc-title">{panelName}</div>

        {/* Abnormal value rows */}
        {displayAbnormals.length > 0 ? (
          <>
            <div className="labc-abnormals">
              {displayAbnormals.map((a) => (
                <div key={a.analyte} className="labc-abnormal-row">
                  <span className="labc-analyte">{a.analyte}</span>
                  <span className="labc-value">
                    {a.value}
                    <span className={`labc-arrow labc-arrow--${a.direction === '▲' ? 'high' : 'low'}`}>
                      {a.direction}
                    </span>
                  </span>
                  <span className="labc-timestamp">{a.timestamp}</span>
                </div>
              ))}
            </div>
            {/* Footnote: "X of Y abnormal" + cap hint when truncated */}
            {totalAbnormal > 0 && (
              <div className="labc-footnote">
                {totalAbnormal} of {totalRows} abnormal
                {totalAbnormal > MAX_ABNORMAL_DISPLAY && (
                  <span className="labc-footnote-cap"> ({MAX_ABNORMAL_DISPLAY} max displayed)</span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="labc-normal">Most recent values normal</div>
        )}
      </div>
    </div>
  );
}
