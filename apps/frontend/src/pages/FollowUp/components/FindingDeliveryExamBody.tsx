import { FC } from 'react';
import { TExamHistory } from '../../../redux/types/followUpTypes';
import { useAppSelector } from '../../../hooks/hooks';
import { TFindingDeliveryRequest } from '../../../models/PeerReview';
import { formateDateTime } from '../../../utils/DateUtils';
// import { formateDateTime } from '../../../utils/DateUtils';
// import { TFindingDeliveryRequest, TFindingDeliveryRequestSaved, TFollowupRequestSaved } from '../../../models/PeerReview';

const FindingDeliveryExamBody: FC<{
  historyItem: TExamHistory;
  active: number | undefined;
}> = ({ historyItem, active }) => {
  console.log('historyItem', historyItem);
  const { findingDelivery, currentPatientId } = useAppSelector(
    ({ followUp }) => followUp,
  );
  const { user } = useAppSelector(({ auth }) => auth);

  const currentExam = (findingDelivery.find(
    (i) => String(i.id) === String(currentPatientId),
  ) ?? {}) as TFindingDeliveryRequest;
  // const dataFollowup = historyItem.data as TFindingDeliveryRequest;
  return (
    <>
      <div
        id={`section${historyItem.id}`}
        className={active === historyItem.id ? 'active' : ''}
      >
        <div>
          <h2>Review Submitted:</h2>
          <p>{currentExam?.findingSeverity || '-'}</p>
        </div>
        <div>
          <span>Comment:</span>
          <p>{currentExam?.comment || '-'}</p>
        </div>
        <div>
          <span>Reporting Radiologist:</span>
          <p>
            {user?.firstName} {user?.lastName}
          </p>
        </div>
        <div>
          <span>Result Time:</span>
          <p>{formateDateTime(historyItem.date)}</p>
          {/* <p>
            {currentExam.time ? formateDateTime(String(currentExam.time)) : '-'}
          </p> */}
        </div>
      </div>
    </>
  );
};

export default FindingDeliveryExamBody;
