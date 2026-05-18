/**
 * expanded-reason-v1.ts — Prompt template for the Expanded Reason for Study
 * synthesis pass.
 *
 * This pass consumes:
 *   - Aggregated note snippets (tagged by context query code from TASK 3)
 *   - The verbatim ServiceRequest clinical indication
 *   - Study metadata (description, body regions, modality)
 *   - Top imaging findings, problems, and procedures for context
 *
 * It produces structured, category-specific clinical context answering
 * each context query (e.g., "What is the clinical presentation?",
 * "What is the differential diagnosis?").
 *
 * Model: Sonnet 4.6 (no reasoning effort) by default.
 * Output: Strict JSON keyed by query codes, partitioned by primary/secondary.
 */

import type { StudyPurpose } from '../models/study-intent-types';

// ── Types ─────────────────────────────────────────────────────────────────

export interface QuerySnippetGroup {
  /** Context query code, e.g., "DX-PRES" */
  code: string;
  /** Human-readable display label */
  displayLabel: string;
  /** Description of what to look for */
  description: string;
  /** Which intent this query serves */
  intentCategory: 'primary' | 'secondary';
  /** Resolved snippet texts from note triage (may be empty) */
  snippets: string[];
}

export interface ExpandedReasonFinding {
  name: string;
  score: number;
  trend: string | null;
}

export interface ExpandedReasonProblem {
  name: string;
  score: number;
}

export interface ExpandedReasonProcedure {
  name: string;
  date: string;
  bodySite: string;
}

export interface ExpandedReasonPromptContext {
  /** Primary study purpose */
  primaryPurpose: StudyPurpose;
  /** Secondary study purpose (if any) */
  secondaryPurpose: StudyPurpose | null;
  /** Verbatim ServiceRequest text */
  clinicalIndication: string;
  /** Current study description */
  studyDescription: string;
  /** Canonical body regions */
  bodyRegions: string[];
  /** Primary imaging modality */
  modality: string;
  /** Context query groups with resolved snippet texts */
  querySnippets: QuerySnippetGroup[];
  /** Top imaging findings (score ≥ 4) */
  topFindings: ExpandedReasonFinding[];
  /** Top problems (score ≥ 5) */
  topProblems: ExpandedReasonProblem[];
  /** Top 4 procedures */
  topProcedures: ExpandedReasonProcedure[];
}

// ── Prompt Builder ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clinical informatics expert writing concise context lines for a radiologist.

For each context query code, distill the provided snippets into a single clinical sentence.

LENGTH RULES (CRITICAL — violations are unacceptable):
- TARGET: 1 sentence per query. Maximum: 2 short sentences.
- Each answer must be ≤ 30 words. Aim for 10–20 words.
- NO preambles ("The patient presents with…"), NO filler ("It should be noted that…")
- NO hedging ("possibly", "may be consistent with", "which could suggest")
- Start directly with the clinical fact: "Left-sided weakness and dysarthria onset 6h prior."
- Use standard clinical shorthand (s/p, w/, h/o, r/o) but avoid excessive acronyms

CONTENT RULES:
- Synthesize ONLY from provided snippets and contextual data — no hallucination
- If a query has no snippets and no relevant contextual data, output null
- The study purpose classification is authoritative — do NOT override it

QUERY-SPECIFIC RULES:
- CLINICAL PRESENTATION (DX-PRES): Report ONLY acute symptoms, signs, and examination findings. Do NOT include patient age, sex, demographics, or past medical history.
- DIFFERENTIAL DIAGNOSIS (DX-DDX): List specific diagnoses separated by commas.
- LOCALIZATION (DX-LOC): Output a bulleted list of up to 2 top contenders. Each bullet pairs the driving finding/sign with the anatomic localization. Format: "• [finding] → [anatomy]". Example: "• Right hemiparesis, aphasia → Left MCA territory\\n• Left gaze preference → Right frontal eye field"

BAD (too wordy):
"The patient is a 67-year-old male who presents with new onset of left-sided hemiparesis and slurred speech that began approximately 6 hours ago, concerning for an acute cerebrovascular event in the right middle cerebral artery territory."

GOOD (correct length):
"Left hemiparesis and dysarthria, onset 6h ago."

OUTPUT: Return ONLY valid JSON. No markdown. No commentary.`;


export function buildExpandedReasonPrompt(
  ctx: ExpandedReasonPromptContext,
): { systemPrompt: string; userMessage: string } {

  const lines: string[] = [];

  // Study context
  lines.push(`STUDY: ${ctx.studyDescription}`);
  lines.push(`MODALITY: ${ctx.modality}`);
  lines.push(`BODY REGIONS: ${ctx.bodyRegions.join(', ')}`);
  lines.push(`CLINICAL INDICATION (verbatim from order): ${ctx.clinicalIndication || '(none provided)'}`);
  lines.push(`PRIMARY PURPOSE: ${ctx.primaryPurpose}`);
  if (ctx.secondaryPurpose) {
    lines.push(`SECONDARY PURPOSE: ${ctx.secondaryPurpose}`);
  }
  lines.push('');

  // Query snippets
  const primaryQueries = ctx.querySnippets.filter(q => q.intentCategory === 'primary');
  const secondaryQueries = ctx.querySnippets.filter(q => q.intentCategory === 'secondary');

  if (primaryQueries.length > 0) {
    lines.push(`--- PRIMARY CONTEXT QUERIES (${ctx.primaryPurpose}) ---`);
    for (const q of primaryQueries) {
      lines.push(`\n[${q.code}] ${q.displayLabel}: ${q.description}`);
      if (q.snippets.length > 0) {
        lines.push(`Relevant snippets (${q.snippets.length}):`);
        for (const s of q.snippets) {
          lines.push(`  • ${s}`);
        }
      } else {
        lines.push('(no snippets tagged for this query)');
      }
    }
    lines.push('');
  }

  if (secondaryQueries.length > 0) {
    lines.push(`--- SECONDARY CONTEXT QUERIES (${ctx.secondaryPurpose}) ---`);
    for (const q of secondaryQueries) {
      lines.push(`\n[${q.code}] ${q.displayLabel}: ${q.description}`);
      if (q.snippets.length > 0) {
        lines.push(`Relevant snippets (${q.snippets.length}):`);
        for (const s of q.snippets) {
          lines.push(`  • ${s}`);
        }
      } else {
        lines.push('(no snippets tagged for this query)');
      }
    }
    lines.push('');
  }

  // Contextual data
  if (ctx.topFindings.length > 0) {
    lines.push('--- TOP IMAGING FINDINGS (from prior studies) ---');
    for (const f of ctx.topFindings) {
      const trendLabel = f.trend ? ` [${f.trend}]` : '';
      lines.push(`  • ${f.name} (relevancy: ${f.score}/10)${trendLabel}`);
    }
    lines.push('');
  }

  if (ctx.topProblems.length > 0) {
    lines.push('--- TOP ACTIVE PROBLEMS ---');
    for (const p of ctx.topProblems) {
      lines.push(`  • ${p.name} (relevancy: ${p.score}/10)`);
    }
    lines.push('');
  }

  if (ctx.topProcedures.length > 0) {
    lines.push('--- RECENT PROCEDURES ---');
    for (const p of ctx.topProcedures) {
      const site = p.bodySite ? ` (${p.bodySite})` : '';
      lines.push(`  • ${p.name}${site} — ${p.date}`);
    }
    lines.push('');
  }

  // Output schema — reinforces brevity in placeholders
  const primarySchema: Record<string, string> = {};
  for (const q of primaryQueries) {
    primarySchema[q.code] = '<1 sentence, ≤30 words, or null>';
  }

  lines.push('REMEMBER: Each value must be 1 sentence (≤ 30 words) or null. No paragraphs.');
  lines.push('');
  lines.push('Output schema:');
  lines.push('{');
  lines.push(`  "primary": ${JSON.stringify(primarySchema, null, 4).split('\n').join('\n  ')}`);

  if (secondaryQueries.length > 0) {
    const secondarySchema: Record<string, string> = {};
    for (const q of secondaryQueries) {
      secondarySchema[q.code] = '<1 sentence, ≤30 words, or null>';
    }
    lines.push(`  ,"secondary": ${JSON.stringify(secondarySchema, null, 4).split('\n').join('\n  ')}`);
  } else {
    lines.push('  ,"secondary": null');
  }

  lines.push('}');

  return { systemPrompt: SYSTEM_PROMPT, userMessage: lines.join('\n') };
}
