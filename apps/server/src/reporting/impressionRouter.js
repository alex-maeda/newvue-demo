/**
 * Impression Router — Phase 6
 *
 * Express Router for POST /api/report/impression.
 * Takes aggregated report content + user preferences → Claude-generated
 * rank-ordered impression synthesis.
 *
 * Design:
 *   - Claude Haiku 4.5 (same model as Pass 1/2)
 *   - JSON output with per-item critical finding flags
 *   - Locked-paragraph protocol: user-edited impression items are preserved
 *     verbatim but can be repositioned in the rank order
 *   - Style matching from prior impression samples (when available)
 *   - Guideline and recommendation generation per user preferences
 */

import { Router } from 'express';
import { claudeClient } from './llmClient.js';

const router = Router();

// ─── System Prompt ────────────────────────────────────────────────────

function buildSystemPrompt(preferences) {
  const structureGuide = {
    bulleted: 'Present the impression as a bulleted list (use "- " prefix). Most important finding first.',
    numbered: 'Present the impression as a numbered list (use "1. ", "2. ", etc.). Most important finding first.',
    paragraph: 'Present the impression in full sentences and paragraphs. Most important details discussed first.',
  }[preferences.structure] || 'Present the impression as a numbered list.';

  const verbosityGuide = {
    low: 'Be terse and to the point. Sentence fragments are acceptable. Include only text required to convey the finding.',
    medium: 'Be concise but use complete sentences. No sentence fragments.',
    high: 'Use fully detailed sentences. Expand incomplete phrasing but NEVER hallucinate new information not present in the report.',
  }[preferences.verbosity] || 'Be concise but use complete sentences.';

  const hedgingGuide = {
    low: 'Statements should be declarative and decisive unless the radiologist explicitly used hedging language. Never override the radiologist\'s own language.',
    medium: 'Follow the radiologist\'s provided language without hedging bias. If they were certain, be certain. If they hedged, hedge similarly.',
    high: 'Present findings as likely present but acknowledge uncertainty. Never contradict direct statements by the radiologist.',
  }[preferences.hedging] || 'Follow the radiologist\'s provided language without hedging bias.';

  const acronymGuide = preferences.acronymExpansion
    ? 'Expand acronyms to their full text (e.g., "PE" → "pulmonary embolism").'
    : 'Leave acronyms as written by the radiologist. Do not expand them.';

  const guidelinesGuide = preferences.guidelines
    ? 'If a validated and commonly used clinical guideline is relevant to a finding (e.g., BI-RADS for breast imaging, TI-RADS for thyroid nodules, Fleischner criteria for pulmonary nodules, LI-RADS for liver lesions), include the guideline reference and classification in the relevant impression item. Place it naturally within the statement.'
    : 'Do NOT reference clinical guidelines.';

  const recommendationsGuide = {
    imaging: 'If appropriate, suggest type and timing of essential follow-up imaging based on findings. Do NOT include clinical referral or specialty follow-up recommendations — only imaging follow-up.',
    clinical: 'If appropriate, suggest specialty and timing of essential clinical follow-up based on findings. Do NOT include follow-up imaging recommendations — only clinical referral follow-up.',
    imaging_clinical: 'If appropriate, suggest both essential follow-up imaging (type and timing) and essential clinical follow-up (specialty and timing) based on findings.',
    none: 'Do NOT include follow-up recommendations.',
  }[preferences.recommendations] || 'If appropriate, suggest both essential imaging and essential clinical follow-up.';

  const normalFindingsGuide = preferences.normalFindings === 'include'
    ? 'Include normal/default findings in the impression. If prior impression samples are available, match the radiologist\'s style for how they present normals (individual items vs. aggregated statement). If no style samples are available, aggregate all normal findings into a single concise statement (e.g., "Otherwise unremarkable MRI of the brain."). Normal findings should appear AFTER any abnormal findings in the priority order.'
    : 'EXCLUDE normal/default findings from the impression. Content boxes flagged as "default" (baseline template normals) should NOT appear in the impression UNLESS: (1) a normal finding is clinically significant because it directly addresses the clinical question in the History (e.g., "No evidence of pulmonary embolism" when PE is the clinical concern), or (2) ALL findings are normal, in which case produce a single concise "Normal examination." statement (or study-specific equivalent like "Normal MRI of the brain."). When there are abnormal findings, do NOT enumerate individual normal findings — focus the impression solely on the clinically significant and abnormal content.';

  return `You are a radiology impression generator. Your task is to synthesize the findings from a radiology report into a concise, clinically prioritized impression.

CLINICAL PRIORITIZATION:
- Rank findings by clinical significance. The most important, relevant, and consequential finding appears FIRST.
- Aggregate similar findings when possible without losing specific details. For example: multiple pulmonary nodules can be combined into one statement listing sizes and locations.
- Report content boxes flagged as "userModified", "userModifiedAI", or "userAdded" represent the radiologist's direct observations and should be weighted most heavily.
- Content boxes flagged as "aiInserted" are LLM-placed findings from the radiologist's dictation — treat as high importance.
- Content boxes flagged as "default" are baseline template normals — include only if clinically relevant.

CLINICAL QUESTION INFERENCE:
- If the provided HISTORY specifically asks about the presence or absence of a condition (e.g., "Rule out pulmonary embolism", "Evaluate for stroke", "Concern for appendicitis"), this clinical question MUST be directly addressed in the impression.
- If the queried condition is NOT mentioned in the report findings, it should be taken as ABSENT. Generate a statement confirming its absence (e.g., "No evidence of pulmonary embolism.").
- If the queried condition IS mentioned in the report findings, address it using the radiologist's own language.
- The presence or absence of the specifically queried finding should be the FIRST item in the impression, as it directly answers the referring clinician's primary concern.

CRITICAL FINDING DETECTION:
- Flag any finding as CRITICAL if it represents a process with significant probability of causing risk to life or function, or requires urgent treatment or action.
- Examples: acute stroke, aortic dissection, tension pneumothorax, pulmonary embolism, intracranial hemorrhage, bowel perforation, spinal cord compression.
- Set "isCritical": true for these findings.

STRUCTURE: ${structureGuide}
VERBOSITY: ${verbosityGuide}
HEDGING: ${hedgingGuide}
NORMAL FINDINGS: ${normalFindingsGuide}
ACRONYMS: ${acronymGuide}
GUIDELINES: ${guidelinesGuide}
RECOMMENDATIONS: ${recommendationsGuide}

LOCKED ITEMS:
- If "lockedImpressionItems" are provided, these are impression items that the user has manually edited.
- You MUST include these items VERBATIM — do not modify, rephrase, duplicate, restate, or contradict them.
- You CAN reposition them within the rank order to their most clinically appropriate position.
- Do NOT produce any other impression item that duplicates or restates information already contained in a locked item.

STYLE MATCHING:
- If "priorImpressionSamples" are provided, analyze them to learn the radiologist's personal impression style (phrasing patterns, level of detail, ordering preferences, punctuation habits).
- Mimic this personal style as closely as possible while still respecting the explicit preference settings above.
- When the style samples conflict with explicit preferences, the explicit preferences take priority.

OUTPUT FORMAT:
Return ONLY valid JSON. The JSON object must have this structure:
{
  "impressionItems": [
    {
      "text": "1. 4mm right upper lobe pulmonary nodule.",
      "isCritical": false,
      "guideline": "Fleischner Society 2017: 6-12 month follow-up for solid nodules 6-8mm in low-risk patients.",
      "recommendation": "Recommend follow-up chest CT in 12 months to assess stability.",
      "isLocked": false
    }
  ]
}

FIELD SEPARATION — CRITICAL:
The "text", "recommendation", and "guideline" fields serve DISTINCT purposes and must NEVER overlap:
- "text" contains ONLY the clinical finding statement. Do NOT embed follow-up recommendations, management suggestions, or guideline references in this field.
- "recommendation" contains ONLY the type of follow-up recommendation language permitted by the RECOMMENDATIONS directive above. This is rendered separately from the impression text.
- "guideline" contains ONLY the guideline reference and classification. This is rendered separately from the impression text.
If you would normally write "4mm pulmonary nodule, recommend follow-up CT in 12 months per Fleischner criteria", you MUST split it:
  - text: "4mm right upper lobe pulmonary nodule."
  - recommendation: "Recommend follow-up chest CT in 12 months to assess stability."
  - guideline: "Fleischner Society 2017: 6-12 month follow-up for solid nodules 6-8mm in low-risk patients."

Fields:
- "text": The impression statement text. Include numbering ("1. ") or bullet ("- ") prefixes as appropriate for the selected structure. Must contain ONLY the clinical finding — no recommendation or guideline language.
- "isCritical": true if this is a critical/urgent finding, false otherwise.
- "guideline": A brief guideline reference string or null if no validated guideline applies or if guidelines are disabled. Do NOT embed this in "text".
- "recommendation": Follow-up recommendation text (only the type permitted by the RECOMMENDATIONS directive) or null if no follow-up is warranted or if recommendations are disabled. Do NOT embed this in "text".
- "isLocked": true ONLY for items that were provided as locked impression items. false for all newly generated items.

RULES:
1. Do NOT add clinical findings not present in the report content.
2. Do NOT hallucinate imaging findings, measurements, or diagnoses.
3. Every piece of information in the impression must be traceable to report content provided.
4. NORMAL EXAM HANDLING: If ALL content boxes contain only their default template text (importance: "default") and no content boxes are flagged as "userModified", "userModifiedAI", or "aiInserted", the entire exam is normal. In that case, produce a single impression item with text "Normal examination." (or appropriate study-specific equivalent like "Normal MRI of the brain." if the study title is provided). Do NOT enumerate individual normal findings — a single concise "normal" statement suffices.
5. If the report is MOSTLY normal with one or a few abnormal findings, lead with the abnormal findings in clinical priority order. You may optionally append "Otherwise normal examination." or "Remaining findings are unremarkable." as the final item if it adds clarity, but this is not required.
6. Return ONLY the JSON object. No explanations, no markdown fences, no commentary.`;
}

// ─── POST /api/report/impression ────────────────────────────────────

router.post('/api/report/impression', async (req, res) => {
  const {
    reportContent,
    allFindingsNormal,
    preferences,
    priorImpressionSamples,
    lockedImpressionItems,
    studyTitle,
    historyText,
    runId,
  } = req.body;

  // Allow empty reportContent when allFindingsNormal is true
  // (normalFindings=exclude strips defaults, leaving nothing)
  if (!reportContent?.length && !allFindingsNormal) {
    return res.status(400).json({ error: 'No report content provided' });
  }

  if (!preferences) {
    return res.status(400).json({ error: 'No preferences provided' });
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt(preferences);
  const userPrompt = buildUserMessage(
    reportContent || [],
    preferences,
    priorImpressionSamples || [],
    lockedImpressionItems || [],
    studyTitle || '',
    historyText || '',
    !!allFindingsNormal
  );

  // If Claude is not configured, return empty (fallback)
  if (!claudeClient.isConfigured()) {
    return res.status(200).json({
      runId,
      impressionItems: [],
      warnings: ['claude_not_configured_impression_skipped'],
    });
  }

  try {
    const startTime = performance.now();

    const { text: rawResponse, usage } = await claudeClient.complete(
      systemPrompt,
      userPrompt,
      {
        temperature: 0.1,       // Slight creativity for natural language
        maxTokens: 2048,
        model: process.env.IMPRESSION_MODEL || process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      }
    );

    const latencyMs = Math.round(performance.now() - startTime);

    // Parse JSON response
    const parsed = claudeClient.parseJSON(rawResponse);

    if (!parsed || !Array.isArray(parsed.impressionItems)) {
      console.warn('[ImpressionRouter] Could not parse impression response');
      return res.status(200).json({
        runId,
        impressionItems: [],
        warnings: ['impression_parse_failed'],
        rawResponse,
        latencyMs,
      });
    }

    // Validate and normalize items
    const impressionItems = parsed.impressionItems.map((item, idx) => ({
      text: String(item.text || '').trim(),
      isCritical: !!item.isCritical,
      guideline: item.guideline || null,
      recommendation: item.recommendation || null,
      isLocked: !!item.isLocked,
    })).filter(item => item.text.length > 0);

    return res.status(200).json({
      runId,
      impressionItems,
      warnings: [],
      latencyMs,
      rawResponse,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (e) {
    console.error('[ImpressionRouter] Claude call failed:', e.message || e);
    return res.status(200).json({
      runId,
      impressionItems: [],
      warnings: ['impression_exception_used_fallback'],
    });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Build the user prompt from aggregated report content.
 */
function buildUserMessage(
  reportContent,
  preferences,
  priorSamples,
  lockedItems,
  studyTitle,
  historyText,
  allFindingsNormal
) {
  const parts = [];

  // Study context
  if (studyTitle) {
    parts.push(`STUDY: ${studyTitle}`);
  }
  if (historyText) {
    parts.push(`HISTORY: ${historyText}`);
  }

  parts.push('');

  // Signal all-normal exam
  if (allFindingsNormal) {
    parts.push('ALL FINDINGS ARE NORMAL. No content boxes were modified by the radiologist or AI. Produce a single concise "Normal examination." impression item (or study-specific equivalent).');
    parts.push('');
  }

  // Report content organized by section
  if (reportContent.length > 0) {
    parts.push('REPORT CONTENT:');
    for (const item of reportContent) {
      const importanceTag = item.importance !== 'default'
        ? ` [${item.importance}]`
        : '';
      const findingTag = item.isFinding ? ' [finding]' : '';
      parts.push(`[${item.sectionPath}]${findingTag}${importanceTag}: "${item.text}"`);
    }
  }

  // Locked impression items
  if (lockedItems.length > 0) {
    parts.push('');
    parts.push('LOCKED IMPRESSION ITEMS (include verbatim, do not modify):');
    for (const item of lockedItems) {
      parts.push(`- "${item.text}"`);
    }
  }

  // Prior impression samples for style matching
  if (priorSamples.length > 0) {
    parts.push('');
    parts.push('PRIOR IMPRESSION SAMPLES (for style reference):');
    for (let i = 0; i < priorSamples.length; i++) {
      parts.push(`--- Sample ${i + 1} ---`);
      parts.push(priorSamples[i]);
    }
  }

  return parts.join('\n');
}

export default router;
