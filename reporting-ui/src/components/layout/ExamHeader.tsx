/**
 * ExamHeader — Top bar with logo, patient dropdown, current exam dropdown, and user profile.
 *
 * The "current exam" dropdown is populated dynamically from the patient's
 * currentStudies array (loaded from encounter metadata via the API).
 * Selecting an exam sets the full CurrentStudy object — including its
 * structured labels — as the active context for relevance filtering.
 */

import './ExamHeader.css';
import { useCockpit } from '../../context/CockpitContext';
import { usePatients } from '../../hooks/usePatients';
import { formatShortDate, formatTime12h } from '../../utils/dates';
import { UserProfileMenu } from './UserProfileMenu';

export function ExamHeader() {
  const { state, selectPatient, selectCurrentExam } = useCockpit();
  const { patients, loading: patientsLoading } = usePatients();

  /** Current studies available for the selected patient */
  const currentStudies = state.patientRecord?.currentStudies ?? [];

  return (
    <header className="zone-exam-header">
      {/* ── Logo ── */}
      <div className="nv-logo" aria-label="NewVue">
        <img
          src="/newvue-logo.png"
          alt="newVue AI"
          className="nv-logo-img"
        />
      </div>

      <div className="h-sep" />

      {/* ── Patient Selector ── */}
      <div className="patient-block">
        <select
          className="patient-select"
          value={state.selectedPatientId ?? ''}
          onChange={(e) => {
            if (e.target.value) selectPatient(e.target.value);
          }}
          aria-label="Select patient"
        >
          <option value="">
            {patientsLoading ? 'Loading patients…' : 'Select Patient'}
          </option>
          {patients.map((p) => (
            <option key={p.patientId} value={p.patientId}>
              {p.name} — MRN {p.mrn}
            </option>
          ))}
        </select>

        {state.patientRecord && (
          <span className="pt-meta">
            {state.patientRecord.demographics.sex} · MRN {state.patientRecord.demographics.mrn}
          </span>
        )}
      </div>

      <div className="h-sep" />

      {/* ── Current Exam Selector (patient-specific studies from encounter metadata) ── */}
      <div className="study-block">
        {state.patientRecord ? (
          <>
            <select
              className="study-select"
              value={state.currentStudy?.currentStudyId ?? ''}
              onChange={(e) => {
                const selected = currentStudies.find(
                  (s) => s.currentStudyId === e.target.value,
                );
                if (selected) selectCurrentExam(selected);
              }}
              aria-label="Select current exam"
            >
              <option value="">Select Current Exam</option>
              {currentStudies.map((study) => (
                <option key={study.currentStudyId} value={study.currentStudyId}>
                  {study.studyDescription}
                </option>
              ))}
            </select>

            {state.currentStudy && (
              <div className="study-meta">
                {formatShortDate(state.currentStudy.studyDateTime)}
                {' · '}
                {formatTime12h(state.currentStudy.studyDateTime)}
                {' · '}
                {state.currentStudy.accessionNumber}
                {' · '}
                {state.currentStudy.orderingPhysician}
              </div>
            )}
          </>
        ) : (
          <span className="study-placeholder">No patient selected</span>
        )}
      </div>

      <div className="h-sep" />

      {/* ── User Profile (cockpit-native) ── */}
      <UserProfileMenu />
    </header>
  );
}

