/**
 * TypeScript interfaces mirroring the server's data model.
 *
 * These types represent the JSON payloads returned by the REST API
 * at http://localhost:3001/api/v1/. They are kept in sync with
 * server/src/models/types.ts but decoupled to avoid cross-project imports.
 */

// ── Canonical Value Types ────────────────────────────────────────────────

/**
 * Canonical modality codes used in the NewVue system.
 * CT=Computed Tomography, MR=Magnetic Resonance, XR=Radiography,
 * US=Ultrasound, FL=Fluoroscopy, MG=Mammography,
 * NM=Nuclear Medicine, IR=Interventional Radiology
 */
export type Modality = 'CT' | 'MR' | 'XR' | 'US' | 'FL' | 'MG' | 'NM' | 'IR' | 'NA';

/** Laterality designations for imaging studies */
export type Laterality = 'right' | 'left' | 'bilateral' | null;

// ── Study Labels ─────────────────────────────────────────────────────────

/** Structured labels for relevance matching of prior examinations */
export interface StudyLabels {
  modality: Modality;
  /** Canonical body region display names (e.g., ["Head", "Neck"]) */
  bodyRegions: string[];
  /** Raw body region terms from the labeling lexicon, before canonical resolution */
  rawBodyRegions: string[];
  isAngiographic: boolean;
  laterality: Laterality;
  /** All detected modality codes (primary + additional) */
  allModalities: string[];
}

// ── Current Study ────────────────────────────────────────────────────────

/**
 * A "current" imaging study the radiologist is about to read.
 * Distinct from the Study interface which represents prior exams with reports.
 */
export interface CurrentStudy {
  currentStudyId: string;
  studyDescription: string;
  accessionNumber: string;
  studyDateTime: string;
  orderingPhysician: string;
  clinicalIndication: string;
  resultStatus: string;
  studyInstanceUid: string;
  labels: StudyLabels;
}

// ── Patient Summary (list endpoint) ──────────────────────────────────────

/** Lightweight patient entry returned by GET /api/v1/patients */
export interface PatientSummary {
  patientId: string;
  mrn: string;
  name: string;
  sex: string;
  dateOfBirth: string;
  patientClass: string;
  totalStudies: number;
}

// ── Full Patient Record ──────────────────────────────────────────────────

/** Complete patient record from GET /api/v1/patients/:id */
export interface PatientRecord {
  patientId: string;
  demographics: Demographics;
  encounter: Encounter;
  messageHeader: MessageHeader;
  /** Prior imaging studies parsed from the HL7 feed */
  studies: Study[];
  totalStudies: number;
  /** Current studies the radiologist is about to read */
  currentStudies: CurrentStudy[];
  /**
   * Pre-computed relevance scores for all current study × prior study pairs.
   * Outer key = currentStudyId, inner key = prior study sequence number.
   */
  relevanceScores: Record<string, Record<number, RelevanceResult>>;
}

// ── Relevance Scoring ────────────────────────────────────────────────────

/** Per-category breakdown of how a prior study scored against the current exam */
export interface RelevanceBreakdown {
  modality: number;
  bodyRegion: number;
  recency: number;
  angiography: number;
  laterality: number;
}

/** Complete relevance assessment for one prior study vs. one current exam */
export interface RelevanceResult {
  totalScore: number;
  maxPossible: number;
  /** Score as a fraction (0.0–1.0+), stored to 2 decimal precision */
  percentage: number;
  /** True when percentage >= 0.50 */
  isRelevant: boolean;
  breakdown: RelevanceBreakdown;
}

// ── Demographics (PID segment) ───────────────────────────────────────────

export interface Demographics {
  mrn: string;
  name: {
    last: string;
    first: string;
    middle: string;
  };
  dateOfBirth: string;
  sex: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  phone: string;
}

// ── Encounter (PV1 segment) ──────────────────────────────────────────────

export interface Encounter {
  patientClass: string;
  location: string;
  attendingPhysician: Physician;
  referringPhysician: Physician;
  visitNumber: string;
}

export interface Physician {
  id: string;
  last: string;
  first: string;
  middleInitial: string;
}

// ── Message Header (MSH segment) ─────────────────────────────────────────

export interface MessageHeader {
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  messageDateTime: string;
  messageType: string;
  messageControlId: string;
  hl7Version: string;
}

// ── Study (OBR + OBX + ZDS group) ────────────────────────────────────────

export interface Study {
  sequence: number;
  accessionNumber: string;
  studyDescription: string;
  loincCode: string;
  studyDateTime: string;
  clinicalIndication: string;
  resultStatus: string;
  studyInstanceUid: string;
  reportSections: ReportSections;
  /** Structured labels derived from studyDescription (computed server-side) */
  labels?: StudyLabels;
}

// ── Report Sections ──────────────────────────────────────────────────────

export interface ReportSections {
  clinicalIndication: string | null;
  technique: string | null;
  comparison: string | null;
  findings: string | null;
  impression: string | null;
  rawText: string[];
}

// ── RFC 7807 Error Response ──────────────────────────────────────────────

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
}

// ── Summarization Types ──────────────────────────────────────────────────

/** A single finding extracted from a prior radiology report */
export interface ExtractedFinding {
  /** Deterministic finding ID: {accessionNumber}-F{1-based index} */
  id: string;
  name: string;
  sourceExcerpt: string;
  bodySubregion: string;
  subregionSource: 'primary' | 'overlap';
  reportSubsection: string;
  sourceSection: 'impression' | 'findings' | 'both';
  severity: 'critical' | null;
  /** True when finding describes scan quality/artifacts, not pathology */
  technique: boolean;
  trend: 'new' | 'progressing' | 'stable' | 'improving' | 'resolved' | null;
  incidental: boolean;
  measurements: SummarizationMeasurement[];
  changeStatement: string | null;
  recommendation: SummarizationRecommendation | null;
  comparisonStudyReference: string | null;
  /** Global sentence IDs from the source report (e.g., ["RA.03", "RA.14"]) for provenance */
  sourceSentenceIds?: string[];
}

export interface SummarizationMeasurement {
  dimension: string;
  location: string;
  context: string;
}

export interface SummarizationRecommendation {
  action: string;
  timeframe: string | null;
  guideline: string | null;
}

export interface ReferencedStudy {
  studyType: string;
  studyDate: string;
  context: string;
}

/** Complete structured analysis of a single prior report (Tier 1 output) */
export interface PriorReportAnalysis {
  studyName: string;
  studyDate: string;
  accessionNumber: string;
  clinicalPresentation: string | null;
  findings: ExtractedFinding[];
  referencedPriorStudies: ReferencedStudy[];
  /** Sentence-level index for this report (e.g., RA.01, RA.02...) for provenance */
  reportSentenceIndex?: SentenceSnippetIndex[];
}

/** Region group in the executive summary */
export interface ExecutiveSummaryRegionGroup {
  regionName: string;
  findings: ExecutiveFinding[];
}

export interface ExecutiveFinding {
  name: string;
  chips: string[];
  studyEntries: SummaryStudyEntry[];
  /** 3-axis relevancy score from the finding consolidation LLM pass */
  relevancyScore?: FindingRelevancyScore;
}

/** Decomposed relevancy score for an imaging finding (study-independent) */
export interface FindingRelevancyScore {
  /** Safety Risk (0–5) */
  SAF: number;
  /** Probability of Change (0–3) */
  CHG: number;
  /** Tracking Relevance (0–2) */
  TRK: number;
  /** Total = SAF + CHG + TRK (0–10) */
  total: number;
}

export interface SummaryStudyEntry {
  /** Deterministic finding ID for resolution */
  findingId: string;
  studyName: string;
  studyDate: string;
  accessionNumber: string;
  /** Original Tier 1 finding name — for display */
  findingName: string;
  measurement: string | null;
  /** Verbatim source report excerpt — resolved server-side from Tier 1 data */
  sourceExcerpt: string | null;
  /** Change statement — resolved server-side from Tier 1 data */
  changeStatement: string | null;
  /** Sentence IDs from the source report for citation provenance */
  sourceSentenceIds: string[];
}

export interface SimilarPresentation {
  studyName: string;
  studyDate: string;
  accessionNumber: string;
  priorPresentation: string;
  keyFindings: string[];
}

export interface OpenRecommendation {
  action: string;
  sourceStudyName: string;
  sourceStudyDate: string;
  sourceAccession: string;
  timeframe: string | null;
  dueDate: string | null;
  findingContext: string;
  status: 'fulfilled' | 'overdue' | 'pending';
  fulfilledBy: string | null;
}

/** Complete executive summary (Tier 2 output) */
export interface ExecutiveSummary {
  regionGroups: ExecutiveSummaryRegionGroup[];
  similarPriorPresentations: SimilarPresentation[];
  openRecommendations: OpenRecommendation[];
  normalStatement: string;
}

/** One Liner synthesis result — two 1–2 sentence clinical summaries */
export interface OneLinerResult {
  /** Summary using ONLY imaging data (findings + demographics + study context) */
  imagingOneLiner: string;
  /** Summary synthesizing ALL data (imaging + EHR problems/procedures) */
  fullOneLiner: string;
}

export interface ValidationCheck {
  type: 'finding_traceable' | 'measurement_verbatim' | 'reference_present';
  findingName: string;
  status: 'pass' | 'warning' | 'fail';
  detail: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
}

export interface SummarizationQAEntry {
  label: string;
  studyName: string | null;
  studyDate: string | null;
  accessionNumber: string | null;
  type: 'individual' | 'similar-presentations' | 'finding-grouping' | 'problem-grouping' | 'note-triage' | 'one-liner' | 'expanded-reason';
  inputData: Record<string, unknown>;
  outputData: Record<string, unknown>;
  validation: ValidationResult;
  latencyMs: number;
  tokenUsage: { input: number; output: number };
  /** Relevance score breakdown (individual entries only) */
  relevanceScore?: {
    percentage: number;
    totalScore: number;
    maxPossible: number;
    breakdown: {
      modality: { score: number; maxPossible: number };
      bodyRegion: { score: number; maxPossible: number };
      recency: { score: number; maxPossible: number };
      angiography: { score: number; maxPossible: number };
      laterality: { score: number; maxPossible: number };
    };
  };
}

/** Full response from POST /api/v1/patients/:id/summarize */
export interface SummarizationResponse {
  currentStudyId: string;
  individualAnalyses: PriorReportAnalysis[];
  executiveSummary: ExecutiveSummary | null;
  noteTriage: NoteTriageResult | null;
  problemGrouping: ProblemGroupingResult | null;
  oneLiner: OneLinerResult | null;
  expandedReason: ExpandedReasonForStudy | null;
  studyIntent: StudyIntentResult;
  qaLog: SummarizationQAEntry[];
  totalLatencyMs: number;
  totalTokenUsage: { input: number; output: number };
}

// ── Problem Grouping ──────────────────────────────────────────────────────

export interface ProblemGroupEntry {
  name: string;
  score: number;
  memberIds: string[];
  memberCodes: string[];
  isGroup: boolean;
  sentenceSources?: string[];
  /** Earliest recordedDate across all member problems (for "New" chip) */
  oldestDate?: string;
  /** Per-member detail with individual sentence IDs for citation provenance */
  members?: ProblemMemberDetail[];
}

/** Detail for a single member problem — name + per-member sentence IDs */
export interface ProblemMemberDetail {
  id: string;
  name: string;
  sentenceIds: string[];
}

export interface ProblemGroupingResult {
  entries: ProblemGroupEntry[];
  problemListEmpty: boolean;
}

// ── Dev Settings (development-only model comparison) ─────────────────────

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface FindingGroupingDevSettings {
  modelId: string;
  reasoningEffort: ReasoningEffort;
}

export interface DevSettings {
  findingGrouping: FindingGroupingDevSettings;
  problemGrouping: FindingGroupingDevSettings;
  noteTriage: FindingGroupingDevSettings;
  oneLiner: FindingGroupingDevSettings;
  expandedReason: FindingGroupingDevSettings;
}

/** QA data for a single ERIK LLM pass (triage or answer) */
export interface ErikQAData {
  input: string;
  output: string;
  tokens: { input: number; output: number };
}

// ── Note Triage ───────────────────────────────────────────────────────────

export interface ExtractedProblem {
  name: string;
  sourceSentenceIds: string[];
  sourceNoteIds: string[];
  mostRecentNoteDate: string;
}

export interface SentenceSnippetIndex {
  id: string;
  noteId: string;
  noteTitle: string;
  section: string;
  text: string;
}

export interface NoteTriageResult {
  extractedProblems: ExtractedProblem[];
  problemSentenceMap: Record<string, string[]>;
  contextSentenceMap: Record<string, string[]>;
  sentenceIndex: SentenceSnippetIndex[];
  noRelevantNotes: boolean;
}

// ── Expanded Reason for Study ──────────────────────────────────────────────

export type StudyPurpose =
  | 'Diagnostic' | 'Follow-up' | 'Trauma' | 'Hardware'
  | 'Guidance' | 'Post-Op' | 'Screening' | 'Medicolegal' | 'Research';

export interface StudyIntentResult {
  primary: StudyPurpose;
  secondary: StudyPurpose | null;
  primaryMatchCount: number;
  secondaryMatchCount: number;
  matchDetails: Partial<Record<StudyPurpose, number>>;
}

export interface ExpandedReasonEntry {
  code: string;
  displayLabel: string;
  content: string;
}

export interface ExpandedReasonBlock {
  purpose: StudyPurpose;
  entries: ExpandedReasonEntry[];
}

export interface ExpandedReasonForStudy {
  primary: ExpandedReasonBlock;
  secondary: ExpandedReasonBlock | null;
  clinicalIndication: string;
}

