/**
 * note-triage-v1.ts — Prompt for sentence-level Problem Extraction
 * with problem→sentence provenance mapping and clinical context tagging.
 *
 * This pass runs BEFORE the problem grouping/deduplication pass and serves
 * up to three purposes:
 *
 *   TASK 1 — Problem Extraction:
 *             Extract medical problems mentioned in clinical note sentences
 *             that are NOT represented on the patient's formal EHR problem list.
 *
 *   TASK 2 — Problem-Sentence Mapping:
 *             For each provided problem, identify ALL sentence IDs that provide
 *             meaningful clinical information about that problem.
 *
 *   TASK 3 — Clinical Context Tagging (optional):
 *             When context queries are provided (based on the study's high-level
 *             purpose — Diagnostic, Trauma, Follow-up, etc.), tag sentence IDs
 *             that directly answer or inform each query.
 *
 * Input encoding:
 *   - EHR problems are coded with two-letter IDs (AA, AB, ..., AZ, BA, ...)
 *     to avoid collision with single-letter note IDs (A, B, C...).
 *   - Sentences use flat IDs per note: A.01, A.02, ..., A.47.
 *     Section type (CC/HPI/PEX/AP/COURSE) is included as metadata in the
 *     sentence label but NOT in the ID.
 *
 * Output: Strict JSON with two or three fields:
 *   - extractedProblems: new problems found with source sentence IDs
 *   - problemMappings: map of each input problem code → relevant sentence IDs
 *   - contextMappings: (when context queries present) map of query code → relevant sentence IDs
 *
 * Per-note batching: This prompt is invoked once per note (not once for all
 * notes). Each call receives the full problem list but only one note's sentences.
 * Cross-note aggregation happens server-side after all calls complete.
 *
 * Model: Haiku by default, configurable via dev-settings.json.
 */

import type { ContextQuery } from '../models/study-intent-types';

// ── Types ─────────────────────────────────────────────────────────────────

export interface NoteTriagePromptContext {
  /** Display name of the current imaging study */
  studyDescription: string;
  /** Canonical body regions for the current study */
  bodyRegions: string[];
  /** Coded EHR problem entries */
  problems: CodedProblemEntry[];
  /** Sentences from ONE note, with flat IDs and section metadata */
  sentences: SentenceEntry[];
  /** Human-readable title of the note being analyzed */
  noteTitle: string;
  /**
   * Clinical context queries for TASK 3 (optional).
   * When provided, the LLM will also tag sentences relevant to each query.
   * Empty array = TASK 3 is skipped.
   */
  contextQueries?: ContextQuery[];
}

export interface CodedProblemEntry {
  /** Two-letter compact code: "AA", "AB", ..., "AZ", "BA", etc. */
  code: string;
  /** Problem name from FHIR Condition resource */
  name: string;
  /** Clinical status: "active", "resolved", "llm-extracted", etc. */
  status: string;
  /** Date the problem was recorded, formatted as YYYY-MM-DD */
  date: string;
}

export interface SentenceEntry {
  /** Flat ID: "A.01", "A.02", etc. */
  id: string;
  /** Section this sentence came from (metadata, not part of the ID) */
  section: string;
  /** The sentence text */
  text: string;
}

// ── Prompt Builder ────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a clinical informatics expert assisting a radiologist. You receive:
1. A patient's formal EHR problem list (each problem has a two-letter code)
2. Sentences extracted from a single clinical note, each with a unique ID

You have TWO tasks:

TASK 1 — Problem Extraction:
Review each sentence for clearly defined active medical problems that are NOT already represented on the provided problem list.

Rules:
- Extract only DISCRETE clinical conditions — not symptoms restated as problems, not synonyms of existing problems.
- If a sentence describes a condition that is a clear subset, complication, or direct manifestation of an existing problem list entry, do NOT extract it.
- Prefer specific, clinically precise names (e.g., "Right MCA territory infarct" not "stroke").
- Include the sentence ID(s) where each new problem was identified.
- If no new problems are found, return an empty array.

TASK 2 — Problem-Sentence Mapping:
For each provided problem (by its two-letter code), identify ALL sentence IDs that provide meaningful clinical information about that problem.

A sentence is relevant to a problem if it describes:
- Onset, severity, progression, or current status of the problem
- Specific exam findings, lab values, or imaging references related to the problem
- Treatment details, medications, or clinical reasoning about the problem
- Complications or sequelae of the problem
- Recommendations or plans related to the problem

A sentence is NOT relevant if it:
- Merely lists the problem name without adding clinical context
- Describes a completely unrelated condition
- Is boilerplate template text

For problems with no relevant sentences in this note, output an empty array.`;

const TASK3_SYSTEM_ADDENDUM = `

TASK 3 — Clinical Context Tagging:
You are also provided with a set of clinical context queries, each identified by a short code.
For each query, identify sentence IDs that contain information directly relevant to answering that query.
Only include sentences with clearly relevant content — do not guess or speculate.
If no sentences are relevant to a query, output an empty array.`;

const OUTPUT_FOOTER = `\n\nOUTPUT FORMAT:\nReturn ONLY valid JSON. No markdown fences. No commentary.`;

export function buildNoteTriagePrompt(
  ctx: NoteTriagePromptContext,
): { systemPrompt: string; userMessage: string } {
  const hasContextQueries = ctx.contextQueries && ctx.contextQueries.length > 0;

  // ── Build system prompt (conditionally include TASK 3) ──
  const systemPrompt = hasContextQueries
    ? BASE_SYSTEM_PROMPT + TASK3_SYSTEM_ADDENDUM + OUTPUT_FOOTER
    : BASE_SYSTEM_PROMPT + OUTPUT_FOOTER;

  // Build the coded problem reference list
  const problemLines = ctx.problems.length > 0
    ? ctx.problems.map((p) => `${p.code}: ${p.name} (${p.status}, ${p.date})`).join('\n')
    : '(No problems on the formal EHR problem list)';

  // Build sentence blocks — each sentence gets its ID, section label, and text
  const sentenceLines = ctx.sentences.map((s) =>
    `[${s.id}] (${s.section}) ${s.text}`,
  ).join('\n');

  // Build the expected output keys for problemMappings
  const mappingKeys = ctx.problems.map(p => `"${p.code}": []`).join(',\n    ');

  // ── Build user message ──
  const lines: string[] = [];
  lines.push(`CURRENT IMAGING STUDY: ${ctx.studyDescription}`);
  lines.push(`BODY REGIONS: ${ctx.bodyRegions.join(', ')}`);
  lines.push(`NOTE: ${ctx.noteTitle}`);
  lines.push('');
  lines.push(`PATIENT EHR PROBLEM LIST (${ctx.problems.length} entries):`);
  lines.push(problemLines);

  // Context queries block (TASK 3 — only when queries are provided)
  if (hasContextQueries) {
    lines.push('');
    lines.push(`CLINICAL CONTEXT QUERIES (${ctx.contextQueries!.length} queries):`);
    for (const q of ctx.contextQueries!) {
      lines.push(`${q.code}: ${q.description}`);
    }
  }

  lines.push('');
  lines.push(`NOTE SENTENCES (${ctx.sentences.length} sentences):`);
  lines.push(sentenceLines);

  // Output schema
  lines.push('');
  lines.push('Output schema:');
  lines.push('{');
  lines.push('  "extractedProblems": [');
  lines.push('    {');
  lines.push('      "name": "<specific clinical condition name>",');
  lines.push('      "sentences": ["<sentenceId>", "<sentenceId>"]');
  lines.push('    }');
  lines.push('  ],');
  lines.push('  "problemMappings": {');
  lines.push(`    ${mappingKeys}`);
  lines.push('  }');

  if (hasContextQueries) {
    const contextKeys = ctx.contextQueries!.map(q => `"${q.code}": []`).join(',\n    ');
    lines.push('  ,"contextMappings": {');
    lines.push(`    ${contextKeys}`);
    lines.push('  }');
  }

  lines.push('}');

  // Reminders
  lines.push('');
  lines.push('Reminders:');
  lines.push('- Only extract problems that are genuinely NEW — not already on the problem list.');
  lines.push('- For problemMappings, include ALL sentence IDs that add meaningful information about each problem.');
  lines.push('- Every input problem code MUST appear in problemMappings (use an empty array if no relevant sentences).');
  lines.push('- If no new problems are found, return an empty extractedProblems array.');

  if (hasContextQueries) {
    lines.push('- For contextMappings, include ALL sentence IDs that directly answer or inform the query.');
    lines.push('- Every context query code MUST appear in contextMappings (use an empty array if no relevant sentences).');
  }

  return { systemPrompt, userMessage: lines.join('\n') };
}
