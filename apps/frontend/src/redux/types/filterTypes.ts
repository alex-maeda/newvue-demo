import { IFilter } from '../../models/Filter';

export type TFiltersReducerInitialState = {
  filters: IFilter[];
  checkedFilters: IFilter[];
  searchQuery: string;
  searchClinicalQuery: string;
  linkedFilterIds: number[];
  currentFilterId: number;
  lastCheckedFilterId: string;
  count: number;
  isFetching: boolean;
  error: { message: string } | null;
};
