import { IPatient } from '../../models/Patient';
import {
  TFindingDeliveryRequest,
  TFollowupRequest,
  TPeerFeedback,
  TPeerReviewSaved,
} from '../../models/PeerReview';
import { EExamStatus } from '../../models/enums';

export type TExamHistory = {
  id?: number;
  type: EExamStatus;
  date: string;
  data?:
    | { reportText: string }
    | TPeerReviewSaved
    | TFollowupRequest
    | TFindingDeliveryRequest;
};

export type TReportData = {
  type: EExamStatus;
  date: string;
  data: { reportText: string };
};

export interface IUpdatePatient extends Omit<IPatient, 'timer'> {
  prevType?: string;
}
export interface IPatientPeerReviewResult {
  patientData: IUpdatePatient;
  examHistory: TExamHistory[];
}

export type TPatientReviewResult = Record<string, IPatientPeerReviewResult>;
export type TPatientHistoryResult = Record<
  string,
  { examHistory: TExamHistory[] }
>;

export interface TFollowUpReducerInitialState {
  isFetching: boolean;
  openedPeerReview: boolean;
  openedPeerLearning: boolean;
  openedPreliminary: boolean;
  openedEDOverRead: boolean;
  openedExamQualityFeedback: boolean;
  openedFindingsDeliveryFeedback: boolean;
  preliminaryInfo: {
    physician: string | null;
    preliminary: string | null;
    comment: string | null;
    date: string | null;
  };
  currentPatientId: string;
  followUpData: TPatientReviewResult;
  peerFeedback: TPeerFeedback[];
  actionableFeedback: TPeerFeedback[];
  followupRequest: TFollowupRequest[];
  findingDelivery: TFindingDeliveryRequest[];
  selectedPatientFromWorklist: IPatient | null;
}
