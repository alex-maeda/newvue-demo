export interface IPanelArrConfig {
  id: number;
  title: string;
  info: string;
  component: JSX.Element;
}

export interface IInsightDailyConfig {
  icon: string;
  title: string;
  value: string;
}

export interface IScheduledArrConfig {
  status: string;
  title: string;
  time: string;
}

export interface IChart {
  type: string;
  value: number;
}

export interface IGraph {
  hour: string;
  value: number;
}
