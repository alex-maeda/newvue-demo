/**
 * FHIR Data Service
 *
 * Reads FHIR R4 JSON files from the patient's data directory and transforms
 * them into a unified EhrDataPayload suitable for client consumption.
 *
 * Design notes:
 *   - All reads are synchronous (static simulation files, not production I/O).
 *   - The service resolves FHIR List → Resource references (e.g., Problems List
 *     → individual Condition resources) to flatten the data.
 *   - Text content (notes, pathology reports) is NOT loaded eagerly — only the
 *     metadata is returned. Full text is fetched on-demand via /api/v1/ehr/text.
 */

import fs from 'fs';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface EhrNote {
  id: string;
  title: string;
  date: string;
  type: string;
  author: string;
  setting: string;
  /** Clinical specialty / department (e.g. "Neurology", "Emergency Medicine") */
  specialty: string;
  textFilePath: string;
  /** Author's FHIR Practitioner reference (e.g., "Practitioner/PRAC-0001") */
  authorRef: string;
  /** FHIR encounter ID for this note (e.g., "ENC-001") */
  encounterId: string;
}

export interface EhrProblem {
  id: string;
  text: string;
  status: string;
  recordedDate: string;
  note?: string;
}

export interface EhrProcedure {
  id: string;
  text: string;
  date: string;
  status: string;
  bodySite: string;
  note?: string;
}

export interface EhrMedication {
  id: string;
  /** Medication name from medicationCodeableConcept.text */
  name: string;
  /** Full dosage instruction text (free-text sig) */
  dosageInstruction: string;
  /** "active", "on-hold", "stopped", etc. */
  status: string;
  /** "outpatient" | "inpatient-scheduled" | "inpatient-prn" | "inpatient-continuous" */
  category: string;
  /** Most recent administration datetime from MedicationAdministration (empty if none) */
  lastGiven: string;
  /** Optional clinician annotation */
  note?: string;
}

export interface LabRow {
  name: string;
  values: string[];
  /** Unit of measurement (e.g., "K/uL", "mg/dL") */
  unit: string;
  /** Normal reference range string (e.g., "4.5-11.0") */
  referenceRange: string;
  trend: { delta: number | null; dir: string };
}

export interface LabPanel {
  columns: string[];
  rows: LabRow[];
}

export interface EhrLabs {
  panels: Record<string, LabPanel>;
}

export interface EhrPathologyReport {
  id: string;
  title: string;
  date: string;
  status: string;
  textFilePath: string;
}

import type { NoteRelevanceResult } from '../models/types';

export interface EhrDataPayload {
  available: true;
  notes: EhrNote[];
  problems: EhrProblem[];
  procedures: EhrProcedure[];
  medications: EhrMedication[];
  labs: EhrLabs;
  pathology: EhrPathologyReport[];
  /**
   * Pre-computed note relevance scores, keyed by currentStudyId.
   * Each entry is an array of NoteRelevanceResult (one per note).
   * Computed server-side during patient load to keep scoring logic on the backend.
   */
  noteRelevance: Record<string, NoteRelevanceResult[]>;
}

export interface EhrDataUnavailable {
  available: false;
}

export type EhrDataResponse = EhrDataPayload | EhrDataUnavailable;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Safely read + parse a JSON file. Returns null on any error. */
function safeReadJSON(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Check if a file/directory exists. */
function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Extract the resource ID from a FHIR reference string (e.g., "Condition/COND-001" → "COND-001"). */
function refToId(ref: string): string {
  return (ref || '').split('/').pop() || '';
}

/** Compute trend (delta + direction) from the last two numeric values in an array. */
function parseLastTwoNumeric(arr: string[]): { delta: number | null; dir: string } {
  const nums = arr
    .map(v => {
      const m = /[-+]?[0-9]*\.?[0-9]+/.exec(String(v || ''));
      return m ? parseFloat(m[0]) : null;
    })
    .filter((v): v is number => v != null);

  if (nums.length < 2) return { delta: null, dir: '' };
  const a = nums[nums.length - 2];
  const b = nums[nums.length - 1];
  const d = b - a;
  const dir = Math.abs(d) < 1e-6 ? '■' : d > 0 ? '▲' : '▼';
  const delta = isFinite(d) ? Math.round(d * 100) / 100 : null;
  return { delta, dir };
}

/** Extract numeric series from string values (for sparkline rendering). */
function seriesFromValues(values: string[]): number[] {
  return values
    .map(v => {
      const m = /[-+]?[0-9]*\.?[0-9]+/.exec(String(v || ''));
      return m ? parseFloat(m[0]) : null;
    })
    .filter((v): v is number => v != null);
}

// ── Main Service ───────────────────────────────────────────────────────────

/**
 * Load all EHR (FHIR) data for a patient from the filesystem.
 *
 * @param fhirDir - Absolute path to the patient's FHIR directory (e.g., .../FHIR/Patient_1/)
 * @returns The assembled EhrDataPayload, or { available: false } if the dir doesn't exist.
 */
export function loadPatientEhrData(fhirDir: string): EhrDataResponse {
  if (!exists(fhirDir)) {
    return { available: false };
  }

  const result: EhrDataPayload = {
    available: true,
    notes: [],
    problems: [],
    procedures: [],
    medications: [],
    labs: { panels: {} },
    pathology: [],
    noteRelevance: {},
  };

  // ── Notes (DocumentReference → Binary text) ──────────────────────────
  const docRefDir = path.join(fhirDir, 'DocumentReference');
  if (exists(docRefDir)) {
    const files = fs.readdirSync(docRefDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const j = safeReadJSON(path.join(docRefDir, f));
        if (!j) continue;
        const id = j.id || path.basename(f, '.json');
        const title = j.type?.text || j.category?.[0]?.text || id;
        const date = j.date || j.created || j.meta?.lastUpdated || '';
        const type = j.type?.text || '';
        const author = j.author?.[0]?.display || '';
        const authorRef = j.author?.[0]?.reference || '';
        const setting = j.context?.facilityType?.text || '';
        const specialty = j.context?.practiceSetting?.text || '';
        const encounterId = (j.context?.encounter?.[0]?.reference || '').replace('Encounter/', '');

        // Resolve text file path from the attachment URL (e.g., "Binary/BIN-N-2025-0919-1")
        let textFilePath = '';
        const att = j.content?.[0]?.attachment;
        if (att?.url) {
          // The URL is a FHIR-relative reference like "Binary/BIN-N-2025-0919-1"
          // We need to resolve it to the actual file path
          const urlPath = att.url.replace(/^Binary\//, '');
          const candidate = path.join(fhirDir, 'Binary', urlPath + '.txt');
          if (exists(candidate)) {
            textFilePath = candidate;
          } else {
            // Try without extension
            const candidateNoExt = path.join(fhirDir, 'Binary', urlPath);
            if (exists(candidateNoExt)) textFilePath = candidateNoExt;
          }
        }

        result.notes.push({ id, title, date, type, author, authorRef, setting, specialty, encounterId, textFilePath });
      } catch { /* skip bad file */ }
    }
    result.notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // ── Problems (List → Condition resources) ────────────────────────────
  const problemsListPath = path.join(fhirDir, 'List', 'PROBLEMS-P12345.json');
  const conditionsDir = path.join(fhirDir, 'Condition');
  if (exists(problemsListPath) && exists(conditionsDir)) {
    try {
      const list = safeReadJSON(problemsListPath);
      if (list?.entry) {
        for (const entry of list.entry) {
          const ref = entry.item?.reference || '';
          const condId = refToId(ref);
          const condPath = path.join(conditionsDir, `${condId}.json`);
          const cond = safeReadJSON(condPath);
          if (cond) {
            result.problems.push({
              id: condId,
              text: cond.code?.text || cond.code?.coding?.[0]?.display || condId,
              status: cond.clinicalStatus?.text || cond.clinicalStatus?.coding?.[0]?.code || '',
              recordedDate: cond.recordedDate || '',
              note: cond.note?.[0]?.text || '',
            });
          }
        }
      }
      // Sort problems by recordedDate descending (newest first)
      result.problems.sort((a, b) => (b.recordedDate || '').localeCompare(a.recordedDate || ''));
    } catch { /* skip */ }
  }

  // ── Procedures (List → Procedure resources) ──────────────────────────
  const surgicalListPath = path.join(fhirDir, 'List', 'SURGICAL-HX-P12345.json');
  const proceduresDir = path.join(fhirDir, 'Procedure');
  if (exists(surgicalListPath) && exists(proceduresDir)) {
    try {
      const list = safeReadJSON(surgicalListPath);
      if (list?.entry) {
        for (const entry of list.entry) {
          const ref = entry.item?.reference || '';
          const procId = refToId(ref);
          const procPath = path.join(proceduresDir, `${procId}.json`);
          const proc = safeReadJSON(procPath);
          if (proc) {
            result.procedures.push({
              id: procId,
              text: proc.code?.text || proc.code?.coding?.[0]?.display || procId,
              date: proc.performedDateTime || proc.performedPeriod?.start || '',
              status: proc.status || '',
              bodySite: proc.bodySite?.[0]?.text || '',
              note: proc.note?.[0]?.text || '',
            });
          }
        }
      }
      // Sort procedures by date descending (newest first)
      result.procedures.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } catch { /* skip */ }
  }

  // ── Medications (multiple Lists → MedicationRequest resources) ───────
  const medRequestsDir = path.join(fhirDir, 'MedicationRequest');
  const listDir = path.join(fhirDir, 'List');

  const loadMedList = (listFile: string, category: string) => {
    const listPath = path.join(listDir, listFile);
    if (!exists(listPath)) return;
    try {
      const list = safeReadJSON(listPath);
      if (!list?.entry) return;
      for (const entry of list.entry) {
        const ref = entry.item?.reference || '';
        const medId = refToId(ref);
        const medPath = path.join(medRequestsDir, `${medId}.json`);
        const med = safeReadJSON(medPath);
        if (med) {
          result.medications.push({
            id: med.id || medId,
            name: med.medicationCodeableConcept?.text || medId,
            dosageInstruction: med.dosageInstruction?.[0]?.text || '',
            status: med.status || 'active',
            category,
            lastGiven: '',
            note: med.note?.[0]?.text || undefined,
          });
        }
      }
    } catch { /* skip */ }
  };

  loadMedList('MEDS-OUTPATIENT-P12345.json', 'outpatient');
  loadMedList('MEDS-INPATIENT-SCHEDULED-ENC-001.json', 'inpatient-scheduled');
  loadMedList('MEDS-INPATIENT-CONTINUOUS-ENC-001.json', 'inpatient-continuous');
  loadMedList('MEDS-INPATIENT-PRN-ENC-001.json', 'inpatient-prn');

  // Cross-reference MedicationAdministration records for lastGiven timestamps
  const medAdminDir = path.join(fhirDir, 'MedicationAdministration');
  if (exists(medAdminDir)) {
    try {
      const adminFiles = fs.readdirSync(medAdminDir).filter(f => f.endsWith('.json'));
      // Build a map of MedicationRequest ID → most recent effectiveDateTime
      const lastGivenMap = new Map<string, string>();
      for (const af of adminFiles) {
        const admin = safeReadJSON(path.join(medAdminDir, af));
        if (!admin?.request?.reference) continue;
        const reqId = refToId(admin.request.reference);
        const dt = admin.effectiveDateTime || '';
        if (dt && (!lastGivenMap.has(reqId) || dt > lastGivenMap.get(reqId)!)) {
          lastGivenMap.set(reqId, dt);
        }
      }
      // Apply to medication entries
      for (const med of result.medications) {
        const lg = lastGivenMap.get(med.id);
        if (lg) med.lastGiven = lg;
      }
    } catch { /* skip */ }
  }

  // Sort medications alphabetically within each category
  result.medications.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // ── Labs (pre-processed panel format) ────────────────────────────────
  const labsPath = path.join(fhirDir, 'Labs', 'LabPanels.json');
  if (exists(labsPath)) {
    try {
      const labsJson = safeReadJSON(labsPath);
      const panelsRaw = labsJson?.panels || [];
      for (const panel of panelsRaw) {
        const panelName = panel.name || 'Panel';
        const columns: string[] = panel.columns || [];
        const rows: LabRow[] = (panel.rows || []).map((r: any) => {
          const name = r.name || r.analyte || r.test || '';
          const values: string[] = Array.isArray(r.values)
            ? r.values
            : Array.isArray(r.cells)
              ? r.cells
              : columns.map(c => r[c] ?? '');
          const unit: string = r.unit || '';
          const referenceRange: string = r.referenceRange || '';
          const trend = parseLastTwoNumeric(values);
          return { name, values, unit, referenceRange, trend };
        });
        result.labs.panels[panelName] = { columns, rows };
      }
    } catch { /* skip */ }
  }

  // ── Pathology (List → DiagnosticReport + text files) ─────────────────
  const pathologyListPath = path.join(fhirDir, 'List', 'PATHOLOGY-REPORTS-P12345.json');
  const diagReportDir = path.join(fhirDir, 'DiagnosticReport');
  const pathTextDir = path.join(fhirDir, 'pathology');

  if (exists(pathologyListPath) && exists(diagReportDir)) {
    try {
      const list = safeReadJSON(pathologyListPath);
      if (list?.entry) {
        for (const entry of list.entry) {
          const ref = entry.item?.reference || '';
          const drId = refToId(ref);
          const drPath = path.join(diagReportDir, `${drId}.json`);
          const dr = safeReadJSON(drPath);
          if (dr) {
            const id = dr.id || drId;
            const date = dr.effectiveDateTime || dr.issued || '';

            // Resolve text file path and extract presentedForm title
            let textFilePath = '';
            const pf = dr.presentedForm?.[0];
            // Prefer presentedForm.title (richer, includes specimen context)
            // then code.text, then category text, then id
            const title = pf?.title || dr.code?.text || dr.category?.[0]?.text || id;
            if (pf?.url) {
              // Try to find in pathology text dir first
              const urlPath = pf.url.replace(/^file:\/\//, '').replace(/^Binary\//, '');
              const candidate = path.join(pathTextDir, path.basename(urlPath));
              if (exists(candidate)) {
                textFilePath = candidate;
              } else {
                // Fallback: BIN-<id> in pathology dir
                const fallback = path.join(pathTextDir, `BIN-${id}.txt`);
                if (exists(fallback)) textFilePath = fallback;
              }
            }

            result.pathology.push({
              id,
              title,
              date,
              status: dr.status || 'final',
              textFilePath,
            });
          }
        }
      }
      // Sort pathology reports by date descending (newest first)
      result.pathology.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } catch { /* skip */ }
  }

  return result;
}

/**
 * Read the full text content of a clinical note or pathology report.
 *
 * Handles plain text files and FHIR Binary JSON (base64-encoded).
 *
 * @param filePath - Absolute path to the text file.
 * @returns The text content, or an error message if not found.
 */
export function readEhrText(filePath: string): string {
  const tryPaths = [filePath, filePath + '.txt', filePath + '.json'];

  for (const p of tryPaths) {
    try {
      fs.accessSync(p);
      const buf = fs.readFileSync(p, 'utf8');

      // Check if it's a FHIR Binary JSON with base64 data
      try {
        const obj = JSON.parse(buf);
        if (obj?.resourceType === 'Binary' && obj.data) {
          return Buffer.from(obj.data, 'base64').toString('utf8');
        }
      } catch { /* not JSON, just plain text */ }

      return buf;
    } catch { /* try next path */ }
  }

  return `(File not found: ${path.basename(filePath)})`;
}
