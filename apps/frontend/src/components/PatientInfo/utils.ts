import { EPatientsSex } from '../../models/enums';

export const preparePatientSex = {
  [EPatientsSex.MALE]: 'Male',
  [EPatientsSex.FEMALE]: 'Female',
  [EPatientsSex.UNDEFINED]: '',
};
