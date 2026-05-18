import { FC, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ERate } from '../../../../models/enums';

import { useAppSelector } from '../../../../hooks/hooks';

const AiResults: FC = () => {
  const {
    getPatientClinicalHistory: { data },
  } = useAppSelector(({ clinical }) => clinical);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  const { patientId } = useParams();

  const [rate, setRate] = useState<ERate[]>([]);

  const aiResults = useMemo(
    () => (patientId && data?.aiResults ? data?.aiResults[patientId] : []),
    [data],
  );

  const handleRate = (value: ERate, index: number) => {
    setRate((prevValue) => {
      const newArr = [...prevValue];
      if (!!newArr[index] && newArr[index] === value) {
        newArr[index] = ERate.NOT_RATE;
      } else {
        newArr[index] = value;
      }
      return newArr;
    });
  };

  return (
    <>
      <div className="title-item">
        <h1>AI Results</h1>
      </div>
      <div className="ai-result">
        {!!aiResults?.length &&
          aiResults.map((item, index) => (
            <div key={index}>
              <ul>
                <span>{item.title}</span>
                {item.options.map((opt, i) => (
                  <li key={i}>{opt}</li>
                ))}
              </ul>
              <div
                className={`like-wrapper${
                  isKonicaBranding ? ' isKonicaBranding' : ''
                }`}
              >
                <span
                  className={`like-btn ${
                    rate[index] === ERate.LIKE ? 'active' : ''
                  }`}
                  onClick={() => handleRate(ERate.LIKE, index)}
                />
                <span
                  className={`dislike-btn ${
                    rate[index] === ERate.DISLIKE ? 'active' : ''
                  }`}
                  onClick={() => handleRate(ERate.DISLIKE, index)}
                />
              </div>
            </div>
          ))}
      </div>
    </>
  );
};

export default AiResults;
