import { ERadiologyTypeColor } from '../../models/enums';

export interface IPanelArrConfig {
  id: number;
  title: string;
  info: string;
  size: number;
  getComponent: (handleExpand: (id: number) => void) => JSX.Element;
}

export interface IInsightDailyConfig {
  icon: string;
  title: string;
  value: string;
}

export interface IGrowhChart {
  type: keyof typeof ERadiologyTypeColor;
  value: number;
  opacityPercent?: number;
}
