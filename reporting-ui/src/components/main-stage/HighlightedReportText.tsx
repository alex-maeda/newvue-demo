/**
 * HighlightedReportText — Renders a report section's text with inline
 * purple highlights for text snippets that were cited as source material
 * for extracted findings.
 *
 * Interaction model:
 *   - Hover a highlighted snippet → lighter purple background + overlay
 *     showing the bulleted list of associated findings
 *   - Move mouse away from snippet → overlay dismisses (hover state clears)
 *   - Click within the highlighted snippet → overlay dismisses immediately
 *     (so user can copy-paste or interact with text underneath)
 *   - Click anywhere outside the overlay → same dismissal behavior
 *
 * The overlay is positioned near the mouse cursor, clamped to the viewport.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import './HighlightedReportText.css';
import type { HighlightSegment, SnippetFindingMap } from '../../utils/snippet-highlighter';
import { getFindingsForSnippets } from '../../utils/snippet-highlighter';

interface HighlightedReportTextProps {
  /** Pre-computed segments from buildHighlightSegments() */
  segments: HighlightSegment[];
  /** Reverse map: snippet ID → display names */
  snippetFindingMap: SnippetFindingMap;
  /** Whether to preserve whitespace (for Findings/Impression sections) */
  preWrap?: boolean;
  /** Label for the overlay header (default: "Finding") — e.g., "Problem" for notes */
  overlayHeaderLabel?: string;
}

interface OverlayState {
  /** Which snippet IDs are being shown */
  snippetIds: string[];
  /** Position for the overlay */
  x: number;
  y: number;
}

export function HighlightedReportText({
  segments,
  snippetFindingMap,
  preWrap,
  overlayHeaderLabel = 'Finding',
}: HighlightedReportTextProps) {
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [activeSnippetKey, setActiveSnippetKey] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Click anywhere outside the overlay dismisses it
  useEffect(() => {
    if (!overlay) return;

    function handleClick(e: MouseEvent) {
      // If click is inside the overlay, don't dismiss
      if (overlayRef.current?.contains(e.target as Node)) return;
      setOverlay(null);
      setActiveSnippetKey(null);
    }

    // Use a slight delay to avoid immediately dismissing on the same click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
    };
  }, [overlay]);

  const handleSnippetHover = useCallback(
    (snippetIds: string[], segmentIndex: number, e: React.MouseEvent) => {
      const key = `${segmentIndex}`;
      setActiveSnippetKey(key);

      // Position overlay near cursor, will be clamped by CSS/JS
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setOverlay({
        snippetIds,
        x: rect.left,
        y: rect.bottom + 6,
      });
    },
    [],
  );

  const handleSnippetLeave = useCallback(() => {
    setOverlay(null);
    setActiveSnippetKey(null);
  }, []);

  const handleSnippetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOverlay(null);
    setActiveSnippetKey(null);
  }, []);

  // Clamp overlay position to viewport
  const overlayStyle = overlay
    ? (() => {
        const pad = 12;
        let { x, y } = overlay;

        // Clamp to right edge (estimate overlay width ~340px)
        if (x + 340 > window.innerWidth - pad) {
          x = window.innerWidth - 340 - pad;
        }
        if (x < pad) x = pad;

        // If below viewport, flip above the element
        if (y + 200 > window.innerHeight - pad) {
          y = overlay.y - 220; // flip upward
        }
        if (y < pad) y = pad;

        return { left: x, top: y } as React.CSSProperties;
      })()
    : undefined;

  const overlayFindings = overlay
    ? getFindingsForSnippets(overlay.snippetIds, snippetFindingMap)
    : [];

  return (
    <span style={preWrap ? { whiteSpace: 'pre-wrap' } : undefined}>
      {segments.map((seg, i) => {
        if (!seg.snippetIds) {
          // Plain text segment
          return <span key={i}>{seg.text}</span>;
        }

        const key = `${i}`;
        const isActive = activeSnippetKey === key;

        return (
          <span
            key={i}
            className={`highlight-snippet${isActive ? ' highlight-snippet--active' : ''}`}
            onMouseEnter={(e) => handleSnippetHover(seg.snippetIds!, i, e)}
            onMouseLeave={handleSnippetLeave}
            onClick={handleSnippetClick}
          >
            {seg.text}
          </span>
        );
      })}

      {/* Finding overlay */}
      {overlay && overlayFindings.length > 0 && (
        <div
          ref={overlayRef}
          className="highlight-overlay"
          style={overlayStyle}
        >
          <div className="highlight-overlay-header">
            Associated {overlayHeaderLabel}{overlayFindings.length !== 1 ? 's' : ''}
          </div>
          <ul className="highlight-overlay-list">
            {overlayFindings.map((name) => (
              <li key={name} className="highlight-overlay-item">
                <span className="highlight-overlay-bullet">•</span>
                <span className="highlight-overlay-name">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

// ── Unmatched Findings Warning ────────────────────────────────────────────

interface UnmatchedWarningProps {
  unmatchedFindings: Array<{ name: string }>;
  /** Label for the item type (default: "findings") — e.g., "problems" for notes */
  label?: string;
}

export function UnmatchedFindingsWarning({ unmatchedFindings, label = 'findings' }: UnmatchedWarningProps) {
  if (unmatchedFindings.length === 0) return null;

  return (
    <div className="highlight-unmatched-warning">
      <span className="highlight-unmatched-icon">⚠️</span>
      <div className="highlight-unmatched-body">
        <div className="highlight-unmatched-title">
          Source text was not traceable for the following {label}
        </div>
        <ul className="highlight-unmatched-list">
          {unmatchedFindings.map((f) => (
            <li key={f.name} className="highlight-unmatched-item">
              {f.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
