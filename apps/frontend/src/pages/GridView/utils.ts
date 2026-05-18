import { ETableHeader } from '../../components/AdminSettings/types';

export const rowsOptions = [
  { value: ETableHeader.INSURANCE, label: 'Insurance plans' },
  { value: ETableHeader.WORKLIST, label: 'Worklists' },
  { value: ETableHeader.SPECIALTIES, label: 'Specialties' },
  { value: ETableHeader.PHYSICIAN, label: 'Ordering Physicians' },
];

export const titlesMap = {
  [ETableHeader.INSURANCE]: 'Plans',
  [ETableHeader.WORKLIST]: 'Worklists',
  [ETableHeader.SPECIALTIES]: 'Specialties',
  [ETableHeader.PHYSICIAN]: 'Physicians',
};
