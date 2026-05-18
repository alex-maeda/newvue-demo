/**
 * NoteTextView — Full clinical document text viewer in the main stage left pane.
 *
 * Shared by both Clinical Notes and Pathology Reports. Fetches the full
 * document text on-demand from the server via /api/v1/ehr/text.
 *
 * When note triage data is available and this note was analyzed, inline
 * purple highlights are rendered over text snippets that were cited as
 * source material for extracted problems and reason-for-study context queries.
 *
 * Layout:
 *   - Toolbar: label chip + document type label + date + close button
 *   - Banner: "Not Radiology Report" safety pill
 *   - Body: Full document text with pre-wrap formatting + inline highlights
 *   - Footer: Unmatched problems warning (if any)
 */

import { useState, useEffect, useMemo } from 'react';
import './NoteTextView.css';
import type { EhrNote, EhrProblem, EhrPathologyReport } from '../../types/ehrTypes';
import type { NoteTriageResult, ExpandedReasonForStudy } from '../../types/api';
import { formatDisplayDate } from '../../utils/dates';
import { fetchEhrText } from '../../services/ehrService';
import { HighlightedReportText, UnmatchedFindingsWarning } from './HighlightedReportText';
import {
  isNoteAnalyzed,
  buildNoteSnippetMap,
  buildNoteHighlightSegments,
  findUnmatchedProblems,
} from '../../utils/note-snippet-highlighter';

// Specialty alias lookup for abbreviated chip labels (shared with NoteCard)
import specialtyAliasesRaw from '../../data/specialty_aliases.json';
const SPECIALTY_LOOKUP: Map<string, string> = new Map(
  Object.entries(specialtyAliasesRaw as Record<string, string>).map(
    ([key, abbrev]) => [key.toLowerCase(), abbrev],
  ),
);
function abbrevSpecialty(s: string): string {
  return SPECIALTY_LOOKUP.get(s.toLowerCase()) ?? s;
}

// ── Component ──────────────────────────────────────────────────────────────

interface NoteTextViewProps {
  /** The document to display (either a clinical note or a pathology report) */
  note?: EhrNote;
  pathologyReport?: EhrPathologyReport;
  onClose: () => void;
  /** Note triage result for inline highlighting (clinical notes only) */
  noteTriage?: NoteTriageResult | null;
  /** EHR problem list for resolving problem IDs to names */
  ehrProblems?: EhrProblem[];
  /** Expanded reason data for resolving context query codes to display labels */
  expandedReason?: ExpandedReasonForStudy | null;
}

export function NoteTextView({
  note,
  pathologyReport,
  onClose,
  noteTriage,
  ehrProblems,
  expandedReason,
}: NoteTextViewProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine which document type we're displaying
  const isPathology = !!pathologyReport;
  const doc = note || pathologyReport;

  // Chip label + document type label
  const chipLabel = note
    ? abbrevSpecialty(note.specialty || 'Note')
    : 'Path';
  const docTypeLabel = note ? 'Clinical Note' : 'Pathology Report';

  // Compose display title
  const displayTitle = note
    ? (() => {
        const titleSpecialty = note.specialty || note.setting || '';
        const titleNoteType = note.type || note.title || 'Note';
        return titleSpecialty ? `${titleSpecialty} – ${titleNoteType}` : titleNoteType;
      })()
    : pathologyReport?.title || 'Pathology Report';

  // Document date
  const docDate = note?.date || pathologyReport?.date || '';

  // Text file path for on-demand fetch
  const textFilePath = note?.textFilePath || pathologyReport?.textFilePath || '';
  const docId = note?.id || pathologyReport?.id || '';

  // Check if this note has been analyzed by note triage
  const noteAnalyzed = note ? isNoteAnalyzed(note.id, noteTriage) : false;

  // Build the snippet → display name reverse map (stable unless triage changes)
  const snippetMap = useMemo(() => {
    if (!noteAnalyzed || !noteTriage || !ehrProblems) return {};
    return buildNoteSnippetMap(noteTriage, ehrProblems, expandedReason);
  }, [noteAnalyzed, noteTriage, ehrProblems, expandedReason]);

  // Build highlight segments once text is loaded
  const segments = useMemo(() => {
    if (!text || !noteAnalyzed || !noteTriage || !note) return null;
    return buildNoteHighlightSegments(text, note.id, noteTriage.sentenceIndex, snippetMap);
  }, [text, noteAnalyzed, noteTriage, note, snippetMap]);

  // Find unmatched problems for the warning footer
  const unmatchedProblems = useMemo(() => {
    if (!segments || !noteAnalyzed || !noteTriage || !ehrProblems || !note) return [];
    return findUnmatchedProblems(noteTriage, ehrProblems, note.id, segments);
  }, [segments, noteAnalyzed, noteTriage, ehrProblems, note]);

  // Determine if we should render highlighted text vs plain text
  const hasHighlights = segments && segments.some((s) => s.snippetIds !== null);

  // Fetch document text on mount or when document changes
  useEffect(() => {
    if (!textFilePath) {
      setLoading(false);
      setError(`No text file available for this ${isPathology ? 'report' : 'note'}.`);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);

    fetchEhrText(textFilePath)
      .then((content) => {
        if (!cancelled) {
          setText(content);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || `Failed to load ${isPathology ? 'report' : 'note'} text.`);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [textFilePath, docId, isPathology]);

  if (!doc) return null;

  return (
    <div className="note-text-view">
      {/* Toolbar */}
      <div className="ntv-toolbar">
        <span className="ntv-toolbar-chip">
          {chipLabel}
        </span>
        <span className="ntv-toolbar-status">{docTypeLabel}</span>
        <span className="ntv-toolbar-date">
          {formatDisplayDate(docDate)}
        </span>
        <button
          className="ntv-close-btn"
          onClick={onClose}
          title="Close document view"
          aria-label="Close document view"
        >
          ✕
        </button>
      </div>

      {/* Banner — safety warning only */}
      <div className="ntv-banner">
        <span className="ntv-banner-pill">Not Radiology Report</span>
      </div>

      {/* Body */}
      <div className="ntv-body">
        {/* Header */}
        <div className="ntv-header">
          <div className="ntv-header-title">{displayTitle}</div>
          {note && (
            <div className="ntv-header-meta">
              {note.author && <span>{note.author}</span>}
              {note.author && note.setting && <span className="ntv-meta-sep">·</span>}
              {note.setting && <span>{note.setting}</span>}
            </div>
          )}
        </div>

        {/* Document text content */}
        <div className="ntv-content">
          {loading && (
            <div className="ntv-loading">Loading {isPathology ? 'report' : 'note'}…</div>
          )}
          {error && (
            <div className="ntv-error">{error}</div>
          )}
          {text && hasHighlights && segments ? (
            <div className="ntv-text">
              <HighlightedReportText
                segments={segments}
                snippetFindingMap={snippetMap}
                preWrap
                overlayHeaderLabel="Problem"
              />
            </div>
          ) : text ? (
            <div className="ntv-text">{text}</div>
          ) : null}
        </div>

        {/* Unmatched problems warning */}
        {unmatchedProblems.length > 0 && (
          <UnmatchedFindingsWarning
            unmatchedFindings={unmatchedProblems}
            label="problems"
          />
        )}
      </div>
    </div>
  );
}
