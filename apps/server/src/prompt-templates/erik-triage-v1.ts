/**
 * erik-triage-v1.ts — Pass 1 prompt template for ERIK's triage classifier.
 *
 * Classifies the user's question into one of four categories:
 *   - ANSWER: General medical/radiology knowledge (answered directly by Pass 1)
 *   - DATA:<codes>: Medical record question requiring chart data drill-down
 *   - BIO: Self-referential question about ERIK's identity or namesake
 *   - DECLINE: Out of scope (not medical/chart related)
 *
 * The prompt includes:
 *   - Tier 0 clinical context (consolidated findings + problems overview)
 *   - A menu of available data codes with tier/cost labels
 *   - Conversation history for multi-turn context
 *
 * Model: Claude Haiku 4.5 (optimized for fast, cheap classification).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface TriagePromptInput {
  /** The user's current question */
  question: string;
  /** Patient demographics one-liner (e.g., "John Smith, 67M, MRN 12345") */
  demographics: string;
  /** Current study one-liner (e.g., "MRI Brain without contrast, 05/10/2026") */
  currentStudy: string;
  /** Expanded reason for study (if available) */
  expandedReason: string | null;
  /**
   * Consolidated findings overview from executive summary.
   * Compact listing: "Finding Group Name (N findings, relevancy: X/10)"
   * Null when executive summary hasn't been run.
   */
  findingsOverview: string | null;
  /**
   * Consolidated problems overview from problem grouping.
   * Compact listing: "Problem Group Name (relevancy: X/10)"
   * Null when problem grouping hasn't been run.
   */
  problemsOverview: string | null;
  /** One-liner summary (if available) */
  oneLiner: string | null;
  /** Available data codes menu (dynamically built) */
  dataMenu: string;
  /** Recent conversation history (formatted as user/assistant turns) */
  conversationHistory: string;
}

export interface TriageResult {
  /** Classification: 'answer', 'data', 'bio', or 'decline' */
  type: 'answer' | 'data' | 'bio' | 'decline';
  /** For 'answer': the direct response text. For 'decline': the decline reason. */
  text?: string;
  /** For 'data': the comma-separated list of requested codes */
  codes?: string[];
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are ERIK (Enhanced Radiology Insight Kit), a radiologist's intelligent chart assistant embedded in a radiology workstation.

Your role in this step is to CLASSIFY the user's question and decide what to do:

1. If the question is about GENERAL medical or radiology knowledge (not patient-specific):
   → Output: ANSWER:<your concise response>
   Write a clear, concise answer appropriate for a practicing radiologist.

2. If the question requires PATIENT-SPECIFIC chart data to answer:
   → Output: DATA:<comma-separated codes>
   Select the MINIMUM set of data codes needed. Prefer cheaper Tier 1 codes.
   The data will be loaded and you'll answer in a follow-up step.

3. If the user is asking about YOU — your identity, your name, who ERIK is,
   why you are called ERIK, your purpose, or anything self-referential:
   → Output: BIO
   Just output the single word BIO. Nothing else.
   Examples: "Tell me about yourself", "Who is ERIK?", "What does ERIK stand for?",
   "Why are you called ERIK?", "Who are you named after?", "What is your story?"

4. If the question is NOT about medical/radiology topics or the patient's chart:
   → Output: DECLINE:<brief reason>
   Example: DECLINE:I help with patient chart questions and medical/radiology knowledge.

CRITICAL RULES:
- Output EXACTLY ONE line starting with ANSWER:, DATA:, BIO, or DECLINE:
- For ANSWER responses, be concise but clinically complete. Audience: radiologists.
- For DATA responses, output ONLY the codes line. No explanation.
- You have pre-loaded clinical context below. Use it to inform your classification.
- If the context already contains enough information to answer, use ANSWER: directly.
- Prefer Tier 1 drill-down codes (F1, P3, etc.) over Tier 2-3 broad loads.
- The consolidated findings and problems summaries below are RICH resources — 
  check them first before requesting broad data loads.
- Never request more data than necessary. Be token-efficient.`;

/**
 * Build the complete triage prompt from structured inputs.
 */
export function buildTriagePrompt(input: TriagePromptInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const sections: string[] = [];

  // Patient context
  sections.push(`PATIENT: ${input.demographics}`);
  sections.push(`CURRENT STUDY: ${input.currentStudy}`);

  if (input.expandedReason) {
    sections.push(`REASON FOR STUDY: ${input.expandedReason}`);
  }

  if (input.oneLiner) {
    sections.push(`CLINICAL SUMMARY: ${input.oneLiner}`);
  }

  // Tier 0: Pre-loaded clinical context
  if (input.findingsOverview) {
    sections.push(`\nCONSOLIDATED IMAGING FINDINGS:\n${input.findingsOverview}`);
  }

  if (input.problemsOverview) {
    sections.push(`\nCONSOLIDATED CLINICAL PROBLEMS:\n${input.problemsOverview}`);
  }

  if (!input.findingsOverview && !input.problemsOverview) {
    sections.push('\n(AI Summary has not been run yet — limited clinical context available)');
  }

  // Data menu
  sections.push(`\nAVAILABLE DATA CODES:\n${input.dataMenu}`);

  // Conversation history
  if (input.conversationHistory) {
    sections.push(`\nCONVERSATION HISTORY:\n${input.conversationHistory}`);
  }

  // The actual question
  sections.push(`\nQUESTION: ${input.question}`);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage: sections.join('\n'),
  };
}

/**
 * Parse the raw LLM output from Pass 1 into a structured TriageResult.
 */
export function parseTriageOutput(raw: string): TriageResult {
  const trimmed = raw.trim();

  // Check for ANSWER: prefix
  if (trimmed.startsWith('ANSWER:')) {
    return {
      type: 'answer',
      text: trimmed.slice('ANSWER:'.length).trim(),
    };
  }

  // Check for DATA: prefix
  if (trimmed.startsWith('DATA:')) {
    const codesStr = trimmed.slice('DATA:'.length).trim();
    const codes = codesStr
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);
    return {
      type: 'data',
      codes,
    };
  }

  // Check for DECLINE: prefix
  if (trimmed.startsWith('DECLINE:')) {
    return {
      type: 'decline',
      text: trimmed.slice('DECLINE:'.length).trim(),
    };
  }

  // Check for BIO (self-referential identity question)
  if (trimmed === 'BIO' || trimmed.startsWith('BIO:') || trimmed.startsWith('BIO ')) {
    return {
      type: 'bio',
    };
  }

  // Fallback: if the LLM didn't follow the format, treat as an answer
  // (this handles edge cases gracefully)
  console.warn('[erik-triage] LLM output did not match expected format, treating as answer:', trimmed.slice(0, 100));
  return {
    type: 'answer',
    text: trimmed,
  };
}
