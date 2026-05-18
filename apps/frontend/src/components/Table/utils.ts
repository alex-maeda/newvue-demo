import { Cell, Header } from '@tanstack/react-table';
import { TOrder } from './types';
type UnionType<TData> = Cell<TData, unknown> | Header<TData, unknown>;

export const getSeparateRows = <TData, TCell extends UnionType<TData>>(
  rows: TCell[],
) => {
  const firstRow: (TCell | null)[] = [];
  const secondRow: (TCell | null)[] = [];
  let count = 0;
  rows.forEach((row) => {
    const {
      column: { columnDef },
    } = row;
    const order = (columnDef.meta as TOrder)?.order || 0;

    if (order === 1) {
      firstRow.push(row);
    } else if (order === 2) {
      secondRow.push(row);
      count += 1;
    } else {
      firstRow.push(row);
      secondRow.push(null);
    }
  });

  const isSecondRow = count > 0;

  // if (isSecondRow && firstRow.length > secondRow.length) {
  //   secondRow = secondRow.concat(
  //     new Array(firstRow.length - secondRow.length - 1).fill(null) as null[],
  //   );
  // }
  // if (isSecondRow && secondRow.length > firstRow.length) {
  //   firstRow = firstRow.concat(
  //     new Array(secondRow.length - firstRow.length + 1).fill(null) as null[],
  //   );
  // }

  return {
    firstRow,
    secondRow,
    isSecondRow,
  };
};
