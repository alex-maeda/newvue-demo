import { createAsyncThunk } from '@reduxjs/toolkit';
import usersDataJson from '../fakeApi/users.json';
import insurancePlansData from '../fakeApi/insurancePlans.json';
import orderingPhysicianData from '../fakeApi/orderingPhysician.json';
import specialitiesData from '../fakeApi/specialities.json';
import filtersData from '../fakeApi/filters.json';
import columnsData from '../fakeApi/columnSettings.json';
import jobsData from '../fakeApi/jobs.json';
import availableFilers from '../fakeApi/worklistBuilder.json';

import { IInsurancePlan } from '../../models/Insurance';
import { IUser } from '../../models/User';

const usersData = usersDataJson as IUser[];
import {
  IFilter,
  TColumnSetting,
  TUserOrUserGroupRights,
} from '../../models/Filter';
import { TCorrespondData } from '../types/adminSettingsTypes';
import { getStorage } from '../../utils/StorageUtil';
import { ERole, EStorageKeys } from '../../models/enums';
import { IJob } from '../../models/Job';

export const getUsersListThunk = createAsyncThunk<IUser[]>(
  'adminSettings/getUsersList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => resolve(usersData || []), 1000),
    );
  },
);

export const getInsurancePlansCorrespondThunk = createAsyncThunk<
  TCorrespondData[]
>('adminSettings/getInsurancePlansCorrespond', async () => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(() => {
      const insurances = insurancePlansData.map((plan: IInsurancePlan) => {
        const result: TCorrespondData = { key: plan.label };
        usersData.forEach((user: IUser) => {
          const { firstName, lastName } = user;
          if (user.personalInfo.otherInfo.insuranceCoverage) {
            result[`${firstName} ${lastName}`] =
              user.personalInfo.otherInfo.insuranceCoverage.includes(
                plan.label,
              );
          }
        });
        return result;
      });

      resolve(insurances || []);
    }, 1000),
  );
});

export const getWorklistCorrespondThunk = createAsyncThunk<TCorrespondData[]>(
  'adminSettings/getWorklistCorrespond',
  async () => {
    return await new Promise((resolve) =>
      setTimeout(() => {
        const storageFiltersData =
          (getStorage<IFilter[]>(EStorageKeys.WORKLISTS) as IFilter[]) || [];
        const updateFiltersData =
          storageFiltersData.length > filtersData.length
            ? storageFiltersData
            : filtersData;
        const worklist = updateFiltersData.map((filter: IFilter) => {
          const result: TCorrespondData = { key: filter.label };
          usersData.forEach((user: IUser) => {
            const { firstName, lastName } = user;
            if (user.worklists) {
              result[`${firstName} ${lastName}`] = user.worklists.includes(
                filter.id,
              );
            }
          });
          return result;
        });

        resolve(worklist || []);
      }, 1000),
    );
  },
);

export const getSpecialtiesCorrespondThunk = createAsyncThunk<
  TCorrespondData[]
>('adminSettings/getSpecialitiesCorrespond', async () => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(() => {
      const insurances = specialitiesData.map((specialty: IInsurancePlan) => {
        const result: TCorrespondData = { key: specialty.label };
        usersData.forEach((user: IUser) => {
          const { firstName, lastName } = user;
          if (user.personalInfo.otherInfo.specialty) {
            result[`${firstName} ${lastName}`] =
              user.personalInfo.otherInfo.specialty.includes(specialty.label);
          }
        });
        return result;
      });

      resolve(insurances || []);
    }, 1000),
  );
});

export const getOrderingPhysicianCorrespondThunk = createAsyncThunk<
  TCorrespondData[]
>('adminSettings/getOrderingPhysicianCorrespond', async () => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(() => {
      const insurances = orderingPhysicianData.map(
        (physician: IInsurancePlan) => {
          const result: TCorrespondData = { key: physician.label };
          usersData.forEach((user: IUser) => {
            const { firstName, lastName } = user;
            if (user.orderingPhysicians) {
              result[`${firstName} ${lastName}`] =
                user.orderingPhysicians.includes(physician.id);
            }
          });
          return result;
        },
      );

      resolve(insurances || []);
    }, 1000),
  );
});

export const getWorklistThunk = createAsyncThunk<IFilter[]>(
  'adminSettings/getWorklist',
  async () => {
    return await new Promise((resolve) =>
      setTimeout(() => {
        const result = filtersData.map((filter: IFilter) => {
          const newFilter = { ...filter };

          const usersRights: TUserOrUserGroupRights[] = [];
          const userGroupsRights: TUserOrUserGroupRights[] = [];
          usersData.forEach((user: IUser) => {
            const { firstName, lastName, group, worklists, rights } = user;
            if (user.role === ERole.USER) {
              usersRights.push({
                name: `${firstName} ${lastName}`,
                isView: worklists?.includes(filter.id) || false,
                isReport:
                  (worklists?.includes(filter.id) && rights?.isReport) || false,
              });
              const isUserGroupExist = userGroupsRights.find(
                (el) => el.name === group,
              );
              if (!isUserGroupExist) {
                userGroupsRights.push({
                  name: group,
                  isView: worklists?.includes(filter.id) || false,
                  isReport:
                    (worklists?.includes(filter.id) && rights?.isReport) ||
                    false,
                });
              }
            }
          });

          newFilter.settings = {
            columnSettings: columnsData,
            usersRights,
            userGroupsRights,
            sorting: [],
            filters: [],
          };
          return newFilter;
        });
        resolve(result || []);
      }, 1000),
    );
  },
);

export const getColumnSettingsListThunk = createAsyncThunk<TColumnSetting[]>(
  'adminSettings/getColumnSettingsList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => resolve(columnsData), 1000),
    );
  },
);

export const getJobsListThunk = createAsyncThunk<IJob[]>(
  'adminSettings/getJobsList',
  async () => {
    // Simulated API response delay using setTimeout
    return await new Promise((resolve) =>
      setTimeout(() => resolve(jobsData), 1000),
    );
  },
);

// export const getPatientListByIdThunk = createAsyncThunk<
//   Omit<IPatient, 'timer'>[],
//   number | string
// >('adminSettings/getPatientListById', async (id: number | string) => {
//   // Simulated API response delay using setTimeout
//   return await new Promise((resolve) =>
//     setTimeout(() => {
//       const data = Object.values(
//         patientData as Record<string, Omit<IPatient, 'timer'>>,
//       ).filter((i) => i.sectionId.includes(+id));
//       return resolve((data as Omit<IPatient, 'timer'>[]) || []);
//     }, 1000),
//   );
// });

export const getAvailableFiltersData = createAsyncThunk<{
  [k: string]: Array<string | number>;
}>('adminSettings/getAvailableFiltersData', async () => {
  // Simulated API response delay using setTimeout
  return await new Promise((resolve) =>
    setTimeout(() => resolve(availableFilers), 1000),
  );
});
