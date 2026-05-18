import { ColumnDef } from '@tanstack/react-table';

import TimerCell from '../../../../components/Table/components/TimerCell';
import AvailableActions from '../../../../components/Table/components/AvailableActions';

import { IPatient } from '../../../../models/Patient';

import {
  WorklistSettingsColumns,
  WorklistSettingsFilters,
  WorklistSettingsUsers,
} from '../../../../UrlsConfig';

interface INavSettings {
  title: string;
  url: string;
  id: string;
}

export const NavLinksWorklistSettings: INavSettings[] = [
  {
    id: '1',
    title: 'Columns',
    url: WorklistSettingsColumns,
  },
  {
    id: '2',
    title: 'Filters',
    url: WorklistSettingsFilters,
  },
  {
    id: '3',
    title: 'Users',
    url: WorklistSettingsUsers,
  },
];

export const getColumns: ColumnDef<IPatient>[] = [
  {
    header: '',
    id: 'timer',
    accessorKey: 'timer',
    size: 70,
    enableSorting: true,
    enableColumnFilter: false,
    cell: (info) => {
      return (
        <TimerCell
          value={info.getValue() as number}
          id={info.row.original.id}
          name={info.row.original.name}
          color={info.row.original.color}
          showOnly
        />
      );
    },
    meta: {
      order: 1,
      disableTooltip: true,
    },
  },
  {
    header: 'AVAILABLE ACTIONS',
    id: 'actions',
    enableSorting: false,
    enableColumnFilter: false,
    enablePinning: true,
    minSize: 50,
    size: 200,
    maxSize: 200,
    enableResizing: false,
    cell: (info) => (
      <AvailableActions
        info={info.row.original}
        sectionId={0}
        showLink={false}
        disableActions={true}
      />
    ),
    meta: {
      order: 1,
      disableTooltip: true,
    },
  },
];
