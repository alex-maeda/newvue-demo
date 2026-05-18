import { FC, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SortingState } from '@tanstack/react-table';
import { useAppSelector } from '../../../../hooks/hooks';
import TableComponent from '../../../../components/Table';
import { columnsProblemList } from './utils';
import { TProblemList } from '../../../../models/Consideration';

const ProblemList: FC = () => {
  const {
    getPatientClinicalHistory: { data },
  } = useAppSelector(({ clinical }) => clinical);
  const { patientId } = useParams();

  const [sorting, setSorting] = useState<SortingState>([
    { id: 'recorded', desc: true },
  ]);

  const problemList = useMemo(
    () =>
      patientId && data?.problemList
        ? data?.problemList?.[patientId] || []
        : [],
    [data, patientId],
  );

  return (
    <>
      <div className="title-item">
        <h1>Problem List</h1>
      </div>
      <div className="table-wrap table-without-borders">
        <TableComponent<TProblemList>
          columns={columnsProblemList}
          data={problemList || []}
          total={problemList?.length || 0}
          sorting={sorting}
          onSortingChange={setSorting}
        />
      </div>
    </>
  );
};

export default ProblemList;
