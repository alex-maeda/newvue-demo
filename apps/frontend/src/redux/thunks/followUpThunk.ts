import { createAsyncThunk } from '@reduxjs/toolkit';
import followUpHistoryData from '../fakeApi/followUpHistory.json';
import patientsData from '../fakeApi/patients.json';

import {
  IUpdatePatient,
  TExamHistory,
  TPatientHistoryResult,
  TPatientReviewResult,
} from '../types/followUpTypes';
import { EExamStatus } from '../../models/enums';

const defaultHistory: TExamHistory[] = [
  {
    id: 0,
    type: EExamStatus.PERFORMED,
    date: '2023-08-01T09:00:00Z',
  },
  {
    id: 1,
    type: EExamStatus.REPORTED,
    date: '2023-08-20T09:00:00Z',
    data: {
      reportText:
        'Focal area of hypodensity is seen in the right frontoparietal temporal lobe, associated with effacement of sulci spaces in this region, suspicious for infarction. Punctate foci of hypodensity are noted within the central aspect of this region, worrisome for intraparenchymal hemorrhage and/or less likely calcifications. Minimal mass effect is noted, associated with effacement of the adjacent right lateral ventricle without midline shift. Differential considerations include but are not limited to mass lesion. Suggest clinical correlation and follow-up enhanced brain MRI exam with diffusion for more optimal characterization, if clinically indicated.',
    },
  },
];

export const getFollowUpHistoryThunk = createAsyncThunk<TPatientReviewResult>(
  'followUp/getFollowUpHistory',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => {
        const updateData: TPatientReviewResult = {};

        Object.values(patientsData as Record<string, IUpdatePatient>).forEach(
          (item) => {
            const history = (followUpHistoryData as TPatientHistoryResult)[
              String(item.id)
            ]?.examHistory;

            updateData[String(item.id)] = {
              patientData: item,
              examHistory: !!history ? history : defaultHistory,
            };
          },
        );

        return resolve(updateData);
      }, 1000),
    );
  },
);
