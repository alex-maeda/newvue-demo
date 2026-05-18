import { createAsyncThunk } from '@reduxjs/toolkit';
import chatData from '../fakeApi/chat.json';
import alertData from '../fakeApi/alert.json';

import { IChat, IAlert } from '../../models/Chat';

export const getChatListThunk = createAsyncThunk<IChat[]>(
  'users/getChatList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => resolve(chatData || []), 1000),
    );
  },
);

export const getAlertsListThunk = createAsyncThunk<IAlert[]>(
  'users/getAlertsList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => resolve(alertData), 1000),
    );
  },
);
