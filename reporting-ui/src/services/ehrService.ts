/**
 * EHR Data Service (Client-Side)
 *
 * Fetch wrappers for the EHR data API. Used by CockpitContext to load
 * FHIR-derived patient data when a patient is selected.
 */

import type { EhrDataResponse } from '../types/ehrTypes';

const API_BASE = '/api/v1/ehr';

/**
 * Fetch the full EHR data payload for a patient.
 *
 * @param patientNumber - 1-based patient number (maps to FHIR/Patient_{N}/)
 * @returns The EhrDataResponse (either { available: true, ... } or { available: false })
 * @throws If the network request fails
 */
export async function fetchEhrData(patientNumber: number): Promise<EhrDataResponse> {
  const res = await fetch(`${API_BASE}/${patientNumber}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch EHR data: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch the full text content of a clinical note or pathology report.
 *
 * @param filePath - Absolute server-side file path (from note/pathology metadata)
 * @returns The plain text content
 * @throws If the network request fails
 */
export async function fetchEhrText(filePath: string): Promise<string> {
  const res = await fetch(`${API_BASE}/text?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch text: HTTP ${res.status}`);
  }
  return res.text();
}
