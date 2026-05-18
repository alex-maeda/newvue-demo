/**
 * Hook to fetch a full patient record (including all studies) by patient ID.
 */

import { useState, useEffect } from 'react';
import { api, ApiError } from '../api/client';
import type { PatientRecord } from '../types/api';

interface UsePatientRecordResult {
  patientRecord: PatientRecord | null;
  loading: boolean;
  error: string | null;
}

export function usePatientRecord(patientId: string | null): UsePatientRecordResult {
  const [patientRecord, setPatientRecord] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setPatientRecord(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchRecord(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getPatientRecord(patientId!);
        if (!cancelled) {
          setPatientRecord(data);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof ApiError
            ? err.problem?.detail ?? err.message
            : `Failed to load patient ${patientId}`;
          setError(message);
          setPatientRecord(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchRecord();
    return () => { cancelled = true; };
  }, [patientId]);

  return { patientRecord, loading, error };
}
