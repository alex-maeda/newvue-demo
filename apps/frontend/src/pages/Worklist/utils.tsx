import { ColumnDef } from '@tanstack/react-table';
import type { MenuProps } from 'antd';
import { ReactComponent as RightPanel } from '../../assets/img/rightPanel.svg';
import { ReactComponent as BottomPanel } from '../../assets/img/bottomPanel.svg';
import { ReactComponent as FreePanel } from '../../assets/img/freePanel.svg';

import { IPatient } from '../../models/Patient';
import {
  ColorEnum,
  EPatientMode,
  EPositionWorkListController,
} from '../../models/enums';

import TimerCell from '../../components/Table/components/TimerCell';
import AvailableActions from '../../components/Table/components/AvailableActions';
import { ReactComponent as Eye } from '../../assets/img/eye.svg';
import { ReactComponent as Mic } from '../../assets/img/mic.svg';

export const getColumns = (
  searchQuery: string | number | number[] | null,
): ColumnDef<IPatient>[] => {
  return [
    {
      header: '',
      id: 'timer',
      accessorKey: 'timer',
      size: 70,
      enableSorting: true,
      enableColumnFilter: false,
      cell: (info) => {
        const mode = info.row.original.mode ?? EPatientMode.NORMAL;
        const color = info.row.original.color ?? '';

        return mode === EPatientMode.REPORT ? (
          <div className={`mode ${color}`}>
            <Mic />
          </div>
        ) : mode === EPatientMode.VIEW ? (
          <div className={`mode ${color}`}>
            <Eye />
          </div>
        ) : (
          <TimerCell
            value={info.getValue() as number}
            id={info.row.original.id}
            name={info.row.original.name}
            color={info.row.original.color}
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
      enablePinning: false,
      minSize: 50,
      size: 200,
      maxSize: 200,
      enableResizing: true,
      cell: (info) => {
        let sectionId = 0;
        if (typeof searchQuery === 'number') {
          sectionId = searchQuery;
        }
        return (
          <AvailableActions info={info.row.original} sectionId={sectionId} />
        );
      },
      meta: {
        order: 1,
        disableTooltip: true,
      },
    },
  ];
};

export const titleForStatus: { [k: string]: string } = {
  [ColorEnum.BLUE]: 'Stroke',
  [ColorEnum.RED]: 'ER',
  [ColorEnum.YELLOW]: 'Hold',
  [ColorEnum.ORANGE]: 'Stat',
  [ColorEnum.GREEN]: 'Inpatient routine',
  [ColorEnum.PURPLE]: 'Outpatient routine',
};

export interface IOptionList {
  label: string;
  value: string;
}

export const switcherList: IOptionList[] = [
  {
    label: 'Auto-next',
    value: 'auto-next',
  },
  {
    label: 'Report in progress',
    value: 'report-in-progress',
  },
  {
    label: 'Add assigned to me',
    value: 'add-assigned-to-me',
  },
  {
    label: 'Show assigned to others',
    value: 'show-assigned-to-others',
  },
];

export const displayModeList: IOptionList[] = [
  { label: 'Precision', value: 'precision' },
  { label: 'Alternating', value: 'alternating' },
  { label: 'Cool Down', value: 'coolDown' },
  { label: 'Zen', value: 'zen' },
];

export const menuItems: MenuProps['items'] = [
  {
    label: 'Panel to the right',
    key: '1',
    icon: <RightPanel />,
  },
  {
    label: 'Panel to the bottom',
    key: '2',
    icon: <BottomPanel />,
  },
  {
    label: 'Free moving',
    key: '3',
    icon: <FreePanel />,
  },
];

export const keyByPosition = {
  [EPositionWorkListController.RIGHT]: '1',
  [EPositionWorkListController.BOTTOM]: '2',
  [EPositionWorkListController.FREE]: '3',
};

export const CONTROLLER = 'controller';
