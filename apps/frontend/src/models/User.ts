import { EPatientsSex, EUserStatus } from './enums';

export interface IContactUserInfo {
  address: string;
  phoneNumber: string;
  workEmail: string;
  homeEmail: string;
}

export interface IUserOtherInfo {
  specialty: string[];
  insuranceCoverage: string[];
  credentialing: string;
  facilities: string[];
}
export interface IPersonalUserInfo {
  userAvatar: string | null;
  title: string;
  DOB: string;
  gender: EPatientsSex | string;
  contactInfo: IContactUserInfo;
  otherInfo: IUserOtherInfo;
  status: EUserStatus | string;
  facility: string;
}

export type TUserRights = {
  isView: boolean;
  isReport: boolean;
};
export type TEmbeddingType = 'radpair' | 'mdai' | 'smartreporting';

export interface IUser {
  id: number;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  active: boolean;
  role: string;
  group: string;
  personalInfo: IPersonalUserInfo;
  orderingPhysicians?: string[];
  worklists?: string[];
  rights?: TUserRights;
  embeddingType?: TEmbeddingType;
  embeddingOverrides?: Record<string, TEmbeddingType>;
}
