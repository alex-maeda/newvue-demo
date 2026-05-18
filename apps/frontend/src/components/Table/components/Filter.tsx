import React, { PropsWithChildren } from 'react';
import { FilterProps, TOptions } from '../types';
import DebounceInput from '../../DebounceInput';

const Filter = <TData,>({ column }: PropsWithChildren<FilterProps<TData>>) => {
  const { id, columnDef, setFilterValue, getFilterValue } = column;
  const filterValue = getFilterValue();
  const columnMeta = columnDef.meta as unknown as TOptions | undefined;

  return (
    <div className="form-group table-filter">
      <DebounceInput
        dataQa={`table-input-${id}`}
        value={(filterValue ?? '') as string}
        onChange={(val: string) => setFilterValue(val)}
        inputDataFilter={columnMeta?.regExpOption}
      />
    </div>
  );
};

export default Filter;
