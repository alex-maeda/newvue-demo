import { ColumnDef } from '@tanstack/react-table';
import {
  TFindingDeliveryRequest,
  TFollowupRequest,
  TPeerFeedback,
} from '../../models/PeerReview';
import { defaultSortFn } from '../../utils/GeneralUtil';
import { EMenuItem, IMenuConfig, TTimeLineConfig } from './types';
import { EExamStatus } from '../../models/enums';

export type TColumn =
  | TPeerFeedback
  | TFollowupRequest
  | TFindingDeliveryRequest;

export const columns: ColumnDef<TColumn>[] = [
  {
    header: 'PATIENT NAME',
    id: 'lastName',
    accessorFn: (row: TColumn) => `${row.firstName} ${row.lastName}`,
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    sortingFn: (rowA, rowB) =>
      defaultSortFn(rowA.original.lastName, rowB.original.lastName),
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'MRN',
    id: 'MRN',
    accessorKey: 'MRN',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
  {
    header: 'ACCESSION',
    id: 'accession',
    accessorKey: 'accession',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'MODALITY',
    id: 'modality',
    accessorKey: 'modality',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
  {
    header: 'USER FEEDBACK',
    id: 'score',
    accessorKey: 'userFeedback',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'COMMENT',
    id: 'comment',
    accessorKey: 'comment',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    cell: (info) => info.getValue() || '-',
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
];

export const followUpColumns: ColumnDef<TColumn>[] = [
  {
    header: 'PATIENT NAME',
    id: 'lastName',
    accessorFn: (row: TColumn) => `${row.firstName} ${row.lastName}`,
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    sortingFn: (rowA, rowB) =>
      defaultSortFn(rowA.original.lastName, rowB.original.lastName),
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'PATIENT PHONE NUMBER',
    id: 'phoneNumber',
    accessorKey: 'phoneNumber',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
  {
    header: 'ORDERING PHYSICIAN',
    id: 'orderingPhysician',
    accessorKey: 'orderingPhysician',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'ORDERING PHYSICIAN PHONE NUMBER',
    id: 'orderingPhysicianPhone',
    accessorKey: 'orderingPhysicianPhone',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
  {
    header: 'EXAM DESCRIPTION',
    id: 'examDescription',
    accessorKey: 'examDescription',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'EXAM DATE',
    id: 'examDate',
    accessorKey: 'examDate',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    cell: (info) => info.getValue() || '-',
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
];

export const deliveryFindingsColumn: ColumnDef<TColumn>[] = [
  {
    header: 'PATIENT NAME',
    id: 'lastName',
    accessorFn: (row: TColumn) => `${row.firstName} ${row.lastName}`,
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    sortingFn: (rowA, rowB) =>
      defaultSortFn(rowA.original.lastName, rowB.original.lastName),
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'MRN',
    id: 'MRN',
    accessorKey: 'MRN',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
  {
    header: 'ACCESSION',
    id: 'accession',
    accessorKey: 'accession',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'MODALITY',
    id: 'modality',
    accessorKey: 'modality',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
  {
    header: 'FINDING SEVERITY',
    id: 'findingSeverity',
    accessorKey: 'findingSeverity',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    enableResizing: true,
    meta: {
      order: 1,
      disableTooltip: false,
    },
  },
  {
    header: 'COMMENT',
    id: 'comment',
    accessorKey: 'comment',
    enableSorting: true,
    minSize: 50,
    size: 150,
    maxSize: 200,
    cell: (info) => info.getValue() || '-',
    meta: {
      order: 2,
      disableTooltip: false,
    },
  },
];

export const typeIconsMap: Record<EExamStatus, TTimeLineConfig> = {
  [EExamStatus.PERFORMED]: {
    icon: 'icon peerReview',
    title: 'Exam Performed',
  },
  [EExamStatus.REPORTED]: {
    icon: 'icon teachingFiles',
    title: 'Exam Reported',
  },
  [EExamStatus.PEER_REVIEWED]: {
    icon: 'icon followUp',
    title: 'Exam Reviewed',
  },
  [EExamStatus.PEER_LEARNING]: {
    icon: 'icon followUp',
    title: 'Exam Reviewed',
  },
  [EExamStatus.FOLLOW_UP_REQUEST]: {
    icon: 'icon followUp',
    title: 'Exam Follow-up',
  },
  [EExamStatus.FINALIZE]: {
    icon: 'icon peerLearning',
    title: 'Exam Scored',
  },
  [EExamStatus.ADDENDUM]: {
    icon: 'icon teachingFiles',
    title: 'Exam Scored',
  },
  [EExamStatus.FINDING_DELIVERY]: {
    icon: 'icon followUp',
    title: '',
  },
};

export const menuConfig: IMenuConfig[] = [
  {
    title: EMenuItem.PEER_FEEDBACK,
    count: 16,
  },
  {
    title: EMenuItem.FINDING_DELIVERY,
    count: 15,
  },
  {
    title: EMenuItem.FOLLOW_UP_REQUESTS,
    count: 27,
  },
  {
    title: EMenuItem.ER_EVENTS,
    count: 17,
  },
  {
    title: EMenuItem.EXAM_ISSUES,
    count: 8,
  },
  {
    title: EMenuItem.ACTIONABLE_FEEDBACK,
    count: 23,
  },
];
