/**
 * TypeScript interfaces for the parsed HL7 data model.
 *
 * These types define the structured JSON that the REST API serves to the
 * React frontend. They represent the semantic content extracted from
 * HL7 ORU^R01 messages — not the raw HL7 wire format.
 *
 * Mapping to HL7 segments:
 *   PatientRecord  → entire message
 *   MessageHeader  → MSH segment
 *   Demographics   → PID segment
 *   Encounter      → PV1 segment
 *   Study          → OBR + OBX[] + ZDS group
 *   ReportSections → OBX segments (text content by section)
 *   CurrentStudy   → ServiceRequest / current encounter context
 */

// ── Canonical Value Types ─────────────────────────────────────────────────

/**
 * Canonical modality codes used in the NewVue system.
 * CT=Computed Tomography, MR=Magnetic Resonance, XR=Radiography,
 * US=Ultrasound, FL=Fluoroscopy, MG=Mammography,
 * NM=Nuclear Medicine, IR=Interventional Radiology,
 * NA=Not Available (graceful fallback when modality cannot be extracted)
 */
export type Modality = 'CT' | 'MR' | 'XR' | 'US' | 'FL' | 'MG' | 'NM' | 'IR' | 'NA';

/** Laterality designations for imaging studies */
export type Laterality = 'right' | 'left' | 'bilateral' | null;

// ── Study Labels ──────────────────────────────────────────────────────────

/**
 * Structured labels derived from a study name that drive
 * relevance filtering of prior examinations.
 *
 * In production, these labels are provided directly by the RIS/PACS
 * system. In the simulation environment, they are pre-assigned as
 * static metadata in encounter_metadata.json.
 */
export interface StudyLabels {
  /** Primary imaging modality (e.g., CT, MR, XR) */
  modality: Modality;
  /** Canonical body region display names (e.g., ["Head", "Neck"]) */
  bodyRegions: string[];
  /**
   * Raw body region terms as emitted by the labeling lexicon, prior to
   * canonical resolution. Used for exact-term matching in relevance scoring
   * (5-point tier), where "head" vs "brain" distinction matters.
   */
  rawBodyRegions: string[];
  /**
   * Whether the study is angiographic — determined by the presence of
   * angiography terms (e.g., "artery", "doppler") in the study name.
   */
  isAngiographic: boolean;
  /** Laterality designation, if applicable */
  laterality: Laterality;
  /**
   * All detected modality codes (primary + additional).
   * Used for best-match modality scoring when a study description
   * contains multiple modality tokens (e.g., PET-CT → ["NM", "CT"]).
   * Falls back to ["NA"] if no modalities are detected.
   */
  allModalities: string[];
}

// ── Current Study ─────────────────────────────────────────────────────────

/**
 * A "current" imaging study that the radiologist is about to read.
 * This represents the exam being reported on — NOT a prior study.
 *
 * In production, this data originates from the ServiceRequest / ORM
 * message for the current encounter. In simulation, it is stored
 * in encounter_metadata.json alongside the PV1 encounter context.
 */
export interface CurrentStudy {
  /** Unique identifier within the encounter (e.g., "P1-CURRENT-001") */
  currentStudyId: string;
  /** Full human-readable study description (e.g., "MR Brain without Contrast") */
  studyDescription: string;
  /** Accession number for the current exam */
  accessionNumber: string;
  /** Study date/time in YYYYMMDDHHMMSS format */
  studyDateTime: string;
  /** Ordering/referring physician for this specific study */
  orderingPhysician: string;
  /** Clinical indication / reason for exam (from ServiceRequest) */
  clinicalIndication: string;
  /** Result status — "IP" (in-progress) for current exams, "F" (final) for priors */
  resultStatus: string;
  /** DICOM Study Instance UID */
  studyInstanceUid: string;
  /** Structured labels for relevance matching against prior studies */
  labels: StudyLabels;
}

// ── Relevance Scoring ─────────────────────────────────────────────────────

/**
 * Breakdown of how a prior study scored against the current exam.
 * All component scores are included to enable transparent display
 * and debugging of the scoring algorithm.
 */
export interface RelevanceBreakdown {
  /** Modality match score: 3 (exact), 2 (useful/family), 0 (none) */
  modality: number;
  /** Body region score: 0–5, averaged across current study regions */
  bodyRegion: number;
  /** Recency score: 0–4, linearly tapered by elapsed time */
  recency: number;
  /** Angiography score: +3 (match), -2 (mismatch), 0 (neither) */
  angiography: number;
  /** Laterality score: +2 (exact), +1 (bilateral partial), -2 (mismatch), 0 (N/A) */
  laterality: number;
}

/**
 * Complete relevance assessment for one prior study vs. one current exam.
 * Pre-computed on the server during patient load.
 */
export interface RelevanceResult {
  /** Raw point total (can be negative due to angio/laterality penalties) */
  totalScore: number;
  /** Maximum achievable points for this current study's label profile */
  maxPossible: number;
  /** totalScore / maxPossible, stored to 2 decimal precision */
  percentage: number;
  /** True when percentage > 0.50 */
  isRelevant: boolean;
  /** Per-category score breakdown */
  breakdown: RelevanceBreakdown;
}

// ── Note Relevance Scoring ────────────────────────────────────────────────

/**
 * The 5 canonical clinical note sections extracted by the
 * deterministic section parser. Used for both the physician-note
 * filter (≥2 sections present) and downstream LLM input.
 */
export type NoteSection = 'CC' | 'HPI' | 'PEX' | 'AP' | 'COURSE';

/**
 * Extracted text for each canonical section of a clinical note.
 * Empty string means the section was not found in the note.
 */
export interface NoteSections {
  CC: string;
  HPI: string;
  PEX: string;
  AP: string;
  COURSE: string;
}

/**
 * Per-component breakdown of how a clinical note scored against
 * the current imaging study. All components are additive.
 */
export interface NoteRelevanceBreakdown {
  /** +3 if note encounter matches current study encounter, else 0 */
  sameEncounter: number;
  /** +4 (discharge) / +3 (consult/H&P/ED/operative) / +2 (office) / +1 (ICU) / 0 */
  noteType: number;
  /** +3 (region specialist match) / +1 (whole body) / 0 (other) */
  specialtyRegion: number;
  /** 0–3, piecewise linear decay by months since note date */
  recency: number;
  /** +1.0 (HPI + AP both found) / +0.5 (HPI or AP) / 0 (neither) */
  sectionQuality: number;
}

/**
 * Complete relevance assessment for one clinical note vs. one current exam.
 * Pre-computed on the server during patient load, keyed by currentStudyId.
 */
export interface NoteRelevanceResult {
  /** The note ID this result pertains to */
  noteId: string;
  /** Raw composite score (sum of all breakdown components) */
  totalScore: number;
  /** Normalized percentage relative to the top scorer, rounded to nearest 5% */
  normalizedPercent: number;
  /** True when this note is in the top-5 selected set */
  isRelevant: boolean;
  /** True when this note matches the ordering provider + encounter */
  isOrderingProvider: boolean;
  /** Per-component score breakdown for transparency/debugging */
  breakdown: NoteRelevanceBreakdown;
  /** Which of the 5 canonical sections were found in this note */
  sectionsFound: Record<NoteSection, boolean>;
}

// ── Top-Level Record ──────────────────────────────────────────────────────

/** Complete patient record assembled from a parsed HL7 ORU^R01 feed */
export interface PatientRecord {
  /** Patient directory identifier (e.g., "Patient_1") */
  patientId: string;
  /** Patient demographics from PID segment */
  demographics: Demographics;
  /** Current encounter context from PV1 segment */
  encounter: Encounter;
  /** Message routing metadata from MSH segment */
  messageHeader: MessageHeader;
  /** All prior imaging studies, ordered by OBR sequence */
  studies: Study[];
  /** Total number of prior studies in this feed */
  totalStudies: number;
  /**
   * Current studies the radiologist is about to read during this encounter.
   * These drive the "current exam" dropdown and relevance filtering of priors.
   */
  currentStudies: CurrentStudy[];
  /**
   * Pre-computed relevance scores for all current study × prior study pairs.
   * Outer key = currentStudyId, inner key = prior study sequence number.
   * Computed server-side during patient load to keep business logic on the backend.
   */
  relevanceScores: Record<string, Record<number, RelevanceResult>>;
}

/** Lightweight patient summary for the patient list endpoint */
export interface PatientSummary {
  patientId: string;
  mrn: string;
  name: string;
  sex: string;
  dateOfBirth: string;
  patientClass: string;
  totalStudies: number;
}

// ── MSH Segment ───────────────────────────────────────────────────────────

/** Message header metadata from MSH segment */
export interface MessageHeader {
  /** MSH-3: Sending application (e.g., "NEWVUE_RIS") */
  sendingApplication: string;
  /** MSH-4: Sending facility (e.g., "RADIOLOGY_DEPT") */
  sendingFacility: string;
  /** MSH-5: Receiving application (e.g., "NEWVUE_EHR") */
  receivingApplication: string;
  /** MSH-6: Receiving facility (e.g., "NEWVUE_HOSPITAL") */
  receivingFacility: string;
  /** MSH-7: Message date/time in YYYYMMDDHHMMSS format */
  messageDateTime: string;
  /** MSH-9: Message type (e.g., "ORU^R01") */
  messageType: string;
  /** MSH-10: Unique message control ID */
  messageControlId: string;
  /** MSH-12: HL7 version (e.g., "2.5.1") */
  hl7Version: string;
}

// ── PID Segment ───────────────────────────────────────────────────────────

/** Patient demographics from PID segment */
export interface Demographics {
  /** PID-3.1: Medical Record Number */
  mrn: string;
  /** PID-5: Patient name (XPN data type) */
  name: {
    /** PID-5.1: Family/last name */
    last: string;
    /** PID-5.2: Given/first name */
    first: string;
    /** PID-5.3: Middle name or initial */
    middle: string;
  };
  /** PID-7: Date of birth in YYYYMMDD format */
  dateOfBirth: string;
  /** PID-8: Administrative sex (M/F) */
  sex: string;
  /** PID-11: Patient address */
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  /** PID-13: Phone number */
  phone: string;
}

// ── PV1 Segment ───────────────────────────────────────────────────────────

/** Current encounter from PV1 segment */
export interface Encounter {
  /** PV1-2: Patient class — I (Inpatient), O (Outpatient), E (Emergency) */
  patientClass: string;
  /** PV1-3: Assigned patient location (e.g., "MED^RM412^BED-A") */
  location: string;
  /** PV1-7: Attending physician */
  attendingPhysician: Physician;
  /** PV1-8: Referring physician */
  referringPhysician: Physician;
  /** PV1-19: Visit/encounter number */
  visitNumber: string;
}

/** Physician reference (used in PV1-7 and PV1-8) */
export interface Physician {
  /** Physician identifier (e.g., "ATT006") */
  id: string;
  /** Family/last name */
  last: string;
  /** Given/first name */
  first: string;
  /** Middle initial */
  middleInitial: string;
}

// ── OBR/OBX/ZDS Group ────────────────────────────────────────────────────

/** A single imaging study assembled from an OBR + its child OBX + ZDS segments */
export interface Study {
  /** OBR-1: Sequence number within the message (1-based) */
  sequence: number;
  /** OBR-3: Accession number (e.g., "ACC-P1-0001") */
  accessionNumber: string;
  /** OBR-4.2: Human-readable study description (e.g., "CT Chest") */
  studyDescription: string;
  /** OBR-4.1: LOINC code (e.g., "24627-2") */
  loincCode: string;
  /** OBR-7: Study date/time in YYYYMMDDHHMMSS format */
  studyDateTime: string;
  /** OBR-13: Clinical indication / reason for exam */
  clinicalIndication: string;
  /** OBR-25: Result status — always "F" (Final) for our feeds */
  resultStatus: string;
  /** ZDS-1.1: DICOM Study Instance UID */
  studyInstanceUid: string;
  /** Report text organized by semantic section */
  reportSections: ReportSections;
  /**
   * Structured labels derived from studyDescription via normalization + labeling.
   * Computed server-side during patient load. Optional because it may not be
   * present if labeling fails for a particular study.
   */
  labels?: StudyLabels;
}

/** Report text organized by semantic section, extracted from OBX segments */
export interface ReportSections {
  /** From OBX with "CLINICAL INDICATION:" prefix */
  clinicalIndication: string | null;
  /** From OBX with "TECHNIQUE:" prefix */
  technique: string | null;
  /** From OBX with "COMPARISON:" prefix */
  comparison: string | null;
  /** From OBX with "FINDINGS:" prefix (FT type, line breaks preserved) */
  findings: string | null;
  /** From OBX with "IMPRESSION:" prefix */
  impression: string | null;
  /** All OBX values in order (fallback for non-standard layouts) */
  rawText: string[];
}

// ── RFC 7807 Error Response ───────────────────────────────────────────────

/** Standardized error response per project conventions §4 and RFC 7807 */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
}
