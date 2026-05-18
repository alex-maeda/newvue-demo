/**
 * ERIK REST API routes.
 *
 * Endpoints:
 *   POST /api/v1/erik/chat   → SSE streaming chat endpoint
 *
 * The chat endpoint implements Server-Sent Events (SSE) to stream
 * ERIK's two-pass pipeline output to the client in real-time.
 *
 * SSE event types:
 *   - status: Phase transitions (triage, loading, answering)
 *   - delta:  Text content chunks (streamed token-by-token)
 *   - done:   Pipeline complete with token usage
 *   - error:  Pipeline error
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import { loadPatientEhrData, readEhrText } from '../services/fhirDataService';
import { runErikChat } from '../services/erik-service';
import type { ErikDataContext, ErikConversationMessage } from '../services/erik-service';
import type { SummarizationResponse } from '../models/summarization-types';
import { config } from '../config';

const router = Router();

const FHIR_BASE = config.fhirBasePath;

/**
 * In-memory cache of the most recent summarization result per patient/study.
 * Populated by the summarization endpoint; read here for ERIK context.
 * Key: `${patientId}:${currentStudyId}`
 */
const summarizationCache = new Map<string, SummarizationResponse>();

/**
 * Store a summarization result for ERIK to access.
 * Called by the summarization route after a successful pipeline run.
 */
export function cacheErikSummarizationResult(
  patientId: string,
  currentStudyId: string,
  result: SummarizationResponse,
): void {
  const key = `${patientId}:${currentStudyId}`;
  summarizationCache.set(key, result);
  console.log(`[erik] Cached summarization result: ${key}`);
}

// ── POST /erik/chat ───────────────────────────────────────────────────────

router.post('/chat', async (req: Request, res: Response) => {
  const {
    question,
    patientId,
    currentStudyId,
    conversationHistory,
    currentReportText,
    // Client can optionally pass the summarization result directly
    summarizationResult: clientSummarizationResult,
  } = req.body || {};

  // Validate required fields
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      type: 'https://newvue.com/errors/missing-parameter',
      title: 'Missing Parameter',
      status: 400,
      detail: 'The "question" field is required.',
    });
  }

  if (!patientId || typeof patientId !== 'string') {
    return res.status(400).json({
      type: 'https://newvue.com/errors/missing-parameter',
      title: 'Missing Parameter',
      status: 400,
      detail: 'The "patientId" field is required.',
    });
  }

  // ── Build context ──────────────────────────────────────────────────

  // Load patient record from HL7 simulation data
  let patientRecord = null;
  try {
    const patientNumber = patientId.match(/(\d+)/)?.[1];
    if (patientNumber) {
      const patientDataPath = path.join(config.hl7SimulationPath, `Patient_${patientNumber}`);
      const fs = await import('fs');
      const metaPath = path.join(patientDataPath, 'encounter_metadata.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        patientRecord = {
          patientId,
          demographics: meta.demographics || null,
          encounter: meta.encounter || null,
          messageHeader: meta.messageHeader || null,
          studies: meta.studies || [],
          totalStudies: meta.totalStudies || 0,
          currentStudies: meta.currentStudies || [],
          relevanceScores: {},
        };
      }
    }
  } catch (err) {
    console.warn('[erik] Failed to load patient record:', err);
  }

  // Find current study from patient record
  const currentStudy = patientRecord?.currentStudies?.find(
    (cs: { currentStudyId: string }) => cs.currentStudyId === currentStudyId,
  ) || patientRecord?.currentStudies?.[0] || null;

  // Load EHR data
  let ehrData = null;
  try {
    const patientNumber = patientId.match(/(\d+)/)?.[1];
    if (patientNumber) {
      const fhirDir = path.join(FHIR_BASE, `Patient_${patientNumber}`);
      const data = loadPatientEhrData(fhirDir);
      if (data.available) {
        ehrData = data;
      }
    }
  } catch (err) {
    console.warn('[erik] Failed to load EHR data:', err);
  }

  // Get summarization result (prefer client-provided, fall back to cache)
  const cacheKey = `${patientId}:${currentStudyId || ''}`;
  const summarizationResult: SummarizationResponse | null =
    clientSummarizationResult || summarizationCache.get(cacheKey) || null;

  // Build the ERIK context
  const ctx: ErikDataContext = {
    patientRecord,
    currentStudy,
    summarizationResult,
    ehrData,
    currentReportText: currentReportText || '',
    loadText: async (filePath: string) => {
      try {
        return readEhrText(filePath);
      } catch {
        return '(Text unavailable)';
      }
    },
  };

  // Parse conversation history
  const history: ErikConversationMessage[] = Array.isArray(conversationHistory)
    ? conversationHistory
        .filter((m: unknown) => m && typeof m === 'object' && 'role' in (m as Record<string, unknown>) && 'content' in (m as Record<string, unknown>))
        .map((m: { role: string; content: string }) => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: String(m.content || ''),
        }))
    : [];

  // ── Set up SSE ────────────────────────────────────────────────────

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable proxy buffering
  });

  // Send an initial comment to establish the connection
  res.write(':ok\n\n');

  /**
   * Write a single SSE event.
   * Format: `data: <json>\n\n`
   */
  const sendEvent = (event: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  // ── Run the ERIK pipeline ─────────────────────────────────────────

  try {
    await runErikChat(
      question.trim(),
      ctx,
      history,
      (event) => sendEvent({ ...event }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[erik] Pipeline error:', message);
    sendEvent({ type: 'error', message: `ERIK pipeline failed: ${message}` });
  }

  // Close the SSE stream
  if (!res.writableEnded) {
    res.end();
  }
});

export default router;
