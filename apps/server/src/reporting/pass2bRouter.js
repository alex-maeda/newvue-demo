/**
 * Pass 2B Router — Normal Processing
 *
 * Express Router for /api/dictation/pass2b.
 * Takes placed findings (from Pass 2A) and normal template statements,
 * determines for each normal: keep / suppress / edit.
 *
 * This is a focused, lightweight LLM call that runs after Pass 2A.
 * By isolating normal processing from finding placement, each call
 * has a single clear job, improving reliability on Haiku 4.5.
 *
 * Token-efficient design:
 *   - Short IDs (F1, N1) only
 *   - Single-character action codes: K (keep), S (suppress), E (edit)
 *   - "t" field only present for edits
 *   - All normals must appear in output (completeness guarantee)
 *
 * NOTE ON DECOMPOSITION (chain-of-thought):
 *   The prompt teaches a 3-step decomposition pattern via examples:
 *   decompose normal → match assertions → decide action.
 *   The LLM performs this reasoning internally without outputting the
 *   decomposition array ("d" field), saving ~15-25 output tokens per normal.
 *
 *   If partial-edit quality regresses (e.g., LLM starts fully suppressing
 *   compound normals instead of editing them), RE-ADD the "d" field to the
 *   output format specification. Forcing the LLM to emit the decomposition
 *   as output tokens creates an autoregressive chain-of-thought effect that
 *   significantly improves reasoning accuracy on smaller models like Haiku.
 *   To restore: add "d":[...] to OUTPUT FORMAT, set "Always include this",
 *   and add "d" arrays back to the example output lines.
 */

import { Router } from 'express';
import { claudeClient } from './llmClient.js';

const router = Router();

// ─── Prompt ───────────────────────────────────────────────────────────

const PASS2B_SYSTEM_PROMPT = `You are a radiology report assistant. You will receive:
1. FINDINGS: Clinical findings that have been dictated and will be inserted into the report.
2. NORMALS: Default "normal" statements currently in the report template.

TASK: For each normal, follow these steps:
STEP 1 — DECOMPOSE: List the individual clinical assertions within the normal. Many normals are compound statements (joined by "and", "or", commas) containing multiple independent assertions.
STEP 2 — MATCH: For each assertion, check if ANY finding contradicts it.
STEP 3 — DECIDE:
  - If ALL assertions are contradicted → SUPPRESS (S)
  - If SOME assertions are contradicted but others remain valid → EDIT (E). Output the remaining valid assertions as a grammatically correct sentence.
  - If NO assertions are contradicted → KEEP (K)

CRITICAL: Use SUPPRESS only when EVERY assertion in the normal is invalidated. If even ONE assertion remains valid, you MUST use EDIT.

OUTPUT FORMAT: One JSON line per normal (JSONL):
{"n":"<id>","a":"K|S|E","t":"<remaining text if E>"}

- "a": Action code — K, S, or E.
- "t": Only required when "a" is "E". The remaining valid text after removing contradicted assertions, with correct grammar.

GRAMMAR RULES FOR EDITS:
- The replacement text must be a complete, natural sentence.
- "No A or B" with A removed → "No B." (not "No or B")
- "No A, B, or C" with A removed → "No B or C."
- "No A, B, or C" with B removed → "No A or C."
- If editing would leave a trivially empty or meaningless statement, use SUPPRESS.

RULES:
1. Every normal ID must appear exactly once in the output.
2. DO NOT output explanations or markdown — only JSONL lines.
3. Clinical synonyms count as contradictions: "stroke" = "infarct" = "ischemia"; "mass" = "tumor" = "lesion".

EXAMPLES:

Finding F1: "Ischemic stroke in the left frontal lobe."
Normal N1: "No acute infarct or hemorrhage."
→ Decompose: ["no acute infarct", "no hemorrhage"]
→ F1 ("ischemic stroke") contradicts "no acute infarct" (stroke = infarct). Does NOT contradict "no hemorrhage".
→ 1 of 2 assertions contradicted → EDIT
{"n":"N1","a":"E","t":"No acute hemorrhage."}

Finding F2: "Slight hydrocephalus."
Normal N2: "No hydrocephalus or extra-axial fluid collections."
→ Decompose: ["no hydrocephalus", "no extra-axial fluid collections"]
→ F2 contradicts "no hydrocephalus". Does NOT contradict "no extra-axial fluid collections".
→ 1 of 2 assertions contradicted → EDIT
{"n":"N2","a":"E","t":"No extra-axial fluid collections."}

Finding F3: "Large hemorrhagic stroke in the right MCA territory."
Normal N3: "No acute infarct or hemorrhage."
→ Decompose: ["no acute infarct", "no hemorrhage"]
→ F3 contradicts BOTH "no acute infarct" (stroke = infarct) AND "no hemorrhage" (hemorrhagic).
→ 2 of 2 assertions contradicted → SUPPRESS
{"n":"N3","a":"S"}

Finding F4: "New liver lesion."
Normal N4: "No pleural effusion."
→ Decompose: ["no pleural effusion"]
→ F4 does not contradict N4 at all.
→ 0 of 1 assertions contradicted → KEEP
{"n":"N4","a":"K"}`;
// ─── POST /api/dictation/pass2b ─────────────────────────────────────

router.post('/api/dictation/pass2b', async (req, res) => {
  const { findings, normals, runId } = req.body;

  // If no normals, return empty decisions (nothing to process)
  if (!normals?.length) {
    return res.status(200).json({
      runId,
      normalDecisions: [],
      rawResponse: '',
      latencyMs: 0,
      warnings: [],
    });
  }

  // Build the user prompt
  const userMsg = buildUserMessage(findings || [], normals);

  // If Claude is not configured, return all-keep fallback
  if (!claudeClient.isConfigured()) {
    return res.status(200).json({
      runId,
      normalDecisions: normals.map((n) => ({
        normalShortId: n.shortId,
        action: 'K',
        replacementText: null,
      })),
      warnings: ['claude_not_configured_pass2b_skipped'],
    });
  }

  try {
    const startTime = performance.now();

    const { text: rawResponse, usage } = await claudeClient.complete(
      PASS2B_SYSTEM_PROMPT,
      userMsg,
      { temperature: 0, maxTokens: 1024 }
    );

    const latencyMs = Math.round(performance.now() - startTime);
    const trimmed = rawResponse.trim();

    // Parse JSONL response
    const normalDecisions = parsePass2bJSONL(trimmed);

    // Validate completeness: check that every input normal appears in output
    const outputIds = new Set(normalDecisions.map((d) => d.normalShortId));
    const missingIds = normals
      .map((n) => n.shortId)
      .filter((id) => !outputIds.has(id));

    const warnings = [];
    if (missingIds.length > 0) {
      console.warn('[Pass2bRouter] Missing normals in output:', missingIds.join(', '));
      warnings.push(`missing_normals: ${missingIds.join(',')}`);

      // Auto-fill missing normals as KEEP
      for (const id of missingIds) {
        normalDecisions.push({
          normalShortId: id,
          action: 'K',
          replacementText: null,
        });
      }
    }

    return res.status(200).json({
      runId,
      normalDecisions,
      warnings,
      latencyMs,
      rawResponse: trimmed,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (e) {
    console.error('[Pass2bRouter] Claude call failed:', e.message || e);
    return res.status(200).json({
      runId,
      normalDecisions: normals.map((n) => ({
        normalShortId: n.shortId,
        action: 'K',
        replacementText: null,
      })),
      warnings: ['pass2b_exception_used_fallback'],
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build the user prompt with findings and normals.
 */
function buildUserMessage(findings, normals) {
  const parts = [];

  // Findings
  parts.push('FINDINGS:');
  if (findings.length === 0) {
    parts.push('(none)');
  } else {
    for (const f of findings) {
      parts.push(`${f.shortId}: "${f.text}"`);
    }
  }

  // Normals
  parts.push('');
  parts.push('NORMALS:');
  for (const n of normals) {
    parts.push(`${n.shortId}: "${n.text}"`);
  }

  return parts.join('\n');
}

/**
 * Parse Pass 2B JSONL response from Claude.
 * Each line: {"n":"N1","a":"K|S|E","t":"..."}
 */
function parsePass2bJSONL(text) {
  if (!text) return [];

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    let cleaned = line;
    if (cleaned.startsWith('```')) continue;

    try {
      const obj = JSON.parse(cleaned);

      // Validate required fields
      if (!obj.n || !obj.a) {
        console.warn('[Pass2bRouter] Skipping line with missing n/a:', cleaned);
        continue;
      }

      // Validate action code
      const action = obj.a.toUpperCase();
      if (!['K', 'S', 'E'].includes(action)) {
        console.warn('[Pass2bRouter] Unknown action code:', action, 'in line:', cleaned);
        continue;
      }

      results.push({
        normalShortId: obj.n,
        action,
        // "t" is only present for edits (action "E")
        replacementText: action === 'E' ? (obj.t || null) : null,
      });
    } catch (e) {
      console.warn('[Pass2bRouter] Failed to parse JSONL line:', cleaned, e.message);
    }
  }

  return results;
}

export default router;
