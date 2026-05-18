import { FC, useMemo } from 'react';

import { TVisitHistory } from '../../../../models/Consideration';

import { useAppSelector } from '../../../../hooks/hooks';

import SimpleLabResults from './SimpleLabResults';
import ComplexLabResults from './ComplexLabResults';

const LabResults: FC = () => {
  const {
    getPatientClinicalHistory: { data },
  } = useAppSelector(({ clinical }) => clinical);

  const labResults = useMemo(() => data?.labResults || [], [data]);

  const simpleLabResults = useMemo(() => {
    if (!data?.visitHistory) return [];
    return data.visitHistory.filter(
      (item: TVisitHistory) => item.type === 'labResults',
    );
  }, [data]);

  const hasComplexLabs = labResults.length > 0 && 'panels' in labResults[0];

  if (hasComplexLabs) {
    return <ComplexLabResults />;
  }

  if (simpleLabResults.length > 0) {
    return <SimpleLabResults />;
  }

  return (
    <>
      <div className="title-item">
        <h1>Lab Results</h1>
      </div>
      <div className="text-view">
        <p>No lab results available</p>
      </div>
    </>
  );
};

export default LabResults;
