/**
 * MainStage — Center panel with three display modes:
 *
 * 1. Single-pane: Shows the Reporting iFrame at full width.
 * 2. AI Summary split: Left pane = executive summary, Right pane = Reporting iFrame.
 * 3. Prior compare split: Left pane = prior study report, Right pane = Reporting iFrame.
 *
 * The Reporting iFrame is ALWAYS visible in the right pane (or full width in single-pane).
 * The left pane is used for contextual content (AI summary or prior reports).
 *
 * Communication:
 *   Cockpit → iFrame:  COCKPIT:STUDY_SELECTED (sends study metadata)
 *   iFrame → Cockpit:  REPORTING:READY (iFrame is loaded and ready)
 */

import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import './MainStage.css';
import { useCockpit } from '../../context/CockpitContext';
import { ReportView } from './ReportView';
import { ExecutiveSummary } from './ExecutiveSummary';
import { NoteTextView } from './NoteTextView';
import { LabTableView } from './LabTableView';
import { SplitDivider } from './SplitDivider';
import { parseModality, getModalityStyle } from '../../utils/modality';
import { formatDisplayDate } from '../../utils/dates';

/**
 * ReportingIFrame — Hosts the reporting system in an <iframe>.
 *
 * Manages the postMessage bridge:
 *   - Listens for REPORTING:READY from the iFrame
 *   - Sends COCKPIT:STUDY_SELECTED whenever currentStudy changes
 *   - Re-sends the current study when the iFrame signals readiness
 */
function ReportingIFrame() {
  const { state, toggleEhrIntegration, selectCurrentExam } = useCockpit();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);

  // Listen for REPORTING:READY and REPORTING:EHR_TOGGLE from the iFrame
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'REPORTING:READY') {
        console.log('[Cockpit] Reporting iFrame is ready');
        setIframeReady(true);
      }
      if (event.data?.type === 'REPORTING:EHR_TOGGLE') {
        toggleEhrIntegration();
      }
      if (event.data?.type === 'REPORTING:STUDY_CHANGE') {
        const study = event.data.payload?.study;
        if (study) selectCurrentExam(study);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [toggleEhrIntegration, selectCurrentExam]);

  // Send current study + all available studies to the iFrame
  useEffect(() => {
    if (!iframeReady || !iframeRef.current?.contentWindow) return;
    if (!state.currentStudy) return;

    const studies = state.patientRecord?.currentStudies ?? [];

    const message = {
      type: 'COCKPIT:STUDY_SELECTED',
      payload: { study: state.currentStudy, studies },
    };

    iframeRef.current.contentWindow.postMessage(message, window.location.origin);
    console.log('[Cockpit] Sent COCKPIT:STUDY_SELECTED →', state.currentStudy.studyDescription);
  }, [iframeReady, state.currentStudy, state.patientRecord]);

  return (
    <iframe
      ref={iframeRef}
      src="/reporting.html"
      className="reporting-iframe"
      title="Reporting System"
      allow="microphone"
      id="reporting-iframe"
    />
  );
}

export function MainStage() {
  const { state, clearPrior, selectPrior, clearNote, clearPathology, clearLabPanel, setCompareSplitRatio, toggleExecutiveSummary } = useCockpit();

  // Build priors list (ALL studies, sorted by date desc) to resolve selectedPriorIndex
  const priors = useMemo(() => {
    if (!state.patientRecord) return [];
    return [...state.patientRecord.studies].sort((a, b) => {
      if (b.studyDateTime > a.studyDateTime) return 1;
      if (b.studyDateTime < a.studyDateTime) return -1;
      return 0;
    });
  }, [state.patientRecord]);

  // Build accession → prior index lookup for clickable study links in exec summary
  const accessionToIndex = useMemo(() => {
    const map = new Map<string, number>();
    priors.forEach((study, idx) => {
      map.set(study.accessionNumber, idx);
    });
    return map;
  }, [priors]);

  const handleStudyClick = useCallback((accessionNumber: string) => {
    const idx = accessionToIndex.get(accessionNumber);
    if (idx != null) {
      selectPrior(idx);
    }
  }, [accessionToIndex, selectPrior]);

  const priorStudy =
    state.selectedPriorIndex != null ? priors[state.selectedPriorIndex] ?? null : null;

  // Look up the full analysis for the selected prior (for inline snippet highlighting)
  const priorAnalysis = useMemo(() => {
    if (!priorStudy || !state.summarizationResult) return null;
    return state.summarizationResult.individualAnalyses.find(
      (a) => a.accessionNumber === priorStudy.accessionNumber,
    ) ?? null;
  }, [priorStudy, state.summarizationResult]);

  const isCompare = state.compareMode && priorStudy != null;
  const showExecSummary =
    state.showExecutiveSummary &&
    state.summarizationStatus === 'complete' &&
    state.summarizationResult?.executiveSummary;

  // Compute prior modality styles only when needed (avoid null-ref on priorStudy)
  const priorModality = isCompare ? parseModality(priorStudy!.studyDescription) : null;
  const priorModalityStyle = priorModality ? getModalityStyle(priorModality) : null;

  // Resolve the selected clinical note from EHR data
  const selectedNote = useMemo(() => {
    if (!state.selectedNoteId || !state.ehrData?.notes) return null;
    return state.ehrData.notes.find((n) => n.id === state.selectedNoteId) ?? null;
  }, [state.selectedNoteId, state.ehrData?.notes]);

  const showNoteView = selectedNote != null;

  // Resolve the selected pathology report from EHR data
  const selectedPathology = useMemo(() => {
    if (!state.selectedPathologyId || !state.ehrData?.pathology) return null;
    return state.ehrData.pathology.find((p) => p.id === state.selectedPathologyId) ?? null;
  }, [state.selectedPathologyId, state.ehrData?.pathology]);

  const showPathologyView = selectedPathology != null;

  // Resolve the selected lab panel from EHR data
  const selectedLabPanelData = useMemo(() => {
    if (!state.selectedLabPanel || !state.ehrData?.labs?.panels) return null;
    return state.ehrData.labs.panels[state.selectedLabPanel] ?? null;
  }, [state.selectedLabPanel, state.ehrData?.labs?.panels]);

  const showLabView = selectedLabPanelData != null;

  const hasSplit = isCompare || !!showExecSummary || !!showNoteView || !!showPathologyView || !!showLabView;

  // ── Unified layout: iFrame is ALWAYS in the DOM ───────────────────────
  //
  // The <ReportingIFrame /> is rendered exactly once, in a stable position
  // in the right pane. When no split mode is active, the right pane expands
  // to fill the full width. This prevents React from unmounting/remounting
  // the <iframe> element when the layout mode changes (e.g. when the AI
  // Summary panel opens), which would cause the iFrame to reload and
  // revert to the default template.

  return (
    <main className={`zone-main-stage${hasSplit ? ' zone-main-stage--compare' : ''}`}>

      {/* ── Left Pane: Executive Summary (AI Summary split) ── */}
      {showExecSummary && state.summarizationResult?.executiveSummary && (
        <div
          className="stage-pane stage-pane--prior"
          style={{ flex: `0 0 ${state.compareSplitRatio * 100}%` }}
        >
          <div className="stage-body">
            <ExecutiveSummary
              summary={state.summarizationResult.executiveSummary}
              oneLiner={state.summarizationResult.oneLiner}
              individualAnalyses={state.summarizationResult.individualAnalyses}
              problemGrouping={state.summarizationResult.problemGrouping}
              noteTriage={state.summarizationResult.noteTriage}
              currentStudy={state.currentStudy}
              ehrIntegrationEnabled={state.ehrIntegrationEnabled}
              expandedReason={state.summarizationResult.expandedReason}
              studyIntent={state.summarizationResult.studyIntent}
              onStudyClick={handleStudyClick}
              onClose={toggleExecutiveSummary}
            />
          </div>
        </div>
      )}

      {/* ── Left Pane: Prior Report (compare mode) ── */}
      {isCompare && !showExecSummary && (
        <div
          className="stage-pane stage-pane--prior"
          style={{ flex: `0 0 ${state.compareSplitRatio * 100}%` }}
        >
          <div className="stage-toolbar stage-toolbar--prior">
            <span
              className="stage-toolbar-chip"
              style={{
                background: priorModalityStyle!.background,
                color: priorModalityStyle!.color,
              }}
            >
              {priorModality}
            </span>
            <span className="stage-toolbar-status">Prior Report</span>
            <span className="stage-toolbar-date">
              {formatDisplayDate(priorStudy!.studyDateTime)}
            </span>
            <button
              className="stage-close-btn"
              onClick={clearPrior}
              title="Close compare view"
              aria-label="Close compare view"
            >
              ✕
            </button>
          </div>

          {/* Banner */}
          <div className="stage-prior-banner">
            <span className="stage-prior-banner-text">Viewing Prior Report</span>
            <span className="stage-prior-banner-pill">Not Current Exam</span>
          </div>

          <div className="stage-body">
            <ReportView
              study={priorStudy!}
              variant="prior"
              analysis={priorAnalysis}
              allStudies={priors}
              onStudyClick={handleStudyClick}
            />
          </div>
        </div>
      )}

      {/* ── Left Pane: Clinical Note (note view mode) ── */}
      {showNoteView && selectedNote && !showExecSummary && !isCompare && (
        <div
          className="stage-pane stage-pane--prior"
          style={{ flex: `0 0 ${state.compareSplitRatio * 100}%` }}
        >
          <NoteTextView
            note={selectedNote}
            onClose={clearNote}
            noteTriage={state.summarizationResult?.noteTriage}
            ehrProblems={state.ehrData?.problems}
            expandedReason={state.summarizationResult?.expandedReason}
          />
        </div>
      )}

      {/* ── Left Pane: Pathology Report (pathology view mode) ── */}
      {showPathologyView && selectedPathology && !showExecSummary && !isCompare && !showNoteView && (
        <div
          className="stage-pane stage-pane--prior"
          style={{ flex: `0 0 ${state.compareSplitRatio * 100}%` }}
        >
          <NoteTextView
            pathologyReport={selectedPathology}
            onClose={clearPathology}
          />
        </div>
      )}

      {/* ── Left Pane: Lab Table (lab panel view mode) ── */}
      {showLabView && selectedLabPanelData && !showExecSummary && !isCompare && !showNoteView && !showPathologyView && (
        <div
          className="stage-pane stage-pane--prior"
          style={{ flex: `0 0 ${state.compareSplitRatio * 100}%` }}
        >
          <LabTableView
            panelName={state.selectedLabPanel!}
            panel={selectedLabPanelData}
            onClose={clearLabPanel}
          />
        </div>
      )}

      {/* ── Divider (only when split) ── */}
      {hasSplit && (
        <SplitDivider
          ratio={state.compareSplitRatio}
          onRatioChange={setCompareSplitRatio}
        />
      )}

      {/* ── Right Pane: Reporting iFrame (ALWAYS rendered) ── */}
      <div
        className={`stage-pane stage-pane--current${!hasSplit ? ' stage-pane--full' : ''}`}
        style={hasSplit ? { flex: 1 } : undefined}
      >
        <div className="stage-body stage-body--iframe">
          <ReportingIFrame />
        </div>
      </div>
    </main>
  );
}
