import { ColumnFiltersState, SortingState } from '@tanstack/react-table';

export type TColumnSetting = {
  accessor: string;
  order: number;
};

export type TUserOrUserGroupRights = {
  name: string;
  isView: boolean;
  isReport: boolean;
};

export interface IFilter {
  id: string;
  label: string;
  isCombine?: boolean;
  priorityColor?: string;
  resultCount?: number;
  settings?: {
    columnSettings: TColumnSetting[];
    usersRights: TUserOrUserGroupRights[];
    userGroupsRights: TUserOrUserGroupRights[];
    sorting: SortingState;
    filters: ColumnFiltersState;
  };
}
