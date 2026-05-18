import { useState, FC, useMemo } from 'react';
import {
  ColumnDef,
  ColumnFiltersState,
  Row,
  SortingState,
} from '@tanstack/react-table';
import { Button } from 'antd';
import { IoChevronDown } from 'react-icons/io5';
// COMPONENTS
import TableComponent from '../../../components/Table';
import Loader from '../../../components/Loader';
// REDUX
import { setCurrentPatientId } from '../../../redux/reducers/followUpReducer';
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import useSelectedFirstRow from '../../../hooks/useSelectedFirstRow';
// MODELS
import {
  TFindingDeliveryRequest,
  TFollowupRequest,
  TPeerFeedback,
} from '../../../models/PeerReview';
import { EMenuItem } from '../types';

import {
  TColumn,
  columns,
  deliveryFindingsColumn,
  followUpColumns,
} from '../utils';

const PeerFeedback: FC<{
  data: TColumn[];
  selectedFeedback: EMenuItem;
}> = ({ data, selectedFeedback }) => {
  const dispatch = useAppDispatch();
  const { isFetching } = useAppSelector(({ followUp }) => followUp);
  const [expanded, setExpanded] = useState<boolean>(true);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastName', desc: false },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const { selectedRow, setSelectedRow } = useSelectedFirstRow(data, sorting);

  const dataMemo = useMemo(() => {
    setSorting([{ id: 'lastName', desc: false }]);
    setColumnFilters([]);
    return data || [];
  }, [data]);

  const columnsMemo: ColumnDef<TColumn>[] = useMemo(() => {
    return selectedFeedback === EMenuItem.FOLLOW_UP_REQUESTS
      ? followUpColumns
      : selectedFeedback === EMenuItem.FINDING_DELIVERY
      ? deliveryFindingsColumn
      : columns;
  }, [selectedFeedback]);

  const handleRowClick = (
    row: Row<TPeerFeedback | TFollowupRequest | TFindingDeliveryRequest>,
  ) => {
    dispatch(setCurrentPatientId(row.original.id));
    setSelectedRow({ [row.index]: true });
  };

  return (
    <div
      className={`table-panel ${expanded ? 'expanded' : ''} ${
        isFetching && expanded ? 'loading' : ''
      }`}
    >
      <div className="panel-header">
        {isFetching && expanded ? (
          <Loader />
        ) : (
          <div className="panel-title wide-center stack">
            <div className="stack-item">
              <h1>{selectedFeedback}</h1>
            </div>
            <Button
              type="primary"
              shape="circle"
              className={`expand-header-icon ${
                expanded ? 'expand-icon' : 'collapse-icon'
              } `}
              icon={<IoChevronDown size={24} color="#282C34" />}
              onClick={() => setExpanded((prev) => !prev)}
            />
          </div>
        )}
      </div>
      <div className="panel-body">
        {isFetching && expanded ? (
          <Loader />
        ) : (
          <div className="table-wrap double-table">
            <TableComponent<TColumn>
              columns={columnsMemo}
              data={dataMemo}
              total={dataMemo.length}
              sorting={sorting}
              onSortingChange={setSorting}
              isSelectable
              isDoubleRowTable
              onRowSelectionChange={setSelectedRow}
              handleRowClick={handleRowClick}
              rowSelection={selectedRow}
              onFilterChange={setColumnFilters}
              filters={columnFilters}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PeerFeedback;
