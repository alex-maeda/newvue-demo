import { createAsyncThunk } from '@reduxjs/toolkit';
import clinicalData from '../fakeApi/clinicalConsidiration.json';
import patientHistory from '../fakeApi/patientHistory.json';

import {
  IPatientClinicalHistoryResponse,
  TConsiderations,
} from '../../models/Consideration';

export const getConsiderationListThunk = createAsyncThunk<TConsiderations>(
  'clinical/getConsiderationList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => resolve(clinicalData), 1000),
    );
  },
);

export const getPatientHistoryThunk = createAsyncThunk<
  IPatientClinicalHistoryResponse,
  number | undefined
>('clinical/getPatientHistory', async () => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(() => resolve(patientHistory), 1000),
  );
});
