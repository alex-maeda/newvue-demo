import { IFilter, TColumnSetting } from '../../models/Filter';
import { IJob } from '../../models/Job';
import { IPatient } from '../../models/Patient';
import { IUser } from '../../models/User';

export type TCorrespondData = {
  [key in string]: boolean | string;
};

export interface IGetColumnsInitialState {
  columnSettings: TColumnSetting[];
  isFetching: boolean;
  error: { message: string } | null;
}

export interface IGetWorklistsInitialState {
  worklists: IFilter[];
  currentWorklist: IFilter;
  isFetching: boolean;
  error: { message: string } | null;
}

export interface IGetJobsInitialState {
  jobs: IJob[];
  currentJob: IJob;
  isFetching: boolean;
  error: { message: string } | null;
}
export interface IFiltersConfig {
  [k: string]: {
    [k: string]: Array<string | number>;
  };
}

export interface IFiltersSettings {
  [id: string | number]: {
    filtersAll: IFiltersConfig;
    filtersAny: IFiltersConfig[];
  };
}

export interface IFilteredData {
  [k: string]: IPatient[];
}

export interface IWorklistsSettingsInitialState {
  availableFiltersData: {
    filters: { [k: string]: Array<string | number> };
    isFetching: boolean;
    error: { message: string } | null;
  };
  filtersSettings: IFiltersSettings;
  filteredData: IFilteredData;
}

export interface IUserInitialState {
  usersList: IUser[] | null;
  worklistCorrespondData: TCorrespondData[];
  insurancePlansCorrespondData: TCorrespondData[];
  specialtiesCorrespondData: TCorrespondData[];
  orderingPhysicianCorrespondData: TCorrespondData[];
  selectedUser: IUser;
  isFetching: boolean;
  isTableFetching: boolean;
  error: { message: string } | null;
  getColumnSetting: IGetColumnsInitialState;
  getWorklists: IGetWorklistsInitialState;
  settingsFilters: IWorklistsSettingsInitialState;
  getJobs: IGetJobsInitialState;
}
