import { SerializedError } from '@reduxjs/toolkit';
import { IAlert, IChat } from '../../models/Chat';
import { ENotificationsType } from '../../models/enums';

export interface IChatsInitialState {
  chats: IChat[];
  unreadCount: number;
  isFetching: boolean;
  error: { message: string } | null;
  isShowLarge: boolean;
  isShowSmall: boolean;
}

export interface IAlertsListInitialState {
  alerts: IAlert[];
  unreadCount: number;
  isFetching: boolean;
  error: { message: string } | null;
}

export interface INotificationInitialState {
  title: string;
  description: string;
  type: ENotificationsType;
}

export type TChatReducerInitialState = {
  getChats: IChatsInitialState;
  getAlerts: IAlertsListInitialState;
  getNotifications: INotificationInitialState;
  unexpectedError: SerializedError | null;
};
