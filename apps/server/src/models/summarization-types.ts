/**
 * summarization-types.ts — Data model for the two-tier LLM summarization pipeline.
 *
 * Tier 1: Individual prior report analysis — structured extraction of findings,
 *         measurements, recommendations, and referenced studies from each prior report.
 *
 * Also includes types for the Expanded Reason for Study pipeline
 * (study intent classification + synthesis pass).
 *
 * Tier 2: Executive summary synthesis — aggregated, region-grouped presentation
 *         of findings across all analyzed prior reports.
 *
 * These types define the contract between:
 *   - The LLM output (what Claude returns)
 *   - The validation service (what gets checked for hallucination)
 *   - The UI rendering layer (what the client displays)
 *   - The QA log (what gets stored for audit)
 */

import type { ExpandedReasonForStudy, StudyIntentResult } from './study-intent-types';

// ── Individual Report Extraction ──────────────────────────────────────────

/**
 * A single finding extracted from a prior radiology report.
 *
 * Each finding carries multi-dimensional labels (severity, trend, technique,
 * incidental) as independent boolean/enum dimensions — NOT mutually exclusive
 * categories. A finding can be simultaneously critical, progressing, and actionable.
 *
 * The `bodySubregion` field is constrained to the vocabulary defined in
 * report-subregions.json, ensuring consistent region tagging across reports.
 */
export interface ExtractedFinding {
  /**
   * Deterministic finding ID: {accessionNumber}-F{1-based index}.
   * Assigned after Tier 1 parsing, NOT by the LLM.
   * Used as the canonical reference across all downstream pipeline stages.
   */
  id: string;

  /** LLM-assigned descriptive label, e.g., "Left lower lobe mass" */
  name: string;

  /**
   * Verbatim excerpt from the source report text that this finding is based on.
   * Used by the validation service for source attribution verification and
   * fed to the executive summary prompt as the finding's textual content.
   * Should be a direct quote, not a paraphrase.
   */
  sourceExcerpt: string;

  /**
   * Anatomical subregion from the constrained vocabulary (report-subregions.json).
   * Must be one of the options provided in the PRIMARY or OVERLAP subregion lists.
   */
  bodySubregion: string;

  /**
   * Whether this finding's subregion came from the prior study's canonical region
   * list (primary) or the current study's canonical region list (overlap).
   *
   * - 'primary': Finding is in the prior study's anatomy (may not be visible on current exam)
   * - 'overlap': Finding is in anatomy overlapping with the current exam (likely visible)
   */
  subregionSource: 'primary' | 'overlap';

  /**
   * The literal report section heading under which this finding appeared,
   * e.g., "LUNGS", "HEART AND VASCULATURE", "BRAIN PARENCHYMA".
   * Preserved for provenance and executive summary grouping.
   */
  reportSubsection: string;

  /** Whether this finding was mentioned in the impression, findings, or both */
  sourceSection: 'impression' | 'findings' | 'both';

  // ── Multi-Dimensional Labels (Independent, NOT Mutually Exclusive) ──

  /**
   * Severity flag — only set when the radiologist explicitly flags a finding
   * as critical, urgent, emergent, or uses communication statements
   * (e.g., "Results communicated to Dr. Smith at 14:32").
   * This is data extraction, NOT clinical judgment by the LLM.
   */
  severity: 'critical' | null;

  /**
   * Technique flag — true when the finding describes scan quality, artifacts,
   * or technical limitations rather than pathology (e.g., "motion degradation",
   * "metallic artifact", "suboptimal contrast bolus").
   *
   * Technique findings are extracted in Tier 1 individual report analysis
   * (for QA/audit and individual study context) but are filtered OUT of
   * the Tier 2 executive summary to keep the longitudinal view focused
   * on pathology trajectories.
   */
  technique: boolean;

  /**
   * Trend label — extracted from explicit change-over-time language in the report.
   * Only set when the radiologist explicitly describes the finding's trajectory.
   * NOT inferred by the LLM.
   */
  trend: 'new' | 'progressing' | 'stable' | 'improving' | 'resolved' | null;

  /**
   * Incidental flag — only true when the radiologist explicitly uses language
   * like "incidental", "incidentally noted", "of no clinical significance",
   * or "benign-appearing". NOT inferred by the LLM.
   */
  incidental: boolean;

  // ── Extracted Data ──

  /** Specific measurements provided for this finding */
  measurements: Measurement[];

  /** Explicit statement of change relative to a prior study, if present */
  changeStatement: string | null;

  /** Follow-up recommendation associated with this finding, if present */
  recommendation: Recommendation | null;

  /**
   * Which prior study the change statement references, if identifiable.
   * e.g., "compared to CT chest 6/24/2025"
   */
  comparisonStudyReference: string | null;

  /**
   * Raw sentence IDs from the LLM output (e.g., ["RA.03", "RA.05"]).
   * Preserved alongside the resolved sourceExcerpt for use in downstream
   * prompts (finding grouping) where referencing by ID avoids token-costly
   * text duplication.
   * Empty array for legacy findings that pre-date sentence splitting.
   */
  sourceSentenceIds: string[];

}

/**
 * A specific measurement extracted from a finding description.
 * All fields should be near-verbatim from the report text.
 */
export interface Measurement {
  /** The measurement value, e.g., "5.5 x 4.8 cm", "SUV 13.2" */
  dimension: string;

  /** Location reference in the study, e.g., "image 47:3, series 4" */
  location: string;

  /** Anatomical context, e.g., "left posterior perihilar mass" */
  context: string;
}

/**
 * A follow-up recommendation extracted from a finding.
 * Only populated when the radiologist explicitly recommends action.
 */
export interface Recommendation {
  /** The recommended action, e.g., "Follow-up CT", "Clinical correlation", "Biopsy" */
  action: string;

  /** Recommended timeframe, if specified, e.g., "3 months", "6 weeks", "immediate" */
  timeframe: string | null;

  /** Clinical guideline referenced, if any, e.g., "Fleischner criteria", "ACR TI-RADS" */
  guideline: string | null;

  /**
   * True when the finding IS entirely a recommendation with no pathological
   * observation (e.g., "Repeat contrast MRI recommended"). False when the
   * finding describes pathology that also includes a recommended action
   * (e.g., "Left lower lobe mass, recommend follow-up CT").
   *
   * Standalone recommendation findings are filtered from the executive
   * summary (the recommendation itself is still tracked separately).
   */
  standalone: boolean;
}

/**
 * A prior study referenced in the report text, either in the COMPARISON
 * section or within the findings themselves.
 */
export interface ReferencedStudy {
  /** Study type as described in the report, e.g., "CT chest", "MR brain" */
  studyType: string;

  /** Study date as written in the report, e.g., "6/24/2025", "7/11/2025" */
  studyDate: string;

  /**
   * How the study was referenced — "comparison" for the formal COMPARISON
   * section, "findings" for inline references within finding descriptions.
   */
  context: string;
}

/**
 * Complete structured analysis of a single prior radiology report.
 * Produced by the individual report summarization LLM pass (Tier 1).
 */
export interface PriorReportAnalysis {
  /** Full study name, e.g., "CT Chest with Contrast" */
  studyName: string;

  /** Study date in YYYYMMDDHHMMSS format (from the Study object) */
  studyDate: string;

  /** Accession number for cross-referencing, e.g., "ACC-P1-0009" */
  accessionNumber: string;

  /**
   * Clinical presentation / reason for study extracted from the report's
   * HISTORY section. Null when not present or not parseable.
   */
  clinicalPresentation: string | null;

  /** All extracted findings with multi-dimensional labels */
  findings: ExtractedFinding[];

  /** Prior studies referenced in the COMPARISON section or within findings */
  referencedPriorStudies: ReferencedStudy[];

  /**
   * Sentence-level index for this report's text.
   * Each entry maps a globally unique sentence ID (e.g., "RA.03") to its
   * text, source section, and parent study metadata.
   * Used for provenance resolution and future UI sentence highlighting.
   */
  reportSentenceIndex?: SentenceSnippetIndex[];
}

// ── Finding Relevancy Scoring ─────────────────────────────────────────────

/**
 * 3-axis relevancy score assigned to each finding (grouped or ungrouped)
 * by the finding consolidation LLM pass.
 *
 * Study-independent — characterizes the finding's intrinsic clinical weight,
 * NOT its relevance to any particular imaging study being read.
 *
 * Axes:
 *   SAF (0–5): Safety risk / threat to patient life or function
 *   CHG (0–3): Probability of change on follow-up imaging
 *   TRK (0–2): Tracking relevance for the reading radiologist
 *   total (0–10): SAF + CHG + TRK
 */
export interface FindingRelevancyScore {
  SAF: number;
  CHG: number;
  TRK: number;
  total: number;
}

// ── Executive Summary (Tier 2) ────────────────────────────────────────────

/**
 * A group of findings within a single anatomical region in the executive summary.
 * Findings within a group are ordered chronologically (most recent first).
 */
export interface ExecutiveSummaryRegionGroup {
  /** Display name of the region, e.g., "Lungs", "Brain Parenchyma" */
  regionName: string;

  /** Ordered findings within this region */
  findings: ExecutiveFinding[];
}

/**
 * A single finding in the executive summary, potentially aggregated across
 * multiple prior reports when the same anatomical area is discussed.
 */
export interface ExecutiveFinding {
  /** Descriptive name, e.g., "Left lower lobe mass" */
  name: string;

  /**
   * Category chips to display, derived from the finding's multi-dimensional labels.
   * e.g., ["CRITICAL", "NEW"], ["PROGRESSING", "ACTIONABLE"], ["STABLE"]
   */
  chips: string[];

  /** Chronological appearances of this finding across prior reports */
  studyEntries: StudyEntry[];

  /**
   * 3-axis relevancy score from the finding consolidation LLM pass.
   * Present when the finding grouping LLM was invoked; absent when
   * the pass was skipped (e.g., single-finding regions with no LLM call).
   */
  relevancyScore?: FindingRelevancyScore;
}

/**
 * A single study-specific data point for a finding in the executive summary.
 * Provides the measurement/change context from one specific prior report.
 *
 * All fields are resolved deterministically from the Tier 1 data using
 * the finding ID — no LLM echo-back involved.
 */
export interface StudyEntry {
  /** Deterministic finding ID for resolution, e.g., "ACC-P1-0020-F1" */
  findingId: string;

  /** Study name for display, e.g., "CT Chest" */
  studyName: string;

  /** Study date for display, e.g., "07/08/2025" */
  studyDate: string;

  /** Accession number for linking to the source report */
  accessionNumber: string;

  /** Original Tier 1 finding name — used for display in study entry rows */
  findingName: string;

  /** Measurement from this study, if available (resolved from Tier 1 data) */
  measurement: string | null;

  /**
   * Verbatim excerpt from the source report text.
   * Resolved from Tier 1 individual analysis — NOT LLM-produced.
   */
  sourceExcerpt: string | null;

  /**
   * Change statement relative to an earlier study.
   * Resolved from Tier 1 individual analysis — NOT LLM-produced.
   */
  changeStatement: string | null;

  /**
   * Sentence IDs from the source report for citation provenance.
   * Resolved from the Tier 1 ExtractedFinding.sourceSentenceIds.
   * e.g., ["RA.03", "RA.14"]
   */
  sourceSentenceIds: string[];
}

/**
 * A flagged case where a prior study's clinical presentation semantically
 * matches the current study's reason for examination.
 */
export interface SimilarPresentation {
  /** Name of the prior study with similar presentation */
  studyName: string;

  /** Date of the prior study */
  studyDate: string;

  /** Accession number for linking */
  accessionNumber: string;

  /** The prior study's clinical presentation text */
  priorPresentation: string;

  /** Key findings from that study (names only, for brevity) */
  keyFindings: string[];
}

/**
 * Recommendation fulfillment status — computed deterministically by
 * matching recommendations against the patient's study timeline.
 * No LLM involved in this assessment.
 */
export interface OpenRecommendation {
  /** The recommended action, e.g., "Follow-up CT Chest" */
  action: string;

  /** Which study the recommendation came from */
  sourceStudyName: string;

  /** Date of the source study */
  sourceStudyDate: string;

  /** Accession number of the source study */
  sourceAccession: string;

  /** Recommended timeframe, e.g., "3 months" */
  timeframe: string | null;

  /** Computed due date based on source study date + timeframe */
  dueDate: string | null;

  /** The finding that prompted the recommendation */
  findingContext: string;

  /** Fulfillment status — deterministically computed, not LLM-inferred */
  status: 'fulfilled' | 'overdue' | 'pending';

  /** If fulfilled, which study fulfilled it */
  fulfilledBy: string | null;
}

/**
 * Complete executive summary synthesized from all individual report analyses.
 * Produced by the executive summary LLM pass (Tier 2).
 */
export interface ExecutiveSummary {
  /** Findings organized by anatomical region */
  regionGroups: ExecutiveSummaryRegionGroup[];

  /** Prior studies with clinical presentations similar to the current exam */
  similarPriorPresentations: SimilarPresentation[];

  /**
   * Outstanding follow-up recommendations from prior reports.
   * Populated by the deterministic recommendation tracker, not the LLM.
   */
  openRecommendations: OpenRecommendation[];

  /**
   * Professional statement about regions assessed as normal.
   * e.g., "Other assessed regions were unremarkable on prior imaging."
   */
  normalStatement: string;
}

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Result of source attribution validation for a single LLM extraction.
 * Each finding is checked for traceability back to the source report text.
 */
export interface ValidationResult {
  /** True when all checks passed or returned warnings (no failures) */
  passed: boolean;

  /** Individual check results */
  checks: ValidationCheck[];
}

/**
 * A single validation check verifying that an extracted datum is
 * traceable to the source report text.
 */
export interface ValidationCheck {
  /** Type of validation performed */
  type: 'finding_traceable' | 'measurement_verbatim' | 'reference_present';

  /** Which finding this check relates to */
  findingName: string;

  /**
   * - 'pass': Exact or strong fuzzy match found in source text
   * - 'warning': Partial match — finding name present but description differs
   * - 'fail': No match — finding cannot be traced to source text (possible hallucination)
   */
  status: 'pass' | 'warning' | 'fail';

  /** Human-readable explanation of the check result */
  detail: string;
}

// ── QA Log ────────────────────────────────────────────────────────────────

/**
 * Complete audit record for a single LLM pass in the summarization pipeline.
 * Stored in the right-rail QA panel for transparency and debugging.
 */
export interface SummarizationQAEntry {
  /** Human-readable identifier, e.g., "CT Chest 07/08/2025" or "Executive Summary" */
  label: string;

  /** The study being summarized (null for executive summary) */
  studyName: string | null;

  /** Study date (null for executive summary) */
  studyDate: string | null;

  /** Accession number (null for executive summary) */
  accessionNumber: string | null;

  /** Type of pipeline pass */
  type: 'individual' | 'similar-presentations' | 'finding-grouping' | 'problem-grouping' | 'note-triage' | 'one-liner' | 'expanded-reason';

  /** Full input data sent to the LLM (excluding prompt template text) */
  inputData: Record<string, unknown>;

  /** Raw structured JSON response from the LLM */
  outputData: Record<string, unknown>;

  /** Validation results for this LLM pass */
  validation: ValidationResult;

  /** Wall-clock time for the LLM call in milliseconds */
  latencyMs: number;

  /** Token usage for cost tracking */
  tokenUsage: {
    input: number;
    output: number;
  };

  /**
   * Relevance score breakdown for this study vs. the current exam.
   * Only present for individual (Tier 1) entries, not the executive summary.
   * Includes per-component scores with their maxPossible values for transparent display.
   */
  relevanceScore?: {
    /** Overall percentage (0–1) */
    percentage: number;
    /** Raw point total */
    totalScore: number;
    /** Maximum achievable points */
    maxPossible: number;
    /** Per-component breakdown with individual maxPossible values */
    breakdown: {
      modality: { score: number; maxPossible: number };
      bodyRegion: { score: number; maxPossible: number };
      recency: { score: number; maxPossible: number };
      angiography: { score: number; maxPossible: number };
      laterality: { score: number; maxPossible: number };
    };
  };
}

// ── One Liner ─────────────────────────────────────────────────────────────

/**
 * Result from the One Liner synthesis pass — two 1–2 sentence summaries
 * answering "What must I know about this patient?"
 *
 * Produced in a single LLM call. The UI renders one or the other based
 * on the EHR Integration toggle state.
 */
export interface OneLinerResult {
  /** Summary using ONLY imaging data (findings + demographics + study context) */
  imagingOneLiner: string;
  /** Summary synthesizing ALL data (imaging + EHR problems/procedures) */
  fullOneLiner: string;
}

// ── Full Summarization Response ───────────────────────────────────────────

/**
 * Complete response from the summarization pipeline endpoint.
 * Returned by POST /api/v1/patients/:id/summarize.
 */
export interface SummarizationResponse {
  /** Current study this summarization was performed for */
  currentStudyId: string;

  /** Individual report analyses for each top-N relevant prior */
  individualAnalyses: PriorReportAnalysis[];

  /** Synthesized executive summary across all analyzed priors */
  executiveSummary: ExecutiveSummary | null;

  /** Audit log entries for each LLM pass (individual + executive) */
  qaLog: SummarizationQAEntry[];

  /** Total pipeline execution time in milliseconds */
  totalLatencyMs: number;

  /** Aggregate token usage across all LLM calls */
  totalTokenUsage: {
    input: number;
    output: number;
  };

  /**
   * Note snippet triage and problem extraction result.
   * Null when no relevant notes are available.
   */
  noteTriage: NoteTriageResult | null;

  /**
   * Problem list deduplication and relevancy scoring result.
   * Null when the patient has no EHR problems or EHR data is unavailable.
   */
  problemGrouping: ProblemGroupingResult | null;

  /**
   * One Liner synthesis result — two 1–2 sentence clinical summaries.
   * Null when the pipeline has no data to summarize.
   */
  oneLiner: OneLinerResult | null;

  /**
   * Expanded Reason for Study from EHR clinical context synthesis.
   * Null when no EHR notes are available or synthesis was skipped.
   */
  expandedReason: ExpandedReasonForStudy | null;

  /**
   * High-level study purpose from deterministic classification.
   * Always present (defaults to "Diagnostic" when no matches).
   */
  studyIntent: StudyIntentResult;
}

// ── Problem Grouping ──────────────────────────────────────────────────────

/**
 * A single entry in the deduplicated, scored problem list.
 * Can represent either a merged group of related problems or a standalone problem.
 */
export interface ProblemGroupEntry {
  /** Unified heading (for groups) or original problem name (ungrouped) */
  name: string;
  /** Clinical relevancy score (0–10) relative to the current imaging study */
  score: number;
  /** FHIR Condition resource IDs belonging to this entry */
  memberIds: string[];
  /** Compact codes used in the LLM prompt (e.g., ["J", "K", "L"]) */
  memberCodes: string[];
  /** True if this entry merges 2+ raw problems; false if standalone */
  isGroup: boolean;
  /**
   * Aggregated sentence IDs providing provenance for this problem.
   * Populated post-grouping by merging member problems' sentence mappings.
   * Format: ["A.03", "A.14", "B.07", ...]
   */
  sentenceSources?: string[];
  /**
   * Earliest recordedDate across all member problems.
   * Used to determine the "New" chip (≤7 days from current study).
   */
  oldestDate?: string;
  /**
   * Per-member detail with individual sentence IDs for citation provenance.
   * Populated post-grouping alongside sentenceSources.
   * Parallel to memberIds — members[i] corresponds to memberIds[i].
   */
  members?: ProblemMemberDetail[];
}

/**
 * Detail for a single member problem within a ProblemGroupEntry.
 * Carries the original name and per-member sentence IDs for citation attribution.
 */
export interface ProblemMemberDetail {
  /** FHIR Condition ID (e.g., "COND-001" or "LLM-EXTRACTED-001") */
  id: string;
  /** Original problem name (for display in bulleted member list) */
  name: string;
  /** Sentence IDs from note triage specific to this member */
  sentenceIds: string[];
}

/**
 * Complete result of the problem grouping LLM pass.
 */
export interface ProblemGroupingResult {
  /** All grouped + ungrouped entries, sorted by score descending */
  entries: ProblemGroupEntry[];
  /** True if the patient has no problems (LLM was not called) */
  problemListEmpty: boolean;
}

// ── Note Triage ───────────────────────────────────────────────────────────

/**
 * A problem extracted from clinical notes that was NOT on the formal EHR
 * problem list. Discovered by the Note Triage LLM pass.
 */
export interface ExtractedProblem {
  /** LLM-extracted problem name */
  name: string;
  /** Sentence IDs where this problem was identified (e.g., ["A.03", "A.14"]) */
  sourceSentenceIds: string[];
  /** Resolved FHIR note IDs for provenance tracing */
  sourceNoteIds: string[];
  /** Date from the most recent source note */
  mostRecentNoteDate: string;
}

/**
 * A sentence snippet record for provenance resolution.
 * Used by both clinical notes and radiology reports.
 *
 * For notes:  id="A.01", noteId=FHIR resource ID, section="CC"|"HPI"|etc.
 * For reports: id="RA.03", noteId=accession number, section="IMPRESSION"|"FINDINGS"|etc.
 */
export interface SentenceSnippetIndex {
  /** Globally unique sentence ID: "A.01" (notes), "RA.03" (reports) */
  id: string;
  /** Source identifier — FHIR note ID or accession number */
  noteId: string;
  /** Human-readable source title (note title or study description) */
  noteTitle: string;
  /** Section origin: "CC"|"HPI"|"PEX"|"AP"|"COURSE" (notes) or "IMPRESSION"|"FINDINGS"|"COMPARISON" (reports) */
  section: string;
  /** The sentence text */
  text: string;
}

/**
 * Complete result of the note triage LLM pass.
 */
export interface NoteTriageResult {
  /** Problems found in notes but NOT on the EHR problem list */
  extractedProblems: ExtractedProblem[];
  /** Map: problem code → list of sentence IDs with relevant information.
   *  Codes are two-letter problem codes (AA, AB, ...) matching the input coding. */
  problemSentenceMap: Record<string, string[]>;
  /**
   * Map: context query code → list of sentence IDs with relevant content.
   * Codes are from study intent context queries (DX-PRES, TR-MECH, etc.).
   * Empty object when no context queries were requested.
   */
  contextSentenceMap: Record<string, string[]>;
  /** All sentence snippets across all notes (for downstream provenance resolution) */
  sentenceIndex: SentenceSnippetIndex[];
  /** True if no relevant notes were provided (LLM not called) */
  noRelevantNotes: boolean;
}
