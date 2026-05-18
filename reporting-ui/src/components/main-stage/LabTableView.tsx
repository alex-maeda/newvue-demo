/**
 * LabTableView — Full lab panel table display for the main stage left pane.
 *
 * Shows a time-columnar table of lab results for a single panel (e.g., CBC).
 * Most recent results on the left, oldest on the right. Abnormal values are
 * highlighted with red text and directional arrows based on reference range
 * comparison (▲ above normal, ▼ below normal).
 *
 * Row headers show the analyte name with the reference range in smaller text below.
 * Multi-value cells (pipe-separated) show the primary value with secondary values
 * in a smaller line. Missing values display as an em-dash in muted gray.
 */

import './LabTableView.css';
import type { LabPanel } from '../../types/ehrTypes';

/** Parse a reference range string (e.g., "4.5-11.0") into numeric bounds. */
function parseRefRange(range: string): { low: number; high: number } | null {
  const m = range.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/);
  if (!m) return null;
  const low = parseFloat(m[1]);
  const high = parseFloat(m[2]);
  if (isNaN(low) || isNaN(high)) return null;
  return { low, high };
}

/** Extract the first numeric value from a raw cell string. */
function extractNumericValue(raw: string): number | null {
  const m = /[-+]?[0-9]*\.?[0-9]+/.exec(raw);
  return m ? parseFloat(m[0]) : null;
}

/** Check if a cell is a missing/empty value. */
function isMissingCell(cell: string): boolean {
  return cell.trim() === '--' || cell.trim() === '';
}

/**
 * Format a column timestamp string (e.g., "09/18/25 0222") into two-line display.
 * Returns { datePart: "09/18/25", timePart: "2:22a" }.
 */
function formatColumnHeader(col: string): { datePart: string; timePart: string } {
  const parts = col.match(/^(\d{2}\/\d{2}\/\d{2})\s*(\d{2})(\d{2})$/);
  if (!parts) return { datePart: col, timePart: '' };
  const [, datePart, hh24, min] = parts;
  const hour = parseInt(hh24, 10);
  const ampm = hour >= 12 ? 'p' : 'a';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return { datePart, timePart: `${h12}:${min}${ampm}` };
}

/**
 * Parse a single cell value into display segments.
 * Handles pipe-separated multi-values (e.g., "12.4* | 12.8*").
 */
interface CellSegment {
  raw: string;
  numericValue: number | null;
  isAbnormal: boolean;
  displayText: string;
}

function parseCellValues(cell: string): CellSegment[] {
  if (isMissingCell(cell)) {
    return [{ raw: cell, numericValue: null, isAbnormal: false, displayText: '—' }];
  }
  const parts = cell.split('|').map(p => p.trim());
  return parts.map(part => {
    const isAbnormal = part.includes('*');
    const numericValue = extractNumericValue(part);
    // Clean display: strip the asterisk but keep the number and any text flags
    const displayText = part.replace(/\*/g, '').trim();
    return { raw: part, numericValue, isAbnormal, displayText };
  });
}

interface LabTableViewProps {
  panelName: string;
  panel: LabPanel;
  onClose: () => void;
}

export function LabTableView({ panelName, panel, onClose }: LabTableViewProps) {
  const columnHeaders = panel.columns.map(formatColumnHeader);

  return (
    <div className="lab-table-view">
      {/* Toolbar */}
      <div className="lab-table-toolbar">
        <span className="lab-table-title">{panelName} Lab Results</span>
        <button
          className="stage-close-btn"
          onClick={onClose}
          title="Close lab results"
          aria-label="Close lab results"
        >
          ✕
        </button>
      </div>

      {/* Scrollable table container */}
      <div className="lab-table-container">
        <table className="lab-table">
          <thead>
            <tr>
              <th className="lab-th lab-th--analyte">Test</th>
              {columnHeaders.map((hdr, i) => (
                <th key={`col-${i}`} className="lab-th lab-th--time">
                  <div className="lab-th-date">{hdr.datePart}</div>
                  <div className="lab-th-time">{hdr.timePart}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((row) => {
              const ref = parseRefRange(row.referenceRange);
              return (
                <tr key={row.name} className="lab-tr">
                  {/* Row header: analyte name + reference range */}
                  <td className="lab-td lab-td--analyte">
                    <div className="lab-analyte-name">{row.name}</div>
                    {row.referenceRange && (
                      <div className="lab-analyte-range">{row.referenceRange}</div>
                    )}
                  </td>

                  {/* Value cells */}
                  {row.values.map((cellVal, ci) => {
                    const segments = parseCellValues(cellVal);
                    const primarySeg = segments[0];
                    const secondarySegs = segments.slice(1);
                    const isMissing = isMissingCell(cellVal);

                    // Determine abnormality direction for each segment
                    const getArrow = (seg: CellSegment): string | null => {
                      if (!seg.isAbnormal || seg.numericValue == null || !ref) return null;
                      return seg.numericValue > ref.high ? '▲' : '▼';
                    };

                    const primaryArrow = getArrow(primarySeg);

                    return (
                      <td
                        key={`${row.name}-${ci}`}
                        className={`lab-td lab-td--value${primarySeg.isAbnormal ? ' lab-td--abnormal' : ''}${isMissing ? ' lab-td--missing' : ''}`}
                      >
                        <div className="lab-cell-primary">
                          <span className="lab-cell-text">{primarySeg.displayText}</span>
                          {primaryArrow && (
                            <span className={`lab-cell-arrow lab-cell-arrow--${primaryArrow === '▲' ? 'high' : 'low'}`}>
                              {primaryArrow}
                            </span>
                          )}
                        </div>
                        {secondarySegs.length > 0 && (
                          <div className="lab-cell-secondary">
                            {secondarySegs.map((seg, si) => {
                              const arrow = getArrow(seg);
                              return (
                                <span key={si} className={`lab-cell-secondary-item${seg.isAbnormal ? ' lab-cell-secondary--abnormal' : ''}`}>
                                  {seg.displayText}
                                  {arrow && (
                                    <span className={`lab-cell-arrow lab-cell-arrow--${arrow === '▲' ? 'high' : 'low'}`}>
                                      {arrow}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
