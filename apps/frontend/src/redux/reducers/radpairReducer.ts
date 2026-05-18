/* eslint-disable @typescript-eslint/no-unused-vars */
import { PayloadAction, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import {
  IInitialRadpaidState,
  IReportCreate,
  IReportUpdate,
} from '../types/radpaidTypes';
import { AppDispatch, RootState } from '../types';
import socketService from '../../utils/SocketService';

export const RADPAIR_URL = 'https://staging.radpair.com/';
const SOCKET_URL = 'https://staging.radpair.com/socket';
const ADMIN_USERNAME = 'admin@newvue.ai'; // Replace with your admin username
const ADMIN_PASSWORD = 'N3wVu3123!'; // Replace with your admin password
const USER_EMAIL = 'admin@newvue.ai'; // Replace with the user's email
const FIRST_NAME = 'NewVue'; // Replace with the user's first name
const LAST_NAME = 'Administrator'; // Replace with the user's last name

export const fetchAccessToken = createAsyncThunk(
  'radpair/fetchAccessToken',
  async () => {
    const response = await fetch(`${RADPAIR_URL}api/users/orgs/sign_in`, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + window.btoa(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        first_name: FIRST_NAME,
        last_name: LAST_NAME,
      }),
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
    return data.access_token;
  },
);

export const initializeWebSocket = createAsyncThunk<
  boolean,
  string,
  {
    dispatch: AppDispatch;
    state: RootState;
  }
>('radpair/initializeWebSocket', async (accessToken, { dispatch }) => {
  try {
    await socketService.connect(accessToken);
    socketService.subscribeToReportUpdate((data: IReportUpdate) => {
      dispatch(reportUpdateReceived(data));
    });

    return true;
  } catch (e) {
    return false;
  }
});

export const createReportThunk = createAsyncThunk<
  { report_id: string },
  IReportCreate
>('radpair/createReportThunk', async (reportDetails) => {
  return socketService.createReport(reportDetails);
});

const initialState: IInitialRadpaidState = {
  isFetching: false,
  isReportCreated: false,
  accessToken: null,
  isSocketConnected: false,
  reportUpdates: {},
  createdReportId: '',
  error: '',
};

const radpairSlice = createSlice({
  name: 'redpair',
  initialState,
  reducers: {
    reportUpdateReceived: (state, action: PayloadAction<IReportUpdate>) => {
      const { report_id, update_type } = action.payload;
      state.reportUpdates[report_id] = update_type;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeWebSocket.pending, (state) => {
        console.log('soccet connect');
        state.isSocketConnected = false;
      })
      .addCase(initializeWebSocket.fulfilled, (state, action) => {
        if (action.payload && !state.isSocketConnected) {
          state.isSocketConnected = action.payload;
        }
      })
      .addCase(initializeWebSocket.rejected, (state) => {
        state.isSocketConnected = false;
      })
      .addCase(fetchAccessToken.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchAccessToken.fulfilled, (state, action) => {
        state.isFetching = false;
        state.accessToken = action.payload;
      })
      .addCase(fetchAccessToken.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message;
      })
      .addCase(createReportThunk.pending, (state) => {
        state.isFetching = true;
        state.isReportCreated = false;
      })
      .addCase(createReportThunk.fulfilled, (state, action) => {
        state.isFetching = false;
        if (action.payload.report_id) {
          state.createdReportId = action.payload.report_id;
          state.isReportCreated = true;
        }
      })
      .addCase(createReportThunk.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message;
        state.isReportCreated = false;
      });
  },
});

export const { reportUpdateReceived } = radpairSlice.actions;

export default radpairSlice.reducer;
