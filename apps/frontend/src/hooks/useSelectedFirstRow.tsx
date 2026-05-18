import {
  OnChangeFn,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table';
import { useEffect, useState } from 'react';

import { TColumn } from '../pages/FollowUp/utils';

import { setCurrentPatientId } from '../redux/reducers/followUpReducer';

import { useAppDispatch } from './hooks';

import { defaultSortFn } from '../utils/GeneralUtil';

const useSelectedFirstRow = (
  data: TColumn[],
  sorting: SortingState,
): {
  selectedRow: RowSelectionState;
  setSelectedRow: OnChangeFn<RowSelectionState>;
} => {
  const dispatch = useAppDispatch();
  const [selectedRow, setSelectedRow] = useState<RowSelectionState>({
    0: true,
  });

  useEffect(() => {
    if (data.length) {
      const { id, desc } = sorting?.[0];
      if (id === 'lastName' && !desc) {
        dispatch(setCurrentPatientId(data[0].id));
        setSelectedRow({
          0: true,
        });
        return;
      }

      const sortedData = [...data];
      const key = id as keyof TColumn;

      sortedData.sort((a, b) => {
        const first = a[key];
        const second = b[key];

        if (!first || !second) {
          return 0;
        }

        if (desc) {
          return defaultSortFn(String(second), String(first));
        } else {
          return defaultSortFn(String(first), String(second));
        }
      });

      const nextId = sortedData[0];

      const index = data.indexOf(nextId);

      setSelectedRow({
        [index]: true,
      });

      dispatch(setCurrentPatientId(nextId));
    }
  }, [data]);

  return { selectedRow, setSelectedRow };
};

export default useSelectedFirstRow;
