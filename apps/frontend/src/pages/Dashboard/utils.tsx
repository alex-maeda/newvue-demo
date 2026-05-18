import Achievements from './Components/Achievements';
import RVUHour from './Components/RVUHour';
import RVUModality from './Components/RVUModality';
import Recognition from './Components/Recognition';
import {
  IChart,
  IGraph,
  IInsightDailyConfig,
  IPanelArrConfig,
  IScheduledArrConfig,
} from './types';

export const panelArrConfig: IPanelArrConfig[] = [
  {
    id: 1,
    title: 'Recognition',
    info: '',
    component: <Recognition />,
  },
  {
    id: 2,
    title: 'Achievements',
    info: 'Achievements',
    component: <Achievements />,
  },
  {
    id: 3,
    title: 'RVUs By Hour',
    info: 'RVUs By Hour',
    component: <RVUHour />,
  },
  {
    id: 4,
    title: 'RVUs By Modality',
    info: 'RVUs By Modality',
    component: <RVUModality />,
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

export const chartHourData: IGraph[] = [
  { hour: '01:00', value: 5.5 },
  { hour: '02:00', value: 3.2 },
  { hour: '03:00', value: 1 },
  { hour: '04:00', value: 13.5 },
  { hour: '05:00', value: 1 },
  { hour: '06:00', value: 7.8 },
  { hour: '07:00', value: 4.4 },
  { hour: '08:00', value: 1 },
  { hour: '09:00', value: 0.9 },
  { hour: '10:00', value: 1 },
  { hour: '11:00', value: 27.5 },
  { hour: '12:00', value: 8.6 },
  { hour: '13:00', value: 1 },
  { hour: '14:00', value: 5.4 },
  { hour: '15:00', value: 1 },
  { hour: '16:00', value: 13.5 },
  { hour: '17:00', value: 2.3 },
  { hour: '18:00', value: 1 },
  { hour: '19:00', value: 0.9 },
  { hour: '20:00', value: 1 },
  { hour: '21:00', value: 4.5 },
  { hour: '22:00', value: 1 },
  { hour: '23:00', value: 9.6 },
  { hour: '24:00', value: 3.2 },
];

export const chartModalityData: IChart[] = [
  {
    type: 'XR',
    value: 35,
  },
  {
    type: 'CT',
    value: 46,
  },
  {
    type: 'MR',
    value: 19,
  },
  {
    type: 'US',
    value: 0,
  },
  {
    type: 'NM',
    value: 0,
  },
  {
    type: 'MG',
    value: 0,
  },
  {
    type: 'PT',
    value: 0,
  },
];

export const scheduledArrConfig: IScheduledArrConfig[] = [
  {
    status: 'red',
    title: 'ER Mercy Hospital',
    time: '9:00 - 12:00',
  },
  {
    status: 'purple',
    title: 'Lunch',
    time: '12:00 - 13:00',
  },
  {
    status: 'green',
    title: 'Conference Preparation',
    time: '13:00 - 14:00',
  },
  {
    status: 'blue',
    title: 'Neuroradiology',
    time: '14:00 - 17:00',
  },
];
