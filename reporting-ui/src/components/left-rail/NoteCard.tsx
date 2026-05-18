/**
 * NoteCard — Card for each clinical note in the EHR Notes tab.
 *
 * Layout:
 *   Row 1: Label chips — [★ OP] [Specialty] [Setting]
 *   Row 2: Date + relative age
 *   Row 3: Title (Specialty – Note Type)
 *   Row 4: Author name (subtle)
 *   Bottom Row: (only for relevant notes) — [Relevant] [Score%]
 *
 * Design mirrors PriorStudyCard:
 *   - "Relevant" chip is purple (NewVue interactive) at bottom-left
 *   - Score % chip is a separate contiguous chip with darker tone
 *   - Clicking "Relevant" → filters to relevant notes only
 *   - Clicking Score % → filters + sorts by score descending
 *   - ★ Ordering Provider chip is gold, inline in Row 1
 *
 * Card click → selects this note for full-text view in the main stage.
 */

import { useCallback } from 'react';
import './NoteCard.css';
import type { EhrNote, NoteRelevanceResult } from '../../types/ehrTypes';
import { formatDisplayDate, relativeAge } from '../../utils/dates';
import { useCockpit } from '../../context/CockpitContext';

// ── Specialty Abbreviation Map ───────────────────────────────────────────────
//
// Loaded from the shared config/specialty_aliases.json resource file.
// The JSON keys are lowercase; we build a case-insensitive lookup at init time
// so FHIR values like "Neurology" or "neurology" both resolve correctly.

import specialtyAliasesRaw from '../../data/specialty_aliases.json';

const SPECIALTY_LOOKUP: Map<string, string> = new Map(
  Object.entries(specialtyAliasesRaw as Record<string, string>).map(
    ([key, abbrev]) => [key.toLowerCase(), abbrev],
  ),
);

/** Get the abbreviated chip label for a specialty, or fall back to using the full name. */
function getSpecialtyAbbrev(specialty: string): string {
  if (!specialty) return 'Note';
  return SPECIALTY_LOOKUP.get(specialty.toLowerCase()) ?? specialty;
}

// ── Setting Abbreviation Map ───────────────────────────────────────────────

const SETTING_MAP: Record<string, string> = {
  'Inpatient': 'IP',
  'Outpatient': 'OP',
  'Emergency Department': 'ED',
};

// ── Component ──────────────────────────────────────────────────────────────

interface NoteCardProps {
  note: EhrNote;
  /** Reference date/time for computing relative age (e.g. "today") */
  referenceDateTime: string;
  /** Pre-computed relevance result for this note (from the current study context) */
  relevance?: NoteRelevanceResult | null;
  /** Whether this note was analyzed by the AI problem extraction pipeline */
  isAnalyzed?: boolean;
}

export function NoteCard({ note, referenceDateTime, relevance, isAnalyzed }: NoteCardProps) {
  const {
    state,
    selectNote,
    clearNote,
    toggleNoteFilter,
    toggleNoteRelevantOnly,
    setNoteSortByRelevancy,
  } = useCockpit();

  const isSelected = state.selectedNoteId === note.id;
  const specialtyAbbrev = getSpecialtyAbbrev(note.specialty);
  const settingAbbrev = SETTING_MAP[note.setting] || note.setting;

  // Relevance indicators
  const isRelevant = relevance?.isRelevant ?? false;
  const isOrderingProvider = relevance?.isOrderingProvider ?? false;
  const normalizedPercent = relevance?.normalizedPercent ?? 0;

  // Filter/sort active state (from context)
  const isRelevantActive = state.noteRelevantOnly;
  const isSortByRelevancy = state.noteSortByRelevancy;

  // Suppress setting chip when it would duplicate the specialty chip
  const showSettingChip = settingAbbrev && settingAbbrev !== specialtyAbbrev;

  // Compose title: "Specialty – Note Type"
  const titleSpecialty = note.specialty || note.setting || '';
  const titleNoteType = note.type || note.title || 'Note';
  const cardTitle = titleSpecialty
    ? `${titleSpecialty} – ${titleNoteType}`
    : titleNoteType;

  // ── Filter state checks ───────────────────────────────────────────────
  const isSpecialtyActive = state.noteFilter?.specialty === note.specialty;
  const isSettingActive = state.noteFilter?.setting === note.setting;

  // Whether to render the bottom row at all
  const showBottomRow = isRelevant || isAnalyzed;

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCardClick = useCallback(() => {
    if (isSelected) {
      clearNote();
    } else {
      selectNote(note.id);
    }
  }, [selectNote, clearNote, note.id, isSelected]);

  const handleSpecialtyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (note.specialty) {
        toggleNoteFilter('specialty', note.specialty);
      }
    },
    [toggleNoteFilter, note.specialty],
  );

  const handleSettingClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (note.setting) {
        toggleNoteFilter('setting', note.setting);
      }
    },
    [toggleNoteFilter, note.setting],
  );

  /**
   * Relevant chip click — progressive deactivation:
   *   • If BOTH noteRelevantOnly + noteSortByRelevancy are active → clear both
   *   • Otherwise → toggle noteRelevantOnly normally
   */
  const handleRelevantClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isRelevantActive && isSortByRelevancy) {
        // Both active → clear both
        toggleNoteRelevantOnly();
        setNoteSortByRelevancy(false);
      } else {
        toggleNoteRelevantOnly();
      }
    },
    [toggleNoteRelevantOnly, setNoteSortByRelevancy, isRelevantActive, isSortByRelevancy],
  );

  /**
   * Score chip click — progressive activation/deactivation:
   *   • If BOTH noteRelevantOnly + noteSortByRelevancy are active → clear both
   *   • If noteRelevantOnly is active but sort is not → ADD sort
   *   • If neither is active → activate both
   */
  const handleScoreChipClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isRelevantActive && isSortByRelevancy) {
        // Both active → clear both
        toggleNoteRelevantOnly();
        setNoteSortByRelevancy(false);
      } else if (isRelevantActive) {
        // Filter is on, sort is off → add sort
        setNoteSortByRelevancy(true);
      } else {
        // Neither active → activate both
        toggleNoteRelevantOnly();
        setNoteSortByRelevancy(true);
      }
    },
    [toggleNoteRelevantOnly, setNoteSortByRelevancy, isRelevantActive, isSortByRelevancy],
  );

  return (
    <div
      className={`note-card ${isSelected ? 'selected' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(); }}
    >
      <div className="nc-body">
        {/* Row 1: Chips */}
        <div className="nc-chip-row">
          {/* Specialty chip */}
          <button
            className={`nc-label-chip ${isSpecialtyActive ? 'active' : ''}`}
            onClick={handleSpecialtyClick}
            title={`Filter by ${note.specialty || 'specialty'}`}
            aria-label={`Filter by specialty ${note.specialty}`}
          >
            {specialtyAbbrev}
          </button>

          {/* Setting chip (if not redundant) */}
          {showSettingChip && (
            <button
              className={`nc-label-chip ${isSettingActive ? 'active' : ''}`}
              onClick={handleSettingClick}
              title={`Filter by ${note.setting}`}
              aria-label={`Filter by setting ${note.setting}`}
            >
              {settingAbbrev}
            </button>
          )}

          {/* Ordering provider ★ chip — pushed to the right */}
          {isOrderingProvider && (
            <span
              className="nc-op-chip"
              title="Ordering Clinician's Note"
              aria-label="Ordering Clinician's Note"
            >
              ★
            </span>
          )}
        </div>

        {/* Row 2: Date + relative age */}
        <div className="nc-date-row">
          <span className="nc-date">{formatDisplayDate(note.date)}</span>
          <span className="nc-age">{relativeAge(note.date, referenceDateTime)}</span>
        </div>

        {/* Row 3: Title */}
        <div className="nc-title">{cardTitle}</div>

        {/* Row 4: Author */}
        {note.author && (
          <div className="nc-author">{note.author}</div>
        )}
      </div>

      {/* ── Bottom Row (only for relevant notes) ── */}
      {showBottomRow && (
        <div className="nc-bottom-row">
          <div className="nc-bottom-chips">
            {/* Relevant chip — clickable to filter */}
            <button
              className={`nc-relevant-chip ${isRelevantActive ? 'active' : ''}`}
              onClick={handleRelevantClick}
              title="Show only relevant notes"
              aria-label="Filter to show only relevant notes"
            >
              Relevant
            </button>

            {/* Score % chip — contiguous, toggles filter+sort */}
            {normalizedPercent > 0 && (
              <button
                className={`nc-score-chip ${isSortByRelevancy && isRelevantActive ? 'active' : ''}`}
                onClick={handleScoreChipClick}
                title={`Relevance: ${normalizedPercent}% — click to filter + sort by relevance`}
                aria-label={`Relevance score ${normalizedPercent}%, click to sort by relevance`}
              >
                {normalizedPercent}%
              </button>
            )}

            {/* Analyzed indicator — shown when AI problem extraction has been run */}
            {isAnalyzed && (
              <span
                className="nc-analyzed-chip"
                title="This note has been analyzed by AI"
                aria-label="Note analyzed by AI"
              >
                Analyzed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
