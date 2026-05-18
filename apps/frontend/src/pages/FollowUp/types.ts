export enum EMenuItem {
  PEER_FEEDBACK = 'Peer Feedback',
  FINDING_DELIVERY = 'Finding Delivery',
  FOLLOW_UP_REQUESTS = 'Follow-up Requests',
  ER_EVENTS = 'ER Events',
  EXAM_ISSUES = 'Exam Issues',
  ACTIONABLE_FEEDBACK = 'Actionable Feedback',
}

export interface IMenuConfig {
  title: EMenuItem;
  count: string | number;
}

export type TTimeLineConfig = {
  icon: string;
  title: string;
};
