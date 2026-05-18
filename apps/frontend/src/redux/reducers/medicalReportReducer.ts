import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

const MEDICAL_REPORT_BASE_URL =
  process.env.REACT_APP_MEDICAL_REPORT_BASE_URL ||
  'https://newvue-backend.demo.gomllabs.com';

interface PatientMetadata {
  patient_name: string;
  mrn: string;
  exam_description: string;
}

interface InitializeSessionRequest {
  patient_metadata: PatientMetadata;
  dictation_mode: 'generative' | 'traditional';
  template_type: string;
}

interface InitializeSessionResponse {
  session_id: string;
  dictation_mode: string;
  template_type: string;
  patient_context: PatientMetadata;
}

interface MedicalReportState {
  sessionId: string | null;
  isFetching: boolean;
  error: string | null;
}

const initialState: MedicalReportState = {
  sessionId: null,
  isFetching: false,
  error: null,
};

export const initializeSession = createAsyncThunk<
  InitializeSessionResponse,
  InitializeSessionRequest
>('medicalReport/initializeSession', async (requestData) => {
  const response = await fetch(
    `${MEDICAL_REPORT_BASE_URL}/api/v1/session/initialize`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    },
  );

  if (!response.ok) {
    throw new Error('Failed to initialize session');
  }

  const data: InitializeSessionResponse = await response.json();
  return data;
});

const medicalReportSlice = createSlice({
  name: 'medicalReport',
  initialState,
  reducers: {
    resetSession: (state) => {
      state.sessionId = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeSession.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(initializeSession.fulfilled, (state, action) => {
        state.isFetching = false;
        state.sessionId = action.payload.session_id;
        state.error = null;
      })
      .addCase(initializeSession.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message || 'Failed to initialize session';
      });
  },
});

export const { resetSession } = medicalReportSlice.actions;
export default medicalReportSlice.reducer;
