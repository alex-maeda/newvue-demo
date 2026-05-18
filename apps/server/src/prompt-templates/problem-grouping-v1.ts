/**
 * problem-grouping-v1.ts — Prompt for deduplicating and relevancy-scoring
 * a patient's raw EHR problem list relative to the current imaging study.
 *
 * Single-pass design: the LLM simultaneously identifies redundant / related
 * problems that should be merged under a unified heading AND assigns a
 * 0–10 clinical relevancy score for each problem (grouped or standalone)
 * relative to the specified imaging study and body region(s).
 *
 * Input: Compact-coded problem list with names, statuses, and dates,
 *        plus the current imaging study description and body region(s).
 * Output: Strict JSON with two arrays — `groups` (merged entries with
 *         synthesized names) and `ungrouped` (standalone entries by code).
 *         Every input problem MUST appear exactly once in the output.
 *
 * Token efficiency:
 *   - Compact single-letter codes (A–Z, AA–AZ) as problem identifiers
 *   - Ungrouped output uses code + score only (no name reproduction)
 *   - Unified group names are succinct and to-the-point (no filler)
 *
 * Model: Haiku by default, configurable to Sonnet via dev-settings.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ProblemGroupingPromptContext {
  /** Display name of the current imaging study, e.g., "MR Brain without Contrast" */
  studyDescription: string;
  /** Canonical body regions for the current study, e.g., ["head"] */
  bodyRegions: string[];
  /** Clinical indication for the current study */
  clinicalIndication: string;
  /** Compact-coded problem entries */
  problems: ProblemPromptEntry[];
}

export interface ProblemPromptEntry {
  /** Compact letter code: "A", "B", ..., "W" */
  code: string;
  /** Problem name from FHIR Condition resource */
  name: string;
  /** Clinical status: "active", "resolved", etc. */
  status: string;
  /** Date the problem was recorded, formatted as YYYY-MM-DD */
  date: string;
}

// ── Prompt Builder ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clinical informatics expert assisting a radiologist. Your task is to:

1. DEDUPLICATE: Identify related or redundant problems in the patient's problem list that should be merged under a single unified heading.
2. SCORE: Assign a clinical relevancy score (0–10) to every problem relative to the specified imaging study.

GROUPING RULES:
- Merge problems that describe the same underlying condition, its manifestations, or its direct complications.
  Example: "Left lower lobe lung adenocarcinoma", "Metastatic disease to bone", "Metastatic disease to intrathoracic lymph nodes" → single group.
- Merge duplicate or near-duplicate entries (same condition listed multiple ways).
- Do NOT merge problems that happen to share a body system but describe different pathologies (e.g., "Asthma" and "Lung adenocarcinoma" are both pulmonary but are independent).
- A problem may appear in only ONE group.
- Assign a succinct, clinically accurate unified name for each group. Be clear and to-the-point — no filler words — but do not use unintelligible abbreviations.

RELEVANCY SCORING GUIDE (0–10):
Each problem receives a score based on how likely it is to produce findings visible or relevant on the specified imaging study.

Score 0–1: Problems unlikely to produce imaging findings
  - Psychiatric conditions (anxiety, depression, insomnia)
  - Pure symptom entries (headache, nausea) unless recent and matching the imaged region
  - Definitively ruled-out or resolved conditions with no expected residual findings
  - Administrative entries (e.g., "long term anticoagulant therapy")

Score 2–4: Problems localized to body regions NOT being imaged
  - E.g., "Hammer toes" for head imaging, "Appendicitis" for chest imaging
  - Score lower when the affected region is further from the imaged region
  - Resolved conditions that might still show residual findings in a distant region

Score 5–7: Problems relevant to the imaged body region
  - Localized pathology within or near the imaged region
  - Score higher for more serious or acute conditions
  - Score higher for conditions likely to produce visible findings on the specific modality

Score 8–10: High-priority problems for the current imaging study
  - Active or metastatic cancer (almost always 8–10 regardless of region — cancer is systemic)
  - Acute vascular events in or near the imaged region (stroke, PE, DVT)
  - Systemic conditions with widespread imaging manifestations (sarcoidosis, vasculitis, lupus)
  - Active systemic infections (TB, syphilis, fungal)
  - Hypercoagulable states or conditions predisposing to findings across body regions

CRITICAL SCORING NOTES:
- A "resolved" problem may still warrant a moderate score if it could show residual findings on imaging (e.g., a resolved stroke still shows on MRI Brain).
- Cancer with metastatic disease is almost always high-scoring regardless of the imaged region.
- Problems marked "llm-extracted" were identified from clinical notes but are not on the formal EHR problem list. Score them based on clinical relevance just like any other problem. Their date reflects the most recent clinical note they were found in.
- Score every problem. Do not skip any.

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown fences. No commentary. Every input problem must appear exactly once — either as a member of a group or as an ungrouped entry.`;

export function buildProblemGroupingPrompt(
  ctx: ProblemGroupingPromptContext,
): { systemPrompt: string; userMessage: string } {

  // Build problem list — one line per problem
  const problemLines = ctx.problems.map((p) =>
    `${p.code}: ${p.name} (${p.status}, ${p.date})`,
  ).join('\n');

  const userMessage = `CURRENT IMAGING STUDY: ${ctx.studyDescription}
BODY REGIONS: ${ctx.bodyRegions.join(', ')}
CLINICAL INDICATION: ${ctx.clinicalIndication}

PATIENT PROBLEM LIST (${ctx.problems.length} entries):
${problemLines}

Output schema:
{
  "groups": [
    {
      "name": "<succinct unified heading>",
      "score": <0-10>,
      "members": ["<code>", "<code>"]
    }
  ],
  "ungrouped": [
    { "code": "<code>", "score": <0-10> }
  ]
}

Reminders:
- Every problem code must appear exactly once (either in a group's members or in ungrouped).
- Groups must have 2+ members.
- Ungrouped entries: code and score only — do not reproduce the problem name.
- Group names: succinct, clear, no filler.`;

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
