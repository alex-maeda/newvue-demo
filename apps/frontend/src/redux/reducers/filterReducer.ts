import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { getStorage, removeStorage, setStorage } from '../../utils/StorageUtil';
import { IFilter } from '../../models/Filter';
import { EStorageKeys } from '../../models/enums';
import { TFiltersReducerInitialState } from '../types/filterTypes';
import { getFiltersListThunk } from '../thunks/filterThunk';

export const initialState: TFiltersReducerInitialState = {
  count: -1,
  filters: [],
  searchQuery: '',
  searchClinicalQuery: '',
  linkedFilterIds: [],
  checkedFilters: [],
  currentFilterId: 0,
  lastCheckedFilterId: '',
  isFetching: false,
  error: null,
};

const FilterReducer = createSlice({
  name: 'Filters',
  initialState,
  reducers: {
    resetFiltersError(state) {
      state.error = null;
    },
    moveFilters(state, action) {
      state.filters = action.payload;
      const userName = getStorage(EStorageKeys.USERNAME) as string;
      const filters = getStorage<Record<string, IFilter[]>>(
        EStorageKeys.USER_WORKLIST,
      ) as Record<string, IFilter[]>;
      setStorage<Record<string, IFilter[]>>(EStorageKeys.USER_WORKLIST, {
        ...filters,
        [userName]: action.payload,
      });
    },
    getStorageCheckedFilters(state) {
      const userName = getStorage(EStorageKeys.USERNAME) as string;
      state.checkedFilters =
        (
          getStorage<Record<string, IFilter[]>>(
            EStorageKeys.CHECKED_FILTERS,
          ) as Record<string, IFilter[]>
        )?.[userName] || [];
    },
    storeCheckedFilters(state, action) {
      state.checkedFilters = action.payload;
      const userName = getStorage(EStorageKeys.USERNAME) as string;
      const filters = getStorage<Record<string, IFilter[]>>(
        EStorageKeys.USER_WORKLIST,
      ) as Record<string, IFilter[]>;
      const checkedFilters = getStorage<Record<string, IFilter[]>>(
        EStorageKeys.CHECKED_FILTERS,
      ) as Record<string, IFilter[]>;
      setStorage<Record<string, IFilter[]>>(EStorageKeys.CHECKED_FILTERS, {
        ...checkedFilters,
        [userName]: state.checkedFilters,
      });
      setStorage<Record<string, IFilter[]>>(EStorageKeys.USER_WORKLIST, {
        ...filters,
        [userName]: state.filters,
      });
    },
    storeFiltersSettings(
      state,
      action: PayloadAction<{
        filterId: string;
        sorting: SortingState;
        filters: ColumnFiltersState;
      }>,
    ) {
      const { sorting, filters, filterId } = action.payload;
      state.checkedFilters = state.checkedFilters.map((filter) => {
        const newFilter = { ...filter };
        if (filter.id === filterId) {
          newFilter.settings = {
            columnSettings: newFilter.settings?.columnSettings || [],
            userGroupsRights: newFilter.settings?.userGroupsRights || [],
            usersRights: newFilter.settings?.usersRights || [],
            sorting,
            filters,
          };
        }
        return newFilter;
      });
      const checkedFilters = getStorage<Record<string, IFilter[]>>(
        EStorageKeys.CHECKED_FILTERS,
      ) as Record<string, IFilter[]>;
      const userName = getStorage(EStorageKeys.USERNAME) as string;
      setStorage<Record<string, IFilter[]>>(EStorageKeys.CHECKED_FILTERS, {
        ...checkedFilters,
        [userName]: state.checkedFilters,
      });
    },
    setFiltersCombine(state, action) {
      const id = action.payload;
      const currentFilter = state.filters.find((filter) => filter.id === id);
      if (!currentFilter) {
        return;
      }
      const oldCombine = !!currentFilter.isCombine;
      state.filters = state.filters.map((filter) => {
        const oldFilter = { ...filter };
        if (filter.id === id) {
          return {
            ...filter,
            isCombine: !filter.isCombine,
          };
        }
        return oldFilter;
      });
      let isChecked = false;
      state.checkedFilters = state.checkedFilters.map((filter) => {
        const newFilter = { ...filter };
        if (filter.id === id) {
          newFilter.isCombine = !oldCombine;
          isChecked = true;
        }
        return newFilter;
      });
      if (!isChecked && !oldCombine) {
        state.checkedFilters.push(currentFilter);
      }
      const userName = getStorage(EStorageKeys.USERNAME) as string;
      const userWorklst = getStorage<Record<string, IFilter[]>>(
        EStorageKeys.USER_WORKLIST,
      ) as Record<string, IFilter[]>;
      const checkedFilters = getStorage<Record<string, IFilter[]>>(
        EStorageKeys.CHECKED_FILTERS,
      ) as Record<string, IFilter[]>;
      setStorage<Record<string, IFilter[]>>(EStorageKeys.USER_WORKLIST, {
        ...userWorklst,
        [userName]: state.filters,
      });
      setStorage<Record<string, IFilter[]>>(EStorageKeys.CHECKED_FILTERS, {
        ...checkedFilters,
        [userName]: state.checkedFilters,
      });
    },
    getSearchResult(state, action) {
      const searchQuery = action.payload.toLowerCase();
      state.searchQuery = searchQuery;
    },
    resetSearchResult(state) {
      state.searchQuery = '';
    },
    getSearchClinicalResult(state, action) {
      const searchQuery = action.payload.toLowerCase();
      state.searchClinicalQuery = searchQuery;
    },
    resetSearchClinicalResult(state) {
      state.searchClinicalQuery = '';
    },
    getLinkedResult(state) {
      const isCombinedArray = state.checkedFilters
        .filter((i) => i.isCombine)
        .map((i) => +i.id);

      state.linkedFilterIds = isCombinedArray;
    },
    resetLinkedResult(state) {
      state.linkedFilterIds = [];
    },
    setCurrentFilterId(state, action: PayloadAction<number>) {
      state.currentFilterId = action.payload;
      setStorage<IFilter[]>(EStorageKeys.CURRENT_SECTION, action.payload);
    },
    resetCurrentFilterId(state) {
      state.currentFilterId = 0;
      removeStorage(EStorageKeys.CURRENT_SECTION);
    },
    setLastCheckedFilter(state, action: PayloadAction<string>) {
      state.lastCheckedFilterId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getFiltersListThunk.pending, (state) => {
        state.isFetching = true;
        state.filters = [];
      })
      .addCase(getFiltersListThunk.fulfilled, (state, action) => {
        if (action.payload) {
          const userName = getStorage(EStorageKeys.USERNAME) as string;
          state.filters =
            (
              getStorage<Record<string, IFilter[]>>(
                EStorageKeys.USER_WORKLIST,
              ) as Record<string, IFilter[]>
            )?.[userName] || action.payload;
          state.checkedFilters =
            (
              getStorage<Record<string, IFilter[]>>(
                EStorageKeys.CHECKED_FILTERS,
              ) as Record<string, IFilter[]>
            )?.[userName] || (action.payload[0] ? [action.payload[0]] : []);
          state.count = action.payload.length;
        }
        state.isFetching = false;
      });
  },
});

export const {
  moveFilters,
  getStorageCheckedFilters,
  storeCheckedFilters,
  getSearchResult,
  getSearchClinicalResult,
  resetSearchClinicalResult,
  setFiltersCombine,
  getLinkedResult,
  resetSearchResult,
  resetLinkedResult,
  setCurrentFilterId,
  resetCurrentFilterId,
  setLastCheckedFilter,
  storeFiltersSettings,
} = FilterReducer.actions;

export default FilterReducer.reducer;
