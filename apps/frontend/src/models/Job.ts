export type TUserOrUserGroupReceives = {
  name: string;
  isChecked: boolean;
};

export interface IJob {
  id: string;
  label: string;
  settings: {
    studies: string[];
    usersReceives: TUserOrUserGroupReceives[];
    userGroupsReceives: TUserOrUserGroupReceives[];
    intervals: string[];
  };
}
