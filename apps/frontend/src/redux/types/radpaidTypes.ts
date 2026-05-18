export interface IInitialRadpaidState {
  isFetching: boolean;
  isReportCreated: boolean;
  accessToken: string | null;
  isSocketConnected: boolean;
  reportUpdates: Record<string, string | undefined>;
  createdReportId: string;
  error?: string;
}

export interface IReportUpdate {
  final_report: string;
  report_id: string;
  update_type: 'update' | 'sign' | 'approve';
  final_report_html: string;
}

export interface IReportCreate {
  study: string;
  clinical_history: string;
  comparison: string;
  contrast: string;
  laterality: string;
  views: number;
}
