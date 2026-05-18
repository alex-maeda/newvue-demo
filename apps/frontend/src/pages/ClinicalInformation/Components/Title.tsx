import { FC } from 'react';
import { MdArrowForwardIos } from 'react-icons/md';
import { Button } from 'antd';

import { useAppSelector } from '../../../hooks/hooks';

import { formateDate } from '../../../utils/DateUtils';
import { TCommonData } from '../../../models/Consideration';
import { useParams } from 'react-router-dom';

const Title: FC<{
  title: string;
  data: TCommonData[];
  setShowTable: (value: boolean) => void;
}> = ({ title, data, setShowTable }) => {
  const {
    getPatientClinicalHistory: { currentExamination },
  } = useAppSelector(({ clinical }) => clinical);
  const { currentFilterId } = useAppSelector(({ filter }) => filter);

  const { patientId } = useParams();

  return (
    <div className="title">
      <>
        <div>
          <h1>{title}</h1>
          <p>
            <span>
              <strong>Acc:</strong> {currentExamination?.accession || '-'}
            </span>
            <span>
              <strong>Date:</strong>{' '}
              {currentExamination?.date && !!data.length
                ? formateDate(currentExamination?.date as string)
                : '-'}
            </span>
          </p>
        </div>
        {(!!data.length ||
          ((patientId === String(1) || patientId === String(2)) &&
            currentFilterId === 0)) && (
          <Button
            className="btn-link"
            type="link"
            onClick={() => setShowTable(true)}
          >
            View Full List
            <MdArrowForwardIos className="icon" />
          </Button>
        )}
      </>
    </div>
  );
};

export default Title;
