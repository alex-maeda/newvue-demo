import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Column, ColumnOrderState, flexRender } from '@tanstack/react-table';
import { Button, Tooltip } from 'antd';
import { useDrop, useDrag } from 'react-dnd';
import { MdFilterAlt, MdFilterAltOff } from 'react-icons/md';
import { HeaderCellProps, TOrder } from '../types';
import Filter from './Filter';
import DateFilter from './DateFilter';
import { defaultSortIcon } from '../../../assets/img/sort';
import { ascSortIcon } from '../../../assets/img/sort_asc';
import { descSortIcon } from '../../../assets/img/sort_desc';
import { useAppSelector } from '../../../hooks/hooks';

const HeaderCell = <TData,>({
  header,
  topHeader,
  table,
  isFirst,
  isRowSpan,
}: PropsWithChildren<HeaderCellProps<TData>>) => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const { getState, setColumnOrder } = table;
  const { columnOrder } = getState();
  const { column, id } = header;
  const [isFilterOpen, setIsFilterOpen] = useState(!!column.getFilterValue());

  const tableTdRef = useRef<HTMLTableCellElement>(null);
  const [isShowTooltip, setIsShowTooltip] = useState<boolean>(false);

  const sortDirection = column.getIsSorted();

  const reorderColumn = useCallback(
    (
      draggedColumn: Column<TData>,
      targetColumn: Column<TData>,
      columnOrder: string[],
    ): ColumnOrderState => {
      const {
        id: draggedColumnId,
        columnDef: { meta: draggedColumnMeta },
      } = draggedColumn;
      const {
        id: targetColumnId,
        columnDef: { meta: targetColumnMeta },
      } = targetColumn;

      const { order: draggedColumnOrder } = draggedColumnMeta as TOrder;
      const { order: targetColumnOrder } = targetColumnMeta as TOrder;

      if (
        draggedColumnOrder &&
        targetColumnOrder &&
        draggedColumnOrder !== targetColumnOrder
      ) {
        draggedColumn.columnDef.meta = { order: targetColumnOrder };
        targetColumn.columnDef.meta = { order: draggedColumnOrder };
      }

      columnOrder.splice(
        columnOrder.indexOf(targetColumnId),
        0,
        columnOrder.splice(
          columnOrder.indexOf(draggedColumnId),
          1,
        )[0] as string,
      );
      return [...columnOrder];
    },
    [],
  );

  const [, dropRef] = useDrop({
    accept: 'column',
    drop: (draggedColumn: Column<TData>) => {
      const newColumnOrder = reorderColumn(draggedColumn, column, columnOrder);
      setColumnOrder(newColumnOrder);
    },
  });

  const [{ isDragging }, dragRef, previewRef] = useDrag({
    collect: (monitor) => ({
      isDragging: column.getCanPin() ? false : monitor.isDragging(),
    }),
    item: () => column,
    type: 'column',
  });

  const handleChangeFilterState = () => {
    setIsFilterOpen(!isFilterOpen);
  };

  useEffect(() => {
    !isFilterOpen && column.setFilterValue('');
  }, [isFilterOpen]);

  const cellWidth = (topHeader || header).getSize();

  useEffect(() => {
    if (tableTdRef.current) {
      const spanWidth = tableTdRef.current?.querySelector('span')?.offsetWidth;

      const paddingRight = parseInt(
        getComputedStyle(tableTdRef.current).paddingRight,
      );

      setIsShowTooltip(!!spanWidth && spanWidth > cellWidth - paddingRight);
    }
  }, [tableTdRef.current, cellWidth]);

  return (
    <th
      rowSpan={isRowSpan ? 2 : 1}
      id={id}
      ref={column.getCanPin() ? null : dropRef}
      style={{
        maxWidth: isFirst ? header.getSize() : topHeader?.getSize(),
        opacity: isDragging ? 0.5 : 1,
        height: isFilterOpen ? '60px' : '30px',
      }}
    >
      <div className="filter_col-wrap" ref={previewRef}>
        <div
          className={`filter_sort-wrap ${
            isFirst && column.getCanResize() ? 'resize-allowed' : ''
          } ${header.column.getIsResizing() ? 'isResizing' : ''}`}
          style={{
            paddingRight:
              column.getCanSort() && column.getCanFilter()
                ? '40px'
                : column.getCanSort()
                ? '20px'
                : '5px',
          }}
          ref={tableTdRef}
        >
          {isShowTooltip ? (
            <Tooltip
              placement="top"
              title={<>{column.columnDef.header}</>}
              arrow={true}
              trigger="hover"
              destroyTooltipOnHide={true}
            >
              <span
                className="header-title"
                ref={column.getCanPin() ? null : dragRef}
              >
                {
                  flexRender(
                    column.columnDef.header,
                    header.getContext(),
                  ) as string
                }
              </span>
            </Tooltip>
          ) : (
            <span
              className="header-title"
              ref={column.getCanPin() ? null : dragRef}
            >
              {flexRender(column.columnDef.header, header.getContext())}
            </span>
          )}
          <div className="action-btn">
            {column.getCanSort() && column.columnDef.header && (
              <Button
                type="link"
                className="table-button-sort btn-sort"
                icon={
                  sortDirection
                    ? sortDirection === 'asc'
                      ? ascSortIcon(isKonicaBranding)
                      : descSortIcon(isKonicaBranding)
                    : defaultSortIcon(isKonicaBranding)
                }
                onClick={column.getToggleSortingHandler()}
              />
            )}
            {column.getCanFilter() && (
              <Button
                type="link"
                className="table-button-sort btn-sort"
                icon={
                  isFilterOpen ? (
                    <MdFilterAltOff className="purple" size={18} />
                  ) : (
                    <MdFilterAlt className="purple" size={18} />
                  )
                }
                onClick={handleChangeFilterState}
              />
            )}
          </div>
          {column.getCanResize() && (
            <div
              className="resizer"
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
            >
              <div />
            </div>
          )}
        </div>

        {isFilterOpen && column.getCanFilter() ? (
          <div>
            {id.toLowerCase().includes('date') ? (
              <DateFilter column={column} />
            ) : (
              <Filter column={column} />
            )}
          </div>
        ) : null}
      </div>
    </th>
  );
};

export default HeaderCell;
