/**
 * erik-answer-v1.ts — Pass 2 prompt template for ERIK's chart-aware answer.
 *
 * Used when Pass 1 classified the question as DATA (medical record question).
 * The prompt receives the loaded chart data and conversation history,
 * and generates a concise, clinically accurate streaming response.
 *
 * Model: Claude Haiku 4.5 (streaming mode).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface AnswerPromptInput {
  /** The user's current question */
  question: string;
  /** Patient demographics one-liner */
  demographics: string;
  /** Current study one-liner */
  currentStudy: string;
  /** Assembled chart data from the requested codes */
  chartData: string;
  /** Which data codes were loaded (for transparency) */
  loadedCodes: string[];
  /** Recent conversation history */
  conversationHistory: string;
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are ERIK (Enhanced Radiology Insight Kit), a concise radiology assistant.

STRICT RULES:
- For questions about the patient's medical record, use ONLY the provided chart data.
- Never invent or hallucinate chart facts. If specific information is not present in the provided data, say so plainly.
- Do NOT mention "chart snippets", "provided data", or "data codes" — speak as if you have direct chart access.
- Label uncertain inferences with [inference].
- Audience: practicing radiologists. Style: concise, direct, clinically precise.
- Keep responses short — 1 to 3 short paragraphs maximum. Prefer bullet-like brevity when listing items.
- Use clinical abbreviations where natural (e.g., "CT", "MRI", "PE", "DVT").
- Be precise with dates, measurements, and medication dosages when available.
- When referencing findings from radiology reports, include the study date when possible.`;

/**
 * Build the Pass 2 answer prompt from structured inputs.
 */
export function buildAnswerPrompt(input: AnswerPromptInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const sections: string[] = [];

  sections.push(`PATIENT: ${input.demographics}`);
  sections.push(`CURRENT STUDY: ${input.currentStudy}`);
  sections.push(`DATA LOADED: ${input.loadedCodes.join(', ')}`);

  sections.push(`\nCHART DATA:\n${input.chartData}`);

  if (input.conversationHistory) {
    sections.push(`\nCONVERSATION HISTORY:\n${input.conversationHistory}`);
  }

  sections.push(`\nQUESTION: ${input.question}`);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage: sections.join('\n'),
  };
}
