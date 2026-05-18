import { FC } from 'react';
import { TExamHistory } from '../../../redux/types/followUpTypes';
import { formateDateTime } from '../../../utils/DateUtils';
import { TPeerReviewSaved } from '../../../models/PeerReview';
import { EMenuItem } from '../types';

const PeerFeedbackExamBody: FC<{
  historyItem: TExamHistory;
  active: number | undefined;
  title?: string;
  selectedFeedback: EMenuItem;
}> = ({ historyItem, active, title, selectedFeedback }) => {
  const dataPeer = historyItem.data as TPeerReviewSaved;
  return (
    <div
      id={`section${historyItem.id}`}
      className={active === historyItem.id ? 'active' : ''}
    >
      <div>
        <h2>{title}:</h2>
        <p>{dataPeer?.meaning}</p>
      </div>
      <div>
        <span>Comment:</span>
        <p>{dataPeer?.comment}</p>
      </div>
      {selectedFeedback !== EMenuItem.ACTIONABLE_FEEDBACK &&
        dataPeer?.reviewer && (
          <div>
            <span>Reviewer:</span>
            <p>{dataPeer?.reviewer}</p>
          </div>
        )}
      <div>
        <span>Date of Review:</span>
        <p>{formateDateTime(historyItem.date)}</p>
      </div>
    </div>
  );
};

export default PeerFeedbackExamBody;
