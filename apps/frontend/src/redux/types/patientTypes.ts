import { SerializedError } from '@reduxjs/toolkit';
import { IPatient } from '../../models/Patient';

export interface IPatientsInitialState {
  patients: IPatient[];
  count: number;
  isFetching: boolean;
  error: { message: string } | null;
}

export interface IGetPatientInitialState {
  patient: Omit<IPatient, 'timer'>;
  isFetching: boolean;
  error: { message: string } | null;
}

export type TPatientReducerInitialState = {
  getPatients: IPatientsInitialState;
  getPatient: IGetPatientInitialState;
  unexpectedError: SerializedError | null;
};
