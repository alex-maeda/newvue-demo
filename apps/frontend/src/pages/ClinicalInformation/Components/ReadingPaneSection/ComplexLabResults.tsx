import { FC, useState, useMemo } from 'react';

import { TLabResults } from '../../../../models/Consideration';

import { useAppSelector } from '../../../../hooks/hooks';

import CardList from '../../../../components/CardList';

const ComplexLabResults: FC = () => {
  const {
    getPatientClinicalHistory: { data },
  } = useAppSelector(({ clinical }) => clinical);

  const [selectedLabId, setSelectedLabId] = useState<number | null>(null);

  const labResults = useMemo(() => {
    const labs = data?.labResults || [];
    // Sort by date in descending order (newest first)
    return [...labs].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [data]);

  const selectedLab = useMemo(
    () => labResults.find((lab) => lab.id === selectedLabId),
    [labResults, selectedLabId],
  );

  const handleLabClick = (lab: TLabResults) => {
    setSelectedLabId(lab.id);
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
            items={labResults}
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
            {selectedLab && (
              <div className="lab-results-tables">
                {selectedLab.panels.map((panel, panelIndex) => (
                  <div key={panelIndex} className="lab-section">
                    <table className="lab-table">
                      <thead>
                        <tr className="header-row">
                          <th>{panel.panelName}</th>
                          {panel.dates.map((date, dateIndex) => (
                            <th key={dateIndex}>{date}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {panel.tests.map((test, testIndex) => (
                          <tr key={testIndex}>
                            <td className="test-name">{test.test}</td>
                            {test.values.map((value, valueIndex) => (
                              <td key={valueIndex}>{value}</td>
                            ))}
                            {test.trend && <td>{test.trend}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default ComplexLabResults;
