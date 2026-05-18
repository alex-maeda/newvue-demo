import { createSlice } from '@reduxjs/toolkit';
import { refreshTokenThunk, signInThunk } from '../thunks/authThunk';
import { IInitialState } from '../types/authTypes';
import { clearStorage, getStorage } from '../../utils/StorageUtil';
import { ERole, EStorageKeys } from '../../models/enums';
import socketService from '../../utils/SocketService';

export const initialState: IInitialState = {
  isUserLogged: false,
  isPending: false,
  isAdmin: false,
  user: null,
  error: null,
  unexpectedError: null,
  tokenIsRefreshing: false,
  tokenRefreshFailed: false,
};

const AuthReducer = createSlice({
  name: 'authReducer',
  initialState,
  reducers: {
    refreshProfileInfoModalData(state) {
      state.error = null;
      state.unexpectedError = null;
      state.isPending = false;
    },
    signOut(state) {
      state.isUserLogged = false;
      clearStorage();
      socketService.disconnect();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(signInThunk.pending, (state) => {
        state.isPending = true;
        state.error = null;
        state.tokenIsRefreshing = false;
        state.tokenRefreshFailed = false;
      })
      .addCase(signInThunk.fulfilled, (state, action) => {
        state.isPending = false;
        state.isUserLogged = true;
        if (action.payload) {
          state.isAdmin = action.payload.user.role === ERole.ADMIN;
          state.user = action.payload.user;
        }
      })
      .addCase(signInThunk.rejected, (state, action) => {
        state.isPending = false;
        if (action.payload) {
          state.error = action.payload;
        } else {
          state.unexpectedError = action.error;
        }
      })
      .addCase(refreshTokenThunk.pending, (state) => {
        state.isPending = true;
        state.error = null;
        state.tokenIsRefreshing = false;
        state.tokenRefreshFailed = false;
      })
      .addCase(refreshTokenThunk.fulfilled, (state, action) => {
        state.isPending = false;
        state.isUserLogged = true;
        if (action.payload) {
          state.user = action.payload.user;
          state.isAdmin = getStorage(EStorageKeys.USERNAME) === 'admin';
          state.tokenIsRefreshing = true;
        }
      })
      .addCase(refreshTokenThunk.rejected, (state, action) => {
        state.isPending = false;
        if (action.payload) {
          state.error = action.payload;
          state.isUserLogged = false;
          state.tokenRefreshFailed = true;
        } else {
          state.tokenRefreshFailed = true;
          state.unexpectedError = action.error;
        }
      });
  },
});

export const { refreshProfileInfoModalData, signOut } = AuthReducer.actions;
export default AuthReducer.reducer;
