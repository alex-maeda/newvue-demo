import { FC } from 'react';
import { Tooltip } from 'antd';

import { IPatientPeerReviewResult } from '../../redux/types/followUpTypes';

import { IPatient } from '../../models/Patient';

import { preparePatientDOB } from '../../utils/DateUtils';
import { preparePatientSex } from './utils';
import ProgressPanel from '../ProgressPanel/ProgressPanel';
import { differenceInYears } from 'date-fns';

const PatientInfoBlock: FC<{
  data: Omit<IPatient, 'timer'> | IPatientPeerReviewResult['patientData'];
}> = ({ data }) => {
  // const [isExpanded, setIsExpanded] = useState(false);
  const birthDate = new Date(data.DOB);
  const currentDate = new Date();
  const age = differenceInYears(currentDate, birthDate);

  return (
    <div className="patient-info">
      <div className="patient-info-row">
        <div className="patient-section">
          <h3>
            {`${data.firstName} ${data.lastName}`}&nbsp;
            <span>{preparePatientSex[data.sex]}</span>
          </h3>
          <p>
            Age {data.DOB && age ? age : ''} • DOB{' '}
            {(data.DOB && preparePatientDOB(data.DOB)) || ''} • MRN{' '}
            {data.MRN ?? ''} •
            <Tooltip
              placement="right"
              trigger="hover"
              title={<p>{data.allergies}</p>}
              destroyTooltipOnHide={true}
            >
              <span className="mark">
                {' '}
                Allergies:{' '}
                {data.allergies?.length ? data.allergies : 'No Known Allergies'}
              </span>
            </Tooltip>
          </p>
        </div>
        <div className="exam-section">
          <h4>
            {(data as IPatientPeerReviewResult['patientData']).prevType
              ? `${
                  (data as IPatientPeerReviewResult['patientData']).prevType
                } - `
              : ''}
            {data.examDescription}
          </h4>
          <p>
            Acc {data.accession ?? ''} • Date {data.examDate ?? ''} • Location{' '}
            {data.orderedLocation ?? ''} • Ordered by {data.orderedBy ?? ''} •
            Care provider {data.assignedTo ?? ''}
          </p>
        </div>
      </div>

      {/* <div className="clinical-indication">
        <button
          className={`indication-toggle ${isExpanded ? 'expanded' : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="indication-text">
            {data.DOB && age ? `${age}F` : ''} {data.clinicalIndications ?? ''}
            {data.examDescription ? ` — ${data.examDescription}` : ''}
          </span>
          <span className="dropdown-icon">▼</span>
        </button>
      </div> */}

      {false && <ProgressPanel />}
    </div>
  );
};

export default PatientInfoBlock;
