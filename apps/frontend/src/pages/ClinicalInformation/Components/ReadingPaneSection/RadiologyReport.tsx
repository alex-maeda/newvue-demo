import { FC, useState, useMemo, useEffect } from 'react';

import { TCommonData } from '../../../../models/Consideration';
import { EExaminations } from '../../../../models/enums';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';

import CardList from '../../../../components/CardList';

const RadiologyReport: FC = () => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
  } = useAppSelector(({ clinical }) => clinical);

  const dispatch = useAppDispatch();

  const [showList, setShowList] = useState(true);

  const radiologyReport = useMemo(() => {
    const reports = data?.radiologyReport || [];
    // Sort by date in descending order (newest first)
    return [...reports].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [data]);

  useEffect(() => {
    if (
      currentExamination?.id &&
      currentExamination?.type === EExaminations.RADIOLOGY
    ) {
      setShowList(false);
    } else if (!currentExamination) {
      setShowList(true);
    }
  }, [currentExamination]);

  const handleReportClick = (report: TCommonData) => {
    dispatch(
      setCurrentExamination({
        ...report,
        type: EExaminations.RADIOLOGY,
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
            <h1>Radiology Reports</h1>
          </div>
          <CardList
            items={radiologyReport}
            onItemClick={handleReportClick}
            noDataMessage="No radiology reports available"
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
                (radiologyReport.length ? radiologyReport[0].title : '')}
            </h1>
          </div>
          <div className="text-view">
            {!!radiologyReport.length && currentExamination?.description && (
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

export default RadiologyReport;
