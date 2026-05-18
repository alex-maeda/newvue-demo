/**
 * Pass 1 Router — Phase 4 (revised)
 *
 * Standalone Express Router for the /api/dictation/pass1 endpoint.
 * Uses Claude Haiku 4.5 with preceding/following context for better
 * sentence boundary decisions. Supports "Ok" shortcut response when
 * no edits are needed.
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { claudeClient } from './llmClient.js';

const router = Router();

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const CONFIG_DIR = path.resolve(__dirname_local, '..', '..', 'config');

// ─── Load autocorrect rules ───────────────────────────────────────────
let autoCorrectRules = null;
try {
  const acData = fs.readFileSync(path.join(CONFIG_DIR, 'autocorrect.json'), 'utf8');
  autoCorrectRules = JSON.parse(acData);
  console.log(`[Pass1Router] Loaded ${Object.keys(autoCorrectRules).length} autocorrect rules`);
} catch (e) {
  console.warn('[Pass1Router] Could not load autocorrect.json:', e.message);
}

// ─── Helper functions ─────────────────────────────────────────────────

function normalizeWS(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function removeFillers(s) {
  return String(s || '')
    .replace(/\b(um|uh|er|ah|like)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyAutocorrect(text, rules) {
  if (!rules || !text) return text;
  let computed = text;

  // Sort keys longest-first for exclusive matching
  const sortedKeys = Object.keys(rules).sort((a, b) => b.length - a.length);
  const placeholders = [];

  for (const key of sortedKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    computed = computed.replace(re, () => {
      const idx = placeholders.length;
      const token = `__AC_${idx}__`;
      placeholders.push({ token, value: rules[key] });
      return token;
    });
  }

  for (const { token, value } of placeholders) {
    computed = computed.split(token).join(value);
  }

  return computed;
}

// ─── The Pass 1 prompt (context-aware) ────────────────────────────────

const PASS1_SYSTEM_PROMPT = `You are a radiology dictation text editor.

You will receive dictated text to review. The text is presented in sections:
- [BEFORE]...[/BEFORE] — Up to two preceding sentences for context. Do NOT include this text in your output unless you are merging it with the [REVIEW] text.
- [REVIEW]...[/REVIEW] — The text to review and correct.
- [AFTER]...[/AFTER] — The following sentence for context. Do NOT include this text in your output unless you are merging it with the [REVIEW] text.

Any section may be empty or absent.

OUTPUT RULES:
1) If the [REVIEW] text needs NO changes:
   Respond with exactly: Ok

2) If ANY changes are needed, respond with the corrected text, ONE SENTENCE PER LINE:
   - Each complete sentence on its own line, ending with terminal punctuation (. ! ?)
   - A trailing incomplete fragment (if any) on the final line WITHOUT terminal punctuation
   - Do NOT include [BEFORE]/[REVIEW]/[AFTER] markers or labels
   - CRITICAL: output ONLY the text that the [REVIEW] content is part of. If no merge with [BEFORE] or [AFTER] is needed or no punctuation was added to [BEFORE], your output should contain only the corrected [REVIEW] text. Do NOT echo [BEFORE] or [AFTER] content as separate unchanged sentences.

EDITING RULES:
1) CRITICAL: Fix capitalization but keep clinical meaning and wording as close to original as possible. If no [BEFORE], ensure the first [REVIEW] word is capitalized. No rephrasing. DO NOT add new clinical words. DO NOT hallucinate findings.
2) NON-CLINICAL TEXT: Remove filler words (um, uh, er, ah) and strip any non-radiology content (greetings, conversational speech, definite voice commands, filler phrases) and output only the clinical portions. If NOTHING clinical remains, respond exactly with: <NULL_RESPONSE> — NEVER output commentary, internal thought/analysis, or explanations. If you are not certain that text is non-clinical, err on the side of keeping it.
3) CRITICAL: Review sentence boundaries across all sections. If text from [REVIEW] clearly continues a sentence from [BEFORE], merge them into one sentence on one line. If text from [REVIEW] clearly begins a sentence that continues into [AFTER], merge them. When merging, include the relevant [BEFORE] and/or [AFTER] text in your output as part of the merged sentence(s).
4) CRITICAL: NEVER drop or omit trailing words from the end of [REVIEW] text. Dictation is real-time — trailing words (even single words like "left", "cyst", "right") are nearly always the beginning of the next clinical phrase. Preserve them verbatim on the final line. You may capitalize or fix spelling, but you MUST NOT delete them.
5) PUNCTUATION: Only add terminal punctuation to the [REVIEW] text if you are confident the sentence is complete. If [BEFORE] is clearly a separate sentence but has no terminal punctuation, you can add punctuation and output the [BEFORE] text with the [REVIEW] text. Never produce double periods (..). If there is no [AFTER] text, leave the trailing text without a period — dictation may still be in progress.
6) ISOLATED PUNCTUATION: If the [REVIEW] text consists solely of punctuation (e.g., ".", "!", "?") — possibly with surrounding whitespace — this indicates the user's explicit intent to place a sentence boundary at this position. 
    In your output:
    a) Attach the punctuation to the end of the last word from [BEFORE] 
       (e.g., [BEFORE]...ischemic stroke[/BEFORE] [REVIEW].[/REVIEW] → 
       output "ischemic stroke.")
    b) If [AFTER] text follows, capitalize its first word and include it 
       as the start of a new sentence on a new line
       (e.g., → second line: "Conversely there")
7) CLINICAL CONTINUITY: Phrases like "concerning for", "suggestive of", "suspicious for", "consistent with", "compatible with", "representing", "likely representing" are clinical continuation phrases that typically qualify the preceding finding. Prefer keeping them in the same sentence rather than starting a new sentence (e.g., "Large brain mass concerning for GBM." is ONE sentence, not two).
8) Return ONLY "Ok" (if no corrections are made) or the corrected sentences (one per line). No JSON, no explanations, no commentary.`;

// ─── POST /api/dictation/pass1 ───────────────────────────────────────

router.post('/api/dictation/pass1', async (req, res) => {
  const { sessionId, chunkText, precedingText, followingText } = req.body;
  if (!chunkText || !chunkText.trim()) {
    return res.status(400).json({ error: 'No chunkText provided' });
  }

  // The client sends pre-processed text (autocorrected, normalized)
  const combinedInput = chunkText.trim();

  // If Claude is not configured, return the processed text as-is
  if (!claudeClient.isConfigured()) {
    return res.status(200).json({
      sessionId,
      result: combinedInput,
      noChange: false,
      warnings: ['claude_not_configured_used_passthrough'],
    });
  }

  // Build the marked-up prompt
  const userMsg = buildUserMessage(normalizeWS(precedingText), combinedInput, normalizeWS(followingText));

  try {
    const { text: rawResponse, usage } = await claudeClient.complete(
      PASS1_SYSTEM_PROMPT,
      userMsg,
      { temperature: 0, maxTokens: 2048 }
    );

    // Trim but preserve internal newlines (they delimit sentences)
    const trimmed = rawResponse.trim();

    // Check for "Ok" shortcut
    if (trimmed.toLowerCase() === 'ok') {
      return res.status(200).json({
        sessionId,
        result: 'Ok',
        noChange: true,
        warnings: [],
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    }

    // Claude returned newline-delimited sentences
    return res.status(200).json({
      sessionId,
      result: trimmed,
      noChange: false,
      warnings: [],
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (e) {
    console.error('[Pass1Router] Claude call failed:', e.message || e);
    // Fallback: return the pre-processed text without LLM edits
    return res.status(200).json({
      sessionId,
      result: combinedInput,
      noChange: false,
      warnings: ['pass1_exception_used_fallback'],
    });
  }
});

/**
 * Build the user message with context markers.
 */
function buildUserMessage(before, review, after) {
  const parts = [];
  if (before) parts.push(`[BEFORE]${before}[/BEFORE]`);
  parts.push(`[REVIEW]${review}[/REVIEW]`);
  if (after) parts.push(`[AFTER]${after}[/AFTER]`);
  return parts.join('\n');
}

export default router;
