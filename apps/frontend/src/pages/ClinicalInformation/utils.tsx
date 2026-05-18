import { ColumnDef } from '@tanstack/react-table';
// COMPONENTS
import TimerCell from '../../components/Table/components/TimerCell';
import AvailableActions from '../../components/Table/components/AvailableActions';
import { ReactComponent as Eye } from '../../assets/img/eye.svg';
import { ReactComponent as Mic } from '../../assets/img/mic.svg';
// MODELS
import { IPatient } from '../../models/Patient';
import { EConsiderationItemName, EPatientMode } from '../../models/enums';

export const getColumns: ColumnDef<IPatient>[] = [
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
    cell: (info) => <AvailableActions info={info.row.original} />,
    meta: {
      order: 1,
      disableTooltip: true,
    },
  },
];

export const considerationsList = [
  { title: 'AI Findings', id: EConsiderationItemName.AI_FINDINGS },
  { title: 'Common Findings', id: EConsiderationItemName.COMMON_FINDINGS },
  {
    title: 'Differential Diagnosis',
    id: EConsiderationItemName.DIFFERENTIAL_DIAGNOSIS,
  },
  { title: 'Commonly Missed', id: EConsiderationItemName.COMMONLY_MISSED },
  { title: 'References Sites', id: EConsiderationItemName.REFERENCES },
];
