import { FC, useState, useMemo, useEffect } from 'react';

import { EExaminations } from '../../../../models/enums';
import { TCommonData } from '../../../../models/Consideration';

import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';

import CardList from '../../../../components/CardList';

const Pathology: FC = () => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
  } = useAppSelector(({ clinical }) => clinical);

  const dispatch = useAppDispatch();

  const [showList, setShowList] = useState(true);

  const pathology = useMemo(() => {
    const reports = data?.pathalogy || [];
    // Sort by date in descending order (newest first)
    return [...reports].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [data]);

  useEffect(() => {
    if (
      currentExamination?.id &&
      currentExamination?.type === EExaminations.PATHOLOGY
    ) {
      setShowList(false);
    } else if (!currentExamination) {
      setShowList(true);
    }
  }, [currentExamination]);

  const handlePathologyClick = (report: TCommonData) => {
    dispatch(
      setCurrentExamination({
        ...report,
        type: EExaminations.PATHOLOGY,
      }),
    );
    setShowList(false);
  };

  const handleBackToList = () => {
    setShowList(true);
  };

  return (
    <>
      {showList ? (
        <>
          <div className="title-item">
            <h1>Pathology</h1>
          </div>
          <CardList
            items={pathology}
            onItemClick={handlePathologyClick}
            noDataMessage="No pathology reports available"
          />
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
            <h1>
              {currentExamination?.title ||
                (pathology.length ? pathology[0].title : '')}
            </h1>
          </div>
          <div className="text-view">
            {!!pathology.length && currentExamination?.description && (
              <div className="pathology-report">
                {currentExamination.description.map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default Pathology;
