/**
 * Voice Sanitize Router
 *
 * Dedicated Express Router for /api/dictation/voice-sanitize.
 * Provides ASR error correction for free-form voice command payloads
 * (e.g., ERIK questions dictated by the radiologist).
 *
 * Unlike Pass 1 (which operates on in-context dictation segments with
 * [BEFORE]/[REVIEW]/[AFTER] markers and sentence-per-line output),
 * this route uses a lean, single-purpose prompt that simply cleans
 * up speech recognition errors and returns corrected text as a single line.
 *
 * Uses Claude Haiku 4.5 for speed (same as Pass 1).
 */

import { Router } from 'express';
import { claudeClient } from './llmClient.js';

const router = Router();

// ─── Voice Sanitization Prompt ────────────────────────────────────────

const VOICE_SANITIZE_SYSTEM_PROMPT = `You are a speech-to-text error corrector for a radiology dictation system.
The user dictated a question or instruction via voice. Your task:

1. Fix any speech recognition errors and medical terminology misspellings
2. Remove filler words (um, uh, er, ah, like)
3. Correct capitalization and basic punctuation
4. Preserve the user's intent and wording exactly — do NOT rephrase or add words

Return ONLY the corrected text as a single line. No JSON, no explanations, no commentary.
If the text is already correct, return it unchanged.`;

// ─── POST /api/dictation/voice-sanitize ───────────────────────────────

router.post('/api/dictation/voice-sanitize', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }

  const inputText = text.trim();

  // If Claude is not configured, return the raw text unchanged (graceful degradation)
  if (!claudeClient.isConfigured()) {
    return res.status(200).json({
      result: inputText,
      warnings: ['claude_not_configured_used_passthrough'],
    });
  }

  try {
    const { text: rawResponse, usage } = await claudeClient.complete(
      VOICE_SANITIZE_SYSTEM_PROMPT,
      inputText,
      { temperature: 0, maxTokens: 1024 }
    );

    const trimmed = rawResponse.trim();

    return res.status(200).json({
      result: trimmed,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (e) {
    console.error('[VoiceSanitizeRouter] Claude call failed:', e.message || e);
    // Fallback: return the raw text unchanged
    return res.status(200).json({
      result: inputText,
      warnings: ['voice_sanitize_exception_used_fallback'],
    });
  }
});

export default router;
