import {
  Column,
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  Header,
  OnChangeFn,
  Row,
  RowSelectionState,
  Table,
  Cell,
  RowModel,
} from '@tanstack/react-table';
import { SyntheticEvent } from 'react';

export interface TableProps<TData> {
  data: TData[];
  total: number;
  sorting?: SortingState;
  columns: ColumnDef<TData>[];
  filters?: ColumnFiltersState;
  globalFilter?: string;
  rowSelection?: RowSelectionState;
  manualTable?: boolean;
  isSelectable?: boolean;
  isDoubleRowTable?: boolean;
  isNeedShowHeader?: boolean;
  noDataTextArr?: string[];
  handleRowClick?: (row: Row<TData>, isDoubleClick?: boolean) => void;
  onFilterChange?: OnChangeFn<ColumnFiltersState>;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  onGlobalFilterChange?: (val: string) => void;
  onSortingChange?: OnChangeFn<SortingState>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomSortedRowModel?: () => (table: Table<any>) => () => RowModel<any>;
}

export type HeaderCellProps<TData> = {
  header: Header<TData, unknown>;
  topHeader?: Header<TData, unknown> | null;
  table: Table<TData>;
  isFirst?: boolean;
  isRowSpan?: boolean;
};

export type TableCellProps<TData> = {
  cell: Cell<TData, unknown>;
  row: Row<TData>;
  handleClick: (e: SyntheticEvent<HTMLElement>, row: Row<TData>) => void;
  topCell?: Cell<TData, unknown> | null;
  isRowSpan?: boolean;
};

export type PaginationProps<TData> = {
  table: Table<TData>;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
};

export type TableNavigationProps<TData> = {
  table: Table<TData>;
  totalCount: number;
  totalPages: number;
  shortPagination: boolean;
};

export type FilterProps<TData> = {
  column: Column<TData>;
};

export type TOptions = {
  regExpOption: RegExp;
};

export type TOrder = {
  order: number;
};
