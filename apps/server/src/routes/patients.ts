/**
 * Patient REST API routes.
 *
 * Endpoints:
 *   GET /api/v1/patients              → List available patients (summary)
 *   GET /api/v1/patients/:id          → Full patient record with all studies
 *   GET /api/v1/patients/:id/studies   → All studies for a patient
 *   GET /api/v1/patients/:id/studies/:seq → Single study by sequence number
 *
 * All endpoints return JSON. Error responses follow RFC 7807 Problem Details
 * per project conventions §4.
 */

import { Router, Request, Response } from 'express';
import { listAvailablePatients, loadPatientFeed } from '../services/feed-loader';
import { ProblemDetail } from '../models/types';

const router = Router();

// ── Helper: RFC 7807 error response ───────────────────────────────────────

function sendProblem(res: Response, problem: ProblemDetail): void {
  res.status(problem.status).json(problem);
}

function patientNotFound(patientId: string): ProblemDetail {
  return {
    type: 'https://newvue.com/errors/patient-not-found',
    title: 'Patient Not Found',
    status: 404,
    detail: `No HL7 feed found for patient ID: ${patientId}`,
  };
}

function studyNotFound(patientId: string, sequence: number): ProblemDetail {
  return {
    type: 'https://newvue.com/errors/study-not-found',
    title: 'Study Not Found',
    status: 404,
    detail: `No study with sequence ${sequence} found for patient ${patientId}`,
  };
}

function parseError(patientId: string, message: string): ProblemDetail {
  return {
    type: 'https://newvue.com/errors/parse-error',
    title: 'HL7 Parse Error',
    status: 500,
    detail: `Failed to parse HL7 feed for ${patientId}: ${message}`,
  };
}

// ── GET /patients ─────────────────────────────────────────────────────────
// Returns a lightweight list of available patients without parsing HL7 feeds.

router.get('/', (_req: Request, res: Response) => {
  try {
    const patients = listAvailablePatients();
    res.json(patients);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendProblem(res, {
      type: 'https://newvue.com/errors/internal',
      title: 'Internal Server Error',
      status: 500,
      detail: `Failed to list patients: ${message}`,
    });
  }
});

// ── GET /patients/:id ─────────────────────────────────────────────────────
// Parses the HL7 feed on demand and returns the full patient record.

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const patientId = req.params.id;

  try {
    const record = loadPatientFeed(patientId);
    if (!record) {
      sendProblem(res, patientNotFound(patientId));
      return;
    }
    res.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendProblem(res, parseError(patientId, message));
  }
});

// ── GET /patients/:id/studies ─────────────────────────────────────────────
// Returns all studies for a patient.

router.get('/:id/studies', (req: Request<{ id: string }>, res: Response) => {
  const patientId = req.params.id;

  try {
    const record = loadPatientFeed(patientId);
    if (!record) {
      sendProblem(res, patientNotFound(patientId));
      return;
    }
    res.json(record.studies);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendProblem(res, parseError(patientId, message));
  }
});

// ── GET /patients/:id/studies/:seq ────────────────────────────────────────
// Returns a single study by its OBR sequence number.

router.get('/:id/studies/:seq', (req: Request<{ id: string; seq: string }>, res: Response) => {
  const patientId = req.params.id;
  const sequence = parseInt(req.params.seq, 10);

  if (isNaN(sequence) || sequence < 1) {
    sendProblem(res, {
      type: 'https://newvue.com/errors/invalid-parameter',
      title: 'Invalid Parameter',
      status: 400,
      detail: `Study sequence must be a positive integer, got: ${req.params.seq}`,
    });
    return;
  }

  try {
    const record = loadPatientFeed(patientId);
    if (!record) {
      sendProblem(res, patientNotFound(patientId));
      return;
    }

    const study = record.studies.find(s => s.sequence === sequence);
    if (!study) {
      sendProblem(res, studyNotFound(patientId, sequence));
      return;
    }

    res.json(study);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendProblem(res, parseError(patientId, message));
  }
});

export default router;
