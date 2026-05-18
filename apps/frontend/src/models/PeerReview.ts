import { IUpdatePatient } from '../redux/types/followUpTypes';

export type TPeerReview = Record<
  string,
  {
    score: number;
    meaning: string;
    sub?: Record<string, string>;
  }
>;

export type TPeerReviewSaved = {
  score: string;
  meaning: string;
  subOption: string;
  comment: string;
  isRequired?: string;
  reviewer?: string;
  userFeedback?: string;
};

export type TPeerFeedback = TPeerReviewSaved & IUpdatePatient;

export type TFollowupRequestSaved = {
  phoneNumber: string;
  refPhysicianPhoneNumber: string;
  meaning: string;
  radiologist: string;
  keyFinding: string;
  orderingPhysician: string;
  orderingPhysicianPhone: string;
  studyDescription: string;
  studyDate: string;
  patientName: string;
  examDescription: string;
  examDate: string;
};

export type TFollowupRequest = TFollowupRequestSaved & IUpdatePatient;

export type TFindingDeliveryRequestSaved = {
  // patientName: string;
  // MRN: string;
  // accession: string;
  // modality: string;
  findingSeverity: string;
  comment?: string;
  time?: Date;
};

export type TFindingDeliveryRequest = TFindingDeliveryRequestSaved &
  IUpdatePatient;
