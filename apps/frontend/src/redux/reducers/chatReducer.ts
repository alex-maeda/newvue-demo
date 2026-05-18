import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import {
  INotificationInitialState,
  TChatReducerInitialState,
} from '../types/chatTypes';
import { IChat } from '../../models/Chat';
import { getAlertsListThunk, getChatListThunk } from '../thunks/chatThunk';
import { format } from 'date-fns';
import { ENotificationsType } from '../../models/enums';

export const getUnreadCount = (data: IChat[]) => {
  let unreadCount = 0;
  const chats = data.map((item) => {
    const result = { ...item };
    const { messages } = result;
    const filteredMsg = messages.filter((message) => !message.isReaded);
    result.unreadCount = filteredMsg.length;
    unreadCount += result.unreadCount;
    return result;
  });

  return { chats, unreadCount };
};

export const initialState: TChatReducerInitialState = {
  getChats: {
    chats: [],
    unreadCount: 0,
    isFetching: false,
    error: null,
    isShowLarge: false,
    isShowSmall: false,
  },

  getAlerts: {
    alerts: [],
    unreadCount: 0,
    isFetching: false,
    error: null,
  },

  getNotifications: {
    title: '',
    description: '',
    type: ENotificationsType.SUCCESS,
  },

  unexpectedError: null,
};

const ChatReducer = createSlice({
  name: 'Chat',
  initialState,
  reducers: {
    resetChatError({ getChats, getAlerts }) {
      getChats.error = null;
      getAlerts.error = null;
    },
    addExpirationTimerAlert(
      { getAlerts },
      action: PayloadAction<{ id: number; name: string }>,
    ) {
      const { name, id } = action.payload;
      getAlerts.alerts.unshift({
        usersOrTitle: 'System',
        isGroup: false,
        isOnline: false,
        messages: [
          {
            text: `Patient ${name} with id ${id} timer was expired`,
            timestamp: format(new Date(), 'yyyy.MM.dd HH:mm'),
          },
        ],
      });
      getAlerts.unreadCount += 1;
    },
    addNotificationAlert(
      state,
      action: PayloadAction<INotificationInitialState>,
    ) {
      const { title } = action.payload;
      state.getAlerts.alerts.unshift({
        usersOrTitle: 'System',
        isGroup: false,
        isOnline: false,
        messages: [
          {
            text: title,
            timestamp: format(new Date(), 'yyyy.MM.dd HH:mm'),
          },
        ],
      });
      state.getAlerts.unreadCount += 1;
      state.getNotifications = action.payload;
    },
    resetNotification(state) {
      state.getNotifications = initialState.getNotifications;
    },
    showChatInLargeFormat({ getChats }) {
      getChats.isShowLarge = true;
      getChats.isShowSmall = false;
    },
    showChatInSmallFormat({ getChats }) {
      getChats.isShowLarge = false;
      getChats.isShowSmall = true;
    },
    closeChat({ getChats }) {
      getChats.isShowLarge = false;
      getChats.isShowSmall = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getChatListThunk.pending, ({ getChats }) => {
        getChats.isFetching = true;
        getChats.chats = [];
      })
      .addCase(getChatListThunk.fulfilled, ({ getChats }, action) => {
        if (action.payload) {
          const { chats, unreadCount } = getUnreadCount(action.payload);
          getChats.chats = chats;
          getChats.unreadCount = unreadCount;
        }
        getChats.isFetching = false;
      })
      .addCase(getAlertsListThunk.pending, ({ getAlerts }) => {
        getAlerts.isFetching = true;
        getAlerts.alerts = [];
      })
      .addCase(getAlertsListThunk.fulfilled, ({ getAlerts }, action) => {
        if (action.payload) {
          getAlerts.alerts = action.payload;
          getAlerts.unreadCount = action.payload.length;
        }
        getAlerts.isFetching = false;
      });
  },
});

export const {
  resetChatError,
  addExpirationTimerAlert,
  addNotificationAlert,
  resetNotification,
  showChatInLargeFormat,
  showChatInSmallFormat,
  closeChat,
} = ChatReducer.actions;

export default ChatReducer.reducer;
