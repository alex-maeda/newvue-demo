import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { parseHL7Message } from './hl7-parser';
import { labelStudyDescription } from './study-labeler';
import { computeAllRelevanceScores } from './relevance-scorer';
import { PatientRecord, PatientSummary, CurrentStudy } from '../models/types';

/**
 * List all available patient directories that contain an hl7_feed.hl7 file.
 *
 * Returns lightweight PatientSummary objects without parsing the HL7 feeds.
 * This is used by the GET /patients endpoint for fast listing.
 */
export function listAvailablePatients(): PatientSummary[] {
  const basePath = config.hl7SimulationPath;
  const summaries: PatientSummary[] = [];

  // Scan for Patient_* directories
  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  const patientDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('Patient_'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const dir of patientDirs) {
    const feedPath = path.join(basePath, dir.name, 'hl7_feed.hl7');
    const demoPath = path.join(basePath, dir.name, 'patient_demographics.json');
    const studyMetaPath = path.join(basePath, dir.name, 'study_metadata.json');

    if (!fs.existsSync(feedPath)) continue;

    // For the summary, read the lightweight JSON metadata files
    // rather than parsing the full HL7 feed (which is heavier)
    try {
      const demographics = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
      const studyMeta = JSON.parse(fs.readFileSync(studyMetaPath, 'utf8'));

      // Read patient class from encounter metadata
      const encounterPath = path.join(basePath, dir.name, 'encounter_metadata.json');
      const encounter = JSON.parse(fs.readFileSync(encounterPath, 'utf8'));

      summaries.push({
        patientId: dir.name,
        mrn: demographics.mrn,
        name: `${demographics.name.last}, ${demographics.name.first}`,
        sex: demographics.sex,
        dateOfBirth: demographics.dateOfBirth,
        patientClass: encounter.pv1.patientClass,
        totalStudies: studyMeta.totalStudies,
      });
    } catch (err) {
      // If metadata files are malformed, skip this patient in the listing
      // but log the issue for diagnostics
      console.warn(`[feed-loader] Skipping ${dir.name}: metadata read error`, err);
    }
  }

  return summaries;
}

/**
 * Load and parse a specific patient's HL7 feed.
 *
 * Reads the .hl7 file from disk, delegates parsing to hl7-parser,
 * normalizes + labels each prior study description, and returns the
 * fully structured PatientRecord. Also reads currentStudies from the
 * encounter metadata to populate the current exam context.
 *
 * After labeling, pre-computes relevance scores for all
 * current study × prior study combinations and attaches them
 * to the PatientRecord for client consumption.
 *
 * @param patientId - The patient directory name (e.g., "Patient_1")
 * @returns Parsed PatientRecord, or null if the patient/feed doesn't exist
 */
export function loadPatientFeed(patientId: string): PatientRecord | null {
  // Validate patient ID format to prevent path traversal
  if (!/^Patient_\d+$/.test(patientId)) {
    console.warn(`[feed-loader] Invalid patient ID format: ${patientId}`);
    return null;
  }

  const patientDir = path.join(config.hl7SimulationPath, patientId);
  const feedPath = path.join(patientDir, 'hl7_feed.hl7');

  if (!fs.existsSync(feedPath)) {
    console.warn(`[feed-loader] Feed file not found: ${feedPath}`);
    return null;
  }

  try {
    const rawMessage = fs.readFileSync(feedPath, 'utf8');
    const record = parseHL7Message(patientId, rawMessage);

    // ── Label prior studies ──────────────────────────────────────────
    // Run each prior study's description through the normalize→label
    // pipeline to attach structured StudyLabels for relevance matching.
    for (const study of record.studies) {
      try {
        study.labels = labelStudyDescription(study.studyDescription);
      } catch (err) {
        console.warn(
          `[feed-loader] Failed to label study "${study.studyDescription}" in ${patientId}:`,
          err,
        );
        // Graceful degradation — study will have labels: undefined
      }
    }

    // ── Read current studies from encounter metadata ─────────────────
    // These represent the exams the radiologist is about to read,
    // distinct from the prior studies parsed from the HL7 feed.
    const encounterPath = path.join(patientDir, 'encounter_metadata.json');
    if (fs.existsSync(encounterPath)) {
      const encounter = JSON.parse(fs.readFileSync(encounterPath, 'utf8'));
      record.currentStudies = (encounter.currentStudies as CurrentStudy[]) ?? [];
    } else {
      record.currentStudies = [];
    }

    // ── Label current studies through the labeler pipeline ───────────
    // The encounter_metadata.json labels are pre-assigned but lack
    // rawBodyRegions and allModalities. Running them through the
    // same labeler ensures consistent label structures for scoring.
    // The encounter_metadata labels serve as a fallback if labeling fails.
    for (const currentStudy of record.currentStudies) {
      try {
        currentStudy.labels = labelStudyDescription(currentStudy.studyDescription);
      } catch (err) {
        console.warn(
          `[feed-loader] Labeler failed for current study "${currentStudy.studyDescription}" ` +
          `in ${patientId}, using encounter_metadata labels as fallback:`,
          err,
        );
        // Keep encounter_metadata labels — ensure rawBodyRegions and allModalities
        // are populated with reasonable defaults for scoring
        if (currentStudy.labels && !currentStudy.labels.rawBodyRegions) {
          currentStudy.labels.rawBodyRegions = currentStudy.labels.bodyRegions;
        }
        if (currentStudy.labels && !currentStudy.labels.allModalities) {
          currentStudy.labels.allModalities = [currentStudy.labels.modality];
        }
      }
    }

    // ── Pre-compute relevance scores ─────────────────────────────────
    // Calculate relevance for all current study × prior study pairs.
    // This keeps all scoring business logic on the server side.
    record.relevanceScores = computeAllRelevanceScores(
      record.currentStudies,
      record.studies,
    );

    return record;
  } catch (err) {
    console.error(`[feed-loader] Failed to parse feed for ${patientId}:`, err);
    return null;
  }
}


