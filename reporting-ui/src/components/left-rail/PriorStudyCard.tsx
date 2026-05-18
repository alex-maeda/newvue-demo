/**
 * PriorStudyCard — Card for each prior study in the timeline.
 *
 * Layout:
 *   Row 1: Label chips — [Modality] [Region…] [Angio] [Laterality]
 *   Row 2: Date + relative age
 *   Row 3: Study description
 *   Row 4: (optional) "Relevant" chip + "Analyzed" indicator
 *
 * All chips are clickable — clicking toggles the corresponding filter facet.
 * Active filter facets are highlighted with the NewVue purple.
 *
 * Card click → selects this prior for compare view.
 * The "Analyzed" chip is a visual indicator that the report was summarized by AI.
 */

import { useCallback } from 'react';
import './PriorStudyCard.css';
import type { Study, RelevanceResult, ExtractedFinding } from '../../types/api';
import { getModalityStyle } from '../../utils/modality';
import { formatDisplayDate, relativeAge } from '../../utils/dates';
import { useCockpit } from '../../context/CockpitContext';



interface PriorStudyCardProps {
  study: Study;
  index: number;
  referenceDateTime: string;
  /**
   * Pre-computed relevance result from the server scoring engine.
   * When null, the study has not been scored (no current exam selected).
   */
  relevanceResult: RelevanceResult | null;
  /**
   * Extracted findings from the individual report summarization (Tier 1).
   * When null/undefined, the "Summary" button is not shown even if relevant.
   */
  findings?: ExtractedFinding[] | null;
}

export function PriorStudyCard({
  study,
  index,
  referenceDateTime,
  relevanceResult,
  findings,
}: PriorStudyCardProps) {
  const { state, selectPrior, clearPrior, toggleFilterFacet, setSortByRelevancy } = useCockpit();

  // Derive relevance flag and display percentage from the server-computed result
  const isRelevant = relevanceResult?.isRelevant ?? false;
  const scorePercent = relevanceResult
    ? Math.round(relevanceResult.percentage * 100)
    : null;

  // Use the labeled modality from the server pipeline
  const modality = study.labels?.modality ?? 'NA';
  const isSelected = state.selectedPriorIndex === index;

  const hasSummary = Boolean(findings && findings.length > 0);

  // Extract label data
  const bodyRegions = study.labels?.bodyRegions ?? [];
  const isAngiographic = study.labels?.isAngiographic ?? false;
  const laterality = study.labels?.laterality ?? null;
  const displayLaterality = laterality
    ? laterality.charAt(0).toUpperCase() + laterality.slice(1)
    : null;

  // ── Active-state checks ────────────────────────────────────────────────
  const filter = state.activeFilter;

  const isModalityActive = filter?.modality === modality;

  const isRegionActive = (region: string) =>
    filter?.regions?.includes(region) ?? false;

  const isAngioActive = filter?.angiographic === true;

  const isLateralityActive = displayLaterality
    ? filter?.laterality === displayLaterality
    : false;

  const isRelevantActive = filter?.relevantOnly === true;
  const isSortByRelevancy = state.sortByRelevancy;



  const handleCardClick = useCallback(() => {
    if (state.selectedPriorIndex === index) {
      clearPrior();
    } else {
      selectPrior(index);
    }
  }, [selectPrior, clearPrior, index, state.selectedPriorIndex]);

  // ── Chip click handlers ────────────────────────────────────────────────

  const handleModalityClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleFilterFacet('modality', modality);
    },
    [toggleFilterFacet, modality],
  );

  const handleRegionClick = useCallback(
    (e: React.MouseEvent, region: string) => {
      e.stopPropagation();
      toggleFilterFacet('region', region);
    },
    [toggleFilterFacet],
  );

  const handleAngioClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleFilterFacet('angiographic');
    },
    [toggleFilterFacet],
  );

  const handleLateralityClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (displayLaterality) {
        toggleFilterFacet('laterality', displayLaterality);
      }
    },
    [toggleFilterFacet, displayLaterality],
  );

  /**
   * Relevant chip click — progressive deactivation:
   *   • If BOTH relevantOnly + sortByRelevancy are active → clear both
   *   • Otherwise → toggle relevantOnly normally
   */
  const handleRelevantClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isRelevantActive && isSortByRelevancy) {
        // Both active → clear both
        toggleFilterFacet('relevantOnly');
        setSortByRelevancy(false);
      } else {
        toggleFilterFacet('relevantOnly');
      }
    },
    [toggleFilterFacet, setSortByRelevancy, isRelevantActive, isSortByRelevancy],
  );

  /**
   * Score chip click — progressive activation/deactivation:
   *   • If BOTH relevantOnly + sortByRelevancy are active → clear both
   *   • If relevantOnly is active but sort is not → ADD sort
   *   • If neither is active → activate both
   */
  const handleScoreChipClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isRelevantActive && isSortByRelevancy) {
        // Both active → clear both
        toggleFilterFacet('relevantOnly');
        setSortByRelevancy(false);
      } else if (isRelevantActive) {
        // Filter is on, sort is off → add sort
        setSortByRelevancy(true);
      } else {
        // Neither active → activate both
        toggleFilterFacet('relevantOnly');
        setSortByRelevancy(true);
      }
    },
    [toggleFilterFacet, setSortByRelevancy, isRelevantActive, isSortByRelevancy],
  );

  // Whether to render the bottom row at all
  const showBottomRow = isRelevant;

  return (
    <div
      className={`prior-study-card ${isSelected ? 'selected' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(); }}
    >
      {/* ── Card Body ── */}
      <div className="psc-body">
        {/* Row 1: All label chips */}
        <div className="psc-chip-row">
          {/* Modality chip */}
          <button
            className={`psc-modality-chip ${isModalityActive ? 'active' : ''}`}
            onClick={handleModalityClick}
            title={`Filter by ${modality}`}
            aria-label={`Filter by modality ${modality}`}
          >
            {modality}
          </button>

          {/* Body region chips */}
          {bodyRegions.map((region) => (
            <button
              key={region}
              className={`psc-label-chip ${isRegionActive(region) ? 'active' : ''}`}
              onClick={(e) => handleRegionClick(e, region)}
              title={`Filter by ${region}`}
              aria-label={`Filter by region ${region}`}
            >
              {region}
            </button>
          ))}

          {/* Angiographic chip */}
          {isAngiographic && (
            <button
              className={`psc-label-chip ${isAngioActive ? 'active' : ''}`}
              onClick={handleAngioClick}
              title="Filter angiographic studies"
              aria-label="Filter angiographic studies"
            >
              Angio
            </button>
          )}

          {/* Laterality chip */}
          {displayLaterality && (
            <button
              className={`psc-label-chip ${isLateralityActive ? 'active' : ''}`}
              onClick={handleLateralityClick}
              title={`Filter by ${displayLaterality}`}
              aria-label={`Filter by laterality ${displayLaterality}`}
            >
              {displayLaterality}
            </button>
          )}
        </div>

        {/* Row 2: Date + relative age */}
        <div className="psc-date-row">
          <span className="psc-date">{formatDisplayDate(study.studyDateTime)}</span>
          <span className="psc-age">{relativeAge(study.studyDateTime, referenceDateTime)}</span>
        </div>

        {/* Row 3: Study description */}
        <div className="psc-title">{study.studyDescription}</div>
      </div>

      {/* ── Bottom Row (only for relevant studies) ── */}
      {showBottomRow && (
        <div className="psc-bottom-row">
          <div className="psc-bottom-chips">
            {/* Relevant chip — clickable to filter */}
            <button
              className={`psc-relevant-chip ${isRelevantActive ? 'active' : ''}`}
              onClick={handleRelevantClick}
              title="Show only relevant studies"
              aria-label="Filter to show only relevant studies"
            >
              Relevant
            </button>

            {/* Score % chip — contiguous with Relevant, toggles filter+sort */}
            {scorePercent !== null && (
              <button
                className={`psc-score-chip ${isSortByRelevancy && isRelevantActive ? 'active' : ''}`}
                onClick={handleScoreChipClick}
                title={`Relevance: ${scorePercent}% — click to filter + sort by relevance`}
                aria-label={`Relevance score ${scorePercent}%, click to sort by relevance`}
              >
                {scorePercent}%
              </button>
            )}

            {/* Analyzed indicator — shown when AI summarization has been run */}
            {hasSummary && (
              <span
                className="psc-summary-btn"
                title="This report has been analyzed by AI"
                aria-label="Report analyzed by AI"
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
