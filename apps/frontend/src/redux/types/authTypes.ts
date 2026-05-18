import { SerializedError } from '@reduxjs/toolkit';
import { IUser } from '../../models/User';

export enum ELinkType {
  INVITE = 'invite',
  RESET = 'reset',
}

export interface ILoginRequestData {
  username: string;
  password: string;
}

export interface ILoginResponse {
  user: IUser;
  access?: { accessToken: string; refreshToken: string };
}

export interface IInitialState {
  isUserLogged: boolean;
  user: IUser | null;
  isPending: boolean;
  isAdmin: boolean;
  error: { message: string } | null;
  unexpectedError: SerializedError | null;
  tokenIsRefreshing: boolean;
  tokenRefreshFailed: boolean;
}
