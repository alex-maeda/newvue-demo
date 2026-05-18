/**
 * App — Root component wrapping the cockpit in the global context provider.
 *
 * When loaded with ?firstName=Paula&lastName=Everyly URL params,
 * auto-selects the matching patient from the server's patient list.
 */

import { useEffect, useRef } from 'react';
import './App.css';
import { CockpitProvider, useCockpit } from './context/CockpitContext';
import { CockpitShell } from './components/layout/CockpitShell';
import { usePatients } from './hooks/usePatients';

function AutoSelectPatient() {
  const { patients } = usePatients();
  const { selectPatient } = useCockpit();
  const selectedRef = useRef(false);

  useEffect(() => {
    if (selectedRef.current || patients.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const firstName = params.get('firstName')?.toLowerCase();
    const lastName = params.get('lastName')?.toLowerCase();

    if (!firstName || !lastName) return;

    const match = patients.find((p) => {
      const name = p.name.toLowerCase();
      return name.includes(firstName) && name.includes(lastName);
    });

    if (match) {
      selectPatient(match.patientId);
      selectedRef.current = true;
    }
  }, [patients, selectPatient]);

  return null;
}

export default function App() {
  return (
    <CockpitProvider>
      <AutoSelectPatient />
      <CockpitShell />
    </CockpitProvider>
  );
}
