/**
 * EHR Data REST API routes.
 *
 * Endpoints:
 *   GET /api/v1/ehr/text                  → On-demand text content (notes, pathology reports)
 *   GET /api/v1/ehr/:patientNumber        → Full EHR data for a patient (FHIR-derived)
 *
 * Patient number maps to the FHIR data directory:
 *   1 → FHIR/Patient_1/
 *   2 → FHIR/Patient_2/ (no data yet → { available: false })
 *
 * IMPORTANT: The /text route is registered BEFORE /:patientNumber to prevent
 * Express from matching "text" as a patient number.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadPatientEhrData, readEhrText } from '../services/fhirDataService';
import {
  computeNoteRelevance,
  loadServiceRequestMeta,
} from '../services/noteRelevanceService';
import { config } from '../config';

const router = Router();

/** Base path to the FHIR simulation directory */
const FHIR_BASE = config.fhirBasePath;

// ── GET /ehr/text ─────────────────────────────────────────────────────────
// Returns the full text content of a clinical note or pathology report.
// The path query parameter should be an absolute file path.
// MUST be registered before /:patientNumber to avoid route collision.

router.get('/text', (req: Request, res: Response) => {
  const filePath = String(req.query.path || '').trim();

  if (!filePath) {
    return res.status(400).json({
      type: 'https://newvue.com/errors/missing-parameter',
      title: 'Missing Parameter',
      status: 400,
      detail: 'The "path" query parameter is required.',
    });
  }

  // Security: ensure the path is within the FHIR directory
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(FHIR_BASE))) {
    return res.status(403).json({
      type: 'https://newvue.com/errors/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Access denied: path is outside the allowed directory.',
    });
  }

  try {
    const text = readEhrText(resolved);
    res.type('text/plain').send(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(404).type('text/plain').send(`(Error: ${message})`);
  }
});

// ── GET /ehr/:patientNumber ───────────────────────────────────────────────
// Returns the full EHR data payload for the given patient.
// Patient number is 1-based (matches Patient_1, Patient_2, etc.).

router.get('/:patientNumber', (req: Request<{ patientNumber: string }>, res: Response) => {
  const num = parseInt(req.params.patientNumber, 10);

  if (isNaN(num) || num < 1) {
    return res.status(400).json({
      type: 'https://newvue.com/errors/invalid-parameter',
      title: 'Invalid Parameter',
      status: 400,
      detail: `Patient number must be a positive integer, got: ${req.params.patientNumber}`,
    });
  }

  const fhirDir = path.join(FHIR_BASE, `Patient_${num}`);

  try {
    const data = loadPatientEhrData(fhirDir);

    // ── Compute note relevance per current study ─────────────────────
    // Only if EHR data is available and has notes
    if (data.available && data.notes.length > 0) {
      // Read current studies from encounter_metadata.json
      const encounterPath = path.join(
        config.hl7SimulationPath,
        `Patient_${num}`,
        'encounter_metadata.json',
      );

      if (fs.existsSync(encounterPath)) {
        try {
          const encounter = JSON.parse(fs.readFileSync(encounterPath, 'utf8'));
          const currentStudies = encounter.currentStudies || [];

          for (const cs of currentStudies) {
            const studyId = cs.currentStudyId;
            const studyDesc = cs.studyDescription || '';
            const studyDate = cs.studyDateTime || '';

            // Extract body regions for specialty matching
            const bodyRegions: string[] = cs.labels?.bodyRegions || [];

            // Derive encounter ID from the encounter metadata
            const visitNumber = encounter.pv1?.visitNumber || '';
            // Map HL7 visit number to FHIR encounter ID pattern
            // In our simulation, ServiceRequest encounter references use "Encounter/ENC-001"
            // We need to look at the ServiceRequest to find the actual encounter reference.
            const srMeta = loadServiceRequestMeta(fhirDir, studyDesc, '');

            // Use SR encounter ID if found, fall back to visit number
            const studyEncounterId = srMeta?.encounterId || visitNumber;

            // Re-run SR lookup with the correct encounter ID
            const srMetaFinal = srMeta?.encounterId
              ? srMeta
              : loadServiceRequestMeta(fhirDir, studyDesc, studyEncounterId);

            // Compute relevance scores for this current study
            const results = computeNoteRelevance(
              data.notes,
              studyEncounterId,
              bodyRegions,
              studyDate,
              srMetaFinal,
              (filePath) => fs.readFileSync(filePath, 'utf8'),
            );

            data.noteRelevance[studyId] = results;
          }
        } catch (err) {
          console.warn(
            `[EHR] Note relevance computation failed for Patient_${num}:`,
            err instanceof Error ? err.message : err,
          );
          // Non-fatal — data.noteRelevance remains empty
        }
      }
    }

    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[EHR] Failed to load FHIR data for Patient_${num}:`, message);
    res.status(500).json({
      type: 'https://newvue.com/errors/ehr-load-error',
      title: 'EHR Data Load Error',
      status: 500,
      detail: `Failed to load EHR data for patient ${num}: ${message}`,
    });
  }
});

export default router;

