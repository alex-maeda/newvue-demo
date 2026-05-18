import Accuracy from './Components/Accuracy';
import Compliance from './Components/Compliance';
import Financial from './Components/Financial';
import PerformanceTrends from './Components/PerformanceTrends';
import ProfessionalGrowth from './Components/ProfessionalGrowth';
import { IGrowhChart, IInsightDailyConfig, IPanelArrConfig } from './types';

export const panelArrConfig: IPanelArrConfig[] = [
  {
    id: 1,
    title: 'Performance trends',
    info: 'Performance trends',
    size: 16,
    getComponent: (handleExpand) => (
      <PerformanceTrends onExpand={() => handleExpand(1)} />
    ),
  },
  {
    id: 2,
    title: 'Professional growth',
    info: 'Professional growth',
    size: 8,
    getComponent: () => <ProfessionalGrowth />,
  },
  {
    id: 3,
    title: 'Compliance',
    info: 'Compliance',
    size: 8,
    getComponent: () => <Compliance />,
  },
  {
    id: 4,
    title: 'Financial',
    info: 'Financial',
    size: 8,
    getComponent: () => <Financial />,
  },
  {
    id: 5,
    title: 'Accuracy',
    info: 'Accuracy',
    size: 8,
    getComponent: () => <Accuracy />,
  },
];

export const insightDailyConfig: IInsightDailyConfig[] = [
  {
    icon: 'microphone',
    title: 'Exam Read',
    value: '37',
  },
  {
    icon: 'warning',
    title: 'Unresolved',
    value: '4',
  },
  {
    icon: 'speedometer',
    title: 'RVUs Logged',
    value: '68.2',
  },
  {
    icon: 'personalCard',
    title: 'Exams Assigned to Me',
    value: '12',
  },
];

export const chartGrowhData: IGrowhChart[] = [
  {
    type: 'XR',
    value: 10,
    opacityPercent: 0,
  },
  {
    type: 'CT',
    value: 29,
    opacityPercent: 0,
  },
  {
    type: 'MR',
    value: 60,
    opacityPercent: 0,
  },
  {
    type: 'US',
    value: 15,
    opacityPercent: 0,
  },
  {
    type: 'NM',
    value: 25,
    opacityPercent: 0,
  },
  {
    type: 'MG',
    value: 13,
    opacityPercent: 0,
  },
  {
    type: 'PT',
    value: 25,
    opacityPercent: 0,
  },
];

export const reportingTime: IGrowhChart[] = [
  {
    type: 'XR',
    value: 10,
  },
  {
    type: 'CT',
    value: 22,
  },
  {
    type: 'MR',
    value: 43,
  },
  {
    type: 'US',
    value: 11,
  },
  {
    type: 'NM',
    value: 16,
  },
  {
    type: 'MG',
    value: 18,
  },
  {
    type: 'PT',
    value: 23,
  },
];

// ------- Heatmap utils -------
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hours = [
  '08:00 PM',
  '07:00 PM',
  '06:00 PM',
  '05:00 PM',
  '04:00 PM',
  '03:00 PM',
  '02:00 PM',
  '01:00 PM',
  '12:00 PM',
  '11:00 AM',
  '10:00 AM',
  '09:00 AM',
  '08:00 AM',
];

const generateData = () => {
  const data: {
    day: string;
    hours: string;
    'RVU/Hour': number;
  }[] = [];

  days.forEach((day) => {
    hours.forEach((hour) => {
      data.push({
        day,
        hours: hour,
        'RVU/Hour': +(Math.random() * 5).toFixed(2),
      });
    });
  });

  return data;
};

export const configHeatmap = {
  width: 630,
  height: 280,
  autoFit: true,
  data: generateData(),
  xField: 'day',
  yField: 'hours',
  colorField: 'RVU/Hour',
  color: [
    '#a1d103b3',
    '#a1d10399',
    '#a1d10380',
    '#a1d10366',
    '#a1d1034d',
    '#a1d10333',
    '#a1d1031a',
    '#a1d1030d',
  ],
  meta: {
    'RVU/Hour': {
      type: 'cat',
    },
  },
  heatmapStyle: {
    stroke: '#1C2025',
  },
};
