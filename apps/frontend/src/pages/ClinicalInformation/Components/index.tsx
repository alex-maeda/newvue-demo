import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import Panel from '../../../components/Panel';
import Loader from '../../../components/Loader';
import PatientInfoBlock from '../../../components/PatientInfo';

import { resetRadiologyReportType } from '../../../redux/reducers/clinicalReducer';
import { getPatientThunk } from '../../../redux/thunks/patientThunk';
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';

import '../style.scss';

const ClinicalInfoPage: React.FunctionComponent = () => {
  const {
    getPatient: { isFetching, patient },
  } = useAppSelector(({ patients }) => patients);
  const {
    getPatientClinicalHistory: { isFetching: isFetchingHistory },
  } = useAppSelector(({ clinical }) => clinical);
  const dispatch = useAppDispatch();
  const { patientId } = useParams();

  useEffect(() => {
    if (!patientId || +patientId === 0) {
      return;
    }
    dispatch(getPatientThunk(patientId));

    return () => {
      dispatch(resetRadiologyReportType(patientId));
    };
  }, []);

  return (
    <>
      {isFetching || isFetchingHistory ? (
        <Panel expanded className="patient-block">
          <Loader />
        </Panel>
      ) : !patient.firstName ? (
        <></>
      ) : (
        <Panel expanded className="patient-info-wrapper">
          <PatientInfoBlock data={patient} />
        </Panel>
      )}
    </>
  );
};

export default ClinicalInfoPage;
