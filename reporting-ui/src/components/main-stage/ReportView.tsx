/**
 * ReportView — Reusable component that renders a study's report sections.
 *
 * Used in both single-pane (current report) and compare mode (both panes).
 * Renders structured sections if available, falls back to rawText.
 *
 * When a PriorReportAnalysis is provided (for summarized priors), renders
 * the report text with inline purple highlights on text snippets that were
 * cited as source material for extracted findings. Hovering a highlight
 * shows the associated finding names in a floating overlay.
 */

import { useMemo } from 'react';
import './ReportView.css';
import type { Study, PriorReportAnalysis } from '../../types/api';
import { parseModality, getModalityStyle } from '../../utils/modality';
import { formatDisplayDate } from '../../utils/dates';
import {
  buildSnippetFindingMap,
  buildHighlightSegments,
  findUnmatchedFindings,
} from '../../utils/snippet-highlighter';
import type { HighlightSegment, SnippetFindingMap } from '../../utils/snippet-highlighter';
import { HighlightedReportText, UnmatchedFindingsWarning } from './HighlightedReportText';

interface ReportViewProps {
  study: Study;
  /** Visual variant — 'current' uses the default surface, 'prior' uses the prior tint */
  variant?: 'current' | 'prior';
  /** Whether to show the study header (title, accession, date) */
  showHeader?: boolean;
  /** Structured analysis from the individual report summarization (Tier 1) */
  analysis?: PriorReportAnalysis | null;
  /** All patient studies — needed for comparison study resolution in the summary */
  allStudies?: Study[];
  /** Called when a comparison study chip is clicked in the summary */
  onStudyClick?: (accessionNumber: string) => void;
}

interface SectionDef {
  key: keyof Study['reportSections'];
  label: string;
  preWrap?: boolean;
}

const SECTIONS: SectionDef[] = [
  { key: 'clinicalIndication', label: 'Clinical Indication' },
  { key: 'technique', label: 'Technique' },
  { key: 'comparison', label: 'Comparison' },
  { key: 'findings', label: 'Findings', preWrap: true },
  { key: 'impression', label: 'Impression', preWrap: true },
];

export function ReportView({
  study,
  variant = 'current',
  showHeader = true,
  analysis,
}: ReportViewProps) {
  const modality = parseModality(study.studyDescription);
  const modalityStyle = getModalityStyle(modality);
  const hasStructuredSections = SECTIONS.some(
    (s) => study.reportSections[s.key] != null && study.reportSections[s.key] !== '',
  );

  // ── Build highlighting data when analysis is available ──
  const hasHighlighting = Boolean(
    analysis?.reportSentenceIndex && analysis.reportSentenceIndex.length > 0,
  );

  const snippetFindingMap: SnippetFindingMap = useMemo(() => {
    if (!analysis?.findings) return {};
    return buildSnippetFindingMap(analysis.findings);
  }, [analysis?.findings]);

  // Pre-compute highlight segments for each structured section
  const sectionSegments: Record<string, HighlightSegment[]> = useMemo(() => {
    if (!hasHighlighting || !analysis?.reportSentenceIndex) return {};

    const result: Record<string, HighlightSegment[]> = {};

    for (const section of SECTIONS) {
      const value = study.reportSections[section.key];
      if (value == null || value === '') continue;
      const text = typeof value === 'string' ? value : String(value);

      result[section.key] = buildHighlightSegments(
        text,
        section.key,
        analysis.reportSentenceIndex,
        snippetFindingMap,
      );
    }

    return result;
  }, [hasHighlighting, analysis?.reportSentenceIndex, snippetFindingMap, study.reportSections]);

  // Pre-compute segments for raw text fallback
  const rawTextSegments: HighlightSegment[] = useMemo(() => {
    if (!hasHighlighting || hasStructuredSections || !analysis?.reportSentenceIndex) return [];
    const rawText = study.reportSections.rawText.join('\n');
    return buildHighlightSegments(rawText, 'rawText', analysis.reportSentenceIndex, snippetFindingMap);
  }, [hasHighlighting, hasStructuredSections, analysis?.reportSentenceIndex, snippetFindingMap, study.reportSections.rawText]);

  // Collect all segment arrays for unmatched finding detection
  const allSegmentArrays = useMemo(() => {
    const arrays: HighlightSegment[][] = Object.values(sectionSegments);
    if (rawTextSegments.length > 0) arrays.push(rawTextSegments);
    return arrays;
  }, [sectionSegments, rawTextSegments]);

  const unmatchedFindings = useMemo(() => {
    if (!analysis?.findings || allSegmentArrays.length === 0) return [];
    return findUnmatchedFindings(analysis.findings, allSegmentArrays);
  }, [analysis?.findings, allSegmentArrays]);

  return (
    <div className={`report-view report-view--${variant}`}>
      {showHeader && (
        <div className="rv-header">
          <div className="rv-header-top">
            <span
              className="rv-modality-chip"
              style={{ background: modalityStyle.background, color: modalityStyle.color }}
            >
              {modality}
            </span>
            <span className="rv-study-title">{study.studyDescription}</span>
          </div>
          <div className="rv-meta">
            <span>{formatDisplayDate(study.studyDateTime)}</span>
            <span className="rv-meta-sep">·</span>
            <span>Acc {study.accessionNumber}</span>
          </div>
        </div>
      )}

      <div className="rv-sections">
        {hasStructuredSections ? (
          SECTIONS.map((section) => {
            const value = study.reportSections[section.key];
            if (value == null || value === '') return null;

            const segments = sectionSegments[section.key];
            const hasSegments = segments && segments.length > 0;

            return (
              <div key={section.key} className="rv-section">
                <div className="rv-section-label">{section.label}</div>
                <div className="rv-section-text">
                  {hasHighlighting && hasSegments ? (
                    <HighlightedReportText
                      segments={segments}
                      snippetFindingMap={snippetFindingMap}
                      preWrap={section.preWrap}
                    />
                  ) : (
                    <span style={section.preWrap ? { whiteSpace: 'pre-wrap' } : undefined}>
                      {typeof value === 'string' ? value : String(value)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          /* Fallback to raw text */
          <div className="rv-section">
            <div className="rv-section-label">Report</div>
            <div className="rv-section-text">
              {hasHighlighting && rawTextSegments.length > 0 ? (
                <HighlightedReportText
                  segments={rawTextSegments}
                  snippetFindingMap={snippetFindingMap}
                  preWrap
                />
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>
                  {study.reportSections.rawText.join('\n')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unmatched findings warning */}
      {unmatchedFindings.length > 0 && (
        <UnmatchedFindingsWarning unmatchedFindings={unmatchedFindings} />
      )}
    </div>
  );
}
