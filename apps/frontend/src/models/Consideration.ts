import { EConsiderationItemName, EExaminations } from './enums';

export type TConsiderations = Record<string, TConsideration>;

export type TConsideration = Record<
  EConsiderationItemName,
  { title: string; info: string }[] | null
>;

export type TCommonData = {
  id?: number;
  date: string;
  title: string;
  accession?: string;
  description?: string[];
  abbreviation?: string;
};

export type TSurgicalHistory = TCommonData & {
  laterality?: string;
};

export type TLabTest = {
  test: string;
  values: (string | number)[];
  delta?: string | number;
  trend?: string;
};

export type TLabPanel = {
  panelName: string;
  dates: string[];
  tests: TLabTest[];
};

export type TLabResults = {
  id: number;
  date: string;
  title: string;
  panels: TLabPanel[];
};

export type TVisitHistory = TCommonData & {
  type: EExaminations | string;
  class: string;
  abbreviation?: string;
};

export type TProblemList = {
  status: string;
  text: string;
  recorded?: string;
};

export type TAIResults = {
  title: string;
  options: string[];
};

export type TPhysicianNotes = {
  noteDescription: string;
  noteInfo: {
    name: string;
    description: string;
  }[];
};

export type TMedications = {
  dose: string;
  medication: string;
};
export type TSummaryData = {
  purposeOfStudy?: string;
  criticalFindings?: string[];
  higherPriority?: string[];
  lowerUrgency?: string[];
  provenanceReportIds?: number[];
  problemSummary?: string[];
};

export type TRadiologyDecision = {
  finding: string;
  region: string;
  severity: number;
  trend: string;
  include: boolean;
  reason: string;
  sources: string;
};

export type TProblemDecision = {
  problem: string;
  include: boolean;
  score: number;
  essential: boolean;
  body_region: boolean;
  recent: boolean;
  active: boolean;
  sources: string[];
};

export interface IPatientClinicalHistoryResponse {
  visitHistory: Record<string, TVisitHistory[]>;
  problemList: Record<string, TProblemList[]>;
  medications: Record<string, TMedications[]>;
  chartAndSummary: Record<string, TSummaryData>;
  aiResults: Record<string, TAIResults[]>;
  radiologyDecisions: Record<string, TRadiologyDecision[]>;
  problemDecisions: Record<string, TProblemDecision[]>;
  statedPurpose: Record<string, string>;
  surgicalHistory: TSurgicalHistory[];
  labResults: Record<string, TLabResults[]>;
}

export interface IPatientClinicalHistory
  extends Omit<IPatientClinicalHistoryResponse, 'visitHistory' | 'labResults'> {
  visitHistory: TVisitHistory[];
  physicianNotes: TCommonData[];
  surgicalHistory: TSurgicalHistory[];
  labResults: TLabResults[];
  pathalogy: TCommonData[];
  radiologyReport: TCommonData[];
  radiologyDecisions: Record<string, TRadiologyDecision[]>;
  problemDecisions: Record<string, TProblemDecision[]>;
  statedPurpose: Record<string, string>;
}
