/**
 * ActionPanel — Fixed-position overlay QA rail.
 *
 * Positioned as a fixed overlay on the right edge of the viewport.
 * Does NOT participate in the CSS Grid layout — expanding it does
 * not compress the main stage or any adjacent panels.
 *
 * Default: Collapsed (hidden) with an edge chip to expand.
 * Expanded: Slides in from the right with a draggable left border
 *           for resizing.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import './ActionPanel.css';
import { useCockpit } from '../../context/CockpitContext';
import type { SummarizationQAEntry, ReasoningEffort, ErikQAData } from '../../types/api';
import { api } from '../../api/client';

/** Minimum overlay width — enough for legible content */
const PANEL_MIN_W = 220;

export function ActionPanel() {
  const { state, toggleRightRail, setActionPanelWidth, setMaxPriorsToSummarize, setMaxNotesToAnalyze } = useCockpit();
  const hasStudy = state.currentStudy != null;
  const hasSummary = state.summarizationStatus === 'complete' && state.summarizationResult;
  const dragging = useRef(false);

  /* ── Handler for the priors-to-summarize numeric input ──── */
  const handleMaxPriorsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
        setMaxPriorsToSummarize(value);
      }
    },
    [setMaxPriorsToSummarize],
  );

  /* ── Handler for the notes-to-analyze numeric input ──── */
  const handleMaxNotesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
        setMaxNotesToAnalyze(value);
      }
    },
    [setMaxNotesToAnalyze],
  );

  /* ── Drag-to-resize left border ──────────────────────────────── */
  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      target.classList.add('dragging');

      // Disable transition during drag for real-time feel
      const panel = target.closest('.zone-action-panel') as HTMLElement | null;
      if (panel) panel.style.transition = 'none';

      const maxW = Math.floor(window.innerWidth * 0.5);

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        // Panel anchored to right edge: width = viewport width - cursor X
        const newW = Math.max(PANEL_MIN_W, Math.min(maxW, window.innerWidth - ev.clientX));
        setActionPanelWidth(newW);
      };

      const onUp = () => {
        dragging.current = false;
        target.classList.remove('dragging');
        if (panel) panel.style.transition = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [setActionPanelWidth],
  );

  return (
    <>
      {/* Edge chip removed — QA trigger now lives in CockpitFooter */}

      {/* Expanded overlay panel */}
      <aside
        className={`zone-action-panel ${state.rightRailExpanded ? 'expanded' : ''}`}
        style={{
          '--action-panel-w': `${state.actionPanelWidth}px`,
        } as React.CSSProperties}
      >
        {/* Drag handle — left border */}
        <div
          className="action-drag-handle"
          onPointerDown={handleDragPointerDown}
          role="separator"
          aria-valuenow={state.actionPanelWidth}
          aria-valuemin={PANEL_MIN_W}
          aria-label="Resize Quality Review panel"
        />

        <div className="action-panel-content">
          <div className="action-header">
            <span className="action-header-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="action-header-svg">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </span>
            <span className="action-header-title">Quality Review</span>
            <button
              className="action-collapse-btn"
              onClick={toggleRightRail}
              title="Collapse panel"
              aria-label="Collapse panel"
            >
              ✕
            </button>
          </div>

          <div className="action-body">
            {/* ── Priors-to-Summarize Config ── */}
            <div className="action-priors-config">
              <label
                className="action-priors-label"
                htmlFor="max-priors-input"
              >
                Priors to Summarize
              </label>
              <input
                id="max-priors-input"
                className="action-priors-input"
                type="number"
                min={1}
                max={10}
                step={1}
                value={state.maxPriorsToSummarize}
                onChange={handleMaxPriorsChange}
                title="Number of top-scoring relevant priors to include in AI summarization"
              />
            </div>

            {/* ── Notes-to-Analyze Config ── */}
            <div className="action-priors-config">
              <label
                className="action-priors-label"
                htmlFor="max-notes-input"
              >
                Notes to Analyze
              </label>
              <input
                id="max-notes-input"
                className="action-priors-input"
                type="number"
                min={1}
                max={20}
                step={1}
                value={state.maxNotesToAnalyze}
                onChange={handleMaxNotesChange}
                title="Number of top-scoring relevant clinical notes to analyze for problem extraction"
              />
            </div>

            {/* ── Model for Finding Grouping (dev tool) ── */}
            <FindingGroupingModelSelector />

            {/* ── Model for Problem Grouping (dev tool) ── */}
            <ProblemGroupingModelSelector />

            {/* ── Model for Reason for Study (dev tool) ── */}
            <ReasonForStudyModelSelector />

            {/* ── Model for One-Liner (dev tool) ── */}
            <OneLinerModelSelector />

            {/* ── Summarization QA Section ── */}
            {hasSummary && state.summarizationResult && (
              <div className="action-section">
                <div className="action-section-label">Summarization QA</div>
                <SummarizationQALog
                  qaLog={state.summarizationResult.qaLog}
                  totalLatencyMs={state.summarizationResult.totalLatencyMs}
                  totalTokenUsage={state.summarizationResult.totalTokenUsage}
                />
              </div>
            )}

            {/* ── ERIK QA Section ── */}
            {state.erikTotalTokens && (state.erikTotalTokens.input > 0 || state.erikTotalTokens.output > 0) && (
              <div className="action-section">
                <div className="action-section-label">ERIK QA</div>
                <ErikQALog
                  totalTokens={state.erikTotalTokens}
                  lastTriage={state.erikLastTriage}
                  lastAnswer={state.erikLastAnswer}
                />
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Model Selector Sub-component ────────────────────────────────────────

const HAIKU_MODEL_ID = 'claude-haiku-4-5-20251001';
const SONNET_MODEL_ID = 'claude-sonnet-4-6';
const OPUS_MODEL_ID = 'claude-opus-4-7';
const REASONING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

/** Models that support adaptive thinking / reasoning effort */
const isThinkingCapable = (id: string) => id === SONNET_MODEL_ID || id === OPUS_MODEL_ID;

function FindingGroupingModelSelector() {
  const [modelId, setModelId] = useState(HAIKU_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('none');
  const [loaded, setLoaded] = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    api.getDevSettings()
      .then((settings) => {
        setModelId(settings.findingGrouping.modelId);
        setReasoningEffort(settings.findingGrouping.reasoningEffort);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn('[ModelSelector] Failed to load dev settings:', err);
        setLoaded(true);
      });
  }, []);

  const handleModelChange = useCallback((newModelId: string) => {
    setModelId(newModelId);
    // When switching to a non-thinking model (Haiku), reset reasoning to "none"
    const newEffort = !isThinkingCapable(newModelId) ? 'none' as ReasoningEffort : reasoningEffort;
    if (!isThinkingCapable(newModelId)) setReasoningEffort('none');

    api.updateDevSettings({
      findingGrouping: { modelId: newModelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[ModelSelector] Failed to save model selection:', err);
    });
  }, [reasoningEffort]);

  const handleEffortChange = useCallback((newEffort: ReasoningEffort) => {
    setReasoningEffort(newEffort);
    api.updateDevSettings({
      findingGrouping: { modelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[ModelSelector] Failed to save reasoning effort:', err);
    });
  }, [modelId]);

  if (!loaded) return null; // Avoid flicker before settings load

  const showReasoning = isThinkingCapable(modelId);

  return (
    <div className="dev-model-selector">
      <div className="dev-model-label">
        Model for Finding Grouping
        <span className="dev-badge">DEV</span>
      </div>

      <div className="dev-radio-group" role="radiogroup" aria-label="Model for Finding Grouping">
        {/* Haiku option */}
        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model"
            value={HAIKU_MODEL_ID}
            checked={modelId === HAIKU_MODEL_ID}
            onChange={() => handleModelChange(HAIKU_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Haiku 4.5</span>
        </label>

        {/* Sonnet option */}
        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model"
            value={SONNET_MODEL_ID}
            checked={modelId === SONNET_MODEL_ID}
            onChange={() => handleModelChange(SONNET_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Sonnet 4.6</span>
        </label>

        {/* Opus option */}
        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model"
            value={OPUS_MODEL_ID}
            checked={modelId === OPUS_MODEL_ID}
            onChange={() => handleModelChange(OPUS_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Opus 4.7</span>
        </label>
      </div>

      {/* Reasoning effort — visible when a thinking-capable model is selected */}
      <div className={`dev-reasoning-panel ${showReasoning ? 'dev-reasoning-panel--open' : ''}`}>
        <div className="dev-reasoning-wrapper">
          <div className="dev-reasoning-label">Reasoning Effort</div>
          <div
            className="dev-reasoning-options"
            role="radiogroup"
            aria-label="Reasoning Effort"
          >
            {REASONING_EFFORTS.map((effort) => (
              <label key={effort} className="dev-radio-label">
                <input
                  className="dev-radio-input"
                  type="radio"
                  name="dev-reasoning"
                  value={effort}
                  checked={reasoningEffort === effort}
                  onChange={() => handleEffortChange(effort)}
                />
                <span className="dev-radio-circle" />
                <span className="dev-radio-text">
                  {effort.charAt(0).toUpperCase() + effort.slice(1)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Problem Grouping Model Selector ─────────────────────────────────────

function ProblemGroupingModelSelector() {
  const [modelId, setModelId] = useState(HAIKU_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('none');
  const [loaded, setLoaded] = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    api.getDevSettings()
      .then((settings) => {
        setModelId(settings.problemGrouping.modelId);
        setReasoningEffort(settings.problemGrouping.reasoningEffort);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn('[ProblemGroupingModelSelector] Failed to load dev settings:', err);
        setLoaded(true);
      });
  }, []);

  const handleModelChange = useCallback((newModelId: string) => {
    setModelId(newModelId);
    const newEffort = !isThinkingCapable(newModelId) ? 'none' as ReasoningEffort : reasoningEffort;
    if (!isThinkingCapable(newModelId)) setReasoningEffort('none');

    api.updateDevSettings({
      problemGrouping: { modelId: newModelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[ProblemGroupingModelSelector] Failed to save model selection:', err);
    });
  }, [reasoningEffort]);

  const handleEffortChange = useCallback((newEffort: ReasoningEffort) => {
    setReasoningEffort(newEffort);
    api.updateDevSettings({
      problemGrouping: { modelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[ProblemGroupingModelSelector] Failed to save reasoning effort:', err);
    });
  }, [modelId]);

  if (!loaded) return null;

  const showReasoning = isThinkingCapable(modelId);

  return (
    <div className="dev-model-selector">
      <div className="dev-model-label">
        Model for Problem Grouping
        <span className="dev-badge">DEV</span>
      </div>

      <div className="dev-radio-group" role="radiogroup" aria-label="Model for Problem Grouping">
        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-problem"
            value={HAIKU_MODEL_ID}
            checked={modelId === HAIKU_MODEL_ID}
            onChange={() => handleModelChange(HAIKU_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Haiku 4.5</span>
        </label>

        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-problem"
            value={SONNET_MODEL_ID}
            checked={modelId === SONNET_MODEL_ID}
            onChange={() => handleModelChange(SONNET_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Sonnet 4.6</span>
        </label>

        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-problem"
            value={OPUS_MODEL_ID}
            checked={modelId === OPUS_MODEL_ID}
            onChange={() => handleModelChange(OPUS_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Opus 4.7</span>
        </label>
      </div>

      <div className={`dev-reasoning-panel ${showReasoning ? 'dev-reasoning-panel--open' : ''}`}>
        <div className="dev-reasoning-wrapper">
          <div className="dev-reasoning-label">Reasoning Effort</div>
          <div
            className="dev-reasoning-options"
            role="radiogroup"
            aria-label="Reasoning Effort for Problem Grouping"
          >
            {REASONING_EFFORTS.map((effort) => (
              <label key={effort} className="dev-radio-label">
                <input
                  className="dev-radio-input"
                  type="radio"
                  name="dev-reasoning-problem"
                  value={effort}
                  checked={reasoningEffort === effort}
                  onChange={() => handleEffortChange(effort)}
                />
                <span className="dev-radio-circle" />
                <span className="dev-radio-text">
                  {effort.charAt(0).toUpperCase() + effort.slice(1)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reason for Study Model Selector ─────────────────────────────────────

function ReasonForStudyModelSelector() {
  const [modelId, setModelId] = useState(SONNET_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('none');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getDevSettings()
      .then((settings) => {
        setModelId(settings.expandedReason.modelId);
        setReasoningEffort(settings.expandedReason.reasoningEffort);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn('[ReasonForStudyModelSelector] Failed to load dev settings:', err);
        setLoaded(true);
      });
  }, []);

  const handleModelChange = useCallback((newModelId: string) => {
    setModelId(newModelId);
    const newEffort = !isThinkingCapable(newModelId) ? 'none' as ReasoningEffort : reasoningEffort;
    if (!isThinkingCapable(newModelId)) setReasoningEffort('none');

    api.updateDevSettings({
      expandedReason: { modelId: newModelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[ReasonForStudyModelSelector] Failed to save model selection:', err);
    });
  }, [reasoningEffort]);

  const handleEffortChange = useCallback((newEffort: ReasoningEffort) => {
    setReasoningEffort(newEffort);
    api.updateDevSettings({
      expandedReason: { modelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[ReasonForStudyModelSelector] Failed to save reasoning effort:', err);
    });
  }, [modelId]);

  if (!loaded) return null;

  const showReasoning = isThinkingCapable(modelId);

  return (
    <div className="dev-model-selector">
      <div className="dev-model-label">
        Reason for Study Model
        <span className="dev-badge">DEV</span>
      </div>

      <div className="dev-radio-group" role="radiogroup" aria-label="Reason for Study Model">
        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-reason"
            value={HAIKU_MODEL_ID}
            checked={modelId === HAIKU_MODEL_ID}
            onChange={() => handleModelChange(HAIKU_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Haiku 4.5</span>
        </label>

        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-reason"
            value={SONNET_MODEL_ID}
            checked={modelId === SONNET_MODEL_ID}
            onChange={() => handleModelChange(SONNET_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Sonnet 4.6</span>
        </label>

        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-reason"
            value={OPUS_MODEL_ID}
            checked={modelId === OPUS_MODEL_ID}
            onChange={() => handleModelChange(OPUS_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Opus 4.7</span>
        </label>
      </div>

      <div className={`dev-reasoning-panel ${showReasoning ? 'dev-reasoning-panel--open' : ''}`}>
        <div className="dev-reasoning-wrapper">
          <div className="dev-reasoning-label">Reasoning Effort</div>
          <div
            className="dev-reasoning-options"
            role="radiogroup"
            aria-label="Reasoning Effort for Reason for Study"
          >
            {REASONING_EFFORTS.map((effort) => (
              <label key={effort} className="dev-radio-label">
                <input
                  className="dev-radio-input"
                  type="radio"
                  name="dev-reasoning-reason"
                  value={effort}
                  checked={reasoningEffort === effort}
                  onChange={() => handleEffortChange(effort)}
                />
                <span className="dev-radio-circle" />
                <span className="dev-radio-text">
                  {effort.charAt(0).toUpperCase() + effort.slice(1)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── One-Liner Model Selector ────────────────────────────────────────────

function OneLinerModelSelector() {
  const [modelId, setModelId] = useState(SONNET_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('low');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getDevSettings()
      .then((settings) => {
        setModelId(settings.oneLiner.modelId);
        setReasoningEffort(settings.oneLiner.reasoningEffort);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn('[OneLinerModelSelector] Failed to load dev settings:', err);
        setLoaded(true);
      });
  }, []);

  const handleModelChange = useCallback((newModelId: string) => {
    setModelId(newModelId);
    const newEffort = !isThinkingCapable(newModelId) ? 'none' as ReasoningEffort : reasoningEffort;
    if (!isThinkingCapable(newModelId)) setReasoningEffort('none');

    api.updateDevSettings({
      oneLiner: { modelId: newModelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[OneLinerModelSelector] Failed to save model selection:', err);
    });
  }, [reasoningEffort]);

  const handleEffortChange = useCallback((newEffort: ReasoningEffort) => {
    setReasoningEffort(newEffort);
    api.updateDevSettings({
      oneLiner: { modelId, reasoningEffort: newEffort },
    }).catch((err) => {
      console.warn('[OneLinerModelSelector] Failed to save reasoning effort:', err);
    });
  }, [modelId]);

  if (!loaded) return null;

  const showReasoning = isThinkingCapable(modelId);

  return (
    <div className="dev-model-selector">
      <div className="dev-model-label">
        Model for One-Liner
        <span className="dev-badge">DEV</span>
      </div>

      <div className="dev-radio-group" role="radiogroup" aria-label="Model for One-Liner">
        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-oneliner"
            value={HAIKU_MODEL_ID}
            checked={modelId === HAIKU_MODEL_ID}
            onChange={() => handleModelChange(HAIKU_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Haiku 4.5</span>
        </label>

        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-oneliner"
            value={SONNET_MODEL_ID}
            checked={modelId === SONNET_MODEL_ID}
            onChange={() => handleModelChange(SONNET_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Sonnet 4.6</span>
        </label>

        <label className="dev-radio-label">
          <input
            className="dev-radio-input"
            type="radio"
            name="dev-model-oneliner"
            value={OPUS_MODEL_ID}
            checked={modelId === OPUS_MODEL_ID}
            onChange={() => handleModelChange(OPUS_MODEL_ID)}
          />
          <span className="dev-radio-circle" />
          <span className="dev-radio-text">Claude Opus 4.7</span>
        </label>
      </div>

      <div className={`dev-reasoning-panel ${showReasoning ? 'dev-reasoning-panel--open' : ''}`}>
        <div className="dev-reasoning-wrapper">
          <div className="dev-reasoning-label">Reasoning Effort</div>
          <div
            className="dev-reasoning-options"
            role="radiogroup"
            aria-label="Reasoning Effort for One-Liner"
          >
            {REASONING_EFFORTS.map((effort) => (
              <label key={effort} className="dev-radio-label">
                <input
                  className="dev-radio-input"
                  type="radio"
                  name="dev-reasoning-oneliner"
                  value={effort}
                  checked={reasoningEffort === effort}
                  onChange={() => handleEffortChange(effort)}
                />
                <span className="dev-radio-circle" />
                <span className="dev-radio-text">
                  {effort.charAt(0).toUpperCase() + effort.slice(1)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ERIK QA Log ─────────────────────────────────────────────────────────

interface ErikQALogProps {
  totalTokens: { input: number; output: number };
  lastTriage: ErikQAData | null;
  lastAnswer: ErikQAData | null;
}

function ErikQALog({ totalTokens, lastTriage, lastAnswer }: ErikQALogProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [jsonExpanded, setJsonExpanded] = useState<Record<string, boolean>>({});

  const toggleJson = (key: string) => {
    setJsonExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="qa-log">
      {/* Aggregate Token Stats */}
      <div className="qa-log-stats">
        <span className="qa-stat">
          <span className="qa-stat-label">Total Tokens (in/out)</span>
          <span className="qa-stat-value">
            {totalTokens.input.toLocaleString()} / {totalTokens.output.toLocaleString()}
          </span>
        </span>
      </div>

      {/* Most Recent Triage (Pass 1) */}
      {lastTriage && (
        <div className={`qa-entry ${expandedSection === 'triage' ? 'qa-entry--expanded' : ''}`}>
          <button
            className="qa-entry-header"
            onClick={() => setExpandedSection(expandedSection === 'triage' ? null : 'triage')}
          >
            <span className="qa-entry-icon">🧠</span>
            <span className="qa-entry-label">ERIK Pass 1 (Triage)</span>
            <span className="qa-entry-latency">
              {lastTriage.tokens.input.toLocaleString()} / {lastTriage.tokens.output.toLocaleString()}
            </span>
          </button>

          {expandedSection === 'triage' && (
            <div className="qa-entry-detail">
              <div className="qa-detail-row">
                <span className="qa-detail-label">Tokens (in/out)</span>
                <span className="qa-detail-value">
                  {lastTriage.tokens.input.toLocaleString()} / {lastTriage.tokens.output.toLocaleString()}
                </span>
              </div>

              <div className="qa-json-section">
                <button className="qa-json-toggle" onClick={() => toggleJson('triage-input')}>
                  <span className="qa-json-toggle-icon">{jsonExpanded['triage-input'] ? '▾' : '▸'}</span>
                  <span className="qa-json-toggle-label">LLM Input</span>
                </button>
                {jsonExpanded['triage-input'] && (
                  <div className="qa-json-panel">
                    <pre className="qa-json-pre">{lastTriage.input}</pre>
                  </div>
                )}

                <button className="qa-json-toggle" onClick={() => toggleJson('triage-output')}>
                  <span className="qa-json-toggle-icon">{jsonExpanded['triage-output'] ? '▾' : '▸'}</span>
                  <span className="qa-json-toggle-label">LLM Output</span>
                  <span className="qa-json-toggle-badge">
                    {lastTriage.tokens.output.toLocaleString()} tokens
                  </span>
                </button>
                {jsonExpanded['triage-output'] && (
                  <div className="qa-json-panel">
                    <pre className="qa-json-pre">{lastTriage.output}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Most Recent Answer (Pass 2) */}
      {lastAnswer && (
        <div className={`qa-entry ${expandedSection === 'answer' ? 'qa-entry--expanded' : ''}`}>
          <button
            className="qa-entry-header"
            onClick={() => setExpandedSection(expandedSection === 'answer' ? null : 'answer')}
          >
            <span className="qa-entry-icon">💬</span>
            <span className="qa-entry-label">ERIK Pass 2 (Answer)</span>
            <span className="qa-entry-latency">
              {lastAnswer.tokens.input.toLocaleString()} / {lastAnswer.tokens.output.toLocaleString()}
            </span>
          </button>

          {expandedSection === 'answer' && (
            <div className="qa-entry-detail">
              <div className="qa-detail-row">
                <span className="qa-detail-label">Tokens (in/out)</span>
                <span className="qa-detail-value">
                  {lastAnswer.tokens.input.toLocaleString()} / {lastAnswer.tokens.output.toLocaleString()}
                </span>
              </div>

              <div className="qa-json-section">
                <button className="qa-json-toggle" onClick={() => toggleJson('answer-input')}>
                  <span className="qa-json-toggle-icon">{jsonExpanded['answer-input'] ? '▾' : '▸'}</span>
                  <span className="qa-json-toggle-label">LLM Input</span>
                </button>
                {jsonExpanded['answer-input'] && (
                  <div className="qa-json-panel">
                    <pre className="qa-json-pre">{lastAnswer.input}</pre>
                  </div>
                )}

                <button className="qa-json-toggle" onClick={() => toggleJson('answer-output')}>
                  <span className="qa-json-toggle-icon">{jsonExpanded['answer-output'] ? '▾' : '▸'}</span>
                  <span className="qa-json-toggle-label">LLM Output</span>
                  <span className="qa-json-toggle-badge">
                    {lastAnswer.tokens.output.toLocaleString()} tokens
                  </span>
                </button>
                {jsonExpanded['answer-output'] && (
                  <div className="qa-json-panel">
                    <pre className="qa-json-pre">{lastAnswer.output}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── QA Log Sub-component ────────────────────────────────────────────────

interface QALogProps {
  qaLog: SummarizationQAEntry[];
  totalLatencyMs: number;
  totalTokenUsage: { input: number; output: number };
}

function SummarizationQALog({ qaLog, totalLatencyMs, totalTokenUsage }: QALogProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  // Track which JSON sections are expanded independently per entry
  const [jsonExpanded, setJsonExpanded] = useState<Record<string, boolean>>({});

  const toggleJson = (entryIdx: number, section: string) => {
    const key = `${entryIdx}-${section}`;
    setJsonExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const passCount = qaLog.reduce(
    (n, q) => n + q.validation.checks.filter((c) => c.status === 'pass').length, 0,
  );
  const warnCount = qaLog.reduce(
    (n, q) => n + q.validation.checks.filter((c) => c.status === 'warning').length, 0,
  );
  const failCount = qaLog.reduce(
    (n, q) => n + q.validation.checks.filter((c) => c.status === 'fail').length, 0,
  );

  return (
    <div className="qa-log">
      {/* Aggregate Stats */}
      <div className="qa-log-stats">
        <span className="qa-stat">
          <span className="qa-stat-label">Latency</span>
          <span className="qa-stat-value">{(totalLatencyMs / 1000).toFixed(1)}s</span>
        </span>
        <span className="qa-stat">
          <span className="qa-stat-label">Tokens</span>
          <span className="qa-stat-value">
            {totalTokenUsage.input.toLocaleString()} / {totalTokenUsage.output.toLocaleString()}
          </span>
        </span>
        <span className="qa-stat">
          <span className="qa-stat-label">Checks</span>
          <span className="qa-stat-value">
            ✅{passCount} {warnCount > 0 && `⚠️${warnCount} `}{failCount > 0 && `❌${failCount}`}
          </span>
        </span>
      </div>

      {/* Individual entries */}
      {qaLog.map((entry, idx) => {
        const isExpanded = expandedIdx === idx;
        const entryPasses = entry.validation.checks.filter((c) => c.status === 'pass').length;
        const entryWarns = entry.validation.checks.filter((c) => c.status === 'warning').length;
        const entryFails = entry.validation.checks.filter((c) => c.status === 'fail').length;
        const icon = entry.validation.passed ? '✅' : '❌';

        const isInputExpanded = jsonExpanded[`${idx}-input`] ?? false;
        const isOutputExpanded = jsonExpanded[`${idx}-output`] ?? false;

        return (
          <div key={idx} className={`qa-entry ${isExpanded ? 'qa-entry--expanded' : ''}`}>
            <button
              className="qa-entry-header"
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
            >
              <span className="qa-entry-icon">{icon}</span>
              <span className="qa-entry-label">{entry.label}</span>
              <span className="qa-entry-latency">{(entry.latencyMs / 1000).toFixed(1)}s</span>
              <span className="qa-entry-checks">
                {entryPasses > 0 && `✅${entryPasses}`}
                {entryWarns > 0 && ` ⚠️${entryWarns}`}
                {entryFails > 0 && ` ❌${entryFails}`}
                {entry.validation.checks.length === 0 && '—'}
              </span>
            </button>

            {isExpanded && (
              <div className="qa-entry-detail">
                <div className="qa-detail-row">
                  <span className="qa-detail-label">Tokens (in/out)</span>
                  <span className="qa-detail-value">
                    {entry.tokenUsage.input.toLocaleString()} / {entry.tokenUsage.output.toLocaleString()}
                  </span>
                </div>
                {entry.validation.checks.length > 0 && (
                  <div className="qa-detail-checks">
                    {entry.validation.checks.map((check, ci) => (
                      <div key={ci} className={`qa-check qa-check--${check.status}`}>
                        <span className="qa-check-icon">
                          {check.status === 'pass' ? '✅' : check.status === 'warning' ? '⚠️' : '❌'}
                        </span>
                        <span className="qa-check-name">{check.findingName}</span>
                        <span className="qa-check-type">{check.type.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Score % Details ── */}
                {entry.relevanceScore && (
                  <div className="qa-json-section">
                    <button
                      className="qa-json-toggle"
                      onClick={() => toggleJson(idx, 'score')}
                    >
                      <span className="qa-json-toggle-icon">
                        {jsonExpanded[`${idx}-score`] ? '▾' : '▸'}
                      </span>
                      <span className="qa-json-toggle-label">Score % Details</span>
                      <span className="qa-json-toggle-badge">
                        {(entry.relevanceScore.percentage * 100).toFixed(1)}%
                      </span>
                    </button>
                    {jsonExpanded[`${idx}-score`] && (
                      <div className="qa-score-panel">
                        <div className="qa-score-overall">
                          <span className="qa-score-overall-pct">
                            {(entry.relevanceScore.percentage * 100).toFixed(1)}%
                          </span>
                          <span className="qa-score-overall-raw">
                            {entry.relevanceScore.totalScore.toFixed(2)} / {entry.relevanceScore.maxPossible} pts
                          </span>
                        </div>
                        <div className="qa-score-rows">
                          {(Object.entries(entry.relevanceScore.breakdown) as [string, { score: number; maxPossible: number }][])
                            .filter(([, v]) => v.maxPossible > 0 || v.score !== 0)
                            .map(([key, v]) => {
                              const pct = v.maxPossible > 0 ? (v.score / v.maxPossible) * 100 : 0;
                              const isNeg = v.score < 0;
                              return (
                                <div key={key} className="qa-score-row">
                                  <span className="qa-score-dim">{formatDimName(key)}</span>
                                  <div className="qa-score-bar-track">
                                    <div
                                      className={`qa-score-bar-fill ${isNeg ? 'qa-score-bar-fill--neg' : ''}`}
                                      style={{ width: `${Math.min(100, Math.abs(pct))}%` }}
                                    />
                                  </div>
                                  <span className={`qa-score-fraction ${isNeg ? 'qa-score-fraction--neg' : ''}`}>
                                    {v.score % 1 !== 0 ? v.score.toFixed(2) : v.score}/{v.maxPossible}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Raw JSON Viewers ── */}
                <div className="qa-json-section">
                  {/* LLM Input JSON */}
                  <button
                    className="qa-json-toggle"
                    onClick={() => toggleJson(idx, 'input')}
                  >
                    <span className="qa-json-toggle-icon">{isInputExpanded ? '▾' : '▸'}</span>
                    <span className="qa-json-toggle-label">LLM Input</span>
                  </button>
                  {isInputExpanded && (
                    <div className="qa-json-panel">
                      <pre className="qa-json-pre">
                        {JSON.stringify(entry.inputData, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* LLM Output JSON */}
                  <button
                    className="qa-json-toggle"
                    onClick={() => toggleJson(idx, 'output')}
                  >
                    <span className="qa-json-toggle-icon">{isOutputExpanded ? '▾' : '▸'}</span>
                    <span className="qa-json-toggle-label">LLM Output</span>
                    <span className="qa-json-toggle-badge">
                      {entry.tokenUsage.output.toLocaleString()} tokens
                    </span>
                  </button>
                  {isOutputExpanded && (
                    <div className="qa-json-panel">
                      <pre className="qa-json-pre">
                        {JSON.stringify(entry.outputData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Convert score dimension keys to human-readable labels */
const DIM_NAMES: Record<string, string> = {
  modality: 'Modality',
  bodyRegion: 'Body Region',
  recency: 'Recency',
  angiography: 'Angiography',
  laterality: 'Laterality',
};

function formatDimName(key: string): string {
  return DIM_NAMES[key] ?? key;
}
