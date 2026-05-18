import ErikChat from './ErikChat';
import PhysicianNotes from './PhysicianNotes';
import ProblemList from './ProblemList';
import LabResults from './LabResults';
import Medications from './Medications';
import Pathology from './Pathology';
import RadiologyReport from './RadiologyReport';
import SurgicalHistory from './SurgicalHistory';
import Summary from './Summary';
import { EExaminations } from '../../../../models/enums';
import { ColumnDef } from '@tanstack/react-table';
import {
  TCommonData,
  TMedications,
  TProblemList,
  TLabResults,
} from '../../../../models/Consideration';
import { formateDate } from '../../../../utils/DateUtils';

export interface IReadingPaneConfigItem {
  id: string;
  icon: string;
  component: JSX.Element;
  tooltip: string;
}

export const readingPaneConfig: Record<EExaminations, IReadingPaneConfigItem> =
  {
    [EExaminations.SUMMARY]: {
      id: 'S',
      icon: 'summary',
      component: <Summary />,
      tooltip: 'Summary',
    },
    [EExaminations.RADIOLOGY]: {
      id: 'R',
      icon: 'list',
      component: <RadiologyReport />,
      tooltip: 'Radiology Report',
    },
    [EExaminations.AI_RESULTS]: {
      id: 'I',
      icon: 'neurology',
      component: <ErikChat />,
      tooltip: 'ERIK AI Assistant',
    },
    [EExaminations.PROBLEM_LIST]: {
      id: 'P',
      icon: 'assigment',
      component: <ProblemList />,
      tooltip: 'Problem List',
    },
    [EExaminations.PHYSICIAN_NOTES]: {
      id: 'N',
      icon: 'note',
      component: <PhysicianNotes />,
      tooltip: 'Clinical Notes',
    },
    [EExaminations.MEDICATIONS]: {
      id: 'M',
      icon: 'pill',
      component: <Medications />,
      tooltip: 'Medications',
    },
    [EExaminations.SURGICAL_HISTORY]: {
      id: 'H',
      icon: 'medicalInfo',
      component: <SurgicalHistory />,
      tooltip: 'Surgical History',
    },
    [EExaminations.LAB_RESULT]: {
      id: 'L',
      icon: 'science',
      component: <LabResults />,
      tooltip: 'Lab Results',
    },
    [EExaminations.PATHOLOGY]: {
      id: 'Y',
      icon: 'pathalogy',
      component: <Pathology />,
      tooltip: 'Pathology',
    },
  };

export const readingPaneOrder: EExaminations[] = [
  EExaminations.SUMMARY,
  EExaminations.RADIOLOGY,
  EExaminations.PROBLEM_LIST,
  EExaminations.PHYSICIAN_NOTES,
  EExaminations.MEDICATIONS,
  EExaminations.SURGICAL_HISTORY,
  EExaminations.LAB_RESULT,
  EExaminations.PATHOLOGY,
  EExaminations.AI_RESULTS,
];

export const columnsLabResults: ColumnDef<TLabResults>[] = [
  {
    header: 'Lab Results',
    id: 'title',
    accessorKey: 'title',
    size: 300,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Date',
    id: 'date',
    accessorKey: 'date',
    size: 150,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => formateDate(info.getValue() as string),
  },
];

export const columnsPathology: ColumnDef<TCommonData>[] = [
  {
    header: 'Date',
    id: 'date',
    accessorKey: 'date',
    size: 120,
    enableSorting: true,
    enableColumnFilter: true,
    cell: (info) => formateDate(info.getValue() as string),
  },
  {
    header: 'Findings',
    id: 'findings',
    accessorKey: 'title',
    size: 200,
    enableSorting: true,
    enableColumnFilter: true,
    cell: (info) => info.getValue(),
  },
];

export const columnsPhysicianNotes: ColumnDef<TCommonData>[] = [
  {
    header: 'Date',
    id: 'date',
    accessorKey: 'date',
    size: 120,
    enableSorting: true,
    enableColumnFilter: true,
    cell: (info) => formateDate(info.getValue() as string),
  },
  {
    header: 'Results',
    id: 'description',
    accessorKey: 'title',
    size: 200,
    enableSorting: true,
    enableColumnFilter: true,
    cell: (info) => info.getValue(),
  },
];

export const columnsRadiologyReport: ColumnDef<TCommonData>[] = [
  {
    header: 'Exam Description',
    id: 'description',
    accessorKey: 'title',
    size: 200,
    enableSorting: true,
    enableColumnFilter: true,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Date',
    id: 'date',
    accessorKey: 'date',
    size: 120,
    enableSorting: true,
    enableColumnFilter: true,
    cell: (info) => formateDate(info.getValue() as string),
  },
];

export const columnsMedications: ColumnDef<TMedications>[] = [
  {
    header: 'Medication',
    id: 'medication',
    accessorKey: 'medication',
    size: 300,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Dose',
    id: 'dose',
    accessorKey: 'dose',
    size: 150,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Route',
    id: 'route',
    accessorKey: 'route',
    size: 120,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Frequency',
    id: 'frequency',
    accessorKey: 'frequency',
    size: 150,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Last given',
    id: 'lastGiven',
    accessorKey: 'lastGiven',
    size: 150,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
];

export const columnsSurgicalHistory: ColumnDef<TCommonData>[] = [
  {
    header: 'Procedure',
    id: 'procedure',
    accessorKey: 'title',
    size: 400,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Laterality',
    id: 'laterality',
    accessorKey: 'laterality',
    size: 150,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Date',
    id: 'date',
    accessorKey: 'date',
    size: 150,
    enableSorting: true,
    enableColumnFilter: false,
    cell: (info) => formateDate(info.getValue() as string),
    sortingFn: (rowA, rowB) => {
      const dateA = rowA.original.date;
      const dateB = rowB.original.date;
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    },
  },
];

export const reportConfig: { value: string }[] = [
  {
    value: 'All reports',
  },
  {
    value: 'Relevant reports',
  },
];

export const columnsProblemList: ColumnDef<TProblemList>[] = [
  {
    header: 'Problem',
    id: 'text',
    accessorKey: 'text',
    size: 400,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Status',
    id: 'status',
    accessorKey: 'status',
    size: 120,
    enableSorting: false,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
  },
  {
    header: 'Recorded',
    id: 'recorded',
    accessorKey: 'recorded',
    size: 140,
    enableSorting: true,
    enableColumnFilter: false,
    cell: (info) => info.getValue(),
    sortingFn: (rowA, rowB) => {
      const dateA = rowA.original.recorded;
      const dateB = rowB.original.recorded;
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      // Parse DD-MM-YYYY format
      const [dayA, monthA, yearA] = dateA.split('-').map(Number);
      const [dayB, monthB, yearB] = dateB.split('-').map(Number);
      const timeA = new Date(yearA, monthA - 1, dayA).getTime();
      const timeB = new Date(yearB, monthB - 1, dayB).getTime();
      return timeA - timeB;
    },
  },
];
