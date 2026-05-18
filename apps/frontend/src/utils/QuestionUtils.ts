export interface IQuestionsConfig {
  score: number | string;
  meaning: string;
}

export const peerLearningQuestions: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Great call',
  },
  {
    score: 2,
    meaning: 'Difficult case',
  },
  {
    score: 3,
    meaning: 'General learning opportunity',
  },
];

export const preliminaryQuestions: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'No findings - exam is normal',
  },
  {
    score: 2,
    meaning: 'Abnormal exam',
  },
];

export const findingsDeliveryQuestions: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Incidental or Unexpected Finding',
  },
  {
    score: 2,
    meaning: 'Urgent Finding',
  },
  {
    score: 3,
    meaning: 'Critical Finding',
  },
];

export const deliveryMethodConfig: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Contacted provider directly',
  },
  {
    score: 2,
    meaning: 'Connected provider to radiologist',
  },
  {
    score: 3,
    meaning: 'Attempted delivery - will retry',
  },
  {
    score: 4,
    meaning: 'Delivery confirmed by other means',
  },
];

export const edOverReadQuestions: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'No discrepancies',
  },
  {
    score: 2,
    meaning: 'Preliminary finding not entered',
  },
  {
    score: 3,
    meaning: 'Discrepancy with preliminary finding',
  },
];

export const peerReviewQuestions: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Concur with interpretation',
  },
  {
    score: 2,
    meaning:
      'Discrepancy in interpretation / not ordinarily expected to be made',
  },
  {
    score: 3,
    meaning: 'Discrepancy in interpretation / should be made most of the time',
  },
];

export const peerReviewQuestionsSecondBlock: IQuestionsConfig[] = [
  {
    score: 'A',
    meaning: 'Unlikely to be clinically significant',
  },
  {
    score: 'B',
    meaning: 'Likely to be clinically significant',
  },
];

export const questionsConfigYesOrNo: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Yes',
  },
  {
    score: 2,
    meaning: 'No',
  },
];

export const followUpQuestionSecondBlock: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Exam scheduled with patient',
  },
  {
    score: 2,
    meaning: 'Patient declined exam',
  },
  {
    score: 3,
    meaning: 'Outreach attempted',
  },
  {
    score: 4,
    meaning: 'Contacted ordering physician',
  },
];

export const followUpQuestionThirdBlock: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Notify the radiologist and request additional information',
  },
  {
    score: 2,
    meaning: 'Contacted ordering physician',
  },
  {
    score: 3,
    meaning: 'Contacted patient',
  },
];

export const optionalExamQualityQuestion: IQuestionsConfig[] = [
  {
    score: 1,
    meaning: 'Motion',
  },
  {
    score: 2,
    meaning: 'Artifacts',
  },
  {
    score: 3,
    meaning: 'Poor positioning',
  },
  {
    score: 4,
    meaning: 'Missing markers',
  },
  {
    score: 5,
    meaning: 'Excessive radition dose',
  },
  {
    score: 6,
    meaning: 'Missing anatomy',
  },
  {
    score: 7,
    meaning: 'Other - see comment',
  },
];
