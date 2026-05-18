import { createAsyncThunk } from '@reduxjs/toolkit';
import filtersData from '../fakeApi/filters.json';
import usersData from '../fakeApi/users.json';
import columnsData from '../fakeApi/columnSettings.json';
import patientData from '../fakeApi/patients.json';

import { IFilter } from '../../models/Filter';
import { getStorage } from '../../utils/StorageUtil';
import { TCorrespondData } from '../types/adminSettingsTypes';
import { EStorageKeys } from '../../models/enums';
import { IPatient } from '../../models/Patient';

export const getFiltersListThunk = createAsyncThunk<IFilter[]>(
  'filter/getFiltersList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => {
        const name = getStorage<string>(EStorageKeys.NAME) as string;
        const userName = getStorage(EStorageKeys.USERNAME) as string;
        const savedWorlistСorrespond = getStorage<TCorrespondData[]>(
          EStorageKeys.WORKLIST_CORRESPOND,
        ) as TCorrespondData[];
        const savedWorklists =
          (getStorage<IFilter[]>(EStorageKeys.WORKLISTS) as IFilter[]) ||
          filtersData;
        const resultData: IFilter[] = [];
        const defaultSettings = {
          columnSettings: columnsData,
          usersRights: [],
          userGroupsRights: [],
          sorting: [],
          filters: [],
        };

        if (savedWorlistСorrespond && name) {
          savedWorlistСorrespond.forEach((item) => {
            if (item[name]) {
              const worklist = savedWorklists.find(
                (filter) => filter.label === item.key,
              );
              if (worklist) {
                const { settings, id } = worklist;

                let patientDataArr =
                  (Object.values(patientData) as Omit<IPatient, 'timer'>[]) ||
                  [];

                patientDataArr = patientDataArr.filter(
                  (el) =>
                    el.users.includes(userName) && el.sectionId.includes(+id),
                );

                resultData.push({
                  ...worklist,
                  resultCount: patientDataArr.length,
                  settings: {
                    ...(settings || defaultSettings),
                    sorting: [{ id: 'timer', desc: false }],
                    filters: [],
                  },
                });
              }
            }
          });
        } else if (name) {
          const user = usersData.find(
            (item) => name === `${item.firstName} ${item.lastName}`,
          );

          if (user) {
            savedWorklists.forEach((filter) => {
              if (user.worklists?.includes(filter.id)) {
                const { settings, id } = filter;

                let patientDataArr =
                  (Object.values(patientData) as Omit<IPatient, 'timer'>[]) ||
                  [];

                patientDataArr = patientDataArr.filter(
                  (el) =>
                    el.users.includes(userName) && el.sectionId.includes(+id),
                );

                resultData.push({
                  ...filter,
                  resultCount: patientDataArr.length,
                  settings: {
                    ...(settings || defaultSettings),
                    sorting: [{ id: 'timer', desc: false }],
                    filters: [],
                  },
                });
              }
            });
          }
        }

        resolve(resultData);
      }, 1000),
    );
  },
);
