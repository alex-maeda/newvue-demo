import { FC, useState, useMemo } from 'react';
import { SortingState } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import { TMedications } from '../../../../models/Consideration';

import { useAppSelector } from '../../../../hooks/hooks';

import TableComponent from '../../../../components/Table';

import { columnsMedications } from './utils';

const Medications: FC = () => {
  const {
    getPatientClinicalHistory: { data },
  } = useAppSelector(({ clinical }) => clinical);
  const { patientId } = useParams();

  const [sorting, setSorting] = useState<SortingState>([]);

  const medications = useMemo(
    () => data?.medications?.[patientId as string] || [],
    [data, patientId],
  );

  return (
    <>
      <div className="title-item">
        <h1>Medications</h1>
      </div>
      <div className="table-wrap table-without-borders">
        <TableComponent<TMedications>
          columns={columnsMedications}
          data={medications || []}
          total={medications?.length || 0}
          sorting={sorting}
          onSortingChange={setSorting}
        />
      </div>
    </>
  );
};

export default Medications;
