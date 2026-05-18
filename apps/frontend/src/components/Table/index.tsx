import {
  Fragment,
  PropsWithChildren,
  SyntheticEvent,
  memo,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Cell,
  ColumnOrderState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  Header,
  Row,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
// COMPONENTS
import HeaderCell from './components/HeaderCell';
import TableBodyCell from './components/TableBodyCell';
// MODELS
import { TableProps } from './types';

import { getSeparateRows } from './utils';
import { isIconClick } from '../../utils/TableUtil';

function TableComponent<TData>(props: PropsWithChildren<TableProps<TData>>) {
  const {
    data,
    columns,
    sorting,
    filters,
    rowSelection = {},
    total,
    isSelectable = false,
    isDoubleRowTable = false,
    noDataTextArr = ['No matching records found'],
    onRowSelectionChange,
    onSortingChange,
    onFilterChange,
    getCustomSortedRowModel,
    handleRowClick,
    isNeedShowHeader = true,
  } = props;

  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [highlightedGroup, setHighlightedGroup] = useState<number | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setColumnOrder(columns.map((column) => column.id as string));
  }, [columns]);

  const table = useReactTable<TData>({
    data,
    columns: columns,
    state: {
      sorting,
      columnFilters: filters,
      rowSelection,
      columnOrder,
    },
    columnResizeMode: 'onChange',
    enableRowSelection: true,
    enableMultiRowSelection: true,
    onColumnOrderChange: setColumnOrder,
    onSortingChange: onSortingChange,
    onRowSelectionChange,
    onColumnFiltersChange: onFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getCustomSortedRowModel
      ? getCustomSortedRowModel()
      : getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const handleClick = (e: SyntheticEvent<HTMLElement>, row: Row<TData>) => {
    e.stopPropagation();
    e.preventDefault();

    if (isSelectable) {
      table.resetRowSelection();
      row.toggleSelected();
    }

    handleRowClick && handleRowClick(row, !isSelectable);
  };

  const handleRowMouseEnter = (
    e: SyntheticEvent<HTMLElement>,
    group: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setHighlightedGroup(group);
  };

  const handleRowMouseLeave = (e: SyntheticEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setHighlightedGroup(null);
  };

  const handleDoubleClick = (
    event: React.MouseEvent<HTMLTableRowElement, MouseEvent>,
    row: Row<TData>,
  ) => {
    if (isIconClick(event.target as HTMLElement)) {
      return;
    }

    !!handleRowClick && handleRowClick(row);
  };

  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 35,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows?.[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0)
      : 0;

  return (
    <div ref={tableContainerRef} className="table-scroll">
      <table
      // style={{
      //   width: table.getCenterTotalSize(),
      // }}
      >
        {isNeedShowHeader && (
          <thead
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 6,
            }}
          >
            {table.getHeaderGroups().map((headerGroup, index) => {
              const {
                firstRow,
                secondRow = [],
                isSecondRow = false,
              } = isDoubleRowTable
                ? getSeparateRows<TData, Header<TData, unknown>>(
                    headerGroup.headers,
                  )
                : { firstRow: headerGroup.headers };
              return (
                <Fragment key={index}>
                  <tr key={`first_${index}`}>
                    {firstRow.map((header, firstRowIndex) => {
                      if (!header) {
                        return <th key={firstRowIndex} />;
                      }

                      return (
                        <HeaderCell<TData>
                          key={header.id}
                          header={header}
                          table={table}
                          isFirst={true}
                          isRowSpan={header.id === 'timer' && isSecondRow}
                        />
                      );
                    })}
                  </tr>
                  {isSecondRow && (
                    <tr key={`second_${index}`}>
                      {secondRow.map((header, secondRowIndex) => {
                        const topHeader = firstRow[secondRowIndex - 1];
                        if (!header) {
                          return <th key={secondRowIndex} />;
                        }
                        return (
                          <HeaderCell<TData>
                            key={header.id}
                            header={header}
                            topHeader={topHeader}
                            table={table}
                          />
                        );
                      })}
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </thead>
        )}

        {total > 0 ? (
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index] as Row<TData>;
              const addFocusRowClass = isSelectable && row?.getIsSelected();
              const {
                firstRow,
                secondRow = [],
                isSecondRow = false,
              } = isDoubleRowTable
                ? getSeparateRows<TData, Cell<TData, unknown>>(
                    row.getVisibleCells(),
                  )
                : { firstRow: row.getVisibleCells() };

              // const isRowMatched = matchedPatientIndexes.includes(row.index);

              return (
                <Fragment key={row.index}>
                  <tr
                    key={`first_${row.index}`}
                    onMouseEnter={(e) => handleRowMouseEnter(e, row.index)}
                    onMouseLeave={handleRowMouseLeave}
                    onDoubleClick={(e) => handleDoubleClick(e, row)}
                    className={
                      highlightedGroup === row.index || addFocusRowClass
                        ? 'highlighted'
                        : ''
                    }
                  >
                    {firstRow.map((cell, index) => {
                      if (!cell) {
                        return <td key={`header_${index}`} />;
                      }

                      return (
                        <TableBodyCell<TData>
                          key={cell.id}
                          cell={cell}
                          row={row}
                          handleClick={handleClick}
                          isRowSpan={cell.id.includes('_timer') && isSecondRow}
                        />
                      );
                    })}
                  </tr>
                  {isSecondRow && (
                    <tr
                      key={`second_${row.index}`}
                      onMouseEnter={(e) => handleRowMouseEnter(e, row.index)}
                      onMouseLeave={handleRowMouseLeave}
                      onDoubleClick={(e) => handleDoubleClick(e, row)}
                      className={
                        highlightedGroup === row.index || addFocusRowClass
                          ? 'highlighted'
                          : ''
                      }
                    >
                      {secondRow.map((cell, index) => {
                        const topCell = firstRow[index - 1];
                        if (!cell) {
                          return <td key={`header_${index}`} />;
                        }
                        return (
                          <TableBodyCell<TData>
                            key={cell.id}
                            cell={cell}
                            row={row}
                            handleClick={handleClick}
                            topCell={topCell || null}
                          />
                        );
                      })}
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        ) : (
          <tbody>
            <tr className="no-border">
              <td colSpan={columns?.length}>
                <div className="no-data">
                  {!!noDataTextArr?.length &&
                    noDataTextArr.map((x, i) => <p key={i}>{x}</p>)}
                </div>
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

export default memo(TableComponent) as typeof TableComponent;
