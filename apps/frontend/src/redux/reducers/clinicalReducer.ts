import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  getConsiderationListThunk,
  getPatientHistoryThunk,
} from '../thunks/clinicalThunk';
import { TClinicalReducerInitialState } from '../types/clinicalTypes';
import { EExaminations } from '../../models/enums';
import { TCommonData } from '../../models/Consideration';

export const initialState: TClinicalReducerInitialState = {
  getConsideration: {
    considerations: null,
    isFetching: false,
    error: null,
  },

  getPatientClinicalHistory: {
    data: null,
    currentExamination: null,
    isFetching: false,
    error: null,
  },

  radiologyReportType: {
    1: 'All reports',
    2: 'All reports',
  },

  unexpectedError: null,
};

const ClinicalReducer = createSlice({
  name: 'Clinical',
  initialState,
  reducers: {
    setCurrentExamination(
      { getPatientClinicalHistory },
      action: PayloadAction<
        (TCommonData & { type: EExaminations | string }) | null
      >,
    ) {
      getPatientClinicalHistory.currentExamination = action.payload;
    },
    setRadiologyReportType(state, action) {
      const { id, type } = action.payload;
      state.radiologyReportType = {
        ...state.radiologyReportType,
        [id]: type,
      };
    },
    resetRadiologyReportType(state, action) {
      state.radiologyReportType = state.radiologyReportType = {
        ...state.radiologyReportType,
        [action.payload]: 'All reports',
      };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getConsiderationListThunk.pending, ({ getConsideration }) => {
        getConsideration.isFetching = true;
        getConsideration.considerations = null;
      })

      .addCase(
        getConsiderationListThunk.fulfilled,
        ({ getConsideration }, action) => {
          if (action.payload) {
            getConsideration.considerations = action.payload;
          }
          getConsideration.isFetching = false;
        },
      )
      .addCase(
        getPatientHistoryThunk.pending,
        ({ getPatientClinicalHistory }) => {
          getPatientClinicalHistory.isFetching = true;
          getPatientClinicalHistory.data = null;
        },
      )
      .addCase(
        getPatientHistoryThunk.fulfilled,
        ({ getPatientClinicalHistory }, action) => {
          const patientId = action.meta.arg;
          if (action.payload && patientId) {
            const {
              visitHistory,
              medications,
              problemList,
              chartAndSummary,
              aiResults,
              radiologyDecisions,
              problemDecisions,
              statedPurpose,
              surgicalHistory,
              labResults,
            } = action.payload;
            getPatientClinicalHistory.data = {
              visitHistory: visitHistory[String(patientId)],
              medications,
              problemList,
              chartAndSummary,
              physicianNotes: [],
              aiResults,
              radiologyReport: [],
              pathalogy: [],
              labResults: labResults?.[String(patientId)] || [],
              surgicalHistory: surgicalHistory || [],
              radiologyDecisions,
              problemDecisions,
              statedPurpose,
            };
            getPatientClinicalHistory.data?.visitHistory?.forEach((item) => {
              if (
                getPatientClinicalHistory.data &&
                item.type !== EExaminations.PROBLEM_LIST &&
                item.type !== EExaminations.MEDICATIONS &&
                item.type !== EExaminations.AI_RESULTS &&
                item.type !== EExaminations.LAB_RESULT &&
                item.type !== EExaminations.SURGICAL_HISTORY
              ) {
                getPatientClinicalHistory.data[
                  item.type as
                    | EExaminations.RADIOLOGY
                    | EExaminations.PATHOLOGY
                    | EExaminations.PHYSICIAN_NOTES
                ].push(item);
              }
            });
            if (getPatientClinicalHistory.data?.visitHistory) {
              getPatientClinicalHistory.currentExamination = null;
            }
          }
          getPatientClinicalHistory.isFetching = false;
        },
      );
  },
});

export const {
  setCurrentExamination,
  setRadiologyReportType,
  resetRadiologyReportType,
} = ClinicalReducer.actions;

export default ClinicalReducer.reducer;
