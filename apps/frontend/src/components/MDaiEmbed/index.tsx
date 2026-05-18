import React, { useEffect } from 'react';
import Loader from '../Loader';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import {
  fetchReportLink,
  resetReportLink,
} from '../../redux/reducers/mdaiReducer';
import { TCommonData } from '../../models/Consideration';
import './style.scss';

const MDaiEmbed: React.FC = () => {
  const { isFetching, reportLink } = useAppSelector(({ mdai }) => mdai);
  const {
    getPatient: { patient },
  } = useAppSelector(({ patients }) => patients);
  const {
    getPatientClinicalHistory: {
      currentExamination,
      isFetching: isFetchingClinicalHistory,
    },
  } = useAppSelector(({ clinical }) => clinical);
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Only fetch report link when patient changes, not when currentExamination changes
    // (clicking timeline badges shouldn't trigger API calls)
    if (!patient || reportLink) return;

    // Fetch report link with current examination if available, otherwise use patient data
    const examination = currentExamination || {
      title: patient.examDescription || 'Unknown Exam',
      description: [],
      date: patient.examDate || new Date().toISOString(),
    };

    dispatch(
      fetchReportLink({
        patient,
        currentExamination: examination as TCommonData,
      }),
    );
  }, [patient, reportLink]);

  useEffect(() => {
    return () => {
      dispatch(resetReportLink());
    };
  }, []);

  return (
    <div className="iframe-wrapper" id="medical-report-section">
      {isFetching || isFetchingClinicalHistory ? (
        <Loader />
      ) : (
        <iframe
          id="medical-report-iframe"
          src={
            reportLink ||
            'https://main.dlz869gpeqvia.amplifyapp.com?session_id=1b101df9-59d4-49da-a42d-dc9cad3193de'
          }
          title="Medical Report UI"
          style={{ width: '100%', height: '100%' }}
          allow="microphone; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      )}
    </div>
  );
};

export default React.memo(MDaiEmbed);
