export interface IAchievementsConfig {
  icon: string;
  title: string;
  value: number;
  total: number;
}

export const achieveConfig: IAchievementsConfig[] = [
  {
    icon: 'noteBone',
    title: 'Read Complex Exams',
    value: 2,
    total: 2,
  },
  {
    icon: 'chat',
    title: 'Completed Consultations',
    value: 0,
    total: 1,
  },
  {
    icon: 'timer',
    title: 'STAT Exams with SLA',
    value: 7,
    total: 10,
  },
  {
    icon: 'note',
    title: 'Completed a peer review',
    value: 1,
    total: 2,
  },
  {
    icon: 'hat',
    title: 'Educational Activities',
    value: 1,
    total: 1,
  },
  {
    icon: 'monitor',
    title: 'Overflow Coverage',
    value: 0,
    total: 1,
  },
  {
    icon: 'check',
    title: 'AI Finding Accuracy Rated',
    value: 3,
    total: 3,
  },
  {
    icon: 'target',
    title: 'AI Suggestions Used',
    value: 3,
    total: 5,
  },
];
