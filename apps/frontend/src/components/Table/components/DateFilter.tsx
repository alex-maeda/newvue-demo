import { PropsWithChildren } from 'react';
import { DatePicker } from 'antd';
import { FilterProps } from '../types';
import { Dayjs } from 'dayjs';

const DateFilter = <TData,>({
  column,
}: PropsWithChildren<FilterProps<TData>>) => {
  const { setFilterValue } = column;

  const onRangeChange = (
    dates: null | (Dayjs | null)[],
    dateStrings: string[],
  ) => {
    if (dates) {
      setFilterValue(`${dateStrings[0]} - ${dateStrings[1]}`);
    } else {
      setFilterValue('');
    }
  };

  return (
    <DatePicker.RangePicker
      format={'MM/DD/YYYY'}
      onChange={onRangeChange}
      style={{
        width: '100%',
        maxHeight: 30,
        fontWeight: 400,
        border: '1px solid #999999',
      }}
      popupClassName="date-picker"
    />
  );
};

export default DateFilter;
