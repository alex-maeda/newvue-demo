interface ICheckboxConfig {
  label: string;
  value: string;
}

export const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const checkboxConfig: ICheckboxConfig[] = [
  {
    label: 'User must be online',
    value: 'online',
  },
  {
    label: 'Timer to unassign',
    value: 'timer',
  },
];

export const stydiesCheckboxConfig: ICheckboxConfig[] = [
  {
    label: 'Ordering physicians',
    value: 'orderingPhysicians',
  },
  {
    label: 'Specialty',
    value: 'speacilaty',
  },
  {
    label: 'Insurance',
    value: 'insurance',
  },
  {
    label: 'Credentials',
    value: 'credentials',
  },
  {
    label: 'Facility',
    value: 'facility',
  },
];
