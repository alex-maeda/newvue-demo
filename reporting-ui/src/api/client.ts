import type { PatientSummary, PatientRecord, Study, ProblemDetail, SummarizationResponse, DevSettings } from '../types/api';

const API_BASE = '/api/v1';

/** Custom error class that carries RFC 7807 problem details when available */
export class ApiError extends Error {
  public readonly status: number;
  public readonly problem: ProblemDetail | null;

  constructor(status: number, message: string, problem: ProblemDetail | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

/**
 * Generic JSON fetcher with error handling.
 * Throws ApiError on non-2xx responses, attaching RFC 7807 details if present.
 */
async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    let problem: ProblemDetail | null = null;
    try {
      problem = (await response.json()) as ProblemDetail;
    } catch {
      // Response body wasn't valid JSON — fall through to generic error
    }
    throw new ApiError(
      response.status,
      problem?.detail ?? `API request failed: ${response.status} ${response.statusText}`,
      problem,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Generic POST JSON helper.
 * Sends JSON body and expects JSON response.
 */
async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let problem: ProblemDetail | null = null;
    try {
      problem = (await response.json()) as ProblemDetail;
    } catch {
      // Response body wasn't valid JSON
    }
    throw new ApiError(
      response.status,
      problem?.detail ?? `API request failed: ${response.status} ${response.statusText}`,
      problem,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Generic PUT JSON helper.
 * Sends JSON body and expects JSON response.
 */
async function putJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let problem: ProblemDetail | null = null;
    try {
      problem = (await response.json()) as ProblemDetail;
    } catch {
      // Response body wasn't valid JSON
    }
    throw new ApiError(
      response.status,
      problem?.detail ?? `API request failed: ${response.status} ${response.statusText}`,
      problem,
    );
  }

  return response.json() as Promise<T>;
}

/** Type-safe API methods matching the backend route structure */
export const api = {
  /** GET /api/v1/patients — lightweight patient list */
  getPatients: (): Promise<PatientSummary[]> => fetchJson<PatientSummary[]>('/patients'),

  /** GET /api/v1/patients/:id — full patient record with all studies */
  getPatientRecord: (patientId: string): Promise<PatientRecord> =>
    fetchJson<PatientRecord>(`/patients/${encodeURIComponent(patientId)}`),

  /** GET /api/v1/patients/:id/studies — all studies for a patient */
  getStudies: (patientId: string): Promise<Study[]> =>
    fetchJson<Study[]>(`/patients/${encodeURIComponent(patientId)}/studies`),

  /** GET /api/v1/patients/:id/studies/:seq — single study by sequence */
  getStudy: (patientId: string, sequence: number): Promise<Study> =>
    fetchJson<Study>(`/patients/${encodeURIComponent(patientId)}/studies/${sequence}`),

  /** POST /api/v1/patients/:id/summarize — trigger summarization pipeline */
  summarize: (patientId: string, currentStudyId: string, maxPriors?: number, maxNotes?: number): Promise<SummarizationResponse> =>
    postJson<SummarizationResponse>(
      `/patients/${encodeURIComponent(patientId)}/summarize`,
      { currentStudyId, ...(maxPriors != null && { maxPriors }), ...(maxNotes != null && { maxNotes }) },
    ),

  /** GET /api/v1/dev-settings — read development settings */
  getDevSettings: (): Promise<DevSettings> => fetchJson<DevSettings>('/dev-settings'),

  /** PUT /api/v1/dev-settings — update development settings */
  updateDevSettings: (settings: Partial<DevSettings>): Promise<DevSettings> =>
    putJson<DevSettings>('/dev-settings', settings as Record<string, unknown>),
};
