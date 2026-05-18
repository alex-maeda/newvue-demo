/* eslint-disable @typescript-eslint/no-unused-vars */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { IPatient } from '../../models/Patient';
import { IInitialMdaiState } from '../types/mdaiTypes';
import { TCommonData } from '../../models/Consideration';

const MDAI_URL = 'https://chat.md.ai';
const ACCESS_TOKEN = 'dd6467f37675fabba5ce1a0a9a60dd5b';
const SITE_ID = 'newvue-test';
const USER_NAME = 'aaron@newvue.ai';
const USER_EMAIL = 'aaron@newvue.ai';

export const fetchReportLink = createAsyncThunk(
  'MDai/fetchReportLink',
  async ({
    patient,
    currentExamination,
  }: {
    patient: Omit<IPatient, 'timer'>;
    currentExamination: TCommonData;
  }) => {
    const response = await fetch(`${MDAI_URL}/api/report/launch/clinical`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': ACCESS_TOKEN,
      },
      body: JSON.stringify({
        clinicalInfo: {
          SiteID: SITE_ID,
          PatientMRN: patient.MRN ?? '',
          Accession: patient.accession, //currentExamination.accession
          PatientName: `${patient.firstName} ${patient.lastName}`,
          PatientBirthDate: patient.DOB,
          PatientAge: patient.age,
          PatientSex: patient.sex,
          Modality: patient.modality,
          BodyPartExamined: patient.bodyPart,
          StudyDescription: patient.examDescription,
          StudyDate: new Date(patient.examDate).toISOString().split('T')[0],
          StudyTime: '',
          StudyInstanceUID: '',
          ReasonForExam: patient.reasonForExam,
          KeyFindings: currentExamination.description?.join('\n'),
          ReferringPhysician: patient.referredBy,
          ReportingPhysician: patient.performedBy,
          Notes:
            patient.patientsNote?.map((note) => note.note).join('\n') ?? '',
        },
        reportingApp: {
          AppLanguage: 'en',
          SpeechLanguage: 'en',
          ReturnFormat: 'HL7',
          SyncLaunch: true,
          ApplyTemplate: true,
        },
        userInfo: {
          Auth: ACCESS_TOKEN,
          UserName: USER_NAME,
          UserEmail: USER_EMAIL,
        },
        response: {
          type: 'link',
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
    return data.reportLink;
  },
);

const initialState: IInitialMdaiState = {
  isFetching: false,
  reportLink: null,
  error: '',
};

const mdaiSlice = createSlice({
  name: 'mdai',
  initialState,
  reducers: {
    resetReportLink(state) {
      state.reportLink = null;
      state.error = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReportLink.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchReportLink.fulfilled, (state, action) => {
        state.isFetching = false;
        state.reportLink = action.payload;
      })
      .addCase(fetchReportLink.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message;
      });
  },
});

export const { resetReportLink } = mdaiSlice.actions;
export default mdaiSlice.reducer;
