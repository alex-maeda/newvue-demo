import { TColumnSetting } from '../../../../models/Filter';

export const defaultTopColumn: TColumnSetting = {
  accessor: 'actions',
  order: 1,
};

export const allColumns: TColumnSetting[] = [
  {
    accessor: 'examStatus',
    order: 0,
  },
  {
    accessor: 'examDescription',
    order: 0,
  },
  {
    accessor: 'modality',
    order: 0,
  },
  {
    accessor: 'name',
    order: 0,
  },
  {
    accessor: 'age',
    order: 0,
  },
  {
    accessor: 'examCompleted',
    order: 0,
  },
  {
    accessor: 'orderedLocation',
    order: 0,
  },
  {
    accessor: 'clinicalIndications',
    order: 0,
  },
  {
    accessor: 'reasonForExam',
    order: 0,
  },
  {
    accessor: 'specialty',
    order: 0,
  },
  {
    accessor: 'bodyPart',
    order: 0,
  },
  {
    accessor: 'accession',
    order: 0,
  },
  {
    accessor: 'MRN',
    order: 0,
  },
  {
    accessor: 'facilityName',
    order: 0,
  },
  {
    accessor: 'orderedBy',
    order: 0,
  },
  {
    accessor: 'referredBy',
    order: 0,
  },
  {
    accessor: 'performedBy',
    order: 0,
  },
  {
    accessor: 'assignedTo',
    order: 0,
  },
  {
    accessor: 'facilityCode',
    order: 0,
  },
  {
    accessor: 'insurancePlan',
    order: 0,
  },
  {
    accessor: 'currentPatientLocation',
    order: 0,
  },
];
