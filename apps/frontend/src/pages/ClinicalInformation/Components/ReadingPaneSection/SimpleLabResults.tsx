import { FC, useState, useMemo, useEffect } from 'react';

import { TVisitHistory } from '../../../../models/Consideration';

import { useAppSelector } from '../../../../hooks/hooks';

import CardList from '../../../../components/CardList';

const SimpleLabResults: FC = () => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
  } = useAppSelector(({ clinical }) => clinical);

  const [selectedLabId, setSelectedLabId] = useState<number | null>(null);

  // Auto-select lab if currentExamination is set
  useEffect(() => {
    if (
      currentExamination &&
      currentExamination.type === 'labResults' &&
      currentExamination.id
    ) {
      setSelectedLabId(currentExamination.id);
    } else if (!currentExamination) {
      setSelectedLabId(null);
    }
  }, [currentExamination]);

  const simpleLabResults = useMemo(() => {
    if (!data?.visitHistory) return [];
    const labs = data.visitHistory.filter(
      (item: TVisitHistory) => item.type === 'labResults',
    );
    // Sort by date in descending order (newest first)
    return [...labs].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [data]);

  const selectedLab = useMemo(
    () => simpleLabResults.find((lab) => lab.id === selectedLabId),
    [simpleLabResults, selectedLabId],
  );

  const handleLabClick = (lab: TVisitHistory) => {
    if (lab.id) {
      setSelectedLabId(lab.id);
    }
  };

  const handleBackToList = () => {
    setSelectedLabId(null);
  };

  return (
    <>
      {!selectedLabId ? (
        <>
          <div className="title-item">
            <h1>Lab Results</h1>
          </div>
          <CardList
            items={simpleLabResults}
            onItemClick={handleLabClick}
            noDataMessage="No lab results available"
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
            <h1>{selectedLab?.title || 'Lab Results'}</h1>
          </div>
          <div className="text-view">
            {selectedLab && selectedLab.description && (
              <div className="simple-lab-results">
                {selectedLab.description.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default SimpleLabResults;
