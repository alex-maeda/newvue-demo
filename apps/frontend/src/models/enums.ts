export enum EStorageKeys {
  VERSION = 'version',
  TOKENS = 'newvue-tokens',
  USERNAME = 'username',
  NAME = 'name',
  USER_WORKLIST = 'user_worklist',
  WORKLISTS = 'worklists',
  CHECKED_FILTERS = 'checked_filters',
  CURRENT_SECTION = 'current_section',
  INSURANCE_PLANS_CORRESPOND = 'insurance_plans_correspond',
  WORKLIST_CORRESPOND = 'worklist_correspond',
  SPECIALTIES_CORRESPOND = 'specialties_correspond',
  ORDERING_PHYSYICIAN_CORRESPOND = 'ordering_physician_correspond',
  JOBS = 'jobs',
}

export enum ERole {
  ADMIN = 'admin',
  USER = 'user',
}

export enum ColorEnum {
  BLUE = 'blue',
  RED = 'red',
  ORANGE = 'orange',
  YELLOW = 'yellow',
  GREEN = 'green',
  PURPLE = 'purple',
}

export enum PriorityEnum {
  INPATIENT = 'Inpatient',
  ER = 'ER',
  STAT = 'Stat',
  OUTPATIENT = 'Outpatient',
  HOLD = 'Hold',
  STROKE = 'Stroke',
}

export enum EChatType {
  CHAT = 'chat',
  ALERT = 'alert',
}

export enum ELoginFieldsName {
  NAME = 'username',
  PASSWORD = 'password',
}

export enum EPatientsSex {
  MALE = 'M',
  FEMALE = 'F',
  UNDEFINED = '',
}

export enum EWheelMenuItemName {
  FINDINGS_DELIVERY = 'Findings Delivery',
  INCIDENTAL_FINDINGS = 'Incidental Findings',
  PEER_LEARNING = 'Peer Learning',
  TEACHING_FILES = 'Teaching Files',
  IMAGE_QA = 'Image QA',
}

export enum EConsiderationItemName {
  AI_FINDINGS = 'aiFindings',
  COMMON_FINDINGS = 'commonFindings',
  DIFFERENTIAL_DIAGNOSIS = 'differentialDiagnosis',
  COMMONLY_MISSED = 'commonlyMissed',
  REFERENCES = 'reference',
}

export enum EInfoMenuType {
  TABLE_INFO = 'table',
  CLINICAL_INFO = 'clinical',
}

export enum ENotificationsType {
  SUCCESS = 'success',
  ERROR = 'error',
  INFO = 'info',
  WARNING = 'warning',
}

export enum ERate {
  LIKE = 'like',
  DISLIKE = 'dislike',
  NOT_RATE = 'not_rate',
}

export enum EExaminations {
  SUMMARY = 'summary',
  RADIOLOGY = 'radiologyReport',
  PROBLEM_LIST = 'problemList',
  PHYSICIAN_NOTES = 'physicianNotes',
  MEDICATIONS = 'medications',
  SURGICAL_HISTORY = 'surgicalHistory',
  LAB_RESULT = 'labResults',
  PATHOLOGY = 'pathalogy',
  AI_RESULTS = 'aiResults',
}

export enum EExamStatus {
  PERFORMED = 'performed',
  REPORTED = 'reported',
  PEER_REVIEWED = 'peerReviewed',
  PEER_LEARNING = 'peerLearning',
  FINALIZE = 'finalize',
  FOLLOW_UP_REQUEST = 'followupRequest',
  ADDENDUM = 'addendum',
  FINDING_DELIVERY = 'findingDelivery',
}

export enum EPatientMode {
  VIEW = 'view',
  REPORT = 'report',
  NORMAL = 'normal',
}

export enum ENoteType {
  ER = 'ER',
  AI = 'AI',
}

export enum EUserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export enum EOperators {
  EQUALS = 'Equals',
  CONTAINS = 'Contains',
  STARTS_WITH = 'Starts with',
  ENDS_WITH = 'Ends with',
  DOES_NOT_CONTAINS = 'Does NOT contain',
  DOES_NOT_EQUAL = 'Does NOT equal',
  LESS_THAN_OR_EQUAL_TO = 'Less than or equal to',
  LESS_THAN = 'Less than',
  GREATER_THAN_OR_EQUAL_TO = 'Greater than or equal to',
  GREATER_THAN = 'Greater than',
}

export enum ETableColumnAccessor {
  actions = 'AVAILABLE ACTlONS',
  examStatus = 'EXAM STATUS',
  examDescription = 'EXAM DESCRIPTION',
  modality = 'MODALITY',
  name = 'PATIENT NAME',
  age = 'PATIENT AGE',
  examCompleted = 'EXAM COMPLETED',
  orderedLocation = 'ORDERED LOCATION',
  clinicalIndications = 'CLINICAL INDICATIONS',
  reasonForExam = 'REASON FOR EXAM',
  specialty = 'SPECIALTY',
  bodyPart = 'BODY PART',
  accession = 'ACCESSION',
  MRN = 'MRN',
  facilityName = 'FACILITY NAME',
  orderedBy = 'ORDERED BY',
  referredBy = 'REFERRED BY',
  performedBy = 'PERFORMED BY',
  assignedTo = 'ASSIGNED TO',
  facilityCode = 'FACILITY CODE',
  insurancePlan = 'INSURANCE PLAN',
  currentPatientLocation = 'CURRENT PATIENT LOCATION',
}

export enum EConditionType {
  OR = 'OR',
  AND = 'AND',
}

export enum EPositionWorkListController {
  RIGHT = 'right',
  BOTTOM = 'bottom',
  FREE = 'free',
}

export enum ERadiologyTypeColor {
  XR = '#888BBD',
  CT = '#82AAD3',
  MR = '#8CC7DE',
  US = '#A8E1E5',
  NM = '#6AE4C7',
  MG = '#6BE082',
  PT = '#A1D103',
}
