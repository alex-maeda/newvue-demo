/**
 * ReportSummary — Micro executive summary for an individual prior report.
 *
 * Renders above the full report text in the main stage. Design mirrors the
 * executive summary: subsection-grouped findings with hover-to-preview,
 * click-to-pin interaction, importance scoring, inline chips, and a
 * recommendations footer.
 *
 * Key differences from the executive summary:
 *   - Groups by reportSubsection (e.g., "LUNGS") instead of bodySubregion
 *   - Shows sourceExcerpt in detail view instead of study entries
 *   - Shows comparison study chips instead of multi-study timeline
 *   - Scoped to a single report (no cross-report aggregation)
 *   - No state persistence (resets when report is closed/reopened)
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import './ReportSummary.css';
import { SparkleIcon, CheckboxIcon } from '../icons/SummaryIcons';
import type {
  PriorReportAnalysis,
  ExtractedFinding,
  Study,
} from '../../types/api';
import { computeFindingScore, buildFindingChips } from '../../utils/finding-importance';
import { resolveComparisonStudy } from '../../utils/comparison-resolver';
import { formatDisplayDate } from '../../utils/dates';

/** Capitalize the first letter of a string */
function ucFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Chip color mapping — 2-tier visual priority system.
 *
 * "Important" (teal): CRITICAL, PROGRESSING, NEW — clinically actionable
 * "Routine" (muted purple): everything else — tracked but not attention-grabbing
 *
 * Routine chips match the Relevancy Score chips in the left-rail prior
 * study cards for visual consistency across the application.
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
  ACTIONABLE:  ROUTINE_CHIP,
  INCIDENTAL:  ROUTINE_CHIP,
};
const DEFAULT_CHIP = ROUTINE_CHIP;

interface ReportSummaryProps {
  analysis: PriorReportAnalysis;
  /** All patient studies — needed for comparison study resolution */
  allStudies: Study[];
  /** Called when a comparison study chip is clicked */
  onStudyClick?: (accessionNumber: string) => void;
}

/** Group findings by reportSubsection, preserving report order */
interface SubsectionGroup {
  name: string;
  findings: ExtractedFinding[];
}

function groupBySubsection(findings: ExtractedFinding[]): SubsectionGroup[] {
  const groups: SubsectionGroup[] = [];
  const seen = new Map<string, SubsectionGroup>();

  for (const f of findings) {
    const key = f.reportSubsection || 'Other';
    let group = seen.get(key);
    if (!group) {
      group = { name: key, findings: [] };
      seen.set(key, group);
      groups.push(group);
    }
    group.findings.push(f);
  }

  return groups;
}

/** Sort findings within a group by importance score descending (stable) */
function sortByImportance(findings: ExtractedFinding[]): ExtractedFinding[] {
  const indexed = findings.map((f, i) => ({ finding: f, index: i }));
  indexed.sort((a, b) => {
    const diff = computeFindingScore(b.finding) - computeFindingScore(a.finding);
    return diff !== 0 ? diff : a.index - b.index;
  });
  return indexed.map((item) => item.finding);
}

export function ReportSummary({ analysis, allStudies, onStudyClick }: ReportSummaryProps) {
  // Group findings by reportSubsection, preserving report order
  const groups = useMemo(() => {
    const raw = groupBySubsection(analysis.findings);
    // Sort findings within each group by importance
    return raw.map((g) => ({
      ...g,
      findings: sortByImportance(g.findings),
    }));
  }, [analysis.findings]);

  const totalFindings = analysis.findings.length;

  // Subsection collapse state — all expanded by default, no persistence
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.name)),
  );

  // Reset expanded state when analysis changes
  useEffect(() => {
    setExpandedSections(new Set(groups.map((g) => g.name)));
  }, [analysis]);

  // Hover/pin state (same pattern as executive summary)
  const [pinnedFindings, setPinnedFindings] = useState<Set<string>>(new Set());
  const [hoveredFindings, setHoveredFindings] = useState<Set<string>>(new Set());
  const hoverTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const hoverCoordsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [, forceUpdate] = useState(0);

  const HOVER_EXPAND_MS = 25;
  const HOVER_COLLAPSE_MS = 30;

  const toggleSection = useCallback((name: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      hoverTimersRef.current.forEach((t) => clearTimeout(t));
      hoverTimersRef.current.clear();
    };
  }, []);

  // Collect all recommendations from findings
  const recommendations = useMemo(() => {
    return analysis.findings
      .filter((f) => f.recommendation && f.recommendation.action?.trim())
      .map((f) => ({
        action: f.recommendation!.action,
        timeframe: f.recommendation!.timeframe,
        guideline: f.recommendation!.guideline,
        findingName: f.name,
      }));
  }, [analysis.findings]);

  return (
    <div className="rpt-summary">
      {/* ── Header ── */}
      <div className="rpt-summary-header">
        <SparkleIcon className="rpt-summary-icon" />
        <span className="rpt-summary-title">AI Summary</span>
        <span className="rpt-summary-badge">AI</span>
        <span className="rpt-summary-meta">
          {groups.length} section{groups.length !== 1 ? 's' : ''} · {totalFindings} finding{totalFindings !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Subsection Groups ── */}
      <div className="rpt-summary-body">
        {groups.map((group) => {
          const isExpanded = expandedSections.has(group.name);
          return (
            <div key={group.name} className="rpt-section">
              <button
                className={`rpt-section-header ${isExpanded ? 'rpt-section-header--expanded' : ''}`}
                onClick={() => toggleSection(group.name)}
              >
                <span className="rpt-section-chevron">{isExpanded ? '▼' : '▶'}</span>
                <span className="rpt-section-name">{group.name}</span>
                <span className="rpt-section-count">{group.findings.length}</span>
              </button>

              {isExpanded && (
                <div className="rpt-section-body">
                  {group.findings.map((finding, fi) => {
                    const findingKey = `${group.name}-${fi}`;
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
                        onTogglePin={() => togglePin(findingKey)}
                        onMouseEnter={(e) => handleFindingHover(findingKey, e)}
                        onMouseLeave={() => handleFindingLeave(findingKey)}
                        allStudies={allStudies}
                        onStudyClick={onStudyClick}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Recommendations ── */}
        {recommendations.length > 0 && (
          <div className="rpt-recommendations">
            <div className="rpt-rec-header">
              <CheckboxIcon className="rpt-rec-icon" />
              <span className="rpt-rec-title">Recommendations</span>
              <span className="rpt-rec-count">{recommendations.length}</span>
            </div>
            <div className="rpt-rec-body">
              {recommendations.map((rec, i) => (
                <div key={i} className="rpt-rec-item">
                  <div className="rpt-rec-item-header">
                    <span className="rpt-rec-status">⏳</span>
                    <span className="rpt-rec-action">{rec.action}</span>
                  </div>
                  <div className="rpt-rec-meta">
                    {rec.findingName}
                    {rec.timeframe && ` · ${rec.timeframe}`}
                    {rec.guideline && ` · ${rec.guideline}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Finding Row ──────────────────────────────────────────────────────────────

interface FindingRowProps {
  finding: ExtractedFinding;
  isOpen: boolean;
  isPinned: boolean;
  hoverCoords?: { x: number; y: number };
  onTogglePin: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  allStudies: Study[];
  onStudyClick?: (accessionNumber: string) => void;
}

function FindingRow({
  finding,
  isOpen,
  isPinned,
  hoverCoords,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  allStudies,
  onStudyClick,
}: FindingRowProps) {
  const chips = buildFindingChips(finding);

  // Resolve comparison study reference
  const comparisonMatch = useMemo(() => {
    if (!finding.comparisonStudyReference) return null;
    return resolveComparisonStudy(finding.comparisonStudyReference, allStudies);
  }, [finding.comparisonStudyReference, allStudies]);

  // For hover preview: position:fixed near cursor
  const previewStyle: React.CSSProperties | undefined =
    !isPinned && isOpen && hoverCoords
      ? {
          position: 'fixed',
          left: hoverCoords.x + 20,
          top: hoverCoords.y,
        }
      : undefined;

  const hasDetail =
    finding.sourceExcerpt ||
    finding.measurements.length > 0 ||
    finding.changeStatement ||
    finding.comparisonStudyReference;

  return (
    <div
      className={`rpt-finding ${isOpen ? 'rpt-finding--expanded' : ''} ${isPinned ? 'rpt-finding--pinned' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Layer 1: Scan line — always visible */}
      <button className="rpt-finding-header" onClick={onTogglePin}>
        <span className="rpt-finding-chevron">
          {isPinned ? '▾' : isOpen ? '▿' : '▸'}
        </span>
        <span className="rpt-finding-name">{finding.name}</span>
        {chips.length > 0 && (
          <div className="rpt-finding-chips">
            {chips.map((chip) => {
              const style = CHIP_STYLES[chip] ?? DEFAULT_CHIP;
              return (
                <span
                  key={chip}
                  className="rpt-chip"
                  style={{ background: style.bg, color: style.color }}
                >
                  {chip}
                </span>
              );
            })}
          </div>
        )}
      </button>

      {/* Layer 2: Detail — visible on hover or pin */}
      {isOpen && hasDetail && (
        <div
          className={`rpt-finding-detail ${isPinned ? 'rpt-finding-detail--pinned' : 'rpt-finding-detail--preview'}`}
          style={previewStyle}
        >
          {/* Source excerpt */}
          {finding.sourceExcerpt && (
            <p className="rpt-source-excerpt">{ucFirst(finding.sourceExcerpt)}</p>
          )}

          {/* Measurements */}
          {finding.measurements.length > 0 && (
            <div className="rpt-measurements">
              {finding.measurements.map((m, mi) => (
                <div key={mi} className="rpt-measurement">
                  📏 {m.dimension}{m.location ? ` — ${m.location}` : ''}
                </div>
              ))}
            </div>
          )}

          {/* Change statement */}
          {finding.changeStatement && (
            <div className="rpt-change-statement">
              <span className="rpt-trend-chip">Trend</span>
              <span className="rpt-change-text">{ucFirst(finding.changeStatement)}</span>
            </div>
          )}

          {/* Comparison study reference */}
          {finding.comparisonStudyReference && (
            <div className="rpt-comparison">
              <span className="rpt-comparison-label-text">Compared to:</span>
              {comparisonMatch ? (
                <button
                  className={`rpt-comparison-chip ${comparisonMatch.confidence === 'low' ? 'rpt-comparison-chip--low' : ''}`}
                  onClick={() => onStudyClick?.(comparisonMatch.study.accessionNumber)}
                  title={`Open: ${comparisonMatch.study.studyDescription} — ${comparisonMatch.study.accessionNumber}${comparisonMatch.confidence === 'low' ? ' (approximate match)' : ''}`}
                  aria-label={`Open comparison study ${comparisonMatch.study.studyDescription}`}
                >
                  {comparisonMatch.study.studyDescription} ({formatDisplayDate(comparisonMatch.study.studyDateTime)})
                </button>
              ) : (
                <span className="rpt-comparison-text">{finding.comparisonStudyReference}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
