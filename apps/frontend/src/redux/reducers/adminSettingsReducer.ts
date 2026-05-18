import { PayloadAction, createSlice } from '@reduxjs/toolkit';

import {
  IFilteredData,
  IFiltersConfig,
  IFiltersSettings,
  IUserInitialState,
  TCorrespondData,
} from '../types/adminSettingsTypes';
import { IUser } from '../../models/User';
import {
  IFilter,
  TColumnSetting,
  TUserOrUserGroupRights,
} from '../../models/Filter';
import { EStorageKeys } from '../../models/enums';
import { IJob } from '../../models/Job';
import {
  getAvailableFiltersData,
  getColumnSettingsListThunk,
  getInsurancePlansCorrespondThunk,
  getJobsListThunk,
  getOrderingPhysicianCorrespondThunk,
  getSpecialtiesCorrespondThunk,
  getUsersListThunk,
  getWorklistCorrespondThunk,
  getWorklistThunk,
} from '../thunks/adminSettingsThunk';
import { getStorage, removeStorage, setStorage } from '../../utils/StorageUtil';
import { nameByColumn } from '../../pages/WorklistBuilder/components/FiltersContent/utils';

export const initialState: IUserInitialState = {
  isFetching: false,
  isTableFetching: false,
  error: null,
  usersList: null,
  worklistCorrespondData: [],
  insurancePlansCorrespondData: [],
  specialtiesCorrespondData: [],
  orderingPhysicianCorrespondData: [],
  selectedUser: {} as IUser,

  getColumnSetting: {
    columnSettings: [],
    isFetching: false,
    error: null,
  },

  getWorklists: {
    worklists: [],
    currentWorklist: {} as IFilter,
    isFetching: false,
    error: null,
  },

  settingsFilters: {
    availableFiltersData: {
      filters: {},
      isFetching: false,
      error: null,
    },
    filtersSettings: {
      '0': {
        filtersAll: {},
        filtersAny: [],
      },
    } as IFiltersSettings,
    filteredData: {} as IFilteredData,
  },

  getJobs: {
    jobs: [],
    currentJob: {} as IJob,
    isFetching: false,
    error: null,
  },
};

const AdminSettingsReducer = createSlice({
  name: 'adminSettings',
  initialState,
  reducers: {
    getUserInfo(state, action) {
      const id = action.payload;
      state.selectedUser =
        (state.usersList ?? []).find((i) => i.id === id) || ({} as IUser);
    },
    resetUserInfo(state) {
      state.selectedUser = {} as IUser;
    },
    saveWorklistCorrespondData(state, action) {
      state.worklistCorrespondData = action.payload;
      const { getWorklists, usersList } = state;
      if (getWorklists.worklists.length && usersList) {
        getWorklists.worklists = getWorklists.worklists.map((item) => {
          const newItem = { ...item };
          const worklist = state.worklistCorrespondData.find(
            (el) => el.key === item.label,
          );

          if (worklist) {
            const usersRights: TUserOrUserGroupRights[] = [];
            usersList.forEach((user: IUser) => {
              const { firstName, lastName, rights } = user;
              const name = `${firstName} ${lastName}`;
              usersRights.push({
                name,
                isView: !!worklist[name] || false,
                isReport: (!!worklist[name] && rights?.isReport) || false,
              });
            });

            newItem.settings = {
              columnSettings: newItem.settings?.columnSettings || [],
              userGroupsRights: newItem.settings?.userGroupsRights || [],
              usersRights,
              sorting: [],
              filters: [],
            };
          }
          return newItem;
        });
      }

      setStorage<IFilter[]>(EStorageKeys.WORKLISTS, getWorklists.worklists);
      setStorage<TCorrespondData[]>(
        EStorageKeys.WORKLIST_CORRESPOND,
        action.payload,
      );
      removeStorage(EStorageKeys.USER_WORKLIST);
      removeStorage(EStorageKeys.CHECKED_FILTERS);
    },
    saveInsurancePlansCorrespondData(state, action) {
      state.insurancePlansCorrespondData = action.payload;
      setStorage<TCorrespondData[]>(
        EStorageKeys.INSURANCE_PLANS_CORRESPOND,
        action.payload,
      );
    },
    saveSpecialtiesCorrespondData(state, action) {
      state.specialtiesCorrespondData = action.payload;
      setStorage<TCorrespondData[]>(
        EStorageKeys.SPECIALTIES_CORRESPOND,
        action.payload,
      );
    },
    saveOrderingPhysicianCorrespondData(state, action) {
      state.orderingPhysicianCorrespondData = action.payload;
      setStorage<TCorrespondData[]>(
        EStorageKeys.ORDERING_PHYSYICIAN_CORRESPOND,
        action.payload,
      );
    },
    saveRightsData(
      state,
      action: PayloadAction<{
        usersRights: TUserOrUserGroupRights[];
        userGroupsRights: TUserOrUserGroupRights[];
      }>,
    ) {
      const { usersRights, userGroupsRights } = action.payload;
      const { getWorklists } = state;
      const oldSettings = state.getWorklists.currentWorklist.settings;
      getWorklists.currentWorklist.settings = {
        columnSettings: oldSettings?.columnSettings || [],
        usersRights,
        userGroupsRights,
        sorting: [],
        filters: [],
      };

      if (usersRights) {
        state.worklistCorrespondData = state.worklistCorrespondData.map(
          (item) => {
            const newItem = { ...item };
            if (item.key === getWorklists.currentWorklist.label) {
              usersRights.forEach((user) => {
                newItem[user.name] = user.isView || user.isReport;
              });
            }
            return newItem;
          },
        );
      }

      getWorklists.worklists = getWorklists.worklists.map((item) => {
        if (item.id == getWorklists.currentWorklist.id) {
          return getWorklists.currentWorklist;
        }
        return item;
      });

      setStorage<TCorrespondData[]>(
        EStorageKeys.WORKLIST_CORRESPOND,
        state.worklistCorrespondData,
      );
      setStorage<IFilter[]>(EStorageKeys.WORKLISTS, getWorklists.worklists);
      removeStorage(EStorageKeys.USER_WORKLIST);
      removeStorage(EStorageKeys.CHECKED_FILTERS);
    },
    updateWorklist(state, action) {
      state.getWorklists.worklists = action.payload;
      const worklistCorrespondData = action.payload.map((filter: IFilter) => {
        const result: TCorrespondData = { key: filter.label };
        state.usersList?.forEach((user: IUser) => {
          const { firstName, lastName } = user;
          if (user.worklists) {
            console.log(filter.id);
            result[`${firstName} ${lastName}`] = user.worklists.includes(
              filter.id,
            );
          }
        });
        return result;
      });
      state.worklistCorrespondData = worklistCorrespondData;
      setStorage<TCorrespondData[]>(
        EStorageKeys.WORKLIST_CORRESPOND,
        worklistCorrespondData,
      );
      setStorage<IFilter[]>(EStorageKeys.WORKLISTS, action.payload);
      removeStorage(EStorageKeys.USER_WORKLIST);
      removeStorage(EStorageKeys.CHECKED_FILTERS);
    },
    getCurrentWorklist({ getWorklists }, action) {
      const id = action.payload;
      getWorklists.currentWorklist =
        getWorklists.worklists.find((item) => item.id === id) ||
        ({} as IFilter);
    },
    updateCurrentWorklistColumnsSettings(
      { getWorklists },
      action: PayloadAction<TColumnSetting[]>,
    ) {
      const oldSettings = getWorklists.currentWorklist.settings;
      getWorklists.currentWorklist.settings = {
        columnSettings: action.payload,
        usersRights: oldSettings?.usersRights || [],
        userGroupsRights: oldSettings?.userGroupsRights || [],
        sorting: [],
        filters: [],
      };
      getWorklists.worklists = getWorklists.worklists.map((item) => {
        if (item.id == getWorklists.currentWorklist.id) {
          return getWorklists.currentWorklist;
        }
        return item;
      });
      setStorage(EStorageKeys.WORKLISTS, getWorklists.worklists);
      removeStorage(EStorageKeys.USER_WORKLIST);
      removeStorage(EStorageKeys.CHECKED_FILTERS);
    },
    updateJobs({ getJobs }, action) {
      getJobs.jobs = action.payload;
      setStorage<IJob[]>(EStorageKeys.JOBS, action.payload);
    },
    getCurrentJob({ getJobs }, action) {
      const id = action.payload;
      getJobs.currentJob = getJobs.jobs[id] || ({} as IJob);
    },
    updateCurrentJob({ getJobs }, action) {
      getJobs.currentJob = action.payload;
      getJobs.jobs = getJobs.jobs.map((item) => {
        if (item.id == getJobs.currentJob.id) {
          return getJobs.currentJob;
        }
        return item;
      });
      setStorage<IJob[]>(EStorageKeys.JOBS, getJobs.jobs);
    },
    // setPreviewData({ settingsFilters }, action) {
    //   const updateData = action.payload.map((i: IPatient) => {
    //     return {
    //       ...i,
    //       age: parseInt(i.age ?? ''),
    //     };
    //   });

    //   const result: {
    //     [key: string]: Array<string | number | boolean | null | string[]>;
    //   } = {};

    //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //   updateData.forEach((patient: any) => {
    //     for (const key in tableColumnAccessor) {
    //       if (tableColumnAccessor.hasOwnProperty(key)) {
    //         const patientKey = tableColumnAccessor[key];
    //         if (patient.hasOwnProperty(patientKey)) {
    //           if (!result[key]) {
    //             result[key] = [];
    //           }
    //           result[key].push(patient[patientKey]);
    //         }
    //       }
    //     }
    //   });

    //   for (const key in result) {
    //     if (result.hasOwnProperty(key)) {
    //       result[key] = Array.from(new Set(result[key]));
    //     }
    //   }

    //   settingsFilters.initialMokData = updateData;
    //   settingsFilters.updateData = result;
    // },
    setFiltersAny(
      { settingsFilters },
      action: PayloadAction<{
        id: string;
        data: IFiltersConfig[];
      }>,
    ) {
      const { id, data } = action.payload;
      const updatedObjects = data.map((obj) => {
        const updatedObject: IFiltersConfig = {};

        for (const key in obj) {
          const mappedKey = Object.keys(nameByColumn).find(
            (k) => nameByColumn[k] === key,
          );
          if (mappedKey) {
            updatedObject[mappedKey] = obj[key];
          } else {
            updatedObject[key] = obj[key];
          }
        }

        return updatedObject;
      });

      if (!settingsFilters.filtersSettings?.[id]) {
        settingsFilters.filtersSettings = {
          [id]: {
            filtersAll: {},
            filtersAny: [],
          },
        };
      }

      settingsFilters.filtersSettings[id].filtersAny = updatedObjects;
    },
    setFiltersAll(
      { settingsFilters },
      action: PayloadAction<{
        id: string | number;
        data: IFiltersConfig;
      }>,
    ) {
      const { id, data } = action.payload;
      const updatedObject: IFiltersConfig = {};

      for (const key in data) {
        const mappedKey = Object.keys(nameByColumn).find(
          (k) => nameByColumn[k] === key,
        );
        if (mappedKey) {
          updatedObject[mappedKey] = data[key];
        } else {
          updatedObject[key] = data[key];
        }
      }

      if (!settingsFilters.filtersSettings?.[id]) {
        settingsFilters.filtersSettings = {
          [id]: {
            filtersAll: {},
            filtersAny: [],
          },
        };
      }

      settingsFilters.filtersSettings[id].filtersAll = updatedObject;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getUsersListThunk.pending, (state) => {
        state.isFetching = true;
        state.selectedUser = {} as IUser;
        state.usersList = [];
      })
      .addCase(getUsersListThunk.fulfilled, (state, action) => {
        if (action.payload) {
          const data = action.payload.filter((i) => i.role === 'user');
          state.usersList = data;
        }
        state.isFetching = false;
      })
      .addCase(getInsurancePlansCorrespondThunk.pending, (state) => {
        state.isTableFetching = true;
        state.insurancePlansCorrespondData = [];
      })
      .addCase(getInsurancePlansCorrespondThunk.fulfilled, (state, action) => {
        if (action.payload) {
          state.insurancePlansCorrespondData =
            (getStorage<TCorrespondData[]>(
              EStorageKeys.INSURANCE_PLANS_CORRESPOND,
            ) as TCorrespondData[]) || action.payload;
        }
        state.isTableFetching = false;
      })
      .addCase(getWorklistCorrespondThunk.pending, (state) => {
        state.isTableFetching = true;
        state.worklistCorrespondData = [];
      })
      .addCase(getWorklistCorrespondThunk.fulfilled, (state, action) => {
        if (action.payload) {
          state.worklistCorrespondData =
            (getStorage<TCorrespondData[]>(
              EStorageKeys.WORKLIST_CORRESPOND,
            ) as TCorrespondData[]) || action.payload;
        }
        state.isTableFetching = false;
      })
      .addCase(getSpecialtiesCorrespondThunk.pending, (state) => {
        state.isTableFetching = true;
        state.specialtiesCorrespondData = [];
      })
      .addCase(getSpecialtiesCorrespondThunk.fulfilled, (state, action) => {
        if (action.payload) {
          state.specialtiesCorrespondData =
            (getStorage<TCorrespondData[]>(
              EStorageKeys.SPECIALTIES_CORRESPOND,
            ) as TCorrespondData[]) || action.payload;
        }
        state.isTableFetching = false;
      })
      .addCase(getOrderingPhysicianCorrespondThunk.pending, (state) => {
        state.isTableFetching = true;
        state.orderingPhysicianCorrespondData = [];
      })
      .addCase(
        getOrderingPhysicianCorrespondThunk.fulfilled,
        (state, action) => {
          if (action.payload) {
            state.orderingPhysicianCorrespondData =
              (getStorage<TCorrespondData[]>(
                EStorageKeys.ORDERING_PHYSYICIAN_CORRESPOND,
              ) as TCorrespondData[]) || action.payload;
          }
          state.isTableFetching = false;
        },
      )
      .addCase(getColumnSettingsListThunk.pending, ({ getColumnSetting }) => {
        getColumnSetting.isFetching = true;
        getColumnSetting.columnSettings = [];
      })
      .addCase(
        getColumnSettingsListThunk.fulfilled,
        ({ getColumnSetting }, action) => {
          if (action.payload) {
            getColumnSetting.columnSettings = action.payload;
          }
          getColumnSetting.isFetching = false;
        },
      )
      .addCase(getWorklistThunk.pending, ({ getWorklists }) => {
        getWorklists.isFetching = true;
        getWorklists.worklists = [];
      })
      .addCase(getWorklistThunk.fulfilled, ({ getWorklists }, action) => {
        if (action.payload) {
          getWorklists.worklists =
            (getStorage<IFilter[]>(EStorageKeys.WORKLISTS) as IFilter[]) ||
            action.payload;
          setStorage<IFilter[]>(EStorageKeys.WORKLISTS, getWorklists.worklists);
        }
        getWorklists.isFetching = false;
      })
      .addCase(getJobsListThunk.pending, ({ getJobs }) => {
        getJobs.isFetching = true;
        getJobs.jobs = [];
      })
      .addCase(getJobsListThunk.fulfilled, ({ getJobs }, action) => {
        if (action.payload) {
          getJobs.jobs =
            (getStorage<IJob[]>(EStorageKeys.JOBS) as IJob[]) || action.payload;
        }
        getJobs.isFetching = false;
      })
      .addCase(getAvailableFiltersData.pending, (state) => {
        state.settingsFilters.availableFiltersData.isFetching = true;
        state.settingsFilters.availableFiltersData.filters = {};
      })
      .addCase(getAvailableFiltersData.fulfilled, (state, action) => {
        if (action.payload) {
          state.settingsFilters.availableFiltersData.filters = action.payload;
        }
        state.settingsFilters.availableFiltersData.isFetching = false;
      });
    // .addCase(getPatientListByIdThunk.pending, ({ settingsWorklist }) => {
    //   settingsWorklist.getPatientsBySelected.isFetching = true;
    //   settingsWorklist.getPatientsBySelected.patients = [];
    // })
    // .addCase(
    //   getPatientListByIdThunk.fulfilled,
    //   ({ settingsWorklist }, action) => {
    //     if (action.payload) {
    //       const { patients } = preparePatientData(
    //         action.payload as IPatient[],
    //       );
    //       settingsWorklist.getPatientsBySelected.patients = patients;
    //     }
    //     settingsWorklist.getPatientsBySelected.isFetching = false;
    //   },
    // );
  },
});

export const {
  getUserInfo,
  saveWorklistCorrespondData,
  saveInsurancePlansCorrespondData,
  saveSpecialtiesCorrespondData,
  saveOrderingPhysicianCorrespondData,
  resetUserInfo,
  updateWorklist,
  getCurrentWorklist,
  updateCurrentWorklistColumnsSettings,
  // setPreviewData,
  // getAvailableFiltersData,
  saveRightsData,
  setFiltersAny,
  setFiltersAll,
  updateJobs,
  getCurrentJob,
  updateCurrentJob,
} = AdminSettingsReducer.actions;

export default AdminSettingsReducer.reducer;
