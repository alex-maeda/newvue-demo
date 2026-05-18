import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { flexRender } from '@tanstack/react-table';
import { Tooltip } from 'antd';

import { TableCellProps } from '../types';

const TableBodyCell = <TData,>({
  cell,
  row,
  handleClick,
  topCell,
  isRowSpan,
}: PropsWithChildren<TableCellProps<TData>>) => {
  const tableTdRef = useRef<HTMLTableCellElement>(null);
  const [isShowTooltip, setIsShowTooltip] = useState<boolean>(false);
  const cellWidth = (topCell || cell).column.getSize();

  useEffect(() => {
    if (tableTdRef.current) {
      const span = tableTdRef.current?.querySelector('span')?.offsetWidth;
      const hasMatch = tableTdRef.current?.querySelector('b');
      if (hasMatch && tableTdRef.current.className !== 'mark-td') {
        tableTdRef.current.classList.add('mark-td');
      }
      setIsShowTooltip(!!span && span > cellWidth);
    }
  }, [tableTdRef.current, cellWidth]);

  return (
    <td
      rowSpan={isRowSpan ? 2 : 1}
      ref={tableTdRef}
      key={cell.id}
      id={cell.id}
      style={{
        maxWidth: (topCell || cell).column.getSize(),
      }}
      onClick={(e) => handleClick(e, row)}
    >
      {!cell.column.columnDef.meta?.disableTooltip && isShowTooltip ? (
        <Tooltip
          placement="top"
          title={<>{cell.getContext().getValue()}</>}
          arrow={true}
          trigger="hover"
          destroyTooltipOnHide={true}
        >
          <span>
            {
              flexRender(
                cell.column.columnDef.cell,
                cell.getContext(),
              ) as string
            }
          </span>
        </Tooltip>
      ) : (
        <span>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
      )}
    </td>
  );
};

export default TableBodyCell;
