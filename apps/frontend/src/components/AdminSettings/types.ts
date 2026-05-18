import { IContactUserInfo, IUserOtherInfo } from '../../models/User';
import { EPatientsSex } from '../../models/enums';

export interface EditableCellProps extends React.HTMLAttributes<HTMLElement> {
  editing: boolean;
  dataIndex: string;
  isSelected: boolean;
  title: string;
  children: React.ReactNode;
}

export interface HeaderCellProps {
  isSelected: boolean;
  dataIndex: string;
  setColumnSelected: (arg: string) => void;
  children: React.ReactNode;
}

export interface IEditUserItemsForm extends IUserOtherInfo, IContactUserInfo {
  firstName: string;
  lastName: string;
  title: string;
  DOB: string;
  gender: EPatientsSex | string;
  phoneCodeCountry: string;
}

export enum EEditUserItemsForm {
  FIRST_NAME = 'firstName',
  LAST_NAME = 'lastName',
  TITLE = 'title',
  DOB = 'DOB',
  GENDER = 'gender',
  ADDRESS = 'address',
  PHONE_NUMBER = 'phoneNumber',
  PHONE_CODE_COUNTRY = 'phoneCodeCountry',
  WORK_EMAIL = 'workEmail',
  HOME_EMAIL = 'homeEmail',
  SPECIALTY = 'specialty',
  INSURANCE = 'insuranceCoverage',
  CREDENTIALING = 'credentialing',
  FACILITIES = 'facilities',
}

export enum ETableHeader {
  INSURANCE = 'Insurance plans',
  WORKLIST = 'Worklists',
  SPECIALTIES = 'Specialties',
  PHYSICIAN = 'Physician',
}
