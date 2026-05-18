/**
 * ExecutiveSummary — Two-layer executive summary display.
 *
 * Layer 1 (Scan): Region groups as collapsible sections, findings as
 *   single-line items with colored category chips.
 *   Region headings default to EXPANDED so the finding list is visible.
 *   Individual finding details (study entries) start COLLAPSED — they
 *   expand on hover (floating preview) or click (inline pin).
 * Layer 2 (Detail): Hover to preview, click to pin open.
 *
 * Pinned findings are persisted through the CockpitContext's
 * execViewStateRef so they survive unmount/remount cycles.
 * Region expand/collapse state is also persisted for mid-session toggling
 * but always resets to "all expanded" on fresh summarization loads.
 *
 * Open Recommendations are filtered: fulfilled and untitled entries hidden.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './ExecutiveSummary.css';
import { SparkleIcon, SearchIcon, CheckboxIcon, QuestionCircleIcon, SectionChevronIcon, HourglassIcon } from '../icons/SummaryIcons';
import { RadiologyIcon, ProblemsIcon } from '../icons/EhrIcons';
import { useCockpit } from '../../context/CockpitContext';
import type {
  ExecutiveSummary as ExecutiveSummaryType,
  ExecutiveFinding,
  SummaryStudyEntry,
  SimilarPresentation,
  OpenRecommendation,
  OneLinerResult,
  CurrentStudy,
  PriorReportAnalysis,
  SentenceSnippetIndex,
  ProblemGroupingResult,
  ProblemGroupEntry,
  ProblemMemberDetail,
  NoteTriageResult,
  ExpandedReasonForStudy,
  StudyIntentResult,
} from '../../types/api';
import type { NoteRelevanceResult } from '../../types/ehrTypes';
import { computeChipScore } from '../../utils/finding-importance';

interface ExecutiveSummaryProps {
  summary: ExecutiveSummaryType;
  /** One Liner synthesis result — two 1–2 sentence clinical summaries */
  oneLiner?: OneLinerResult | null;
  /** Tier 1 individual report analyses — for resolving citation sentence IDs */
  individualAnalyses?: PriorReportAnalysis[];
  /** Problem grouping result — for Relevant Problems section (EHR-only) */
  problemGrouping?: ProblemGroupingResult | null;
  /** Note triage result — for resolving problem sentence citations */
  noteTriage?: NoteTriageResult | null;
  /** Current study metadata (for Reason for Study display) */
  currentStudy?: CurrentStudy | null;
  /** Whether EHR Integration is enabled (controls One Liner variant) */
  ehrIntegrationEnabled?: boolean;
  /** Expanded Reason for Study from synthesis pass */
  expandedReason?: ExpandedReasonForStudy | null;
  /** Study intent classification result (for purpose chip) */
  studyIntent?: StudyIntentResult | null;
  /** Called when a study entry chip is clicked (accession number). */
  onStudyClick?: (accessionNumber: string) => void;
  /** Called when the close button is clicked. */
  onClose?: () => void;
}

/**
 * Chip color mapping — 2-tier visual priority system.
 *
 * "Important" (teal): CRITICAL, PROGRESSING, NEW — clinically actionable
 * "Routine" (muted purple): everything else — tracked but not attention-grabbing
 */
const IMPORTANT_CHIP = { bg: 'rgba(2, 128, 144, 0.20)', color: '#5edce2' };
const ROUTINE_CHIP   = { bg: 'rgba(110, 110, 196, 0.18)', color: 'rgba(255, 255, 255, 0.70)' };

const CHIP_STYLES: Record<string, { bg: string; color: string }> = {
  CRITICAL:    IMPORTANT_CHIP,
  PROGRESSING: IMPORTANT_CHIP,
  NEW:         IMPORTANT_CHIP,
  STABLE:      ROUTINE_CHIP,
  IMPROVING:   ROUTINE_CHIP,
  RESOLVED:    ROUTINE_CHIP,
  INCIDENTAL:  ROUTINE_CHIP,
};

const DEFAULT_CHIP = ROUTINE_CHIP;

/** Capitalize first letter of a string */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function ExecutiveSummary({
  summary, oneLiner, individualAnalyses, problemGrouping, noteTriage,
  currentStudy, ehrIntegrationEnabled, expandedReason, studyIntent,
  onStudyClick, onClose,
}: ExecutiveSummaryProps) {
  const { state, execViewStateRef, selectNote } = useCockpit();

  // Select the appropriate one-liner variant based on EHR toggle
  const oneLinerText = ehrIntegrationEnabled
    ? (oneLiner?.fullOneLiner || oneLiner?.imagingOneLiner || '')
    : (oneLiner?.imagingOneLiner || '');
  const reasonForStudy = currentStudy?.clinicalIndication || '';

  // ── Build unified sentence lookup from all report sentence indices ──
  const sentenceIndex = useMemo(() => {
    const map = new Map<string, SentenceSnippetIndex>();
    if (individualAnalyses) {
      for (const analysis of individualAnalyses) {
        if (analysis.reportSentenceIndex) {
          for (const entry of analysis.reportSentenceIndex) {
            map.set(entry.id, entry);
          }
        }
      }
    }
    return map;
  }, [individualAnalyses]);

  // ── Build note sentence lookup from noteTriage sentence index ──
  const noteSentenceIndex = useMemo(() => {
    const map = new Map<string, SentenceSnippetIndex>();
    if (noteTriage?.sentenceIndex) {
      for (const entry of noteTriage.sentenceIndex) {
        map.set(entry.id, entry);
      }
    }
    return map;
  }, [noteTriage]);

  // ── Derive problem entries split by relevancy (EHR-only) ──
  const { moreRelevantProblems, lessRelevantProblems } = useMemo(() => {
    if (!problemGrouping?.entries) return { moreRelevantProblems: [], lessRelevantProblems: [] };
    const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const enriched = problemGrouping.entries
      .sort((a, b) => b.score - a.score)
      .map((entry) => ({
        ...entry,
        isNew: entry.oldestDate
          ? (now - new Date(entry.oldestDate).getTime()) < SIX_MONTHS_MS
          : false,
      }));
    return {
      moreRelevantProblems: enriched.filter((e) => e.score >= 5),
      lessRelevantProblems: enriched.filter((e) => e.score < 5),
    };
  }, [problemGrouping]);

  // ── Note relevance map (for ordering notes within problem provenance) ──
  const noteRelevanceMap = useMemo(() => {
    const map = new Map<string, NoteRelevanceResult>();
    const studyId = currentStudy?.currentStudyId;
    if (!studyId || !state.ehrData?.noteRelevance) return map;
    const results = state.ehrData.noteRelevance[studyId];
    if (results) {
      for (const r of results) map.set(r.noteId, r);
    }
    return map;
  }, [currentStudy?.currentStudyId, state.ehrData?.noteRelevance]);

  // ── Section-level collapse state (title bar toggles) ──
  // One Liner and Reason for Study default OPEN; Findings and Problems default CLOSED
  const [oneLinerExpanded, setOneLinerExpanded] = useState(true);
  const [reasonExpanded, setReasonExpanded] = useState(true);
  const [findingsExpanded, setFindingsExpanded] = useState(false);
  const [problemsExpanded, setProblemsExpanded] = useState(false);

  // ── Relevancy category collapse state ──
  // MORE RELEVANT defaults expanded, LESS RELEVANT defaults collapsed
  const [moreRelevantExpanded, setMoreRelevantExpanded] = useState(true);
  const [lessRelevantExpanded, setLessRelevantExpanded] = useState(false);
  const [moreProblemsExpanded, setMoreProblemsExpanded] = useState(true);
  const [lessProblemsExpanded, setLessProblemsExpanded] = useState(false);

  const [pinnedFindings, setPinnedFindings] = useState<Set<string>>(() => {
    if (execViewStateRef.current) {
      return new Set(execViewStateRef.current.pinnedFindings);
    }
    return new Set();
  });

  // Hover state (local only — not persisted)
  // expand delay (25ms) < collapse delay (30ms) so next opens before prev closes
  const [hoveredFindings, setHoveredFindings] = useState<Set<string>>(new Set());
  const hoverTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const hoverCoordsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [, forceUpdate] = useState(0);

  // Subtitle bar hover preview (only when collapsed)
  const [hoveredSubtitle, setHoveredSubtitle] = useState<string | null>(null);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subtitleCoordsRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleSubtitleEnter = useCallback((key: string, e: React.MouseEvent) => {
    subtitleCoordsRef.current = { x: e.clientX, y: e.clientY };
    if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
    subtitleTimerRef.current = setTimeout(() => setHoveredSubtitle(key), 120);
  }, []);

  const handleSubtitleLeave = useCallback(() => {
    if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
    subtitleTimerRef.current = setTimeout(() => setHoveredSubtitle(null), 80);
  }, []);

  const HOVER_EXPAND_MS = 25;
  const HOVER_COLLAPSE_MS = 30;

  // ── Sync pinned state back to persistent ref ──
  useEffect(() => {
    execViewStateRef.current = {
      expandedRegions: [],
      pinnedFindings: [...pinnedFindings],
    };
  }, [pinnedFindings, execViewStateRef]);

  const togglePin = useCallback((key: string) => {
    setPinnedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleFindingHover = useCallback((key: string, e: React.MouseEvent) => {
    hoverCoordsRef.current.set(key, { x: e.clientX, y: e.clientY });
    const existing = hoverTimersRef.current.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setHoveredFindings((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      forceUpdate((n) => n + 1);
      hoverTimersRef.current.delete(key);
    }, HOVER_EXPAND_MS);
    hoverTimersRef.current.set(key, timer);
  }, []);

  const handleFindingLeave = useCallback((key: string) => {
    const existing = hoverTimersRef.current.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setHoveredFindings((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      hoverCoordsRef.current.delete(key);
      hoverTimersRef.current.delete(key);
    }, HOVER_COLLAPSE_MS);
    hoverTimersRef.current.set(key, timer);
  }, []);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      hoverTimersRef.current.forEach((t) => clearTimeout(t));
      hoverTimersRef.current.clear();
    };
  }, []);

  // ── Filter recommendations: exclude fulfilled and untitled ──
  const filteredRecommendations = summary.openRecommendations.filter((rec) => {
    if (rec.status === 'fulfilled') return false;
    if (!rec.action || !rec.action.trim()) return false;
    return true;
  });

  // ── Section toggle handlers ──
  // When Findings/Problems open, reset subtitle bars to defaults
  const toggleFindings = useCallback(() => {
    setFindingsExpanded((prev) => {
      if (!prev) {
        // Opening: reset subtitle bars to defaults
        setMoreRelevantExpanded(true);
        setLessRelevantExpanded(false);
      }
      return !prev;
    });
  }, []);

  const toggleProblems = useCallback(() => {
    setProblemsExpanded((prev) => {
      if (!prev) {
        setMoreProblemsExpanded(true);
        setLessProblemsExpanded(false);
      }
      return !prev;
    });
  }, []);

  // ── Flatten all findings and split by relevancy score ──
  // MORE RELEVANT: total >= 4, LESS RELEVANT: total < 4
  const { moreRelevant, lessRelevant } = useMemo(() => {
    const allFindings = summary.regionGroups.flatMap((g) => g.findings);

    // Sort by: total desc → SAF desc → CHG desc → TRK desc → chip score → alphabetical
    const sorted = [...allFindings].sort((a, b) => {
      const aScore = a.relevancyScore?.total ?? 0;
      const bScore = b.relevancyScore?.total ?? 0;
      if (bScore !== aScore) return bScore - aScore;

      const aSAF = a.relevancyScore?.SAF ?? 0;
      const bSAF = b.relevancyScore?.SAF ?? 0;
      if (bSAF !== aSAF) return bSAF - aSAF;

      const aCHG = a.relevancyScore?.CHG ?? 0;
      const bCHG = b.relevancyScore?.CHG ?? 0;
      if (bCHG !== aCHG) return bCHG - aCHG;

      const aTRK = a.relevancyScore?.TRK ?? 0;
      const bTRK = b.relevancyScore?.TRK ?? 0;
      if (bTRK !== aTRK) return bTRK - aTRK;

      // Tie-break: chip-based score, then alphabetical
      const chipDiff = computeChipScore(b.chips) - computeChipScore(a.chips);
      if (chipDiff !== 0) return chipDiff;
      return a.name.localeCompare(b.name);
    });

    const more: ExecutiveFinding[] = [];
    const less: ExecutiveFinding[] = [];
    for (const f of sorted) {
      if ((f.relevancyScore?.total ?? 0) >= 4) more.push(f);
      else less.push(f);
    }
    return { moreRelevant: more, lessRelevant: less };
  }, [summary.regionGroups]);

  return (
    <div className="exec-summary">
      {/* ── One Liner Section ── */}
      <div
        className="exec-section-bar exec-section-bar--collapsible"
        onClick={() => setOneLinerExpanded((p) => !p)}
      >
        <SparkleIcon className="exec-section-bar-icon" />
        <span className="exec-section-bar-title">One Liner</span>
        <span className="exec-section-bar-spacer" />
        <SectionChevronIcon
          className={`exec-section-chevron ${oneLinerExpanded ? 'exec-section-chevron--open' : 'exec-section-chevron--closed'}`}
        />
        {onClose && (
          <button
            className="exec-header-close"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close executive summary"
            aria-label="Close executive summary"
          >
            ✕
          </button>
        )}
      </div>
      {oneLinerExpanded && oneLinerText && (
        <div className="exec-oneliner-content">{oneLinerText}</div>
      )}

      {/* ── Reason for Study Section ── */}
      <div
        className="exec-section-bar exec-section-bar--collapsible"
        onClick={() => setReasonExpanded((p) => !p)}
      >
        <QuestionCircleIcon className="exec-section-bar-icon" />
        <span className="exec-section-bar-title">Reason for Study</span>
        {studyIntent && (
          <span className="exec-purpose-chip">
            {studyIntent.primary.toUpperCase()}
          </span>
        )}
        <span className="exec-section-bar-spacer" />
        <SectionChevronIcon
          className={`exec-section-chevron ${reasonExpanded ? 'exec-section-chevron--open' : 'exec-section-chevron--closed'}`}
        />
      </div>
      {reasonExpanded && (
        ehrIntegrationEnabled && expandedReason && expandedReason.primary.entries.length > 0 ? (
          <div className="exec-reason-expanded">
            {/* Primary entries */}
            {expandedReason.primary.entries.map((entry) => (
              <div key={entry.code} className="exec-reason-row">
                <span className="exec-reason-label">{entry.displayLabel}</span>
                <span className="exec-reason-value" style={{ whiteSpace: 'pre-line' }}>
                  {entry.content.split('•').map((part, i) =>
                    i === 0 ? part : (
                      <span key={i}><span className="exec-reason-bullet">•</span>{part}</span>
                    ),
                  )}
                </span>
              </div>
            ))}
            {/* Clinical Indication (always last) */}
            {reasonForStudy && (
              <div className="exec-reason-row">
                <span className="exec-reason-label">Clinical Indication</span>
                <span className="exec-reason-value exec-reason-value--indication">{reasonForStudy}</span>
              </div>
            )}
            {/* Secondary block (if present) */}
            {expandedReason.secondary && expandedReason.secondary.entries.length > 0 && (
              <>
                <hr className="exec-reason-separator" />
                <div style={{ paddingBottom: 2 }}>
                  <span className="exec-purpose-chip">{expandedReason.secondary.purpose.toUpperCase()}</span>
                </div>
                {expandedReason.secondary.entries.map((entry) => (
                  <div key={entry.code} className="exec-reason-row">
                    <span className="exec-reason-label">{entry.displayLabel}</span>
                    <span className="exec-reason-value exec-reason-value--secondary">{entry.content}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          /* Fallback: simple clinical indication only */
          reasonForStudy ? (
            <div className="exec-reason-content">{reasonForStudy}</div>
          ) : null
        )
      )}

      {/* ── Relevant Findings Section ── */}
      <div
        className="exec-section-bar exec-section-bar--collapsible"
        onClick={toggleFindings}
      >
        <RadiologyIcon className="exec-section-bar-icon" />
        <span className="exec-section-bar-title">Relevant Findings</span>
        <span className="exec-section-bar-count exec-section-bar-count--purple">{moreRelevant.length + lessRelevant.length}</span>
        <span className="exec-section-bar-spacer" />
        <SectionChevronIcon
          className={`exec-section-chevron ${findingsExpanded ? 'exec-section-chevron--open' : 'exec-section-chevron--closed'}`}
        />
      </div>

      {findingsExpanded && (
      <div className="exec-body">
        {/* ── MORE RELEVANT (default expanded) ── */}
        {moreRelevant.length > 0 && (
          <div className="exec-category">
            <button
              className={`exec-category-header ${moreRelevantExpanded ? 'exec-category-header--expanded' : ''}`}
              onClick={() => setMoreRelevantExpanded((p) => !p)}
              onMouseEnter={(e) => !moreRelevantExpanded && handleSubtitleEnter('findings-more', e)}
              onMouseLeave={handleSubtitleLeave}
            >
              <span className="exec-region-chevron">{moreRelevantExpanded ? '▼' : '▶'}</span>
              <span className="exec-category-label">MORE RELEVANT</span>
              <span className="exec-region-count">{moreRelevant.length}</span>
            </button>

            {/* Hover preview when collapsed */}
            {!moreRelevantExpanded && hoveredSubtitle === 'findings-more' && (
              <div
                className="exec-subtitle-preview"
                style={{ position: 'fixed', left: subtitleCoordsRef.current.x + 16, top: subtitleCoordsRef.current.y - 8 }}
                onMouseEnter={(e) => handleSubtitleEnter('findings-more', e)}
                onMouseLeave={handleSubtitleLeave}
              >
                <ul className="exec-subtitle-preview-list">
                  {moreRelevant.map((f, i) => <li key={i}>{f.name}</li>)}
                </ul>
              </div>
            )}

            {moreRelevantExpanded && (
              <div className="exec-region-body">
                {moreRelevant.map((finding, fi) => {
                  const findingKey = `more-${fi}`;
                  const isPinned = pinnedFindings.has(findingKey);
                  const isHovered = hoveredFindings.has(findingKey);
                  const isOpen = isPinned || isHovered;
                  const hoverCoords = hoverCoordsRef.current.get(findingKey);
                  return (
                    <FindingRow
                      key={findingKey}
                      finding={finding}
                      isOpen={isOpen}
                      isPinned={isPinned}
                      hoverCoords={!isPinned && isHovered ? hoverCoords : undefined}
                      sentenceIndex={sentenceIndex}
                      onTogglePin={() => togglePin(findingKey)}
                      onMouseEnter={(e) => handleFindingHover(findingKey, e)}
                      onMouseLeave={() => handleFindingLeave(findingKey)}
                      onStudyClick={onStudyClick}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── LESS RELEVANT (default collapsed) ── */}
        {lessRelevant.length > 0 && (
          <div className="exec-category">
            <button
              className={`exec-category-header ${lessRelevantExpanded ? 'exec-category-header--expanded' : ''}`}
              onClick={() => setLessRelevantExpanded((p) => !p)}
              onMouseEnter={(e) => !lessRelevantExpanded && handleSubtitleEnter('findings-less', e)}
              onMouseLeave={handleSubtitleLeave}
            >
              <span className="exec-region-chevron">{lessRelevantExpanded ? '▼' : '▶'}</span>
              <span className="exec-category-label">LESS RELEVANT</span>
              <span className="exec-region-count">{lessRelevant.length}</span>
            </button>

            {/* Hover preview when collapsed */}
            {!lessRelevantExpanded && hoveredSubtitle === 'findings-less' && (
              <div
                className="exec-subtitle-preview"
                style={{ position: 'fixed', left: subtitleCoordsRef.current.x + 16, top: subtitleCoordsRef.current.y - 8 }}
                onMouseEnter={(e) => handleSubtitleEnter('findings-less', e)}
                onMouseLeave={handleSubtitleLeave}
              >
                <ul className="exec-subtitle-preview-list">
                  {lessRelevant.map((f, i) => <li key={i}>{f.name}</li>)}
                </ul>
              </div>
            )}

            {lessRelevantExpanded && (
              <div className="exec-region-body">
                {lessRelevant.map((finding, fi) => {
                  const findingKey = `less-${fi}`;
                  const isPinned = pinnedFindings.has(findingKey);
                  const isHovered = hoveredFindings.has(findingKey);
                  const isOpen = isPinned || isHovered;
                  const hoverCoords = hoverCoordsRef.current.get(findingKey);
                  return (
                    <FindingRow
                      key={findingKey}
                      finding={finding}
                      isOpen={isOpen}
                      isPinned={isPinned}
                      hoverCoords={!isPinned && isHovered ? hoverCoords : undefined}
                      sentenceIndex={sentenceIndex}
                      onTogglePin={() => togglePin(findingKey)}
                      onMouseEnter={(e) => handleFindingHover(findingKey, e)}
                      onMouseLeave={() => handleFindingLeave(findingKey)}
                      onStudyClick={onStudyClick}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── Relevant Problems (EHR-only) — OUTSIDE the findings body ── */}
      {ehrIntegrationEnabled && (moreRelevantProblems.length > 0 || lessRelevantProblems.length > 0) && (
        <>
          <div
            className="exec-section-bar exec-section-bar--problems exec-section-bar--collapsible"
            onClick={toggleProblems}
          >
            <ProblemsIcon className="exec-section-bar-icon" />
            <span className="exec-section-bar-title">Relevant Problems</span>
            <span className="exec-section-bar-count exec-section-bar-count--purple">{moreRelevantProblems.length + lessRelevantProblems.length}</span>
            <span className="exec-section-bar-spacer" />
            <SectionChevronIcon
              className={`exec-section-chevron ${problemsExpanded ? 'exec-section-chevron--open' : 'exec-section-chevron--closed'}`}
            />
          </div>

          {problemsExpanded && (
          <div className="exec-body">
            {/* MORE RELEVANT problems */}
            {moreRelevantProblems.length > 0 && (
              <div className="exec-category">
                <button
                  className={`exec-category-header ${moreProblemsExpanded ? 'exec-category-header--expanded' : ''}`}
                  onClick={() => setMoreProblemsExpanded((v) => !v)}
                  onMouseEnter={(e) => !moreProblemsExpanded && handleSubtitleEnter('problems-more', e)}
                  onMouseLeave={handleSubtitleLeave}
                >
                  <span className="exec-region-chevron">{moreProblemsExpanded ? '▼' : '▶'}</span>
                  <span className="exec-category-label">MORE RELEVANT</span>
                  <span className="exec-region-count">{moreRelevantProblems.length}</span>
                </button>

                {/* Hover preview when collapsed */}
                {!moreProblemsExpanded && hoveredSubtitle === 'problems-more' && (
                  <div
                    className="exec-subtitle-preview"
                    style={{ position: 'fixed', left: subtitleCoordsRef.current.x + 16, top: subtitleCoordsRef.current.y - 8 }}
                    onMouseEnter={(e) => handleSubtitleEnter('problems-more', e)}
                    onMouseLeave={handleSubtitleLeave}
                  >
                    <ul className="exec-subtitle-preview-list">
                      {moreRelevantProblems.map((p, i) => <li key={i}>{sentenceCase(p.name)}</li>)}
                    </ul>
                  </div>
                )}
                {moreProblemsExpanded && (
                  <div className="exec-region-body">
                    {moreRelevantProblems.map((problem) => {
                      const problemKey = `problem-${problem.name}`;
                      const isHovered = hoveredFindings.has(problemKey);
                      const isPinned = pinnedFindings.has(problemKey);
                      const isOpen = isPinned || isHovered;
                      const hoverCoords = hoverCoordsRef.current.get(problemKey);
                      return (
                        <ProblemRow
                          key={problemKey}
                          problem={problem}
                          isOpen={isOpen}
                          isPinned={isPinned}
                          hoverCoords={!isPinned && isHovered ? hoverCoords : undefined}
                          noteSentenceIndex={noteSentenceIndex}
                          noteRelevanceMap={noteRelevanceMap}
                          onTogglePin={() => togglePin(problemKey)}
                          onMouseEnter={(e) => handleFindingHover(problemKey, e)}
                          onMouseLeave={() => handleFindingLeave(problemKey)}
                          onStudyClick={onStudyClick}
                          onNoteClick={selectNote}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* LESS RELEVANT problems */}
            {lessRelevantProblems.length > 0 && (
              <div className="exec-category">
                <button
                  className={`exec-category-header ${lessProblemsExpanded ? 'exec-category-header--expanded' : ''}`}
                  onClick={() => setLessProblemsExpanded((v) => !v)}
                  onMouseEnter={(e) => !lessProblemsExpanded && handleSubtitleEnter('problems-less', e)}
                  onMouseLeave={handleSubtitleLeave}
                >
                  <span className="exec-region-chevron">{lessProblemsExpanded ? '▼' : '▶'}</span>
                  <span className="exec-category-label">LESS RELEVANT</span>
                  <span className="exec-region-count">{lessRelevantProblems.length}</span>
                </button>

                {/* Hover preview when collapsed */}
                {!lessProblemsExpanded && hoveredSubtitle === 'problems-less' && (
                  <div
                    className="exec-subtitle-preview"
                    style={{ position: 'fixed', left: subtitleCoordsRef.current.x + 16, top: subtitleCoordsRef.current.y - 8 }}
                    onMouseEnter={(e) => handleSubtitleEnter('problems-less', e)}
                    onMouseLeave={handleSubtitleLeave}
                  >
                    <ul className="exec-subtitle-preview-list">
                      {lessRelevantProblems.map((p, i) => <li key={i}>{sentenceCase(p.name)}</li>)}
                    </ul>
                  </div>
                )}
                {lessProblemsExpanded && (
                  <div className="exec-region-body">
                    {lessRelevantProblems.map((problem) => {
                      const problemKey = `problem-${problem.name}`;
                      const isHovered = hoveredFindings.has(problemKey);
                      const isPinned = pinnedFindings.has(problemKey);
                      const isOpen = isPinned || isHovered;
                      const hoverCoords = hoverCoordsRef.current.get(problemKey);
                      return (
                        <ProblemRow
                          key={problemKey}
                          problem={problem}
                          isOpen={isOpen}
                          isPinned={isPinned}
                          hoverCoords={!isPinned && isHovered ? hoverCoords : undefined}
                          noteSentenceIndex={noteSentenceIndex}
                          noteRelevanceMap={noteRelevanceMap}
                          onTogglePin={() => togglePin(problemKey)}
                          onMouseEnter={(e) => handleFindingHover(problemKey, e)}
                          onMouseLeave={() => handleFindingLeave(problemKey)}
                          onStudyClick={onStudyClick}
                          onNoteClick={selectNote}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </>
      )}

      {/* ── Similar Prior Presentations (toggleable via footer) ── */}
      {state.showSimilarPresentations && summary.similarPriorPresentations.length > 0 && (
        <SimilarPresentationsSection
          presentations={summary.similarPriorPresentations}
          onStudyClick={onStudyClick}
        />
      )}

      {/* ── Open Recommendations (filtered) ── */}
      {filteredRecommendations.length > 0 && (
        <RecommendationsSection recommendations={filteredRecommendations} />
      )}
    </div>
  );
}

// ── Finding Row (Layer 1 + Layer 2) ────────────────────────────────────────

interface FindingRowProps {
  finding: ExecutiveFinding;
  isOpen: boolean;
  isPinned: boolean;
  /** Cursor coords for floating overlay placement (only set for hover-preview). */
  hoverCoords?: { x: number; y: number };
  /** Unified sentence index for resolving citation IDs to text */
  sentenceIndex: Map<string, SentenceSnippetIndex>;
  onTogglePin: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onStudyClick?: (accessionNumber: string) => void;
}

function FindingRow({
  finding,
  isOpen,
  isPinned,
  hoverCoords,
  sentenceIndex,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  onStudyClick,
}: FindingRowProps) {
  // For hover preview: position:fixed near the cursor
  const previewStyle: React.CSSProperties | undefined =
    !isPinned && isOpen && hoverCoords
      ? {
          position: 'fixed',
          left: hoverCoords.x + 20,
          top: hoverCoords.y,
          maxWidth: 420,
          maxHeight: '60vh',
          overflowY: 'auto',
        }
      : undefined;

  return (
    <div
      className={`exec-finding ${isOpen ? 'exec-finding--expanded' : ''} ${isPinned ? 'exec-finding--pinned' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Layer 1: Scan line — always visible */}
      <button className="exec-finding-header" onClick={onTogglePin}>
        <span className="exec-finding-chevron">
          {isPinned ? '▾' : isOpen ? '▿' : '▸'}
        </span>
        <span className="exec-finding-name">{finding.name}</span>
        <div className="exec-finding-chips">
          {finding.chips.map((chip) => {
            const style = CHIP_STYLES[chip] ?? DEFAULT_CHIP;
            return (
              <span
                key={chip}
                className="exec-chip"
                style={{ background: style.bg, color: style.color }}
              >
                {chip}
              </span>
            );
          })}
        </div>
        <span className="exec-finding-entry-count">{finding.studyEntries.length}</span>
      </button>

      {/* Layer 2: Study entries — visible on hover or pin */}
      {isOpen && (
        <div
          className={`exec-finding-entries ${isPinned ? 'exec-finding-entries--pinned' : 'exec-finding-entries--preview'}`}
          style={previewStyle}
        >
          <CitationProvenanceView
            entries={finding.studyEntries}
            sentenceIndex={sentenceIndex}
            onStudyClick={onStudyClick}
          />
        </div>
      )}
    </div>
  );
}

// ── Citation Provenance View ───────────────────────────────────────────────

/**
 * Citation-based provenance display for finding study entries.
 *
 * Groups entries by study (accessionNumber), then for each study shows:
 *   1. Clickable study chip (study name + date)
 *   2. Alphabetized finding names with purple superscript citation numbers
 *   3. Numbered source snippets resolved from sourceSentenceIds
 *
 * Falls back to sourceExcerpt display when sentence IDs are unavailable.
 */
function CitationProvenanceView({
  entries,
  sentenceIndex,
  onStudyClick,
}: {
  entries: SummaryStudyEntry[];
  sentenceIndex: Map<string, SentenceSnippetIndex>;
  onStudyClick?: (accessionNumber: string) => void;
}) {
  // Group entries by study (accessionNumber)
  const studyGroups = new Map<string, SummaryStudyEntry[]>();
  for (const entry of entries) {
    const key = entry.accessionNumber;
    if (!studyGroups.has(key)) studyGroups.set(key, []);
    studyGroups.get(key)!.push(entry);
  }

  return (
    <>
      {Array.from(studyGroups.entries()).map(([accession, studyEntries]) => {
        const firstEntry = studyEntries[0];

        // Collect all unique sentence IDs across entries for this study
        const allSentenceIds: string[] = [];
        for (const entry of studyEntries) {
          for (const sid of entry.sourceSentenceIds) {
            if (!allSentenceIds.includes(sid)) allSentenceIds.push(sid);
          }
        }
        // Sort by sentence ID for consistent ordering (reflects report appearance)
        allSentenceIds.sort();

        // Build citation number lookup: sentenceId → 1-based index
        const citationMap = new Map<string, number>();
        allSentenceIds.forEach((sid, i) => citationMap.set(sid, i + 1));

        // Build finding → citation numbers mapping
        const findingCitations: { name: string; citations: number[]; measurement: string | null; changeStatement: string | null }[] = [];
        for (const entry of studyEntries) {
          const citations = entry.sourceSentenceIds
            .map((sid) => citationMap.get(sid))
            .filter((n): n is number => n !== undefined)
            .sort((a, b) => a - b);
          findingCitations.push({
            name: entry.findingName,
            citations,
            measurement: entry.measurement,
            changeStatement: entry.changeStatement,
          });
        }
        // Alphabetize finding names
        findingCitations.sort((a, b) => a.name.localeCompare(b.name));

        // Resolve sentence snippets
        const resolvedSnippets = allSentenceIds
          .map((sid) => {
            const snippet = sentenceIndex.get(sid);
            return snippet ? { num: citationMap.get(sid)!, text: snippet.text } : null;
          })
          .filter((s): s is { num: number; text: string } => s !== null);

        // Determine if we have citation data or need fallback
        const hasCitations = resolvedSnippets.length > 0;

        return (
          <div key={accession} className="exec-entry exec-entry--consolidated">
            {/* Study chip — once per source study */}
            <button
              className="exec-entry-study-chip"
              onClick={() => onStudyClick?.(accession)}
              title={`Open report: ${firstEntry.studyName} — ${accession}`}
              aria-label={`Open prior report for ${firstEntry.studyName} (${firstEntry.studyDate})`}
            >
              {firstEntry.studyName} ({firstEntry.studyDate})
            </button>

            {/* Finding names with citation superscripts */}
            <ul className="exec-entry-finding-names">
              {findingCitations.map((fc, fi) => (
                <li key={fi}>
                  {fc.name}
                  {fc.citations.length > 0 && (
                    <sup className="exec-citation-sup">{fc.citations.join(',')}</sup>
                  )}
                  {fc.measurement && (
                    <span className="exec-entry-measurement-inline"> — 📏 {fc.measurement}</span>
                  )}
                </li>
              ))}
            </ul>

            {/* Numbered source snippets */}
            {hasCitations ? (
              <ol className="exec-citation-list">
                {resolvedSnippets.map((snippet) => (
                  <li key={snippet.num} value={snippet.num}>
                    {capitalizeFirst(snippet.text)}
                  </li>
                ))}
              </ol>
            ) : (
              /* Fallback: show sourceExcerpt when no sentence IDs available */
              studyEntries.map((entry, ei) =>
                entry.sourceExcerpt ? (
                  <p key={ei} className="exec-entry-excerpt">{capitalizeFirst(entry.sourceExcerpt)}</p>
                ) : null
              )
            )}

            {/* Change statements (non-redundant) */}
            {studyEntries.map((entry, ei) => {
              if (!entry.changeStatement) return null;
              // Suppress if substantially contained in any resolved snippet
              const isRedundant = resolvedSnippets.some((s) => isContainedIn(entry.changeStatement!, s.text));
              if (isRedundant) return null;
              return (
                <div key={`chg-${ei}`} className="exec-entry-trend">
                  <span className="exec-entry-trend-chip">Trend</span>
                  <span className="exec-entry-trend-text">{capitalizeFirst(entry.changeStatement)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// ── Problem Row (mirrors FindingRow hover/pin pattern) ─────────────────────

type EnrichedProblem = ProblemGroupEntry & { isNew: boolean };

interface ProblemRowProps {
  problem: EnrichedProblem;
  isOpen: boolean;
  isPinned: boolean;
  hoverCoords?: { x: number; y: number };
  noteSentenceIndex: Map<string, SentenceSnippetIndex>;
  noteRelevanceMap: Map<string, NoteRelevanceResult>;
  onTogglePin: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onStudyClick?: (accessionNumber: string) => void;
  onNoteClick?: (noteId: string) => void;
}

function ProblemRow({
  problem,
  isOpen,
  isPinned,
  hoverCoords,
  noteSentenceIndex,
  noteRelevanceMap,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  onStudyClick,
  onNoteClick,
}: ProblemRowProps) {
  const previewStyle: React.CSSProperties | undefined =
    !isPinned && isOpen && hoverCoords
      ? {
          position: 'fixed',
          left: hoverCoords.x + 20,
          top: hoverCoords.y,
          maxWidth: 420,
          maxHeight: '60vh',
          overflowY: 'auto',
        }
      : undefined;

  return (
    <div
      className={`exec-finding ${isOpen ? 'exec-finding--expanded' : ''} ${isPinned ? 'exec-finding--pinned' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Layer 1: Scan line — always visible */}
      <button className="exec-finding-header" onClick={onTogglePin}>
        <span className="exec-finding-chevron">
          {isPinned ? '▾' : isOpen ? '▿' : '▸'}
        </span>
        <span className="exec-finding-name">{sentenceCase(problem.name)}</span>
        <div className="exec-finding-chips">
          {problem.score >= 8 && (
            <span className="exec-chip" style={{ background: IMPORTANT_CHIP.bg, color: IMPORTANT_CHIP.color }}>
              CRITICAL
            </span>
          )}
          {problem.isNew && (
            <span className="exec-chip" style={{ background: IMPORTANT_CHIP.bg, color: IMPORTANT_CHIP.color }}>
              NEW
            </span>
          )}
          {problem.isGroup && (
            <span className="exec-chip" style={{ background: ROUTINE_CHIP.bg, color: ROUTINE_CHIP.color }}>
              {problem.memberIds.length}
            </span>
          )}
        </div>
      </button>

      {/* Layer 2: Problem provenance — visible on hover or pin */}
      {isOpen && (
        <div
          className={`exec-finding-entries ${isPinned ? 'exec-finding-entries--pinned' : 'exec-finding-entries--preview'}`}
          style={previewStyle}
        >
          <ProblemProvenanceView
            problem={problem}
            noteSentenceIndex={noteSentenceIndex}
            noteRelevanceMap={noteRelevanceMap}
            onNoteClick={onNoteClick}
          />
        </div>
      )}
    </div>
  );
}

// ── Problem Provenance View ────────────────────────────────────────────────

/**
 * Citation-based provenance display for problem entries.
 *
 * Structure:
 *   1. Bulleted member names with purple superscript citation numbers (grouped only)
 *   2. Clickable note chips (ordered by note relevancy score)
 *      - Gold star chip on ordering provider's note
 *   3. Numbered source snippets under each note chip
 *      - Global numbering continues across note boundaries
 */
function ProblemProvenanceView({
  problem,
  noteSentenceIndex,
  noteRelevanceMap,
  onNoteClick,
}: {
  problem: EnrichedProblem;
  noteSentenceIndex: Map<string, SentenceSnippetIndex>;
  noteRelevanceMap: Map<string, NoteRelevanceResult>;
  onNoteClick?: (noteId: string) => void;
}) {
  const members = problem.members ?? [];

  // Collect ALL unique sentence IDs across all members
  const allSentenceIds: string[] = [];
  for (const member of members) {
    for (const sid of member.sentenceIds) {
      if (!allSentenceIds.includes(sid)) allSentenceIds.push(sid);
    }
  }
  // Fallback to aggregated sentenceSources if no per-member data
  if (allSentenceIds.length === 0 && problem.sentenceSources) {
    for (const sid of problem.sentenceSources) {
      if (!allSentenceIds.includes(sid)) allSentenceIds.push(sid);
    }
  }

  // Resolve all sentence IDs to their snippet objects
  const resolvedSnippets = allSentenceIds
    .map((sid) => noteSentenceIndex.get(sid))
    .filter((s): s is SentenceSnippetIndex => s !== undefined);

  // Group snippets by noteId
  const noteGroups = new Map<string, SentenceSnippetIndex[]>();
  for (const snippet of resolvedSnippets) {
    if (!noteGroups.has(snippet.noteId)) noteGroups.set(snippet.noteId, []);
    noteGroups.get(snippet.noteId)!.push(snippet);
  }

  // Sort notes by relevance score (descending)
  const sortedNoteIds = [...noteGroups.keys()].sort((a, b) => {
    const aScore = noteRelevanceMap.get(a)?.normalizedPercent ?? 0;
    const bScore = noteRelevanceMap.get(b)?.normalizedPercent ?? 0;
    return bScore - aScore;
  });

  // Sort snippets within each note by ID (preserves appearance order)
  for (const snippets of noteGroups.values()) {
    snippets.sort((a, b) => a.id.localeCompare(b.id));
  }

  // Assign global citation numbers (continuous across note boundaries)
  let globalCitationNum = 1;
  const citationMap = new Map<string, number>();
  for (const noteId of sortedNoteIds) {
    const snippets = noteGroups.get(noteId)!;
    for (const s of snippets) {
      if (!citationMap.has(s.id)) {
        citationMap.set(s.id, globalCitationNum++);
      }
    }
  }

  // Build per-member citation numbers
  const memberCitations = members.map((member) => ({
    ...member,
    citations: member.sentenceIds
      .map((sid) => citationMap.get(sid))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b),
  }));

  return (
    <>
      {/* Bulleted member list (only for grouped problems) */}
      {problem.isGroup && memberCitations.length > 0 && (
        <ul className="exec-entry-finding-names">
          {memberCitations.map((mc, mi) => (
            <li key={mi}>
              {sentenceCase(mc.name)}
              {mc.citations.length > 0 && (
                <sup className="exec-citation-sup">{mc.citations.join(',')}</sup>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Note chips + numbered snippets */}
      {sortedNoteIds.map((noteId) => {
        const noteSnippets = noteGroups.get(noteId)!;
        const firstSnippet = noteSnippets[0];
        const relevance = noteRelevanceMap.get(noteId);
        const isOrderingProvider = relevance?.isOrderingProvider ?? false;

        return (
          <div key={noteId} className="exec-entry exec-entry--consolidated">
            {/* Note chip */}
            <div className="exec-note-chip-row">
              <button
                className="exec-entry-study-chip"
                onClick={() => onNoteClick?.(noteId)}
                title={`Open note: ${firstSnippet.noteTitle}`}
              >
                {firstSnippet.noteTitle}
              </button>
              {isOrderingProvider && (
                <span className="exec-ordering-star" title="Ordering provider's note">★</span>
              )}
            </div>

            {/* Numbered source snippets */}
            <ol className="exec-citation-list">
              {noteSnippets.map((snippet) => {
                const num = citationMap.get(snippet.id)!;
                return (
                  <li key={snippet.id} value={num}>
                    {capitalizeFirst(snippet.text)}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      {/* Fallback: no citation data */}
      {sortedNoteIds.length === 0 && !problem.isGroup && (
        <p className="exec-entry-excerpt" style={{ opacity: 0.6, fontStyle: 'italic' }}>
          No source citations available
        </p>
      )}
    </>
  );
}

// ── Text Utilities ─────────────────────────────────────────────────────────

/**
 * Capitalize the first character of a string.
 * Handles edge cases (empty, already capitalized).
 */
function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Sentence-case a string: first letter uppercase, rest lowercase.
 * Used for normalizing problem names from EHR/LLM sources.
 */
function sentenceCase(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Word containment ratio: checks if the words in `needle` are
 * substantially contained within `haystack`.
 *
 * Returns true if ≥80% of needle's words appear in haystack.
 * Handles word reordering (e.g., "new 6 mm shift" vs "6 mm new shift").
 *
 * Used to suppress redundant changeStatements when they're already
 * expressed within the sourceExcerpt.
 */
function isContainedIn(needle: string, haystack: string): boolean {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // strip punctuation
        .split(/\s+/)
        .filter(Boolean),
    );

  const needleWords = tokenize(needle);
  const haystackWords = tokenize(haystack);

  if (needleWords.size === 0) return true;

  let matchCount = 0;
  for (const word of needleWords) {
    if (haystackWords.has(word)) matchCount++;
  }

  return matchCount / needleWords.size >= 0.80;
}

// ── Similar Prior Presentations ────────────────────────────────────────────

function SimilarPresentationsSection({
  presentations,
  onStudyClick,
}: {
  presentations: SimilarPresentation[];
  onStudyClick?: (accessionNumber: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        className="exec-section-bar exec-section-bar--collapsible"
        onClick={() => setExpanded((p) => !p)}
      >
        <SearchIcon className="exec-section-bar-icon" />
        <span className="exec-section-bar-title">Similar Prior Presentations</span>
        <span className="exec-section-bar-count exec-section-bar-count--purple">{presentations.length}</span>
        <span className="exec-section-bar-spacer" />
        <SectionChevronIcon
          className={`exec-section-chevron ${expanded ? 'exec-section-chevron--open' : 'exec-section-chevron--closed'}`}
        />
      </div>
      {expanded && (
      <div className="exec-section-body">
        {presentations.map((p, i) => (
          <div key={i} className="exec-presentation">
            <button
              className="exec-entry-study-chip"
              onClick={(e) => { e.stopPropagation(); onStudyClick?.(p.accessionNumber); }}
              title={`Open report: ${p.studyName} — ${p.accessionNumber}`}
              aria-label={`Open prior report for ${p.studyName} (${p.studyDate})`}
            >
              {p.studyName} ({p.studyDate})
            </button>
            <div className="exec-presentation-indication">
              "{p.priorPresentation}"
            </div>
            <div className="exec-presentation-findings">
              Key findings: {p.keyFindings.join(', ')}
            </div>
          </div>
        ))}
      </div>
      )}
    </>
  );
}

// ── Open Recommendations (filtered: no fulfilled, no untitled) ────────────

function RecommendationsSection({ recommendations }: { recommendations: OpenRecommendation[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      <div
        className="exec-section-bar exec-section-bar--collapsible"
        onClick={() => setExpanded((p) => !p)}
      >
        <CheckboxIcon className="exec-section-bar-icon" />
        <span className="exec-section-bar-title">Open Recommendations</span>
        <span className="exec-section-bar-count exec-section-bar-count--purple">{recommendations.length}</span>
        <span className="exec-section-bar-spacer" />
        <SectionChevronIcon
          className={`exec-section-chevron ${expanded ? 'exec-section-chevron--open' : 'exec-section-chevron--closed'}`}
        />
      </div>
      {expanded && (
      <div className="exec-section-body">
        {recommendations.map((rec, i) => (
          <div key={i} className="exec-recommendation">
            <div className="exec-rec-header">
              <HourglassIcon className="exec-rec-status-icon" />
              <span className="exec-rec-action" style={{ color: 'rgba(255, 255, 255, 0.92)' }}>
                {capitalize(rec.action)}
              </span>
            </div>
            <div className="exec-rec-meta">
              From: {rec.sourceStudyName} · {rec.findingContext}
              {rec.timeframe && ` · ${rec.timeframe}`}
            </div>
          </div>
        ))}
      </div>
      )}
    </>
  );
}
