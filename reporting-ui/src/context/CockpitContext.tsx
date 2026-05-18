/**
 * CockpitContext — Global state management for the NewVue Cockpit UI.
 *
 * Provides patient/study selection, UI panel state, filters, and summary
 * toggle state to all descendant components via React Context + useReducer.
 */

import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode, type MutableRefObject } from 'react';
import type { PatientRecord, CurrentStudy, SummarizationResponse, ErikQAData } from '../types/api';
import type { EhrDataPayload, EhrDataStatus } from '../types/ehrTypes';
import { usePatientRecord } from '../hooks/usePatientRecord';
import { fetchEhrData } from '../services/ehrService';

/** Persistent view state for the executive summary (survives component mount/unmount). */
export interface ExecViewState {
  expandedRegions: string[];
  pinnedFindings: string[];
}
import { api } from '../api/client';

// ── Filter Model ─────────────────────────────────────────────────────────

/**
 * Multi-faceted compound filter for the prior-study timeline.
 *
 * All set facets are AND'd — a study must satisfy every active facet.
 * Null/undefined facets are ignored (pass-through).
 */
export interface StudyFilter {
  /** Show only studies with this modality code (e.g. "CT", "MR") */
  modality?: string;
  /** Show only studies whose canonical body regions include ALL of these */
  regions?: string[];
  /** Show only angiographic studies */
  angiographic?: boolean;
  /** Show only studies with this laterality (e.g. "Left", "Right", "Bilateral") */
  laterality?: string;
  /** Show only studies tagged as relevant to the current exam */
  relevantOnly?: boolean;
}

/** Returns true if a StudyFilter has no active facets */
function isFilterEmpty(f: StudyFilter | null): boolean {
  if (!f) return true;
  return (
    !f.modality &&
    (!f.regions || f.regions.length === 0) &&
    !f.angiographic &&
    !f.laterality &&
    !f.relevantOnly
  );
}

// ── State Shape ──────────────────────────────────────────────────────────

/** Valid EHR data category keys for the patient data icon bar. */
export type EhrCategory =
  | 'radiology'
  | 'notes'
  | 'problems'
  | 'procedures'
  | 'pathology'
  | 'medications'
  | 'labs'
  | 'ai-summary'
  | 'erik';

/** A single ERIK chat message (user or assistant). */
export interface ErikMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** True while the streaming response is still arriving */
  streaming?: boolean;
}

/** Sort state for the unified SORT: bar */
export interface RailSort {
  field: 'name' | 'date';
  /** asc = A→Z / newest-first; desc = Z→A / oldest-first */
  direction: 'asc' | 'desc';
}

export interface CockpitState {
  /** Selected patient ID (e.g., "Patient_1") */
  selectedPatientId: string | null;
  /** Full patient record fetched from API */
  patientRecord: PatientRecord | null;
  /**
   * The current study the radiologist has selected to report on.
   * This is a "current" study — NOT one of the prior exams.
   * Contains the full CurrentStudy object with structured labels.
   */
  currentStudy: CurrentStudy | null;
  /** Index into the priors array for the selected prior */
  selectedPriorIndex: number | null;
  /** Whether auto-split compare mode is active */
  compareMode: boolean;
  /** Split ratio for compare mode (0.0–1.0, default 0.5) */
  compareSplitRatio: number;
  /** Whether the right QR rail is expanded */
  rightRailExpanded: boolean;
  /** Width of the left context rail in pixels */
  railWidth: number;
  /** Whether the left context rail is fully collapsed */
  railCollapsed: boolean;
  /** Active compound filter on the timeline (null = no filter) */
  activeFilter: StudyFilter | null;
  /** Whether priors should be sorted by relevance score descending */
  sortByRelevancy: boolean;
  /** Whether all summary peek panels are globally pinned open */
  allSummariesExpanded: boolean;
  /** Loading state for patient record fetch */
  loading: boolean;
  /** Error message from patient record fetch */
  error: string | null;
  /** AI Summarization pipeline status */
  summarizationStatus: 'idle' | 'loading' | 'complete' | 'error';
  /** Full pipeline response (null until complete) */
  summarizationResult: SummarizationResponse | null;
  /** Summarization error message */
  summarizationError: string | null;
  /** Whether the executive summary is visible in the main stage */
  showExecutiveSummary: boolean;
  /** Width of the right QA overlay panel in pixels (persisted across open/close) */
  actionPanelWidth: number;
  /** Number of top-N relevant priors to feed into the summarization pipeline */
  maxPriorsToSummarize: number;
  /** Number of top-N relevant clinical notes to analyze for problem extraction */
  maxNotesToAnalyze: number;
  /** Whether the EHR-integrated cockpit mode is active (demo toggle, defaults on) */
  ehrIntegrationEnabled: boolean;
  /** Currently active EHR data category in the patient data icon bar */
  activeEhrCategory: EhrCategory;
  /** FHIR-derived EHR data for the current patient (null if not loaded) */
  ehrData: EhrDataPayload | null;
  /** Loading state for EHR data fetch */
  ehrDataStatus: EhrDataStatus;
  /** ID of the selected clinical note for full-text display in the main stage */
  selectedNoteId: string | null;
  /** Active filter on the notes list */
  noteFilter: { specialty?: string; setting?: string } | null;
  /** Whether to filter notes to only show relevant ones */
  noteRelevantOnly: boolean;
  /** Whether to sort notes by relevance score (descending) */
  noteSortByRelevancy: boolean;
  /** Unified rail sort state (Name / Date with direction) */
  railSort: RailSort | null;
  /** ID of the selected problem for detail view */
  selectedProblemId: string | null;
  /** ID of the selected pathology report for full-text display in the main stage */
  selectedPathologyId: string | null;
  /** Active medication category filter (null = show all) */
  medCategoryFilter: string | null;
  /** Name of the selected lab panel for full table display in the main stage (e.g., "CBC") */
  selectedLabPanel: string | null;
  /** Whether to show Similar Prior Presentations in the executive summary (A/B testing toggle) */
  showSimilarPresentations: boolean;
  /** ERIK chat message history (persists across tab switches, clears on patient/study change) */
  erikMessages: ErikMessage[];
  /** Whether ERIK is currently streaming a response */
  erikStreaming: boolean;
  /** ERIK query queue — pending questions waiting for the current stream to finish (max 3) */
  erikQueue: string[];
  /** Cumulative token usage across all ERIK LLM passes */
  erikTotalTokens: { input: number; output: number };
  /** Most recent ERIK triage (Pass 1) QA data */
  erikLastTriage: ErikQAData | null;
  /** Most recent ERIK answer (Pass 2) QA data */
  erikLastAnswer: ErikQAData | null;
}

// ── Layout Persistence Helpers ───────────────────────────────────────────

const LS_KEY_RAIL_WIDTH = 'nv_railWidth';
const LS_KEY_SPLIT_RATIO = 'nv_compareSplitRatio';
const LS_KEY_ACTION_PANEL_WIDTH = 'nv_actionPanelWidth';
const LS_KEY_MAX_NOTES = 'nv_maxNotesToAnalyze';

/** Safely read a numeric value from localStorage. */
function readNumericLS(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Safely write a numeric value to localStorage. */
function writeNumericLS(key: string, value: number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* quota exceeded — ignore */ }
}

const INITIAL_STATE: CockpitState = {
  selectedPatientId: null,
  patientRecord: null,
  currentStudy: null,
  selectedPriorIndex: null,
  compareMode: false,
  compareSplitRatio: readNumericLS(LS_KEY_SPLIT_RATIO, 0.5),
  rightRailExpanded: false,
  railWidth: readNumericLS(LS_KEY_RAIL_WIDTH, 300),
  railCollapsed: false,
  activeFilter: null,
  sortByRelevancy: false,
  allSummariesExpanded: false,
  loading: false,
  error: null,
  summarizationStatus: 'idle',
  summarizationResult: null,
  summarizationError: null,
  showExecutiveSummary: false,
  actionPanelWidth: readNumericLS(LS_KEY_ACTION_PANEL_WIDTH, 360),
  maxPriorsToSummarize: 3,
  maxNotesToAnalyze: readNumericLS(LS_KEY_MAX_NOTES, 5),
  ehrIntegrationEnabled: true,
  activeEhrCategory: 'radiology',
  ehrData: null,
  ehrDataStatus: 'idle',
  selectedNoteId: null,
  noteFilter: null,
  noteRelevantOnly: false,
  noteSortByRelevancy: false,
  railSort: null,
  selectedProblemId: null,
  selectedPathologyId: null,
  medCategoryFilter: null,
  selectedLabPanel: null,
  showSimilarPresentations: true,
  erikMessages: [],
  erikStreaming: false,
  erikQueue: [],
  erikTotalTokens: { input: 0, output: 0 },
  erikLastTriage: null,
  erikLastAnswer: null,
};

// ── Actions ──────────────────────────────────────────────────────────────

type ToggleFilterFacetAction =
  | { type: 'TOGGLE_FILTER_FACET'; facet: 'modality'; value: string }
  | { type: 'TOGGLE_FILTER_FACET'; facet: 'region'; value: string }
  | { type: 'TOGGLE_FILTER_FACET'; facet: 'angiographic' }
  | { type: 'TOGGLE_FILTER_FACET'; facet: 'laterality'; value: string }
  | { type: 'TOGGLE_FILTER_FACET'; facet: 'relevantOnly' };

type CockpitAction =
  | { type: 'SELECT_PATIENT'; patientId: string }
  | { type: 'SET_PATIENT_RECORD'; record: PatientRecord | null; loading: boolean; error: string | null }
  | { type: 'SELECT_CURRENT_EXAM'; study: CurrentStudy }
  | { type: 'SELECT_PRIOR'; index: number }
  | { type: 'CLEAR_PRIOR' }
  | { type: 'TOGGLE_RIGHT_RAIL' }
  | { type: 'TOGGLE_RAIL_COLLAPSED' }
  | ToggleFilterFacetAction
  | { type: 'CLEAR_FILTER' }
  | { type: 'TOGGLE_SORT_BY_RELEVANCY' }
  | { type: 'SET_SORT_BY_RELEVANCY'; value: boolean }
  | { type: 'TOGGLE_ALL_SUMMARIES' }
  | { type: 'SET_RAIL_WIDTH'; width: number }
  | { type: 'SET_COMPARE_SPLIT_RATIO'; ratio: number }
  | { type: 'START_SUMMARIZATION' }
  | { type: 'SET_SUMMARIZATION_RESULT'; result: SummarizationResponse }
  | { type: 'SUMMARIZATION_ERROR'; error: string }
  | { type: 'TOGGLE_EXECUTIVE_SUMMARY' }
  | { type: 'SET_ACTION_PANEL_WIDTH'; width: number }
  | { type: 'SET_MAX_PRIORS'; count: number }
  | { type: 'SET_MAX_NOTES'; count: number }
  | { type: 'TOGGLE_EHR_INTEGRATION' }
  | { type: 'SET_ACTIVE_EHR_CATEGORY'; category: EhrCategory }
  | { type: 'EHR_DATA_LOADING' }
  | { type: 'EHR_DATA_LOADED'; payload: EhrDataPayload }
  | { type: 'EHR_DATA_UNAVAILABLE' }
  | { type: 'EHR_DATA_ERROR'; error: string }
  | { type: 'SELECT_NOTE'; noteId: string }
  | { type: 'CLEAR_NOTE' }
  | { type: 'TOGGLE_NOTE_FILTER'; facet: 'specialty' | 'setting'; value: string }
  | { type: 'CLEAR_NOTE_FILTER' }
  | { type: 'TOGGLE_NOTE_RELEVANT_ONLY' }
  | { type: 'SET_NOTE_SORT_BY_RELEVANCY'; value: boolean }
  | { type: 'TOGGLE_RAIL_SORT'; field: 'name' | 'date' }
  | { type: 'CLEAR_ALL_RAIL_FILTERS' }
  | { type: 'SELECT_PROBLEM'; problemId: string }
  | { type: 'CLEAR_PROBLEM' }
  | { type: 'SELECT_PATHOLOGY'; pathologyId: string }
  | { type: 'CLEAR_PATHOLOGY' }
  | { type: 'TOGGLE_MED_CATEGORY_FILTER'; category: string }
  | { type: 'SELECT_LAB_PANEL'; panelName: string }
  | { type: 'CLEAR_LAB_PANEL' }
  | { type: 'TOGGLE_SIMILAR_PRESENTATIONS' }
  | { type: 'ERIK_ADD_MESSAGE'; message: ErikMessage }
  | { type: 'ERIK_APPEND_DELTA'; messageId: string; content: string }
  | { type: 'ERIK_FINISH_STREAM'; messageId: string }
  | { type: 'ERIK_CLEAR_HISTORY' }
  | { type: 'ERIK_ENQUEUE'; question: string }
  | { type: 'ERIK_DEQUEUE' }
  | { type: 'ERIK_UPDATE_QA'; triage: ErikQAData | null; answer: ErikQAData | null };

/**
 * Handle TOGGLE_FILTER_FACET — adds, removes, or replaces a single facet
 * in the compound filter. Returns the new filter (or null if empty).
 */
function handleToggleFacet(current: StudyFilter | null, action: ToggleFilterFacetAction): StudyFilter | null {
  const f: StudyFilter = current ? { ...current } : {};

  switch (action.facet) {
    case 'modality':
      f.modality = f.modality === action.value ? undefined : action.value;
      break;

    case 'region': {
      const regions = f.regions ? [...f.regions] : [];
      const idx = regions.indexOf(action.value);
      if (idx >= 0) {
        regions.splice(idx, 1);
      } else {
        regions.push(action.value);
      }
      f.regions = regions.length > 0 ? regions : undefined;
      break;
    }

    case 'angiographic':
      f.angiographic = f.angiographic ? undefined : true;
      break;

    case 'laterality':
      f.laterality = f.laterality === action.value ? undefined : action.value;
      break;

    case 'relevantOnly':
      f.relevantOnly = f.relevantOnly ? undefined : true;
      break;
  }

  return isFilterEmpty(f) ? null : f;
}

function cockpitReducer(state: CockpitState, action: CockpitAction): CockpitState {
  switch (action.type) {
    case 'SELECT_PATIENT':
      return {
        ...INITIAL_STATE,
        selectedPatientId: action.patientId,
        loading: true,
        // EHR toggle is a UI preference — persist across patient switches
        ehrIntegrationEnabled: state.ehrIntegrationEnabled,
        // Clear EHR data on patient switch (will be re-fetched)
        ehrData: null,
        ehrDataStatus: 'idle',
        // Clear ERIK history on patient change
        erikMessages: [],
        erikStreaming: false,
        erikQueue: [],
        erikTotalTokens: { input: 0, output: 0 },
        erikLastTriage: null,
        erikLastAnswer: null,
      };

    case 'SET_PATIENT_RECORD':
      // Auto-select the first current study when patient loads
      // (ExamHeader removed — no manual selector available)
      const autoStudy = action.record?.currentStudies?.[0] ?? null;
      return {
        ...state,
        patientRecord: action.record,
        loading: action.loading,
        error: action.error,
        currentStudy: autoStudy,
      };

    case 'SELECT_CURRENT_EXAM':
      return {
        ...state,
        currentStudy: action.study,
        selectedPriorIndex: null,
        compareMode: false,
        // Reset summarization state when switching exams
        summarizationStatus: 'idle',
        summarizationResult: null,
        summarizationError: null,
        showExecutiveSummary: false,
        // Clear ERIK history on study change
        erikMessages: [],
        erikStreaming: false,
        erikQueue: [],
        erikTotalTokens: { input: 0, output: 0 },
        erikLastTriage: null,
        erikLastAnswer: null,
      };

    case 'SELECT_PRIOR':
      return {
        ...state,
        selectedPriorIndex: action.index,
        compareMode: true,
        showExecutiveSummary: false, // Mutual exclusivity
      };

    case 'CLEAR_PRIOR':
      return {
        ...state,
        selectedPriorIndex: null,
        compareMode: false,
      };

    case 'TOGGLE_RIGHT_RAIL':
      return { ...state, rightRailExpanded: !state.rightRailExpanded };

    case 'TOGGLE_RAIL_COLLAPSED':
      return { ...state, railCollapsed: !state.railCollapsed };

    case 'TOGGLE_FILTER_FACET':
      return {
        ...state,
        activeFilter: handleToggleFacet(state.activeFilter, action),
      };

    case 'CLEAR_FILTER':
      return { ...state, activeFilter: null, sortByRelevancy: false };

    case 'TOGGLE_SORT_BY_RELEVANCY':
      return { ...state, sortByRelevancy: !state.sortByRelevancy };

    case 'SET_SORT_BY_RELEVANCY':
      return { ...state, sortByRelevancy: action.value };

    case 'TOGGLE_ALL_SUMMARIES':
      return { ...state, allSummariesExpanded: !state.allSummariesExpanded };

    case 'SET_RAIL_WIDTH': {
      const rw = Math.max(180, Math.min(600, action.width));
      writeNumericLS(LS_KEY_RAIL_WIDTH, rw);
      return { ...state, railWidth: rw };
    }

    case 'SET_COMPARE_SPLIT_RATIO': {
      const sr = Math.max(0.25, Math.min(0.75, action.ratio));
      writeNumericLS(LS_KEY_SPLIT_RATIO, sr);
      return { ...state, compareSplitRatio: sr };
    }

    case 'START_SUMMARIZATION':
      return { ...state, summarizationStatus: 'loading', summarizationError: null };

    case 'SET_SUMMARIZATION_RESULT':
      return {
        ...state,
        summarizationStatus: 'complete',
        summarizationResult: action.result,
        showExecutiveSummary: true,
        // Close compare mode to show exec summary in split
        selectedPriorIndex: null,
        compareMode: false,
      };

    case 'SUMMARIZATION_ERROR':
      return {
        ...state,
        summarizationStatus: 'error',
        summarizationError: action.error,
      };

    case 'TOGGLE_EXECUTIVE_SUMMARY':
      return {
        ...state,
        showExecutiveSummary: !state.showExecutiveSummary,
        // When showing exec summary, close everything else in the left panel
        ...(!state.showExecutiveSummary ? {
          selectedPriorIndex: null,
          compareMode: false,
          selectedNoteId: null,
          selectedPathologyId: null,
          selectedLabPanel: null,
        } : {}),
      };

    case 'SET_ACTION_PANEL_WIDTH': {
      const apw = Math.max(220, Math.min(Math.floor(window.innerWidth * 0.5), action.width));
      writeNumericLS(LS_KEY_ACTION_PANEL_WIDTH, apw);
      return { ...state, actionPanelWidth: apw };
    }

    case 'SET_MAX_PRIORS':
      return { ...state, maxPriorsToSummarize: Math.max(1, Math.min(10, Math.floor(action.count))) };

    case 'SET_MAX_NOTES': {
      const n = Math.max(1, Math.min(20, Math.floor(action.count)));
      writeNumericLS(LS_KEY_MAX_NOTES, n);
      return { ...state, maxNotesToAnalyze: n };
    }

    case 'TOGGLE_EHR_INTEGRATION':
      return { ...state, ehrIntegrationEnabled: !state.ehrIntegrationEnabled };

    case 'SET_ACTIVE_EHR_CATEGORY':
      return {
        ...state,
        activeEhrCategory: action.category,
        // Clear note selection and filter when switching away from notes
        ...(action.category !== 'notes' ? { selectedNoteId: null, noteFilter: null, noteRelevantOnly: false, noteSortByRelevancy: false } : {}),
        // Reset sort on category switch; clear priors filter when leaving radiology
        railSort: null,
        ...(action.category !== 'radiology' ? { activeFilter: null, sortByRelevancy: false } : {}),
        selectedProblemId: null,
        // Clear pathology selection when switching away from pathology
        ...(action.category !== 'pathology' ? { selectedPathologyId: null } : {}),
        // Clear medication category filter when switching away from medications
        ...(action.category !== 'medications' ? { medCategoryFilter: null } : {}),
        // Clear lab panel selection when switching away from labs
        ...(action.category !== 'labs' ? { selectedLabPanel: null } : {}),
      };

    case 'EHR_DATA_LOADING':
      return { ...state, ehrDataStatus: 'loading' };

    case 'EHR_DATA_LOADED':
      return { ...state, ehrData: action.payload, ehrDataStatus: 'loaded' };

    case 'EHR_DATA_UNAVAILABLE':
      return { ...state, ehrData: null, ehrDataStatus: 'unavailable' };

    case 'EHR_DATA_ERROR':
      return { ...state, ehrData: null, ehrDataStatus: 'error' };

    case 'SELECT_NOTE':
      return {
        ...state,
        selectedNoteId: action.noteId,
        // Mutual exclusivity with compare mode and exec summary
        selectedPriorIndex: null,
        compareMode: false,
        showExecutiveSummary: false,
      };

    case 'CLEAR_NOTE':
      return { ...state, selectedNoteId: null };

    case 'TOGGLE_NOTE_FILTER': {
      const nf = state.noteFilter ? { ...state.noteFilter } : {};
      if (action.facet === 'specialty') {
        nf.specialty = nf.specialty === action.value ? undefined : action.value;
      } else {
        nf.setting = nf.setting === action.value ? undefined : action.value;
      }
      const hasFilter = nf.specialty || nf.setting;
      return { ...state, noteFilter: hasFilter ? nf : null };
    }

    case 'CLEAR_NOTE_FILTER':
      return { ...state, noteFilter: null };

    case 'TOGGLE_NOTE_RELEVANT_ONLY': {
      const next = !state.noteRelevantOnly;
      // If turning off the filter, also disable the sort
      return {
        ...state,
        noteRelevantOnly: next,
        noteSortByRelevancy: next ? state.noteSortByRelevancy : false,
      };
    }

    case 'SET_NOTE_SORT_BY_RELEVANCY':
      return { ...state, noteSortByRelevancy: action.value };

    case 'TOGGLE_RAIL_SORT': {
      const current = state.railSort;
      if (!current || current.field !== action.field) {
        // Activate this field, default direction
        return { ...state, railSort: { field: action.field, direction: 'asc' } };
      }
      if (current.direction === 'asc') {
        // Second click: reverse direction
        return { ...state, railSort: { field: action.field, direction: 'desc' } };
      }
      // Third click: deselect
      return { ...state, railSort: null };
    }

    case 'CLEAR_ALL_RAIL_FILTERS':
      return {
        ...state,
        railSort: null,
        activeFilter: null,
        noteFilter: null,
        noteRelevantOnly: false,
        noteSortByRelevancy: false,
        sortByRelevancy: false,
        medCategoryFilter: null,
      };

    case 'SELECT_PROBLEM':
      return {
        ...state,
        selectedProblemId: action.problemId,
        selectedPriorIndex: null,
        compareMode: false,
        showExecutiveSummary: false,
      };

    case 'CLEAR_PROBLEM':
      return { ...state, selectedProblemId: null };

    case 'SELECT_PATHOLOGY':
      return {
        ...state,
        selectedPathologyId: action.pathologyId,
        selectedPriorIndex: null,
        compareMode: false,
        showExecutiveSummary: false,
      };

    case 'CLEAR_PATHOLOGY':
      return { ...state, selectedPathologyId: null };

    case 'TOGGLE_MED_CATEGORY_FILTER':
      return {
        ...state,
        medCategoryFilter:
          state.medCategoryFilter === action.category ? null : action.category,
      };

    case 'SELECT_LAB_PANEL':
      return {
        ...state,
        selectedLabPanel:
          state.selectedLabPanel === action.panelName ? null : action.panelName,
        // Mutual exclusivity with compare mode, exec summary, notes, pathology
        selectedPriorIndex: null,
        compareMode: false,
        showExecutiveSummary: false,
        selectedNoteId: null,
        selectedPathologyId: null,
      };

    case 'CLEAR_LAB_PANEL':
      return { ...state, selectedLabPanel: null };

    case 'TOGGLE_SIMILAR_PRESENTATIONS':
      return { ...state, showSimilarPresentations: !state.showSimilarPresentations };

    // ── ERIK Chat ──────────────────────────────────────────────────
    case 'ERIK_ADD_MESSAGE':
      return {
        ...state,
        erikMessages: [...state.erikMessages, action.message],
        erikStreaming: action.message.role === 'assistant' && !!action.message.streaming,
      };

    case 'ERIK_APPEND_DELTA': {
      const msgs = state.erikMessages.map(m =>
        m.id === action.messageId
          ? { ...m, content: m.content + action.content }
          : m,
      );
      return { ...state, erikMessages: msgs };
    }

    case 'ERIK_FINISH_STREAM': {
      const msgs = state.erikMessages.map(m =>
        m.id === action.messageId
          ? { ...m, streaming: false }
          : m,
      );
      return { ...state, erikMessages: msgs, erikStreaming: false };
    }

    case 'ERIK_CLEAR_HISTORY':
      return { ...state, erikMessages: [], erikStreaming: false, erikQueue: [],
        erikTotalTokens: { input: 0, output: 0 }, erikLastTriage: null, erikLastAnswer: null };

    case 'ERIK_ENQUEUE': {
      if (state.erikQueue.length >= 3) {
        // Queue is full — insert a system warning message instead of queuing
        return {
          ...state,
          erikMessages: [...state.erikMessages, {
            id: `system-${Date.now()}`,
            role: 'assistant',
            content: 'Maximum of 3 queued questions reached. Please wait for current responses to complete.',
            timestamp: Date.now(),
          }],
        };
      }
      return { ...state, erikQueue: [...state.erikQueue, action.question] };
    }

    case 'ERIK_DEQUEUE':
      return { ...state, erikQueue: state.erikQueue.slice(1) };

    case 'ERIK_UPDATE_QA': {
      const triageTokens = action.triage?.tokens ?? { input: 0, output: 0 };
      const answerTokens = action.answer?.tokens ?? { input: 0, output: 0 };
      return {
        ...state,
        erikTotalTokens: {
          input: state.erikTotalTokens.input + triageTokens.input + answerTokens.input,
          output: state.erikTotalTokens.output + triageTokens.output + answerTokens.output,
        },
        erikLastTriage: action.triage ?? state.erikLastTriage,
        erikLastAnswer: action.answer ?? state.erikLastAnswer,
      };
    }

    default:
      return state;
  }
}

// ── Context Shape ────────────────────────────────────────────────────────

interface CockpitContextValue {
  state: CockpitState;
  selectPatient: (id: string) => void;
  selectCurrentExam: (study: CurrentStudy) => void;
  selectPrior: (index: number) => void;
  clearPrior: () => void;
  toggleRightRail: () => void;
  toggleRailCollapsed: () => void;
  toggleFilterFacet: {
    (facet: 'modality', value: string): void;
    (facet: 'region', value: string): void;
    (facet: 'angiographic'): void;
    (facet: 'laterality', value: string): void;
    (facet: 'relevantOnly'): void;
  };
  clearFilter: () => void;
  toggleSortByRelevancy: () => void;
  setSortByRelevancy: (value: boolean) => void;
  toggleAllSummaries: () => void;
  setRailWidth: (width: number) => void;
  setCompareSplitRatio: (ratio: number) => void;
  triggerSummarization: () => void;
  toggleExecutiveSummary: () => void;
  setMaxPriorsToSummarize: (count: number) => void;
  setMaxNotesToAnalyze: (count: number) => void;
  setActionPanelWidth: (width: number) => void;
  toggleEhrIntegration: () => void;
  setActiveEhrCategory: (category: EhrCategory) => void;
  selectNote: (noteId: string) => void;
  clearNote: () => void;
  toggleNoteFilter: (facet: 'specialty' | 'setting', value: string) => void;
  clearNoteFilter: () => void;
  toggleNoteRelevantOnly: () => void;
  setNoteSortByRelevancy: (value: boolean) => void;
  toggleRailSort: (field: 'name' | 'date') => void;
  clearAllRailFilters: () => void;
  selectProblem: (problemId: string) => void;
  clearProblem: () => void;
  selectPathology: (pathologyId: string) => void;
  clearPathology: () => void;
  toggleMedCategoryFilter: (category: string) => void;
  selectLabPanel: (panelName: string) => void;
  clearLabPanel: () => void;
  toggleSimilarPresentations: () => void;
  /** ERIK chat dispatch — raw dispatcher for fine-grained control */
  erikDispatch: React.Dispatch<CockpitAction>;
  /** Ref for persistent executive summary view state (survives unmount). */
  execViewStateRef: MutableRefObject<ExecViewState | null>;
}

const CockpitContext = createContext<CockpitContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────

interface CockpitProviderProps {
  children: ReactNode;
}

export function CockpitProvider({ children }: CockpitProviderProps) {
  const [state, dispatch] = useReducer(cockpitReducer, INITIAL_STATE);

  // Persistent ref for executive summary expansion state
  const execViewStateRef = useRef<ExecViewState | null>(null);

  // Fetch patient record when selectedPatientId changes
  const { patientRecord, loading, error } = usePatientRecord(state.selectedPatientId);

  useEffect(() => {
    dispatch({
      type: 'SET_PATIENT_RECORD',
      record: patientRecord,
      loading,
      error,
    });
  }, [patientRecord, loading, error]);

  // Fetch EHR (FHIR) data when a patient is selected
  useEffect(() => {
    if (!state.selectedPatientId) return;

    // Extract patient number from ID (e.g., "Patient_1" → 1)
    const match = state.selectedPatientId.match(/(\d+)/);
    const patientNumber = match ? parseInt(match[1], 10) : null;
    if (!patientNumber) return;

    dispatch({ type: 'EHR_DATA_LOADING' });

    fetchEhrData(patientNumber)
      .then((data) => {
        if (data.available) {
          dispatch({ type: 'EHR_DATA_LOADED', payload: data });
        } else {
          dispatch({ type: 'EHR_DATA_UNAVAILABLE' });
        }
      })
      .catch((err) => {
        console.error('[EHR] Failed to load EHR data:', err);
        dispatch({ type: 'EHR_DATA_ERROR', error: err.message || 'Failed to load EHR data' });
      });
  }, [state.selectedPatientId]);

  // ── Stable action creators ────────────────────────────────────────────

  const selectPatient = useCallback((id: string) => {
    dispatch({ type: 'SELECT_PATIENT', patientId: id });
  }, []);

  const selectCurrentExam = useCallback((study: CurrentStudy) => {
    dispatch({ type: 'SELECT_CURRENT_EXAM', study });
  }, []);

  const selectPrior = useCallback((index: number) => {
    dispatch({ type: 'SELECT_PRIOR', index });
  }, []);

  const clearPrior = useCallback(() => {
    dispatch({ type: 'CLEAR_PRIOR' });
  }, []);

  const toggleRightRail = useCallback(() => {
    dispatch({ type: 'TOGGLE_RIGHT_RAIL' });
  }, []);

  const toggleRailCollapsed = useCallback(() => {
    dispatch({ type: 'TOGGLE_RAIL_COLLAPSED' });
  }, []);

  const toggleFilterFacet = useCallback((facet: string, value?: string) => {
    switch (facet) {
      case 'modality':
        dispatch({ type: 'TOGGLE_FILTER_FACET', facet: 'modality', value: value! });
        break;
      case 'region':
        dispatch({ type: 'TOGGLE_FILTER_FACET', facet: 'region', value: value! });
        break;
      case 'angiographic':
        dispatch({ type: 'TOGGLE_FILTER_FACET', facet: 'angiographic' });
        break;
      case 'laterality':
        dispatch({ type: 'TOGGLE_FILTER_FACET', facet: 'laterality', value: value! });
        break;
      case 'relevantOnly':
        dispatch({ type: 'TOGGLE_FILTER_FACET', facet: 'relevantOnly' });
        break;
    }
  }, []) as CockpitContextValue['toggleFilterFacet'];

  const clearFilter = useCallback(() => {
    dispatch({ type: 'CLEAR_FILTER' });
  }, []);

  const toggleSortByRelevancy = useCallback(() => {
    dispatch({ type: 'TOGGLE_SORT_BY_RELEVANCY' });
  }, []);

  const setSortByRelevancy = useCallback((value: boolean) => {
    dispatch({ type: 'SET_SORT_BY_RELEVANCY', value });
  }, []);

  const toggleAllSummaries = useCallback(() => {
    dispatch({ type: 'TOGGLE_ALL_SUMMARIES' });
  }, []);

  const setRailWidth = useCallback((width: number) => {
    dispatch({ type: 'SET_RAIL_WIDTH', width });
  }, []);

  const setCompareSplitRatio = useCallback((ratio: number) => {
    dispatch({ type: 'SET_COMPARE_SPLIT_RATIO', ratio });
  }, []);

  // ── Debounced server sync for layout preferences ─────────────────────
  //
  // Merges the three layout values into the user's existing preferences.json
  // via GET + PUT (merge), debounced at 800ms after the last change.
  const layoutSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRailWidth = useRef(state.railWidth);
  const initialSplitRatio = useRef(state.compareSplitRatio);
  const initialActionPanelWidth = useRef(state.actionPanelWidth);

  useEffect(() => {
    // Skip on first render (initial values haven't changed yet)
    if (
      state.railWidth === initialRailWidth.current &&
      state.compareSplitRatio === initialSplitRatio.current &&
      state.actionPanelWidth === initialActionPanelWidth.current
    ) return;

    if (layoutSyncTimer.current) clearTimeout(layoutSyncTimer.current);
    layoutSyncTimer.current = setTimeout(async () => {
      try {
        // Fetch current preferences so we don't clobber non-layout fields
        const res = await fetch('/api/user/preferences');
        if (!res.ok) return;
        const prefs = await res.json();

        // Merge layout values
        prefs.layout = {
          railWidth: state.railWidth,
          compareSplitRatio: state.compareSplitRatio,
          actionPanelWidth: state.actionPanelWidth,
        };

        await fetch('/api/user/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
        });
      } catch {
        // Fail silently — localStorage already has the values
      }
    }, 800);

    return () => {
      if (layoutSyncTimer.current) clearTimeout(layoutSyncTimer.current);
    };
  }, [state.railWidth, state.compareSplitRatio, state.actionPanelWidth]);

  // Track latest state values in refs for the async summarization callback
  const patientIdRef = useRef(state.selectedPatientId);
  const currentStudyRef = useRef(state.currentStudy);
  const summStatusRef = useRef(state.summarizationStatus);
  const maxPriorsRef = useRef(state.maxPriorsToSummarize);
  const maxNotesRef = useRef(state.maxNotesToAnalyze);
  useEffect(() => {
    patientIdRef.current = state.selectedPatientId;
    currentStudyRef.current = state.currentStudy;
    summStatusRef.current = state.summarizationStatus;
    maxPriorsRef.current = state.maxPriorsToSummarize;
    maxNotesRef.current = state.maxNotesToAnalyze;
  });

  const triggerSummarization = useCallback(async () => {
    const patientId = patientIdRef.current;
    const cs = currentStudyRef.current;
    if (!patientId || !cs) return;

    // If already complete, just toggle visibility
    if (summStatusRef.current === 'complete') {
      dispatch({ type: 'TOGGLE_EXECUTIVE_SUMMARY' });
      return;
    }

    // If already loading, ignore
    if (summStatusRef.current === 'loading') return;

    dispatch({ type: 'START_SUMMARIZATION' });

    try {
      const result = await api.summarize(patientId, cs.currentStudyId, maxPriorsRef.current, maxNotesRef.current);
      dispatch({ type: 'SET_SUMMARIZATION_RESULT', result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Summarization failed';
      dispatch({ type: 'SUMMARIZATION_ERROR', error: msg });
    }
  }, []);

  const toggleExecutiveSummary = useCallback(() => {
    dispatch({ type: 'TOGGLE_EXECUTIVE_SUMMARY' });
  }, []);

  const setActionPanelWidth = useCallback((width: number) => {
    dispatch({ type: 'SET_ACTION_PANEL_WIDTH', width });
  }, []);

  const setMaxPriorsToSummarize = useCallback((count: number) => {
    dispatch({ type: 'SET_MAX_PRIORS', count });
  }, []);

  const setMaxNotesToAnalyze = useCallback((count: number) => {
    dispatch({ type: 'SET_MAX_NOTES', count });
  }, []);

  const toggleEhrIntegration = useCallback(() => {
    dispatch({ type: 'TOGGLE_EHR_INTEGRATION' });
  }, []);

  const setActiveEhrCategory = useCallback((category: EhrCategory) => {
    dispatch({ type: 'SET_ACTIVE_EHR_CATEGORY', category });
  }, []);

  const selectNote = useCallback((noteId: string) => {
    dispatch({ type: 'SELECT_NOTE', noteId });
  }, []);

  const clearNote = useCallback(() => {
    dispatch({ type: 'CLEAR_NOTE' });
  }, []);

  const toggleNoteFilter = useCallback((facet: 'specialty' | 'setting', value: string) => {
    dispatch({ type: 'TOGGLE_NOTE_FILTER', facet, value });
  }, []);

  const clearNoteFilter = useCallback(() => {
    dispatch({ type: 'CLEAR_NOTE_FILTER' });
  }, []);

  const toggleNoteRelevantOnly = useCallback(() => {
    dispatch({ type: 'TOGGLE_NOTE_RELEVANT_ONLY' });
  }, []);

  const setNoteSortByRelevancy = useCallback((value: boolean) => {
    dispatch({ type: 'SET_NOTE_SORT_BY_RELEVANCY', value });
  }, []);

  const toggleRailSort = useCallback((field: 'name' | 'date') => {
    dispatch({ type: 'TOGGLE_RAIL_SORT', field });
  }, []);

  const clearAllRailFilters = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_RAIL_FILTERS' });
  }, []);

  const selectProblem = useCallback((problemId: string) => {
    dispatch({ type: 'SELECT_PROBLEM', problemId });
  }, []);

  const clearProblem = useCallback(() => {
    dispatch({ type: 'CLEAR_PROBLEM' });
  }, []);

  const selectPathology = useCallback((pathologyId: string) => {
    dispatch({ type: 'SELECT_PATHOLOGY', pathologyId });
  }, []);

  const clearPathology = useCallback(() => {
    dispatch({ type: 'CLEAR_PATHOLOGY' });
  }, []);

  const toggleMedCategoryFilter = useCallback((category: string) => {
    dispatch({ type: 'TOGGLE_MED_CATEGORY_FILTER', category });
  }, []);

  const selectLabPanel = useCallback((panelName: string) => {
    dispatch({ type: 'SELECT_LAB_PANEL', panelName });
  }, []);

  const clearLabPanel = useCallback(() => {
    dispatch({ type: 'CLEAR_LAB_PANEL' });
  }, []);

  const toggleSimilarPresentations = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIMILAR_PRESENTATIONS' });
  }, []);

  const contextValue: CockpitContextValue = {
    state,
    selectPatient,
    selectCurrentExam,
    selectPrior,
    clearPrior,
    toggleRightRail,
    toggleRailCollapsed,
    toggleFilterFacet,
    clearFilter,
    toggleSortByRelevancy,
    setSortByRelevancy,
    toggleAllSummaries,
    setRailWidth,
    setCompareSplitRatio,
    triggerSummarization,
    toggleExecutiveSummary,
    setActionPanelWidth,
    setMaxPriorsToSummarize,
    setMaxNotesToAnalyze,
    toggleEhrIntegration,
    setActiveEhrCategory,
    selectNote,
    clearNote,
    toggleNoteFilter,
    clearNoteFilter,
    toggleNoteRelevantOnly,
    setNoteSortByRelevancy,
    toggleRailSort,
    clearAllRailFilters,
    selectProblem,
    clearProblem,
    selectPathology,
    clearPathology,
    toggleMedCategoryFilter,
    selectLabPanel,
    clearLabPanel,
    toggleSimilarPresentations,
    erikDispatch: dispatch,
    execViewStateRef,
  };

  return (
    <CockpitContext.Provider value={contextValue}>
      {children}
    </CockpitContext.Provider>
  );
}

// ── Consumer Hook ────────────────────────────────────────────────────────

export function useCockpit(): CockpitContextValue {
  const context = useContext(CockpitContext);
  if (!context) {
    throw new Error('useCockpit must be used within a CockpitProvider');
  }
  return context;
}
