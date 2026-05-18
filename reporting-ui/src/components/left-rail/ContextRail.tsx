/**
 * ContextRail — Left rail with "Reason for Study" card, optional EHR-integrated
 * patient data bar + ERIK search bar, filter bar, and scrollable content area.
 *
 * Supports two modes controlled by `ehrIntegrationEnabled`:
 *   - Classic: AI Summary full-width button + prior study timeline
 *   - EHR-integrated: Patient Data Icon Bar (8 icons) + ERIK search bar +
 *     category-specific content (prior cards for Radiology, placeholders for others)
 *
 * All patient studies are treated as priors (no filtering out a "current" study),
 * since the current exam is a hypothetical new study.
 *
 * Relevance is computed per-study based on the selected current exam label
 * using placeholder body-region matching (see utils/relevance.ts).
 */

import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './ContextRail.css';
import { SparkleIcon } from '../icons/SummaryIcons';
import {
  RadiologyIcon,
  NotesIcon,
  PathologyIcon,
  ProblemsIcon,
  ProceduresIcon,
  MedicationsIcon,
  LabsIcon,
  BrainIcon,
} from '../icons/EhrIcons';
import { SearchIcon } from '../icons/SummaryIcons';
import { useCockpit } from '../../context/CockpitContext';
import type { StudyFilter, EhrCategory } from '../../context/CockpitContext';
import { sendErikChat } from '../../services/erikService';
import { PriorStudyCard } from './PriorStudyCard';
import { NoteCard } from './NoteCard';
import { ProblemCard } from './ProblemCard';
import { ProcedureCard } from './ProcedureCard';
import { PathologyCard } from './PathologyCard';
import { MedicationCard } from './MedicationCard';
import { LabCategoryCard } from './LabCategoryCard';
import { TimelineSection } from './TimelineSection';

import { extractYear } from '../../utils/dates';
import type { EhrNote, EhrProblem, EhrProcedure, EhrPathologyReport, EhrMedication, NoteRelevanceResult } from '../../types/ehrTypes';
import type { LabPanel } from '../../types/ehrTypes';
import { getRelevanceResult } from '../../utils/relevance';
import { isNoteAnalyzed } from '../../utils/note-snippet-highlighter';
import type { Study, RelevanceResult } from '../../types/api';

// Specialty alias lookup for abbreviated filter chip labels
import specialtyAliasesRaw from '../../data/specialty_aliases.json';
const SPECIALTY_LOOKUP: Map<string, string> = new Map(
  Object.entries(specialtyAliasesRaw as Record<string, string>).map(
    ([key, abbrev]) => [key.toLowerCase(), abbrev],
  ),
);
function abbrevSpecialty(s: string): string {
  return SPECIALTY_LOOKUP.get(s.toLowerCase()) ?? s;
}
const SETTING_ABBREV: Record<string, string> = {
  'Inpatient': 'IP', 'Outpatient': 'OP', 'Emergency Department': 'ED',
};

/** Icon bar definition — order matters (matches legacy prototype layout). */
const EHR_ICONS: { category: EhrCategory; label: string; Icon: React.ComponentType<{ className?: string; size?: number }> }[] = [
  { category: 'radiology',   label: 'Radiology Reports', Icon: RadiologyIcon },
  { category: 'notes',       label: 'Notes',             Icon: NotesIcon },
  { category: 'problems',    label: 'Problems',          Icon: ProblemsIcon },
  { category: 'procedures',  label: 'Procedures',        Icon: ProceduresIcon },
  { category: 'pathology',   label: 'Pathology',         Icon: PathologyIcon },
  { category: 'medications', label: 'Medications',       Icon: MedicationsIcon },
  { category: 'labs',        label: 'Labs',              Icon: LabsIcon },
  { category: 'ai-summary',  label: 'AI Summary',        Icon: SparkleIcon },
];

/** Placeholder display names for categories without data yet. */
const PLACEHOLDER_TEXT: Record<string, string> = {
  pathology:   'Pathology reports will appear here',
  problems:    'Problem list will appear here',
  procedures:  'Procedure history will appear here',
  medications: 'Medication list will appear here',
  erik:        "ERIK's Responses Will Display Here",
};

/** Group studies by year, maintaining chronological order within each group */
function groupByYear(studies: Study[]): Map<string, Study[]> {
  const groups = new Map<string, Study[]>();
  for (const study of studies) {
    const year = extractYear(study.studyDateTime);
    const existing = groups.get(year);
    if (existing) {
      existing.push(study);
    } else {
      groups.set(year, [study]);
    }
  }
  return groups;
}

/** Group notes by year, maintaining chronological order within each group */
function groupNotesByYear(notes: EhrNote[]): Map<string, EhrNote[]> {
  const groups = new Map<string, EhrNote[]>();
  for (const note of notes) {
    const year = extractYear(note.date);
    const existing = groups.get(year);
    if (existing) {
      existing.push(note);
    } else {
      groups.set(year, [note]);
    }
  }
  return groups;
}

/** Group problems by year using recordedDate */
function groupProblemsByYear(problems: EhrProblem[]): Map<string, EhrProblem[]> {
  const groups = new Map<string, EhrProblem[]>();
  for (const p of problems) {
    const year = extractYear(p.recordedDate);
    const existing = groups.get(year);
    if (existing) {
      existing.push(p);
    } else {
      groups.set(year, [p]);
    }
  }
  return groups;
}

/** Group procedures by year using date */
function groupProceduresByYear(procedures: EhrProcedure[]): Map<string, EhrProcedure[]> {
  const groups = new Map<string, EhrProcedure[]>();
  for (const p of procedures) {
    const year = extractYear(p.date);
    const existing = groups.get(year);
    if (existing) {
      existing.push(p);
    } else {
      groups.set(year, [p]);
    }
  }
  return groups;
}

/** Group pathology reports by year using date */
function groupPathologyByYear(reports: EhrPathologyReport[]): Map<string, EhrPathologyReport[]> {
  const groups = new Map<string, EhrPathologyReport[]>();
  for (const r of reports) {
    const year = extractYear(r.date);
    const existing = groups.get(year);
    if (existing) {
      existing.push(r);
    } else {
      groups.set(year, [r]);
    }
  }
  return groups;
}

function buildFilterChips(f: StudyFilter): { label: string; facet: string; value?: string }[] {
  const chips: { label: string; facet: string; value?: string }[] = [];

  if (f.modality) {
    chips.push({ label: f.modality, facet: 'modality', value: f.modality });
  }
  if (f.regions?.length) {
    for (const r of f.regions) {
      chips.push({ label: r, facet: 'region', value: r });
    }
  }
  if (f.angiographic) {
    chips.push({ label: 'Angio', facet: 'angiographic' });
  }
  if (f.laterality) {
    chips.push({ label: f.laterality, facet: 'laterality', value: f.laterality });
  }
  if (f.relevantOnly) {
    chips.push({ label: 'Relevant', facet: 'relevantOnly' });
  }

  return chips;
}

export function ContextRail() {
  const {
    state,
    clearFilter,
    toggleFilterFacet,
    toggleSortByRelevancy,
    triggerSummarization,
    setActiveEhrCategory,
    toggleNoteFilter,
    clearNoteFilter,
    toggleNoteRelevantOnly,
    setNoteSortByRelevancy,
    toggleRailSort,
    clearAllRailFilters,
    toggleMedCategoryFilter,
    selectLabPanel,
    clearLabPanel,
    erikDispatch,
  } = useCockpit();

  // ── ERIK Chat State ──
  const [erikInput, setErikInput] = useState('');
  const [erikStatus, setErikStatus] = useState<string | null>(null);
  const erikChatRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (erikChatRef.current) {
      erikChatRef.current.scrollTop = erikChatRef.current.scrollHeight;
    }
  }, [state.erikMessages, erikStatus]);

  // Clear status when streaming finishes
  useEffect(() => {
    if (!state.erikStreaming) {
      setErikStatus(null);
    }
  }, [state.erikStreaming]);

  /**
   * Execute an ERIK query immediately (send to the chat API).
   * Extracted as a standalone helper so both handleErikSubmit and
   * the queue processor can invoke it without duplicating logic.
   */
  const executeErikQuery = useCallback((question: string) => {
    // Build conversation history from existing messages
    const history = state.erikMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    sendErikChat(
      {
        question,
        patientId: state.selectedPatientId!,
        currentStudyId: state.currentStudy?.currentStudyId ?? null,
        conversationHistory: history,
      },
      erikDispatch,
      (_phase: string, message: string) => setErikStatus(message),
    );
  }, [state.selectedPatientId, state.currentStudy, state.erikMessages, erikDispatch]);

  const handleErikSubmit = useCallback(() => {
    const question = erikInput.trim();
    if (!question) return;
    if (!state.selectedPatientId) return;

    // Add user message bubble immediately
    erikDispatch({
      type: 'ERIK_ADD_MESSAGE',
      message: {
        id: `user-${Date.now()}`,
        role: 'user',
        content: question,
        timestamp: Date.now(),
      },
    });

    setErikInput('');

    if (state.erikStreaming) {
      // Currently streaming — queue the question for later execution
      erikDispatch({ type: 'ERIK_ENQUEUE', question });
      return;
    }

    // Execute immediately
    executeErikQuery(question);
  }, [erikInput, state.erikStreaming, state.selectedPatientId, erikDispatch, executeErikQuery]);

  // ── ERIK Queue Processor: auto-dequeue when streaming finishes ──
  useEffect(() => {
    if (!state.erikStreaming && state.erikQueue.length > 0) {
      const nextQuestion = state.erikQueue[0];
      erikDispatch({ type: 'ERIK_DEQUEUE' });
      executeErikQuery(nextQuestion);
    }
  }, [state.erikStreaming, state.erikQueue, erikDispatch, executeErikQuery]);

  // ── REPORTING:ERIK_QUERY postMessage listener (voice command bridge) ──
  useEffect(() => {
    function handleErikVoiceMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'REPORTING:ERIK_QUERY') return;

      const question = event.data.payload?.question;
      if (!question || !state.selectedPatientId) return;

      console.log(`[ContextRail] Received REPORTING:ERIK_QUERY: "${question}"`);

      // Switch to ERIK view (preserves cursor focus in reporting iframe)
      setActiveEhrCategory('erik');

      // Add user message bubble
      erikDispatch({
        type: 'ERIK_ADD_MESSAGE',
        message: {
          id: `user-${Date.now()}`,
          role: 'user',
          content: question,
          timestamp: Date.now(),
        },
      });

      if (state.erikStreaming) {
        erikDispatch({ type: 'ERIK_ENQUEUE', question });
      } else {
        executeErikQuery(question);
      }
    }

    window.addEventListener('message', handleErikVoiceMessage);
    return () => window.removeEventListener('message', handleErikVoiceMessage);
  }, [state.erikStreaming, state.selectedPatientId, erikDispatch, executeErikQuery, setActiveEhrCategory]);

  const ehrEnabled = state.ehrIntegrationEnabled;
  const activeCategory = state.activeEhrCategory;

  // All studies are priors — sorted by date descending
  const priors = useMemo(() => {
    if (!state.patientRecord) return [];
    return [...state.patientRecord.studies].sort((a, b) => {
      if (b.studyDateTime > a.studyDateTime) return 1;
      if (b.studyDateTime < a.studyDateTime) return -1;
      return 0;
    });
  }, [state.patientRecord]);

  // Look up pre-computed relevance for each study from the server's score matrix
  const relevanceMap = useMemo(() => {
    const map = new Map<number, RelevanceResult | null>();
    const currentStudyId = state.currentStudy?.currentStudyId;
    const scores = state.patientRecord?.relevanceScores;
    for (const study of priors) {
      map.set(
        study.sequence,
        getRelevanceResult(currentStudyId, study.sequence, scores),
      );
    }
    return map;
  }, [priors, state.currentStudy, state.patientRecord?.relevanceScores]);

  // Apply compound filter — all active facets are AND'd
  const filteredPriors = useMemo(() => {
    const f = state.activeFilter;
    if (!f) return priors;

    return priors.filter((study) => {
      const labels = study.labels;

      // Modality facet
      if (f.modality && (labels?.modality ?? 'NA') !== f.modality) return false;

      // Regions facet — study must have ALL requested canonical regions
      if (f.regions?.length) {
        const studyRegions = new Set(labels?.bodyRegions ?? []);
        if (!f.regions.every((r) => studyRegions.has(r))) return false;
      }

      // Angiographic facet
      if (f.angiographic && !labels?.isAngiographic) return false;

      // Laterality facet — compare display-cased values
      if (f.laterality) {
        const studyLat = labels?.laterality
          ? labels.laterality.charAt(0).toUpperCase() + labels.laterality.slice(1)
          : null;
        if (studyLat !== f.laterality) return false;
      }

      // Relevant-only facet
      if (f.relevantOnly && !(relevanceMap.get(study.sequence)?.isRelevant)) return false;

      return true;
    });
  }, [priors, state.activeFilter, relevanceMap]);

  // When sortByRelevancy is active, re-sort filtered priors by score descending
  const displayPriors = useMemo(() => {
    if (!state.sortByRelevancy) return filteredPriors;

    return [...filteredPriors].sort((a, b) => {
      const scoreA = relevanceMap.get(a.sequence)?.percentage ?? 0;
      const scoreB = relevanceMap.get(b.sequence)?.percentage ?? 0;
      if (Math.abs(scoreB - scoreA) > 0.0001) return scoreB - scoreA;
      // Tiebreaker: more recent study first
      if (b.studyDateTime > a.studyDateTime) return 1;
      if (b.studyDateTime < a.studyDateTime) return -1;
      return 0;
    });
  }, [filteredPriors, state.sortByRelevancy, relevanceMap]);

  // Build an index map so each PriorStudyCard knows its position in the full priors array
  const priorIndexMap = useMemo(() => {
    const map = new Map<number, number>(); // study sequence → index in priors array
    priors.forEach((study, idx) => {
      map.set(study.sequence, idx);
    });
    return map;
  }, [priors]);

  // Reference date for relative age — use the current study's dateTime, not today's date
  const referenceDateTime = state.currentStudy?.studyDateTime
    ?? (priors.length > 0 ? priors[0].studyDateTime : '');

  // Active filter chips for the filter bar
  const filterChips = useMemo(
    () => (state.activeFilter ? buildFilterChips(state.activeFilter) : []),
    [state.activeFilter],
  );

  // Build findings lookup from summarization results (accession → findings[])
  const findingsMap = useMemo(() => {
    const map = new Map<string, import('../../types/api').ExtractedFinding[]>();
    if (state.summarizationResult) {
      for (const analysis of state.summarizationResult.individualAnalyses) {
        map.set(analysis.accessionNumber, analysis.findings);
      }
    }
    return map;
  }, [state.summarizationResult]);

  // Whether the sort indicator should show in the filter bar
  const showSortIndicator = state.sortByRelevancy;

  // Handle EHR icon click — special behavior for AI Summary
  const handleEhrIconClick = useCallback((category: EhrCategory) => {
    if (category === 'ai-summary') {
      // Trigger the existing summarization pipeline / toggle the executive summary.
      // Do NOT change the active rail category — the AI Summary only affects the main stage.
      triggerSummarization();
    } else {
      setActiveEhrCategory(category);
    }
  }, [triggerSummarization, setActiveEhrCategory]);

  // Determine whether to show priors content (radiology category active, or classic mode)
  const showPriorsContent = !ehrEnabled || activeCategory === 'radiology';

  // Determine whether to show the Notes list
  const showNotesContent = ehrEnabled && activeCategory === 'notes';

  // Determine whether to show the Problems list
  const showProblemsContent = ehrEnabled && activeCategory === 'problems';

  // Determine whether to show the Procedures list
  const showProceduresContent = ehrEnabled && activeCategory === 'procedures';

  // Determine whether to show the Pathology list
  const showPathologyContent = ehrEnabled && activeCategory === 'pathology';

  // Determine whether to show the Medications list
  const showMedicationsContent = ehrEnabled && activeCategory === 'medications';

  // Determine whether to show the Labs list
  const showLabsContent = ehrEnabled && activeCategory === 'labs';

  // Determine whether to show the ERIK placeholder
  const showErikContent = ehrEnabled && activeCategory === 'erik';

  // Determine whether to show placeholder content
  const showPlaceholder = ehrEnabled
    && activeCategory !== 'radiology'
    && activeCategory !== 'notes'
    && activeCategory !== 'problems'
    && activeCategory !== 'procedures'
    && activeCategory !== 'pathology'
    && activeCategory !== 'medications'
    && activeCategory !== 'labs'
    && activeCategory !== 'ai-summary'
    && activeCategory !== 'erik';

  // ── Rail sort state ────────────────────────────────────────────────────
  const railSort = state.railSort;
  const showYearGroups = !railSort || railSort.field !== 'name';

  // ── Notes filtering ───────────────────────────────────────────────────
  const ehrNotes = state.ehrData?.notes ?? [];

  const filteredNotes = useMemo(() => {
    const nf = state.noteFilter;
    if (!nf) return ehrNotes;
    return ehrNotes.filter((note) => {
      if (nf.specialty && note.specialty !== nf.specialty) return false;
      if (nf.setting && note.setting !== nf.setting) return false;
      return true;
    });
  }, [ehrNotes, state.noteFilter]);

  // ── Note relevance lookup ─────────────────────────────────────────────
  // Build a Map<noteId, NoteRelevanceResult> for the currently selected study
  const noteRelevanceMap = useMemo(() => {
    const map = new Map<string, NoteRelevanceResult>();
    const currentStudyId = state.currentStudy?.currentStudyId;
    if (!currentStudyId || !state.ehrData?.noteRelevance) return map;
    const results = state.ehrData.noteRelevance[currentStudyId];
    if (!results) return map;
    for (const r of results) {
      map.set(r.noteId, r);
    }
    return map;
  }, [state.currentStudy?.currentStudyId, state.ehrData?.noteRelevance]);

  // Apply rail sort to notes
  const displayNotes = useMemo(() => {
    let notes = filteredNotes;

    // Relevance-only filter
    if (state.noteRelevantOnly) {
      notes = notes.filter((n) => noteRelevanceMap.get(n.id)?.isRelevant);
    }

    // Sort by relevance score (descending) when active
    if (state.noteSortByRelevancy) {
      const sorted = [...notes];
      sorted.sort((a, b) => {
        const aScore = noteRelevanceMap.get(a.id)?.normalizedPercent ?? 0;
        const bScore = noteRelevanceMap.get(b.id)?.normalizedPercent ?? 0;
        return bScore - aScore;
      });
      return sorted;
    }

    // Standard rail sort
    if (!railSort) return notes;
    const sorted = [...notes];
    if (railSort.field === 'name') {
      sorted.sort((a, b) => {
        const cmp = a.title.localeCompare(b.title);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      sorted.sort((a, b) => {
        const cmp = (b.date || '').localeCompare(a.date || '');
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    }
    return sorted;
  }, [filteredNotes, railSort, state.noteRelevantOnly, state.noteSortByRelevancy, noteRelevanceMap]);

  // Group notes by year (only used when showYearGroups is true)
  const noteYearGroups = useMemo(() => groupNotesByYear(displayNotes), [displayNotes]);

  const noteFilterChips = useMemo(() => {
    const nf = state.noteFilter;
    if (!nf) return [];
    const chips: { label: string; facet: 'specialty' | 'setting'; value: string }[] = [];
    if (nf.specialty) chips.push({ label: abbrevSpecialty(nf.specialty), facet: 'specialty', value: nf.specialty });
    if (nf.setting) chips.push({ label: SETTING_ABBREV[nf.setting] || nf.setting, facet: 'setting', value: nf.setting });
    return chips;
  }, [state.noteFilter]);

  // ── Problems data ─────────────────────────────────────────────────────
  const ehrProblems = state.ehrData?.problems ?? [];

  const displayProblems = useMemo(() => {
    if (!railSort) return ehrProblems;
    const sorted = [...ehrProblems];
    if (railSort.field === 'name') {
      sorted.sort((a, b) => {
        const cmp = a.text.localeCompare(b.text);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      sorted.sort((a, b) => {
        const cmp = (b.recordedDate || '').localeCompare(a.recordedDate || '');
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    }
    return sorted;
  }, [ehrProblems, railSort]);

  const problemYearGroups = useMemo(() => groupProblemsByYear(displayProblems), [displayProblems]);

  // ── Procedures data ───────────────────────────────────────────────────
  const ehrProcedures = state.ehrData?.procedures ?? [];

  const displayProcedures = useMemo(() => {
    if (!railSort) return ehrProcedures;
    const sorted = [...ehrProcedures];
    if (railSort.field === 'name') {
      sorted.sort((a, b) => {
        const cmp = a.text.localeCompare(b.text);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      sorted.sort((a, b) => {
        const cmp = (b.date || '').localeCompare(a.date || '');
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    }
    return sorted;
  }, [ehrProcedures, railSort]);

  const procedureYearGroups = useMemo(() => groupProceduresByYear(displayProcedures), [displayProcedures]);

  // ── Pathology data ────────────────────────────────────────────────────
  const ehrPathology = state.ehrData?.pathology ?? [];

  const displayPathology = useMemo(() => {
    if (!railSort) return ehrPathology;
    const sorted = [...ehrPathology];
    if (railSort.field === 'name') {
      sorted.sort((a, b) => {
        const cmp = a.title.localeCompare(b.title);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      sorted.sort((a, b) => {
        const cmp = (b.date || '').localeCompare(a.date || '');
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    }
    return sorted;
  }, [ehrPathology, railSort]);

  const pathologyYearGroups = useMemo(() => groupPathologyByYear(displayPathology), [displayPathology]);

  // ── Medication data ───────────────────────────────────────────────────
  const ehrMedications = state.ehrData?.medications ?? [];
  const medCategoryFilter = state.medCategoryFilter;

  // Medication category order and labels
  const MED_CATEGORY_ORDER: { key: string; label: string }[] = [
    { key: 'inpatient-scheduled', label: 'Inpatient – Scheduled' },
    { key: 'inpatient-prn', label: 'Inpatient – PRN' },
    { key: 'inpatient-continuous', label: 'Inpatient – Continuous' },
    { key: 'outpatient', label: 'Outpatient' },
  ];

  // Check which categories have medications
  const hasInpatientMeds = useMemo(() =>
    ehrMedications.some(m => m.category.startsWith('inpatient')),
    [ehrMedications],
  );

  // Group medications by category, apply filter + sort within each group
  const medCategoryGroups = useMemo(() => {
    const groups = new Map<string, EhrMedication[]>();
    for (const cat of MED_CATEGORY_ORDER) {
      // Skip if category filter is active and doesn't match
      if (medCategoryFilter && medCategoryFilter !== cat.key) continue;

      const meds = ehrMedications.filter(m => m.category === cat.key);
      if (meds.length === 0) continue;

      // Apply sort within category
      const sorted = [...meds];
      if (railSort?.field === 'name') {
        sorted.sort((a, b) => {
          const cmp = a.name.localeCompare(b.name);
          return railSort.direction === 'asc' ? cmp : -cmp;
        });
      } else if (railSort?.field === 'date') {
        sorted.sort((a, b) => {
          const aHas = !!a.lastGiven;
          const bHas = !!b.lastGiven;
          if (aHas && bHas) {
            const cmp = (b.lastGiven).localeCompare(a.lastGiven);
            return railSort.direction === 'asc' ? cmp : -cmp;
          }
          // No-date meds: push to bottom on ascending (default), top on descending
          if (aHas && !bHas) return railSort.direction === 'asc' ? -1 : 1;
          if (!aHas && bHas) return railSort.direction === 'asc' ? 1 : -1;
          return 0;
        });
      }
      // Default: already alphabetical from server

      groups.set(cat.key, sorted);
    }
    return groups;
  }, [ehrMedications, medCategoryFilter, railSort]);

  // ── Apply rail sort to priors ─────────────────────────────────────────
  const sortedPriors = useMemo(() => {
    if (!railSort) return displayPriors;
    const sorted = [...displayPriors];
    if (railSort.field === 'name') {
      sorted.sort((a, b) => {
        const cmp = a.studyDescription.localeCompare(b.studyDescription);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      sorted.sort((a, b) => {
        const cmp = (b.studyDateTime || '').localeCompare(a.studyDateTime || '');
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    }
    return sorted;
  }, [displayPriors, railSort]);

  const priorsYearGroups = useMemo(() => groupByYear(sortedPriors), [sortedPriors]);

  // ── Unified SORT: bar state ───────────────────────────────────────────
  const hasActiveFilters = !!(railSort || state.activeFilter || state.noteFilter || state.sortByRelevancy || state.noteRelevantOnly || state.noteSortByRelevancy || state.medCategoryFilter);

  // ── Lab panels data ────────────────────────────────────────────────────
  const ehrLabPanels = state.ehrData?.labs?.panels ?? {};

  // Sort lab panels by name or date
  const sortedLabPanelEntries = useMemo(() => {
    const entries = Object.entries(ehrLabPanels) as [string, LabPanel][];
    if (!railSort) return entries;
    if (railSort.field === 'name') {
      entries.sort((a, b) => {
        const cmp = a[0].localeCompare(b[0]);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      // Sort by most recent column timestamp in each panel
      entries.sort((a, b) => {
        const aCol = a[1].columns[0] || '';
        const bCol = b[1].columns[0] || '';
        const cmp = bCol.localeCompare(aCol);
        return railSort.direction === 'asc' ? cmp : -cmp;
      });
    }
    return entries;
  }, [ehrLabPanels, railSort]);

  return (
    <aside className="zone-context-rail">
      {/* ── EHR Mode: Patient Data Icon Bar + ERIK Search Bar ── */}
      {ehrEnabled && (
        <div className="ehr-controls">
          {/* Patient Data Icon Bar */}
          <div className="patient-data-bar" role="tablist" aria-label="Patient data categories">
            {EHR_ICONS.map(({ category, label, Icon }) => {
              const isAiSummary = category === 'ai-summary';
              // AI Summary active state is driven by whether the executive summary
              // is visible in the main stage — not by the rail category.
              const isActive = isAiSummary
                ? (state.summarizationStatus === 'complete' && state.showExecutiveSummary)
                : activeCategory === category;

              // AI Summary icon status indicators
              const isAiLoading = isAiSummary && state.summarizationStatus === 'loading';
              const isAiComplete = isAiSummary && state.summarizationStatus === 'complete';
              const isAiError = isAiSummary && state.summarizationStatus === 'error';

              return (
                <button
                  key={category}
                  className={[
                    'pdb-icon',
                    isActive ? 'pdb-icon--active' : '',
                    isAiLoading ? 'pdb-icon--loading' : '',
                    isAiComplete ? 'pdb-icon--complete' : '',
                    isAiError ? 'pdb-icon--error' : '',
                  ].filter(Boolean).join(' ')}
                  data-label={label}
                  onClick={() => handleEhrIconClick(category)}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={label}
                  title=""
                >
                  {isAiLoading ? (
                    <span className="pdb-icon-spinner" />
                  ) : (
                    <Icon size={16} />
                  )}
                </button>
              );
            })}
          </div>

          {/* ERIK Search Bar + Brain Button */}
          <div className="erik-bar-row">
            <div className={`erik-search-bar${activeCategory === 'erik' ? ' erik-search-bar--active' : ''}`}>
              <span className="erik-search-icon">
                <SearchIcon size={13} />
              </span>
              <input
                className="erik-search-input"
                type="text"
                placeholder="Ask ERIK…"
                value={erikInput}
                onChange={(e) => setErikInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleErikSubmit();
                  }
                }}
                onFocus={() => {
                  if (activeCategory !== 'erik') {
                    setActiveEhrCategory('erik');
                  }
                }}
                disabled={false}
                tabIndex={0}
              />
            </div>
            <button
              className={`pdb-icon erik-btn${activeCategory === 'erik' ? ' pdb-icon--active' : ''}`}
              data-label="Enhanced Radiology Insight Kit (ERIK)"
              onClick={() => setActiveEhrCategory('erik')}
              aria-label="Enhanced Radiology Insight Kit (ERIK)"
              title=""
            >
              <BrainIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Classic Mode: AI Summary Button ── */}
      {!ehrEnabled && state.currentStudy && (
        <div className="rail-ai-summary-section">
          <button
            className={`ai-summary-btn ${
              state.summarizationStatus === 'loading' ? 'ai-summary-btn--loading' :
              state.summarizationStatus === 'complete' && state.showExecutiveSummary ? 'ai-summary-btn--active' :
              state.summarizationStatus === 'complete' ? 'ai-summary-btn--ready' :
              state.summarizationStatus === 'error' ? 'ai-summary-btn--error' :
              ''
            }`}
            onClick={triggerSummarization}
            disabled={state.summarizationStatus === 'loading'}
            title={
              state.summarizationStatus === 'loading' ? 'Generating AI summary…' :
              state.summarizationStatus === 'complete' ? 'Toggle executive summary' :
              state.summarizationStatus === 'error' ? `Error: ${state.summarizationError}` :
              'Generate AI summary of relevant prior reports'
            }
          >
            <span className="ai-summary-btn-icon">
              {state.summarizationStatus === 'loading' ? (
                <span className="ai-summary-spinner" />
              ) : state.summarizationStatus === 'error' ? (
                '⚠'
              ) : (
                <SparkleIcon size={14} />
              )}
            </span>
            <span className="ai-summary-btn-text">
              {state.summarizationStatus === 'loading' ? 'Generating…' :
               state.summarizationStatus === 'complete' ? 'AI Summary' :
               state.summarizationStatus === 'error' ? 'Retry Summary' :
               'AI Summary'}
            </span>
            {state.summarizationStatus === 'complete' && state.summarizationResult && (
              <span className="ai-summary-btn-badge">
                {state.summarizationResult.individualAnalyses.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Unified SORT: Bar (shown on all 7 data tabs, not AI Summary or ERIK) ── */}
      {ehrEnabled && activeCategory !== 'ai-summary' && activeCategory !== 'erik' && (
        <div className="rail-sort-bar">
          <span className="sort-label">SORT:</span>
          <div className="sort-chips">
            {/* Name sort chip */}
            <button
              className={`sort-chip${railSort?.field === 'name' ? ' sort-chip--active' : ''}`}
              onClick={() => toggleRailSort('name')}
              title="Sort by name"
            >
              Name
              {railSort?.field === 'name' && (
                <span className="sort-chevron">{railSort.direction === 'asc' ? '▼' : '▲'}</span>
              )}
            </button>
            {/* Date sort chip */}
            <button
              className={`sort-chip${railSort?.field === 'date' ? ' sort-chip--active' : ''}`}
              onClick={() => toggleRailSort('date')}
              title="Sort by date"
            >
              Date
              {railSort?.field === 'date' && (
                <span className="sort-chevron">{railSort.direction === 'asc' ? '▼' : '▲'}</span>
              )}
            </button>

            {/* Card-level filter chips — priors (modality, region, etc.) */}
            {showPriorsContent && filterChips.map((chip) => (
              <button
                key={`${chip.facet}-${chip.value ?? ''}`}
                className="filter-chip"
                onClick={() =>
                  chip.value
                    ? toggleFilterFacet(chip.facet as 'modality', chip.value)
                    : toggleFilterFacet(chip.facet as 'angiographic')
                }
                title={`Remove ${chip.label} filter`}
              >
                {chip.label}
                <span className="filter-chip-x">×</span>
              </button>
            ))}

            {/* Relevancy sort chip (priors only) */}
            {showPriorsContent && showSortIndicator && (
              <button
                className="filter-chip filter-chip-sort"
                onClick={toggleSortByRelevancy}
                title="Remove relevance sort"
              >
                ↓ By Score
                <span className="filter-chip-x">×</span>
              </button>
            )}

            {showNotesContent && noteFilterChips.map((chip) => (
              <button
                key={`${chip.facet}-${chip.value}`}
                className="filter-chip"
                onClick={() => toggleNoteFilter(chip.facet, chip.value)}
                title={`Remove ${chip.label} filter`}
              >
                {chip.label}
                <span className="filter-chip-x">×</span>
              </button>
            ))}

            {/* Note-level relevance filter chips — Relevant + By Score */}
            {showNotesContent && state.noteRelevantOnly && (
              <button
                className="filter-chip"
                onClick={toggleNoteRelevantOnly}
                title="Remove relevant notes filter"
              >
                Relevant
                <span className="filter-chip-x">×</span>
              </button>
            )}
            {showNotesContent && state.noteSortByRelevancy && (
              <button
                className="filter-chip filter-chip-sort"
                onClick={() => setNoteSortByRelevancy(false)}
                title="Remove relevance sort"
              >
                ↓ By Score
                <span className="filter-chip-x">×</span>
              </button>
            )}

            {/* Medication category filter chips — all grouped after the pipe separator */}
            {showMedicationsContent && (
              <>
                <span className="sort-pipe">|</span>
                <button
                  className={`sort-chip${medCategoryFilter === 'outpatient' ? ' sort-chip--active' : ''}`}
                  onClick={() => toggleMedCategoryFilter('outpatient')}
                  title="Show only outpatient medications"
                >
                  Outpt
                </button>
                {hasInpatientMeds && (
                  <>
                    <button
                      className={`sort-chip${medCategoryFilter === 'inpatient-scheduled' ? ' sort-chip--active' : ''}`}
                      onClick={() => toggleMedCategoryFilter('inpatient-scheduled')}
                      title="Show only scheduled inpatient medications"
                    >
                      Inpt
                    </button>
                    <button
                      className={`sort-chip${medCategoryFilter === 'inpatient-prn' ? ' sort-chip--active' : ''}`}
                      onClick={() => toggleMedCategoryFilter('inpatient-prn')}
                      title="Show only PRN medications"
                    >
                      PRN
                    </button>
                    <button
                      className={`sort-chip${medCategoryFilter === 'inpatient-continuous' ? ' sort-chip--active' : ''}`}
                      onClick={() => toggleMedCategoryFilter('inpatient-continuous')}
                      title="Show only continuous infusion medications"
                    >
                      Cont
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {/* Clear button — only visible when any sort or filter is active */}
          {hasActiveFilters && (
            <button className="sort-clear" onClick={clearAllRailFilters} aria-label="Clear all sorts and filters">
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Rail Body (scrollable content) ── */}
      <div className="rail-body">
        {/* ── ERIK Chat Interface ── */}
        {showErikContent && !state.loading && state.patientRecord && (
          <div className="erik-chat-container">
            {state.erikMessages.length === 0 && !erikStatus ? (
              /* Empty state */
              <div className="erik-empty">
                <div className="erik-empty-icon">
                  <BrainIcon size={28} />
                </div>
                <div className="erik-empty-text">
                  Ask ERIK about the patient's chart or any medical/radiology topic.
                </div>
                <div className="erik-empty-hint">
                  Try: "What medications is the patient on?" or "What is Fleischner criteria?"
                </div>
              </div>
            ) : (
              /* Message stream */
              <div className="erik-chat-messages" ref={erikChatRef}>
                {state.erikMessages.map((msg) => (
                  <div key={msg.id} className={`erik-msg erik-msg--${msg.role}`}>
                    {msg.role === 'assistant' && (
                      <div className="erik-msg-header">
                        <div className="erik-msg-avatar">
                          <BrainIcon size={11} />
                        </div>
                        <span className="erik-msg-name">ERIK</span>
                      </div>
                    )}
                    <div className={`erik-msg-bubble${msg.streaming ? ' erik-msg-bubble--streaming' : ''}`}>
                      {msg.role === 'assistant' && msg.content ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      ) : (
                        msg.content || (msg.streaming && erikStatus ? '' : '…')
                      )}
                    </div>
                  </div>
                ))}
                {/* Status indicator while pipeline is running */}
                {erikStatus && (
                  <div className="erik-status">
                    <div className="erik-status-dots">
                      <span className="erik-status-dot" />
                      <span className="erik-status-dot" />
                      <span className="erik-status-dot" />
                    </div>
                    {erikStatus}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Loading / Error / Empty states */}
        {state.loading && (
          <div className="rail-empty-state">Loading studies…</div>
        )}

        {state.error && (
          <div className="rail-empty-state rail-error">{state.error}</div>
        )}

        {!state.loading && !state.error && !state.patientRecord && (
          <div className="rail-empty-state">Select a patient to view prior studies</div>
        )}

        {showPlaceholder && !state.loading && state.patientRecord && (
          <div className="ehr-placeholder">
            <div className="ehr-placeholder-icon">
              {EHR_ICONS.find(i => i.category === activeCategory)?.Icon &&
                (() => {
                  const IconComp = EHR_ICONS.find(i => i.category === activeCategory)!.Icon;
                  return <IconComp size={28} />;
                })()
              }
            </div>
            <div className="ehr-placeholder-text">
              {state.ehrDataStatus === 'loading' && 'Loading EHR data…'}
              {state.ehrDataStatus === 'unavailable' && (
                <>
                  {PLACEHOLDER_TEXT[activeCategory]?.replace('will appear', 'would appear') ?? 'Data would appear here'}
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </>
              )}
              {state.ehrDataStatus === 'error' && (
                <>
                  {PLACEHOLDER_TEXT[activeCategory]?.replace('will appear', 'would appear') ?? 'Data would appear here'}
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </>
              )}
              {(state.ehrDataStatus === 'loaded' || state.ehrDataStatus === 'idle') && (
                PLACEHOLDER_TEXT[activeCategory] ?? 'Data will appear here'
              )}
            </div>
          </div>
        )}

        {/* ── Notes content ── */}
        {showNotesContent && !state.loading && state.patientRecord && (
          <>
            {state.ehrDataStatus === 'loading' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-text">Loading clinical notes…</div>
              </div>
            )}

            {state.ehrDataStatus === 'unavailable' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><NotesIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Clinical notes would appear here
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'error' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><NotesIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Clinical notes would appear here
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'loaded' && ehrNotes.length === 0 && (
              <div className="rail-empty-state">No clinical notes found</div>
            )}

            {state.ehrDataStatus === 'loaded' && displayNotes.length === 0 && ehrNotes.length > 0 && state.noteFilter && (
              <div className="rail-empty-state">
                No notes match the active filters
              </div>
            )}

            {/* Note cards — year grouped or flat depending on sort */}
            {state.ehrDataStatus === 'loaded' && (
              showYearGroups ? (
                Array.from(noteYearGroups.entries()).map(([year, notes]) => (
                  <TimelineSection key={year} year={year} studyCount={notes.length}>
                    {notes.map((note) => (
                      <NoteCard key={note.id} note={note} referenceDateTime={referenceDateTime} relevance={noteRelevanceMap.get(note.id)} isAnalyzed={isNoteAnalyzed(note.id, state.summarizationResult?.noteTriage)} />
                    ))}
                  </TimelineSection>
                ))
              ) : (
                displayNotes.map((note) => (
                  <NoteCard key={note.id} note={note} referenceDateTime={referenceDateTime} relevance={noteRelevanceMap.get(note.id)} isAnalyzed={isNoteAnalyzed(note.id, state.summarizationResult?.noteTriage)} />
                ))
              )
            )}
          </>
        )}

        {/* ── Problems content ── */}
        {showProblemsContent && !state.loading && state.patientRecord && (
          <>
            {state.ehrDataStatus === 'loading' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-text">Loading problem list…</div>
              </div>
            )}

            {state.ehrDataStatus === 'unavailable' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><ProblemsIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Problem list would appear here
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'error' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><ProblemsIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Problem list would appear here
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'loaded' && ehrProblems.length === 0 && (
              <div className="rail-empty-state">No problems found</div>
            )}

            {/* Problem cards — year grouped or flat depending on sort */}
            {state.ehrDataStatus === 'loaded' && ehrProblems.length > 0 && (
              showYearGroups ? (
                Array.from(problemYearGroups.entries()).map(([year, problems]) => (
                  <TimelineSection key={year} year={year} studyCount={problems.length}>
                    {problems.map((p) => (
                      <ProblemCard key={p.id} problem={p} />
                    ))}
                  </TimelineSection>
                ))
              ) : (
                displayProblems.map((p) => (
                  <ProblemCard key={p.id} problem={p} />
                ))
              )
            )}
          </>
        )}

        {/* ── Procedures content ── */}
        {showProceduresContent && !state.loading && state.patientRecord && (
          <>
            {state.ehrDataStatus === 'loading' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-text">Loading procedures…</div>
              </div>
            )}

            {state.ehrDataStatus === 'unavailable' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><ProceduresIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Procedures would appear here
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'error' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><ProceduresIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Procedures would appear here
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'loaded' && ehrProcedures.length === 0 && (
              <div className="rail-empty-state">No procedures found</div>
            )}

            {/* Procedure cards — year grouped or flat depending on sort */}
            {state.ehrDataStatus === 'loaded' && ehrProcedures.length > 0 && (
              showYearGroups ? (
                Array.from(procedureYearGroups.entries()).map(([year, procedures]) => (
                  <TimelineSection key={year} year={year} studyCount={procedures.length}>
                    {procedures.map((p) => (
                      <ProcedureCard key={p.id} procedure={p} />
                    ))}
                  </TimelineSection>
                ))
              ) : (
                displayProcedures.map((p) => (
                  <ProcedureCard key={p.id} procedure={p} />
                ))
              )
            )}
          </>
        )}

        {/* ── Pathology content ── */}
        {showPathologyContent && !state.loading && state.patientRecord && (
          <>
            {state.ehrDataStatus === 'loading' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-text">Loading pathology reports…</div>
              </div>
            )}

            {state.ehrDataStatus === 'unavailable' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><PathologyIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Pathology reports would appear here
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'error' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><PathologyIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Pathology reports would appear here
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'loaded' && ehrPathology.length === 0 && (
              <div className="rail-empty-state">No pathology reports found</div>
            )}

            {/* Pathology cards — year grouped or flat depending on sort */}
            {state.ehrDataStatus === 'loaded' && ehrPathology.length > 0 && (
              showYearGroups ? (
                Array.from(pathologyYearGroups.entries()).map(([year, reports]) => (
                  <TimelineSection key={year} year={year} studyCount={reports.length}>
                    {reports.map((r) => (
                      <PathologyCard key={r.id} report={r} />
                    ))}
                  </TimelineSection>
                ))
              ) : (
                displayPathology.map((r) => (
                  <PathologyCard key={r.id} report={r} />
                ))
              )
            )}
          </>
        )}

        {/* ── Medications content ── */}
        {showMedicationsContent && !state.loading && state.patientRecord && (
          <>
            {state.ehrDataStatus === 'loading' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-text">Loading medications…</div>
              </div>
            )}

            {state.ehrDataStatus === 'unavailable' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><MedicationsIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Medications would appear here
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'error' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><MedicationsIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Medications would appear here
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'loaded' && ehrMedications.length === 0 && (
              <div className="rail-empty-state">No medications found</div>
            )}

            {/* Medication cards — grouped by category */}
            {state.ehrDataStatus === 'loaded' && ehrMedications.length > 0 && (
              MED_CATEGORY_ORDER.map(cat => {
                const meds = medCategoryGroups.get(cat.key);
                if (!meds || meds.length === 0) return null;
                return (
                  <TimelineSection key={cat.key} year={cat.label} studyCount={meds.length}>
                    {meds.map((m, idx) => (
                      <MedicationCard key={`${m.id}-${idx}`} medication={m} />
                    ))}
                  </TimelineSection>
                );
              })
            )}
          </>
        )}

        {/* ── Labs content ── */}
        {showLabsContent && !state.loading && state.patientRecord && (
          <>
            {state.ehrDataStatus === 'loading' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-text">Loading lab results…</div>
              </div>
            )}

            {state.ehrDataStatus === 'unavailable' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><LabsIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Lab results would appear here
                  <div className="ehr-placeholder-subtext">EHR data is not available for this patient.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'error' && (
              <div className="ehr-placeholder">
                <div className="ehr-placeholder-icon"><LabsIcon size={28} /></div>
                <div className="ehr-placeholder-text">
                  Lab results would appear here
                  <div className="ehr-placeholder-subtext">Failed to load EHR data.</div>
                </div>
              </div>
            )}

            {state.ehrDataStatus === 'loaded' && sortedLabPanelEntries.length === 0 && (
              <div className="rail-empty-state">No lab results found</div>
            )}

            {/* Lab category cards */}
            {state.ehrDataStatus === 'loaded' && sortedLabPanelEntries.length > 0 && (
              sortedLabPanelEntries.map(([panelName, panel]) => (
                <LabCategoryCard
                  key={panelName}
                  panelName={panelName}
                  panel={panel}
                  isSelected={state.selectedLabPanel === panelName}
                  onClick={() => selectLabPanel(panelName)}
                />
              ))
            )}
          </>
        )}

        {/* Priors content — shown in classic mode or when Radiology Reports category is active */}
        {showPriorsContent && (
          <>
            {!state.loading && state.patientRecord && priors.length === 0 && (
              <div className="rail-empty-state">No prior studies found</div>
            )}

            {!state.loading && sortedPriors.length === 0 && priors.length > 0 && state.activeFilter && (
              <div className="rail-empty-state">
                No studies match the active filters
              </div>
            )}

            {/* When sorting by relevancy or name, render flat (no year grouping) */}
            {(state.sortByRelevancy || !showYearGroups) ? (
              sortedPriors.map((study) => (
                <PriorStudyCard
                  key={study.sequence}
                  study={study}
                  index={priorIndexMap.get(study.sequence) ?? 0}
                  referenceDateTime={referenceDateTime}
                  relevanceResult={relevanceMap.get(study.sequence) ?? null}
                  findings={findingsMap.get(study.accessionNumber) ?? null}
                />
              ))
            ) : (
              Array.from(priorsYearGroups.entries()).map(([year, studies]) => (
                <TimelineSection key={year} year={year} studyCount={studies.length}>
                  {studies.map((study) => (
                    <PriorStudyCard
                      key={study.sequence}
                      study={study}
                      index={priorIndexMap.get(study.sequence) ?? 0}
                      referenceDateTime={referenceDateTime}
                      relevanceResult={relevanceMap.get(study.sequence) ?? null}
                      findings={findingsMap.get(study.accessionNumber) ?? null}
                    />
                  ))}
                </TimelineSection>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  );
}
