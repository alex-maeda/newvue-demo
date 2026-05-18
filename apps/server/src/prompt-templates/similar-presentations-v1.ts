/**
 * similar-presentations-v1.ts — Prompt for identifying prior studies
 * with clinical presentations semantically similar to the current exam.
 *
 * This is a focused, lightweight LLM pass that receives:
 *   - Current exam clinical info (study description, indication, patient demographics)
 *   - Per-study clinical presentations and finding name summaries
 *
 * Output is minimal: just accession numbers of matching studies and
 * their key findings. All other data (studyName, studyDate, presentation text)
 * is resolved deterministically from the Tier 1 analyses.
 */

import type { PriorReportAnalysis } from '../models/summarization-types';
import type { CurrentStudy, Demographics } from '../models/types';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SimilarPresentationsPromptContext {
  currentStudy: CurrentStudy;
  demographics: Demographics;
  patientAge: string;
  individualAnalyses: PriorReportAnalysis[];
}

// ── Prompt Builder ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clinical presentation matching assistant for radiology.
Your task is to identify which prior studies had clinical presentations (reasons for exam) that are semantically similar to the current exam's clinical indication.

Rules:
1. Compare each prior study's "Clinical" text against the current exam's clinical indication.
2. A match means the clinical concern is similar — e.g., "evaluate for stroke" matches "new somnolence, eval for evolving stroke".
3. Do NOT match on vague overlap like shared patient age or generic phrases like "history of cancer".
4. For each match, list 2-4 key finding names from that study that are most relevant to the shared clinical concern.
5. Return ONLY valid JSON. No markdown, no commentary.`;

export function buildSimilarPresentationsPrompt(
  ctx: SimilarPresentationsPromptContext,
): { systemPrompt: string; userMessage: string } {

  // Build study listing
  const studyLines = ctx.individualAnalyses.map((a, si) => {
    const findingNames = a.findings
      .slice(0, 10) // Cap at 10 finding names to limit tokens
      .map((f) => f.name)
      .join(', ');

    return [
      `${si + 1}. ${a.studyName} (${formatDate(a.studyDate)}, ${a.accessionNumber})`,
      `   Clinical: "${a.clinicalPresentation || 'Not provided'}"`,
      `   Findings: ${findingNames || 'None'}`,
    ].join('\n');
  }).join('\n\n');

  const userMessage = `Current Exam:
  Study: ${ctx.currentStudy.studyDescription}
  Date: ${formatDate(ctx.currentStudy.studyDateTime)}
  Clinical indication: ${ctx.currentStudy.clinicalIndication || 'Not provided'}
  Patient: ${ctx.patientAge} ${ctx.demographics.sex === 'M' ? 'male' : 'female'}

Prior Studies:
${studyLines}

Output schema:
{
  "similarPresentations": [
    {
      "accession": "<accession number of matching study>",
      "keyFindings": ["<finding name 1>", "<finding name 2>"]
    }
  ]
}

If no prior presentations are similar, return: { "similarPresentations": [] }`;

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}

// ── Utility ───────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || 'Unknown';
  return `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}/${dateStr.substring(0, 4)}`;
}
