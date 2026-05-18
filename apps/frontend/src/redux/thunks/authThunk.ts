import { createAsyncThunk } from '@reduxjs/toolkit';
import CryptoJS from 'crypto-js';

import { ILoginRequestData, ILoginResponse } from '../types/authTypes';
import usersDataJson from '../fakeApi/users.json';
import { IUser } from '../../models/User';

const usersData = usersDataJson as IUser[];
import { getStorage, removeStorage, setStorage } from '../../utils/StorageUtil';
import { EStorageKeys } from '../../models/enums';
import { setIsKonicaBranding } from '../reducers/utilsReducer';

export const signInThunk = createAsyncThunk<
  ILoginResponse,
  ILoginRequestData,
  { rejectValue: { message: string } }
>(
  'authReducer/signInThunk',
  async (userData: ILoginRequestData, { rejectWithValue, dispatch }) => {
    const users: IUser[] = await new Promise((resolve) =>
      setTimeout(() => resolve(usersData || []), 500),
    );

    const response = users.find(
      (user) =>
        user.username === userData.username &&
        user.password === userData.password,
    );

    if (!response) {
      return rejectWithValue({ message: 'Authorization error' });
    }

    setStorage(
      EStorageKeys.TOKENS,
      CryptoJS.enc.Utf8.parse(userData.username).toString(CryptoJS.enc.Hex),
    );

    const name = `${response.firstName} ${response.lastName}`;

    setStorage(EStorageKeys.USERNAME, userData.username);
    setStorage(EStorageKeys.NAME, name.trim());

    const isKonicaAuth = userData.username === 'konicaminolta';

    if (isKonicaAuth) {
      dispatch(setIsKonicaBranding(true));
    }

    return { user: response } as ILoginResponse;
  },
);

export const refreshTokenThunk = createAsyncThunk<
  ILoginResponse | undefined,
  boolean | undefined,
  { rejectValue: { message: string } | null }
>('authReducer/refreshTokenThunk', async (_, { rejectWithValue }) => {
  const accessToken: string = getStorage(EStorageKeys.TOKENS) as string;
  const decoded = CryptoJS.enc.Hex.parse(accessToken).toString(
    CryptoJS.enc.Utf8,
  );

  if (!decoded) {
    return rejectWithValue(null);
  }

  const users: IUser[] = await new Promise((resolve) =>
    setTimeout(() => resolve(usersData || []), 500),
  );

  const response = users.find((user) => user.username === decoded);

  if (!response) {
    removeStorage(EStorageKeys.TOKENS);
    return rejectWithValue({ message: 'Refresh error' });
  }

  return { user: response } as ILoginResponse;
});
