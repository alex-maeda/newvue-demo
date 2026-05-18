/**
 * Pass 2A Router — Finding Placement
 *
 * Express Router for /api/dictation/pass2.
 * Takes sanitized dictation segments + report template sections,
 * determines finding placement and grouping via Claude.
 *
 * Normal processing (suppress/edit/keep) is handled by Pass 2B
 * in a separate, focused LLM call (see pass2bRouter.js).
 *
 * Token-efficient design:
 *   - Short IDs (S1, R1) instead of full UUIDs
 *   - JSONL output (one JSON object per line, single-character keys)
 *   - "t" field omitted when segment text is used verbatim (saves ~10-20 tokens per segment)
 */

import { Router } from 'express';
import { claudeClient } from './llmClient.js';

const router = Router();

// ─── Prompt ───────────────────────────────────────────────────────────

const PASS2A_SYSTEM_PROMPT = `You are a radiology report structuring assistant.

You will receive:
1. SEGMENTS: Sanitized dictated text segments, each with a short ID (e.g., S1, S2).
2. SECTIONS: Report sections/subsections where findings can be inserted, each with a short ID (e.g., R1, R2) and a label. Sections whose labels name anatomical regions or body parts (e.g., "Brain Parenchyma", "Ventricles/Extra-Axial Spaces", "Liver") are finding subsections - most dictated findings belong in these. Other sections (History, Comparison, Technique) receive text only when clearly appropriate.

TASK: For each segment, determine:
- How many INDEPENDENT clinical statements it contains.
- For EACH statement: which report section/subsection it belongs in.

OUTPUT FORMAT: One JSON object per line (JSONL). Each object:
{"s":"<segment_short_id>","r":"<section_short_id>","t":"<text_or_V>","g":"<group_id_or_omit>","p":<position_or_omit>}

KEY DEFINITIONS:
- "s": The short ID of the source segment (e.g., "S1")
- "r": The short ID of the report section/subsection where this finding should be inserted (e.g., "R3"). Use "NA" if the segment is meaningless (see Rule 5).
- "t": The text to insert for THIS specific finding. ALWAYS include this field.
  - Set "t" to "V" (verbatim) when the segment maps to exactly ONE finding AND no text adjustment is needed. "V" means the original segment text is used as-is.
  - Set "t" to the actual text when the segment contains MULTIPLE independent statements or when grammar/punctuation needs adjustment. Each line's "t" must contain ONLY that statement's portion, extracted and adjusted for standalone readability (proper capitalization, no orphaned conjunctions).
  - NEVER repeat the entire segment text for multiple output lines.
- "g": Group ID for combining related findings into one textbox. Findings with the same "g" AND the same "r" are concatenated into a single textbox. Use IDs like "G1", "G2", etc. OMIT if the finding is standalone.
- "p": Position within the group (1-indexed). Determines text order when multiple findings share a group. OMIT if "g" is omitted.

GROUPING RULES:
- If two or more statements from different segments are clinically related and should appear in the SAME report textbox, assign them the same group ID ("g") and sequential positions ("p").
- Common grouping patterns include:
  * A finding and its differential diagnosis ("Large mass... Concerning for GBM.")
  * A finding and a clinical recommendation or management action ("Mass with herniation... Urgent neurosurgical consultation is recommended.")
  * A finding and its clinical implication or characterization ("Restricted diffusion... Suggestive of acute infarct.")
  * A finding and supporting detail or clarification
- SECTION INHERITANCE: When a recommendation, management action, or ancillary statement directly references a specific finding, it MUST be placed in the SAME section ("r") as that finding and grouped with it - even if the ancillary statement is not itself anatomically specific. The finding's section determines the group's section. Example: if "Large mass of the temporal lobe" -> R6 (Brain Parenchyma), then "Urgent neurosurgical consultation is recommended" also -> R6 with the same group ID, NOT to a parent section like Findings.
- Statements within the same group MUST target the same section ("r").
- If a statement is standalone and unrelated to adjacent statements, OMIT "g" and "p".

RULES:
1. If a segment contains MULTIPLE independent statements, output ONE line per statement, all sharing the same "s" value. Each line MUST have its own extracted "t" text.
2. DO NOT add clinical content that was not in the original text.
3. DO NOT output explanations, markdown, or anything other than JSONL lines.
4. Every segment must produce at least one output line.
5. MEANINGLESS SEGMENT EXCEPTION: If a segment CLEARLY does not contain any meaningful clinical information, output a line with "r":"NA" instead of a real section ID. A segment is meaningless ONLY if it lacks any descriptive word (typically a noun or adjective) that conveys real clinical content. Examples of meaningless segments: a single letter ("A"), a lone article or preposition ("The", "In"), isolated punctuation ("."), or an incomplete phrase with no specific clinical information ("There is evidence of extensive", "It appears that the"). A single medical term like "mass" or "effusion" IS meaningful and MUST be placed - it conveys real content even without a complete sentence. When in doubt, ALWAYS place the finding rather than flagging it as NA.

EXAMPLES:

Single segment, one finding, no text change — use "V" for verbatim:
Segment S1: "Ischemic stroke in the left frontal lobe."
Output: {"s":"S1","r":"R6","t":"V"}

Single segment, one finding, minor grammar fix — include actual text:
Segment S2: "the liver appears normal"
Output: {"s":"S2","r":"R8","t":"The liver appears normal."}

Single segment, multiple findings — one line per finding with extracted text:
Segment S3: "There is a large mass in the liver, as well as bilateral pleural effusions."
Output:
{"s":"S3","r":"R8","t":"There is a large mass in the liver."}
{"s":"S3","r":"R5","t":"Bilateral pleural effusions."}

Meaningless segment — use "NA" for section and "V" for text:
Segment S4: "The"
Output: {"s":"S4","r":"NA","t":"V"}`;

// ─── POST /api/dictation/pass2 ──────────────────────────────────────

router.post('/api/dictation/pass2', async (req, res) => {
  const { segments, sections, runId } = req.body;

  if (!segments?.length) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  // Build the user prompt from short-ID encoded data (no normals)
  const userMsg = buildUserMessage(segments, sections);

  // If Claude is not configured, return empty operations (fallback)
  if (!claudeClient.isConfigured()) {
    return res.status(200).json({
      runId,
      operations: [],
      warnings: ['claude_not_configured_pass2_skipped'],
    });
  }

  try {
    const startTime = performance.now();

    const { text: rawResponse, usage } = await claudeClient.complete(
      PASS2A_SYSTEM_PROMPT,
      userMsg,
      { temperature: 0, maxTokens: 2048 }
    );

    const latencyMs = Math.round(performance.now() - startTime);
    const trimmed = rawResponse.trim();

    // Parse JSONL: each line is an independent JSON object
    const operations = parseJSONL(trimmed);

    return res.status(200).json({
      runId,
      operations,
      warnings: [],
      latencyMs,
      rawResponse: trimmed, // For QA logging
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (e) {
    console.error('[Pass2Router] Claude call failed:', e.message || e);
    return res.status(200).json({
      runId,
      operations: [],
      warnings: ['pass2_exception_used_fallback'],
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build the user prompt with short-ID encoded segments and sections.
 * Normals are NOT included — they are processed by Pass 2B.
 */
function buildUserMessage(segments, sections) {
  const parts = [];

  // Segments
  parts.push('SEGMENTS:');
  for (const seg of segments) {
    parts.push(`${seg.shortId}: "${seg.text}"`);
  }

  // Sections
  parts.push('');
  parts.push('SECTIONS:');
  for (const sec of sections) {
    const tag = sec.isFindings ? ' [findings]' : '';
    parts.push(`${sec.shortId}: ${sec.label}${tag}`);
  }

  return parts.join('\n');
}

/**
 * Parse Pass 2A JSONL response from Claude.
 * Each line is parsed independently — malformed lines are logged and skipped.
 * Only handles placement fields: s, r, t, g, p (no normal fields).
 */
function parseJSONL(text) {
  if (!text) return [];

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    // Strip markdown fences if Claude wraps the output
    let cleaned = line;
    if (cleaned.startsWith('```')) continue; // Skip fence lines

    try {
      const obj = JSON.parse(cleaned);

      // Validate required fields
      if (!obj.s || !obj.r) {
        console.warn('[Pass2Router] Skipping line with missing s/r:', cleaned);
        continue;
      }

      results.push({
        sourceSegmentShortId: obj.s,
        targetSectionShortId: obj.r,
        // Flag for meaningless segments that should not be inserted
        isNA: obj.r === 'NA',
        // 't' = 'V' means verbatim (use original segment text). null signals the same.
        adjustedText: (!obj.t || obj.t === 'V') ? null : obj.t,
        // Grouping fields (optional)
        groupId: obj.g || null,
        position: typeof obj.p === 'number' ? obj.p : null,
      });
    } catch (e) {
      console.warn('[Pass2Router] Failed to parse JSONL line:', cleaned, e.message);
    }
  }

  return results;
}

export default router;
