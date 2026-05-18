import { FC, useState, useMemo, useEffect } from 'react';

import { TCommonData } from '../../../../models/Consideration';
import { EExaminations } from '../../../../models/enums';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';

import CardList from '../../../../components/CardList';

const PhysicianNotes: FC = () => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
  } = useAppSelector(({ clinical }) => clinical);

  const dispatch = useAppDispatch();

  const [showList, setShowList] = useState(true);

  const physicianNotes = useMemo(() => {
    const notes = data?.physicianNotes || [];
    // Sort by date in descending order (newest first)
    return [...notes].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [data]);

  useEffect(() => {
    if (
      currentExamination?.id &&
      currentExamination?.type === EExaminations.PHYSICIAN_NOTES
    ) {
      setShowList(false);
    } else if (!currentExamination) {
      setShowList(true);
    }
  }, [currentExamination]);

  const handleNoteClick = (note: TCommonData) => {
    dispatch(
      setCurrentExamination({
        ...note,
        type: EExaminations.PHYSICIAN_NOTES,
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
            <h1>Clinical Notes</h1>
          </div>
          <CardList
            items={physicianNotes}
            onItemClick={handleNoteClick}
            noDataMessage="No clinical notes available"
            getBadgeLabel={(item) => item.title}
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
                (physicianNotes.length ? physicianNotes[0].title : '')}
            </h1>
          </div>
          <div className="text-view">
            {!!physicianNotes.length && currentExamination?.description && (
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

export default PhysicianNotes;
