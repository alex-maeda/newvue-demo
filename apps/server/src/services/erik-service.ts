/**
 * erik-service.ts — ERIK (Enhanced Radiology Insight Kit) orchestration service.
 *
 * Implements the two-pass LLM pipeline:
 *   Pass 1 (Triage): Classify question + select data codes
 *   Pass 2 (Answer): Load requested data + stream response
 *
 * The service is stateless — all context is provided per-request.
 * Conversation history is managed client-side and passed in each call.
 *
 * Model: Claude Haiku 4.5 for both passes (cost-optimized, low-latency).
 */

import { config } from '../config';
import type { PatientRecord, CurrentStudy } from '../models/types';
import type { SummarizationResponse } from '../models/summarization-types';
import type { EhrDataPayload } from './fhirDataService';
import { readEhrText } from './fhirDataService';
import { invokeClaude, streamClaude, isClaudeConfigured } from './claude-client';
import { buildTriagePrompt, parseTriageOutput } from '../prompt-templates/erik-triage-v1';
import type { TriageResult } from '../prompt-templates/erik-triage-v1';
import { buildAnswerPrompt } from '../prompt-templates/erik-answer-v1';
import {
  buildDataMenu,
  buildFindingsOverview,
  buildProblemsOverview,
  loadRequestedData,
} from './erik-data-codes';

// ── Types ──────────────────────────────────────────────────────────────────

/** Full context needed by ERIK for a single chat request */
export interface ErikDataContext {
  patientRecord: PatientRecord | null;
  currentStudy: CurrentStudy | null;
  summarizationResult: SummarizationResponse | null;
  ehrData: EhrDataPayload | null;
  /** Current report text from the reporting iFrame (may be empty) */
  currentReportText: string;
  /** Function to load text files on-demand (notes, pathology) */
  loadText?: (filePath: string) => Promise<string>;
}

/** Conversation message for multi-turn context */
export interface ErikConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** SSE event emitted during ERIK processing */
export interface ErikSSEEvent {
  type: 'status' | 'delta' | 'done' | 'error';
  phase?: string;
  message?: string;
  content?: string;
  usage?: { inputTokens: number; outputTokens: number };
  triageResult?: TriageResult;
}

// ── Configuration ─────────────────────────────────────────────────────────

/** Model for ERIK triage (Pass 1) — fast classification */
const ERIK_TRIAGE_MODEL = config.bedrockModelId;
/** Model for ERIK answer (Pass 2) — streaming response */
const ERIK_ANSWER_MODEL = config.bedrockModelId;
/** Max tokens for Pass 1 output (triage is very short) */
const TRIAGE_MAX_TOKENS = 4096;
/** Max tokens for Pass 2 output (answer can be longer) */
const ANSWER_MAX_TOKENS = 2048;
/** Max conversation history turns to include */
const MAX_HISTORY_TURNS = 6;
/** Max characters of conversation history */
const MAX_HISTORY_CHARS = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Format conversation history into a compact string for the prompt.
 */
function formatConversationHistory(messages: ErikConversationMessage[]): string {
  if (!messages.length) return '';

  // Take the last N turns and cap total characters
  const recent = messages.slice(-MAX_HISTORY_TURNS);
  const lines: string[] = [];
  let totalChars = 0;

  for (const msg of recent) {
    const prefix = msg.role === 'user' ? 'User' : 'ERIK';
    const line = `${prefix}: ${msg.content}`;
    if (totalChars + line.length > MAX_HISTORY_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }

  return lines.join('\n');
}

/**
 * Build the demographics one-liner for prompt context.
 */
function buildDemographicsOneLiner(pr: PatientRecord | null): string {
  if (!pr?.demographics) return '(Patient not loaded)';
  const d = pr.demographics;
  return `${d.name.first} ${d.name.last}, ${d.sex}, DOB ${d.dateOfBirth}, MRN ${d.mrn}`;
}

/**
 * Build the current study one-liner for prompt context.
 */
function buildCurrentStudyOneLiner(cs: CurrentStudy | null): string {
  if (!cs) return '(No current study selected)';
  return `${cs.studyDescription}, ${cs.studyDateTime}, ordered by ${cs.orderingPhysician}`;
}

/**
 * Build the expanded reason one-liner for prompt context.
 */
function buildExpandedReasonOneLiner(sr: SummarizationResponse | null): string | null {
  const er = sr?.expandedReason;
  if (!er) return null;
  const parts: string[] = [er.clinicalIndication];
  if (er.primary) {
    for (const entry of er.primary.entries) {
      parts.push(`${entry.displayLabel}: ${entry.content}`);
    }
  }
  return parts.join('. ').slice(0, 500);
}

// ── Main Orchestrator ─────────────────────────────────────────────────────

/**
 * Run the ERIK chat pipeline, emitting SSE events via the callback.
 *
 * Flow:
 *   1. Build context (data menu, findings/problems overview)
 *   2. Run Pass 1 (triage: ANSWER / DATA / DECLINE)
 *   3. If DATA: load requested codes, run Pass 2 (streaming answer)
 *   4. If ANSWER: emit the Pass 1 response directly
 *   5. If DECLINE: emit the decline message
 *
 * @param question - The user's current question
 * @param ctx - Full patient/study/summary context
 * @param history - Recent conversation history
 * @param onEvent - Callback for SSE events
 */
export async function runErikChat(
  question: string,
  ctx: ErikDataContext,
  history: ErikConversationMessage[],
  onEvent: (event: ErikSSEEvent) => void,
): Promise<void> {
  // Check LLM availability
  if (!isClaudeConfigured()) {
    onEvent({ type: 'error', message: 'ERIK is unavailable — Bedrock LLM not configured.' });
    return;
  }

  const conversationHistory = formatConversationHistory(history);
  const demographics = buildDemographicsOneLiner(ctx.patientRecord);
  const currentStudy = buildCurrentStudyOneLiner(ctx.currentStudy);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // ── Phase 1: Triage ──────────────────────────────────────────────
    onEvent({ type: 'status', phase: 'triage', message: 'Analyzing question...' });

    // Build Tier 0 context
    const findingsOverview = buildFindingsOverview(ctx);
    const problemsOverview = buildProblemsOverview(ctx);
    const expandedReason = buildExpandedReasonOneLiner(ctx.summarizationResult);
    const oneLiner = ctx.summarizationResult?.oneLiner?.fullOneLiner || null;
    const dataMenu = buildDataMenu(ctx);

    const triagePrompt = buildTriagePrompt({
      question,
      demographics,
      currentStudy,
      expandedReason,
      findingsOverview,
      problemsOverview,
      oneLiner,
      dataMenu,
      conversationHistory,
    });

    const triageResponse = await invokeClaude({
      systemPrompt: triagePrompt.systemPrompt,
      userMessage: triagePrompt.userMessage,
      modelId: ERIK_TRIAGE_MODEL,
      maxOutputTokens: TRIAGE_MAX_TOKENS,
      temperature: 0.0,
    });

    totalInputTokens += triageResponse.tokenUsage.input;
    totalOutputTokens += triageResponse.tokenUsage.output;

    const triageResult = parseTriageOutput(triageResponse.content);

    console.log(
      `[erik-service] Triage: type=${triageResult.type}` +
      (triageResult.codes ? ` codes=${triageResult.codes.join(',')}` : '') +
      ` (${triageResponse.latencyMs}ms)`,
    );

    // ── Handle ANSWER (general knowledge) ──────────────────────────
    if (triageResult.type === 'answer') {
      onEvent({ type: 'status', phase: 'answering', message: 'Responding...' });
      // Emit the answer as a single delta (Pass 1 IS the answer)
      if (triageResult.text) {
        onEvent({ type: 'delta', content: triageResult.text });
      }
      onEvent({
        type: 'done',
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        triageResult,
      });
      return;
    }

    // ── Handle DECLINE ─────────────────────────────────────────────
    if (triageResult.type === 'decline') {
      const declineText = triageResult.text ||
        "I'm designed to help with patient chart questions and medical/radiology knowledge. Could you rephrase your question?";
      onEvent({ type: 'delta', content: declineText });
      onEvent({
        type: 'done',
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        triageResult,
      });
      return;
    }

    // ── Handle DATA (medical record question) ─────────────────────
    const codes = triageResult.codes || [];
    if (codes.length === 0) {
      // Edge case: DATA with no codes — treat as general
      onEvent({ type: 'delta', content: 'I wasn\'t able to determine what data to look up. Could you rephrase your question?' });
      onEvent({ type: 'done', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, triageResult });
      return;
    }

    // ── Phase 2: Load data ──────────────────────────────────────────
    const codeLabels = codes.join(', ');
    onEvent({ type: 'status', phase: 'loading', message: `Loading chart data: ${codeLabels}` });

    const { text: chartData, loadedCodes } = await loadRequestedData(codes, ctx);

    if (!chartData.trim()) {
      onEvent({ type: 'delta', content: 'I tried to load the requested chart data but none was available. The information may not be on file for this patient.' });
      onEvent({ type: 'done', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, triageResult });
      return;
    }

    // ── Phase 3: Stream answer ──────────────────────────────────────
    onEvent({ type: 'status', phase: 'answering', message: 'Generating response...' });

    const answerPrompt = buildAnswerPrompt({
      question,
      demographics,
      currentStudy,
      chartData,
      loadedCodes,
      conversationHistory,
    });

    const streamResult = await streamClaude(
      {
        systemPrompt: answerPrompt.systemPrompt,
        userMessage: answerPrompt.userMessage,
        modelId: ERIK_ANSWER_MODEL,
        maxOutputTokens: ANSWER_MAX_TOKENS,
        temperature: 0.1, // Slight temperature for natural language
      },
      (text) => {
        onEvent({ type: 'delta', content: text });
      },
    );

    totalInputTokens += streamResult.inputTokens;
    totalOutputTokens += streamResult.outputTokens;

    onEvent({
      type: 'done',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      triageResult,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[erik-service] Pipeline error:', message);
    onEvent({ type: 'error', message: `ERIK encountered an error: ${message}` });
  }
}
