/**
 * Hook to fetch the list of available patients from the API.
 */

import { useState, useEffect } from 'react';
import { api, ApiError } from '../api/client';
import type { PatientSummary } from '../types/api';

interface UsePatientsResult {
  patients: PatientSummary[];
  loading: boolean;
  error: string | null;
}

export function usePatients(): UsePatientsResult {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPatients(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getPatients();
        if (!cancelled) {
          setPatients(data);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof ApiError
            ? err.problem?.detail ?? err.message
            : 'Failed to load patients';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchPatients();
    return () => { cancelled = true; };
  }, []);

  return { patients, loading, error };
}
