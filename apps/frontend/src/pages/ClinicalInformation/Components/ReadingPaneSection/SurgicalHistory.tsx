import { FC, useState, useMemo, useEffect } from 'react';
import { Row, SortingState } from '@tanstack/react-table';

import { TSurgicalHistory } from '../../../../models/Consideration';
import { EExaminations } from '../../../../models/enums';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';

import TableComponent from '../../../../components/Table';

import { columnsSurgicalHistory } from './utils';

const SurgicalHistory: FC = () => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
  } = useAppSelector(({ clinical }) => clinical);

  const dispatch = useAppDispatch();

  const [showList, setShowList] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'date', desc: true },
  ]);

  const surgicalHistory = useMemo(() => {
    return data?.surgicalHistory || [];
  }, [data]);

  useEffect(() => {
    if (
      currentExamination?.id &&
      currentExamination?.type === EExaminations.SURGICAL_HISTORY
    ) {
      setShowList(false);
    } else if (!currentExamination) {
      setShowList(true);
    }
  }, [currentExamination]);

  const handleRowClick = (row: Row<TSurgicalHistory>) => {
    if (row.original.id) {
      dispatch(
        setCurrentExamination({
          ...row.original,
          type: EExaminations.SURGICAL_HISTORY,
        }),
      );
      setShowList(false);
    }
  };

  const handleBackToList = () => {
    setShowList(true);
  };

  return (
    <>
      {showList ? (
        <>
          <div className="title-item">
            <h1>Surgical History</h1>
          </div>
          <div className="table-wrap table-without-borders">
            <TableComponent<TSurgicalHistory>
              columns={columnsSurgicalHistory}
              data={surgicalHistory}
              total={surgicalHistory.length}
              sorting={sorting}
              onSortingChange={setSorting}
              handleRowClick={handleRowClick}
            />
          </div>
        </>
      ) : (
        <>
          <div className="title-item">
            <button
              className="back-to-list-btn"
              onClick={handleBackToList}
              type="button"
            >
              ← Back to list
            </button>
            <h1>{currentExamination?.title || 'Surgical Procedure'}</h1>
          </div>
          <div className="text-view">
            {!!surgicalHistory.length && currentExamination?.description && (
              <ul>
                {currentExamination.description.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default SurgicalHistory;
