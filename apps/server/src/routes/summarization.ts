/**
 * Summarization REST API route.
 *
 * Endpoints:
 *   POST /api/v1/patients/:id/summarize — Trigger the full summarization pipeline
 *
 * Request body: { "currentStudyId": "P1-CURRENT-001" }
 * Response: SummarizationResponse (individual analyses + executive summary + QA log)
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { loadPatientFeed } from '../services/feed-loader';
import { runSummarizationPipeline } from '../services/summarization-service';
import { isClaudeConfigured } from '../services/claude-client';
import { loadPatientEhrData, type EhrProblem, type EhrProcedure } from '../services/fhirDataService';
import { computeNoteRelevance, loadServiceRequestMeta } from '../services/noteRelevanceService';
import type { RelevantNoteInput } from '../services/note-triage-service';
import { ProblemDetail } from '../models/types';
import { cacheErikSummarizationResult } from './erik';

const router = Router();

// ── Helper: RFC 7807 error response ───────────────────────────────────────

function sendProblem(res: Response, problem: ProblemDetail): void {
  res.status(problem.status).json(problem);
}

// ── POST /patients/:id/summarize ──────────────────────────────────────────

router.post(
  '/:id/summarize',
  async (req: Request<{ id: string }>, res: Response) => {
    const patientId = req.params.id;
    const { currentStudyId, maxPriors, maxNotes } = req.body as {
      currentStudyId?: string;
      maxPriors?: number;
      maxNotes?: number;
    };

    // ── Validate request ──
    if (!currentStudyId) {
      sendProblem(res, {
        type: 'https://newvue.com/errors/invalid-request',
        title: 'Invalid Request',
        status: 400,
        detail: 'Request body must include "currentStudyId".',
      });
      return;
    }

    // ── Check Claude configuration ──
    if (!isClaudeConfigured()) {
      sendProblem(res, {
        type: 'https://newvue.com/errors/configuration-error',
        title: 'LLM Not Configured',
        status: 503,
        detail:
          'AWS Bedrock is not configured. Check AWS credentials and BEDROCK_MODEL_ID to enable summarization.',
      });
      return;
    }

    // ── Load patient data ──
    let patientRecord;
    try {
      patientRecord = loadPatientFeed(patientId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      sendProblem(res, {
        type: 'https://newvue.com/errors/parse-error',
        title: 'HL7 Parse Error',
        status: 500,
        detail: `Failed to load patient data for ${patientId}: ${message}`,
      });
      return;
    }

    if (!patientRecord) {
      sendProblem(res, {
        type: 'https://newvue.com/errors/patient-not-found',
        title: 'Patient Not Found',
        status: 404,
        detail: `No HL7 feed found for patient ID: ${patientId}`,
      });
      return;
    }

    // ── Validate current study exists ──
    const currentStudy = patientRecord.currentStudies.find(
      (cs) => cs.currentStudyId === currentStudyId,
    );
    if (!currentStudy) {
      sendProblem(res, {
        type: 'https://newvue.com/errors/study-not-found',
        title: 'Current Study Not Found',
        status: 404,
        detail: `Current study "${currentStudyId}" not found for patient ${patientId}. ` +
          `Available: ${patientRecord.currentStudies.map((cs) => cs.currentStudyId).join(', ')}`,
      });
      return;
    }

    // ── Run the pipeline ──
    try {
      // Load EHR data (problems + notes) from FHIR data
      const patientMatch = patientId.match(/(\d+)/);
      const patientNumber = patientMatch ? parseInt(patientMatch[1], 10) : null;
      let ehrProblems: EhrProblem[] = [];
      let ehrProcedures: EhrProcedure[] = [];
      let relevantNotes: RelevantNoteInput[] = [];
      let orderingSpecialty = '';

      if (patientNumber) {
        const fhirBase = config.fhirBasePath;
        const fhirDir = path.join(fhirBase, `Patient_${patientNumber}`);
        const ehrData = loadPatientEhrData(fhirDir);
        if (ehrData.available) {
          ehrProblems = ehrData.problems;
          ehrProcedures = ehrData.procedures || [];
          console.log(
            `[summarization-route] Loaded ${ehrProblems.length} EHR problems, ${ehrProcedures.length} procedures for pipeline`,
          );

          // Compute note relevance for the current study to identify relevant notes
          if (ehrData.notes.length > 0) {
            try {
              const srMeta = loadServiceRequestMeta(
                fhirDir,
                currentStudy.studyDescription,
                '',
              );
              const studyEncounterId = srMeta?.encounterId || '';
              const srMetaFinal = studyEncounterId
                ? srMeta
                : loadServiceRequestMeta(fhirDir, currentStudy.studyDescription, studyEncounterId);

              const noteResults = computeNoteRelevance(
                ehrData.notes,
                studyEncounterId,
                currentStudy.labels.bodyRegions,
                currentStudy.studyDateTime,
                srMetaFinal,
                (filePath) => fs.readFileSync(filePath, 'utf8'),
              );

              // Build relevant notes array for note triage
              let noteIndex = 0;
              for (const nr of noteResults) {
                if (nr.isRelevant) {
                  const note = ehrData.notes.find((n) => n.id === nr.noteId);
                  if (note) {
                    relevantNotes.push({ note, noteIndex: noteIndex++ });
                  }
                }
              }

              console.log(
                `[summarization-route] Identified ${relevantNotes.length} relevant notes for note triage`,
              );

              // Apply maxNotes cap (default: 5)
              const noteLimit = Math.max(1, Math.min(20, Math.floor(maxNotes ?? 5)));
              if (relevantNotes.length > noteLimit) {
                console.log(
                  `[summarization-route] Capping to top ${noteLimit} notes (was ${relevantNotes.length})`,
                );
                relevantNotes = relevantNotes.slice(0, noteLimit);
              }

              // Resolve ordering specialty from the ordering provider's note
              for (const nr of noteResults) {
                if (nr.isOrderingProvider && nr.isRelevant) {
                  const opNote = ehrData.notes.find((n) => n.id === nr.noteId);
                  if (opNote && opNote.specialty) {
                    orderingSpecialty = opNote.specialty;
                    console.log(
                      `[summarization-route] Ordering specialty: ${orderingSpecialty}`,
                    );
                  }
                  break;
                }
              }
            } catch (err) {
              console.warn(
                `[summarization-route] Note relevance computation failed:`,
                err instanceof Error ? err.message : err,
              );
              // Non-fatal — relevantNotes stays empty, triage will be skipped
            }
          }
        }
      }

      console.log(
        `[summarization-route] Starting pipeline for patient=${patientId} ` +
        `currentStudy=${currentStudyId}`,
      );

      const result = await runSummarizationPipeline(
        patientRecord, currentStudyId, maxPriors, ehrProblems, relevantNotes,
        ehrProcedures, orderingSpecialty,
      );

      console.log(
        `[summarization-route] Pipeline complete: ` +
        `${result.individualAnalyses.length} analyses, ` +
        `${result.totalLatencyMs}ms total, ` +
        `${result.totalTokenUsage.input}+${result.totalTokenUsage.output} tokens`,
      );

      // Cache for ERIK access (avoids re-sending from client)
      cacheErikSummarizationResult(patientId, currentStudyId, result);

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[summarization-route] Pipeline error: ${message}`);
      sendProblem(res, {
        type: 'https://newvue.com/errors/summarization-error',
        title: 'Summarization Failed',
        status: 500,
        detail: `Summarization pipeline failed: ${message}`,
      });
    }
  },
);

export default router;
