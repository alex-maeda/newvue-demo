import {
  ColorEnum,
  EPatientsSex,
  EPatientMode,
  ENoteType,
  PriorityEnum,
} from './enums';

export interface IPatient {
  id: number;
  priority: PriorityEnum;
  timer: number;
  timerOverride?: number;
  firstName: string;
  lastName: string;
  name?: string;
  DOB: string;
  MRN: string;
  lock: boolean;
  color?: ColorEnum;
  specialty: string;
  bodyPart: string;
  accession: number | string;
  modality: string;
  examDescription: string;
  examDate: string;
  assignedTo: string;
  refPhysicianPhoneNumber: string;
  sex: EPatientsSex;
  examStatus: string;
  insuranceProvider: string;
  currentPatientLocation: string;
  reasonForExam: string;
  sectionId: number[];
  age?: string;
  examCompleted: string;
  clinicalIndications: string;
  mode?: EPatientMode;
  allergies: string[];
  orderedBy: string;
  orderedLocation: string;
  facilityName: string;
  facilityCode: string;
  performedBy: string;
  referredBy: string;
  insurancePlan: string;
  patientsNote?: IPatientsNote[];
  patientLink?: string;
  users: string[];
  isSummaryEnabled?: boolean;
  isErikEnabled?: boolean;
  isEdPreliminaryEnabled?: boolean;
  isPeerReviewEnabled?: boolean;
}

export interface IPatientsNote {
  type: ENoteType;
  note: string;
  physician: string;
  DOB: string;
}

export interface IPatientObj {
  [k: string]: IPatient;
}
