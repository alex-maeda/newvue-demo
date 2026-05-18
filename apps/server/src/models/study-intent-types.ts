/**
 * study-intent-types.ts — Types for the Expanded Reason for Study feature.
 *
 * The study intent system classifies radiology orders into high-level
 * purpose categories (Diagnostic, Trauma, Follow-up, etc.) and defines
 * clinical context queries that guide EHR note snippet extraction.
 *
 * The classification is purely deterministic (keyword matching from
 * study_intent_rules.json). The synthesis of extracted snippets into
 * structured clinical context is handled by a dedicated LLM pass.
 */

// ── Study Purpose ─────────────────────────────────────────────────────────

/**
 * High-level study purpose categories.
 * Matched deterministically from the ServiceRequest clinicalIndication text
 * using keyword rules in config/study_intent_rules.json.
 *
 * Priority order (for tie-breaking when match counts are equal):
 * Trauma > Post-Op > Hardware > Follow-up > Guidance > Screening >
 * Medicolegal > Research > Diagnostic (default)
 */
export type StudyPurpose =
  | 'Diagnostic'
  | 'Follow-up'
  | 'Trauma'
  | 'Hardware'
  | 'Guidance'
  | 'Post-Op'
  | 'Screening'
  | 'Medicolegal'
  | 'Research';

/**
 * Result of deterministic study intent classification.
 * Primary is always set (defaults to "Diagnostic").
 * Secondary is set when a non-primary category has >0 keyword matches.
 */
export interface StudyIntentResult {
  /** Winning category (most keyword matches, priority tiebreak) */
  primary: StudyPurpose;
  /** Second-place category, if any non-primary category had matches */
  secondary: StudyPurpose | null;
  /** Number of keyword matches for the primary category */
  primaryMatchCount: number;
  /** Number of keyword matches for the secondary category (0 if no secondary) */
  secondaryMatchCount: number;
  /** Full match-count breakdown for all categories */
  matchDetails: Partial<Record<StudyPurpose, number>>;
}

// ── Context Queries ───────────────────────────────────────────────────────

/**
 * A clinical context query that the Problem Extraction LLM pass
 * should use to tag relevant note sentences.
 *
 * These are defined per study purpose category and sent as TASK 3
 * in the note-triage prompt.
 */
export interface ContextQuery {
  /** Short code, e.g., "DX-PRES", "TR-MECH" */
  code: string;
  /** Human-readable display label for the UI, e.g., "CLINICAL PRESENTATION" */
  displayLabel: string;
  /** Instruction for the LLM describing what to look for */
  description: string;
  /** Which intent category this query belongs to */
  intentCategory: 'primary' | 'secondary';
}

// ── Expanded Reason for Study ─────────────────────────────────────────────

/**
 * A single data entry in the expanded reason for study.
 * Produced by the synthesis LLM pass from aggregated note snippets.
 */
export interface ExpandedReasonEntry {
  /** Context query code, e.g., "DX-PRES" */
  code: string;
  /** Human-readable display label, e.g., "CLINICAL PRESENTATION" */
  displayLabel: string;
  /** LLM-synthesized content answering this query */
  content: string;
}

/**
 * A purpose-specific block within the expanded reason for study.
 * Contains the study purpose label and the synthesized entries.
 */
export interface ExpandedReasonBlock {
  /** High-level study purpose, e.g., "Diagnostic", "Trauma" */
  purpose: StudyPurpose;
  /** Synthesized entries for this purpose's data queries */
  entries: ExpandedReasonEntry[];
}

/**
 * Complete expanded reason for study — the final structured output
 * displayed in the executive summary when EHR Integration is enabled.
 *
 * Always includes the verbatim clinicalIndication from the ServiceRequest
 * as a fallback baseline.
 */
export interface ExpandedReasonForStudy {
  /** Primary purpose block with synthesized entries */
  primary: ExpandedReasonBlock;
  /** Optional secondary purpose block (null if no secondary intent) */
  secondary: ExpandedReasonBlock | null;
  /** Verbatim text from the ServiceRequest / study order form */
  clinicalIndication: string;
}
