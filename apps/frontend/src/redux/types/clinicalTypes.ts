import { SerializedError } from '@reduxjs/toolkit';
import {
  IPatientClinicalHistory,
  TCommonData,
  TConsiderations,
} from '../../models/Consideration';
import { EExaminations } from '../../models/enums';

export interface IConsiderationInitialState {
  considerations: TConsiderations | null;
  isFetching: boolean;
  error: { message: string } | null;
}

export interface IPatientClinicalHistoryState {
  data: IPatientClinicalHistory | null;
  currentExamination: (TCommonData & { type: EExaminations | string }) | null;
  isFetching: boolean;
  error: { message: string } | null;
}

export type TClinicalReducerInitialState = {
  getConsideration: IConsiderationInitialState;
  getPatientClinicalHistory: IPatientClinicalHistoryState;
  unexpectedError: SerializedError | null;
  radiologyReportType: Record<string, 'All reports' | 'Relevant reports'>;
};
