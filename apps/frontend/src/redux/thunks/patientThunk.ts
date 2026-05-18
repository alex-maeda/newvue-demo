import { createAsyncThunk } from '@reduxjs/toolkit';
import patientData from '../fakeApi/patients.json';

import { IPatient } from '../../models/Patient';
import { getStorage } from '../../utils/StorageUtil';
import { EStorageKeys } from '../../models/enums';

export const getPatientListThunk = createAsyncThunk<
  Omit<IPatient, 'timer' | 'name' | 'age' | 'color' | 'mode'>[]
>('patient/getPatientList', async () => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(() => {
      let patientDataArr =
        (Object.values(patientData) as Omit<
          IPatient,
          'timer' | 'name' | 'age' | 'color' | 'mode'
        >[]) || [];
      const userName = getStorage(EStorageKeys.USERNAME) as string;

      patientDataArr = patientDataArr.filter((el) =>
        el.users.includes(userName),
      );

      resolve(patientDataArr);
    }, 1000),
  );
});

export const getPatientThunk = createAsyncThunk<
  Omit<IPatient, 'timer'>,
  string
>('patient/getPatient', async (id: string) => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(
      () =>
        resolve((patientData as Record<string, Omit<IPatient, 'timer'>>)[id]),
      1000,
    ),
  );
});
