import { FC } from 'react';
import { TExamHistory } from '../../../redux/types/followUpTypes';
import { formateDateTime } from '../../../utils/DateUtils';
import { TFollowupRequestSaved } from '../../../models/PeerReview';

const FollowupExamBody: FC<{
  historyItem: TExamHistory;
  active: number | undefined;
}> = ({ historyItem, active }) => {
  const dataFollowup = historyItem.data as TFollowupRequestSaved;
  return (
    <>
      <div
        id={`section${historyItem.id}`}
        className={active === historyItem.id ? 'active' : ''}
      >
        <div>
          <h2>Follow-up Request:</h2>
          <p>{dataFollowup?.meaning}</p>
        </div>
        <div>
          <span>Key finding:</span>
          <p>{dataFollowup?.keyFinding}</p>
        </div>
        <div>
          <span>Radiologist:</span>
          <p>{dataFollowup?.radiologist}</p>
        </div>
        <div>
          <span>Date of finding:</span>
          <p>{formateDateTime(historyItem?.date)}</p>
        </div>
      </div>
    </>
  );
};

export default FollowupExamBody;
