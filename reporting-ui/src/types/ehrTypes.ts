/**
 * EHR Data Types
 *
 * TypeScript interfaces for FHIR-derived EHR data returned by the
 * /api/v1/ehr/:patientNumber endpoint. These types mirror the server-side
 * EhrDataPayload shape from fhirDataService.ts.
 */

// ── Individual Resource Types ──────────────────────────────────────────────

export interface EhrNote {
  id: string;
  title: string;
  date: string;
  type: string;
  author: string;
  /** Encounter setting (e.g., "Inpatient", "Neurology") */
  setting: string;
  /** Clinical specialty / department (e.g., "Neurology", "Emergency Medicine") */
  specialty: string;
  /** Server-side file path for on-demand text fetch */
  textFilePath: string;
  /** Author's FHIR Practitioner reference (e.g., "Practitioner/PRAC-0001") */
  authorRef: string;
  /** FHIR encounter ID for this note (e.g., "ENC-001") */
  encounterId: string;
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
  sectionsFound: Record<string, boolean>;
}

export interface EhrProblem {
  id: string;
  text: string;
  /** Clinical status (e.g., "active", "resolved") */
  status: string;
  recordedDate: string;
  /** Optional clinician annotation or explanatory text */
  note?: string;
}

export interface EhrProcedure {
  id: string;
  text: string;
  date: string;
  /** Procedure completion status (e.g., "completed", "in-progress") */
  status: string;
  /** Anatomical location (e.g., "Right superficial lymph node") */
  bodySite: string;
  /** Optional clinician annotation */
  note?: string;
}

export interface EhrMedication {
  id: string;
  /** Medication name from medicationCodeableConcept.text */
  name: string;
  /** Full dosage instruction text (free-text sig) */
  dosageInstruction: string;
  /** "active", "on-hold", "stopped", etc. */
  status: string;
  /** "outpatient" | "inpatient-scheduled" | "inpatient-prn" | "inpatient-continuous" */
  category: string;
  /** Most recent administration datetime from MedicationAdministration (empty if none) */
  lastGiven: string;
  /** Optional clinician annotation */
  note?: string;
}

export interface LabRow {
  name: string;
  values: string[];
  /** Unit of measurement (e.g., "K/uL", "mg/dL") */
  unit: string;
  /** Normal reference range string (e.g., "4.5-11.0") */
  referenceRange: string;
  trend: { delta: number | null; dir: string };
}

export interface LabPanel {
  columns: string[];
  rows: LabRow[];
}

export interface EhrLabs {
  panels: Record<string, LabPanel>;
}

export interface EhrPathologyReport {
  id: string;
  title: string;
  date: string;
  status: string;
  textFilePath: string;
}

// ── Payload Types ──────────────────────────────────────────────────────────

export interface EhrDataPayload {
  available: true;
  notes: EhrNote[];
  problems: EhrProblem[];
  procedures: EhrProcedure[];
  medications: EhrMedication[];
  labs: EhrLabs;
  pathology: EhrPathologyReport[];
  /**
   * Pre-computed note relevance scores, keyed by currentStudyId.
   * Each entry is an array of NoteRelevanceResult (one per note).
   */
  noteRelevance: Record<string, NoteRelevanceResult[]>;
}

export interface EhrDataUnavailable {
  available: false;
}

export type EhrDataResponse = EhrDataPayload | EhrDataUnavailable;

// ── Loading State ──────────────────────────────────────────────────────────

export type EhrDataStatus = 'idle' | 'loading' | 'loaded' | 'unavailable' | 'error';
