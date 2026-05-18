import { FC, useCallback, useState } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown, IoArrowBackOutline } from 'react-icons/io5';
import { Button, Radio, Space } from 'antd';
import type { RadioChangeEvent } from 'antd';

import { ENotificationsType } from '../../models/enums';
import { TPeerReviewSaved } from '../../models/PeerReview';

import Panel from '../Panel';

import { useAppDispatch } from '../../hooks/hooks';
import {
  completePeerLearning,
  peerLearningState,
} from '../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../redux/reducers/utilsReducer';

import { peerLearningQuestions } from '../../utils/QuestionUtils';

import './style.scss';

const PeerLearningPanel: FC<{
  isFinal?: boolean;
}> = ({ isFinal = false }) => {
  const [selected, setSelected] = useState<number>(1);
  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();

  const onChange = (e: RadioChangeEvent) => {
    const { value } = e.target;
    setSelected(value);
  };

  const onSubmit = () => {
    const prepareData: TPeerReviewSaved = {
      score: String(selected),
      meaning:
        peerLearningQuestions.find((i) => i.score === selected)?.meaning || '',
      subOption: '',
      comment,
    };

    dispatch(completePeerLearning(prepareData));

    dispatch(
      addNotificationAlert({
        title: 'Peer learning submitted successfully',
        description: 'Thank you! Your peer learning has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );
    goBack();
  };

  const goBack = () => {
    dispatch(peerLearningState(false));
  };

  const handleShowRightPanel = useCallback(() => {
    dispatch(toggleIsExpandedSidebar());
  }, []);

  return (
    <Panel
      expanded
      className="peer-review"
      header={
        <div>
          {!isFinal && (
            <Button
              type="link"
              className="go-back-button"
              icon={<IoArrowBackOutline size={24} color="#999" />}
              onClick={goBack}
            />
          )}
          <h1>Peer Learning</h1>
          <Button
            shape="circle"
            className="open-hide-right-panel-button"
            icon={<IoChevronDown size={24} color="#282C34" />}
            onClick={() => handleShowRightPanel()}
          />
        </div>
      }
    >
      <>
        <div>
          <div>
            <h2>Please note why you are recommending this case:</h2>
            <Radio.Group
              className="radio-group-wrapper"
              onChange={onChange}
              value={selected}
            >
              <Space direction="vertical">
                {peerLearningQuestions.map((data) => (
                  <div
                    key={data.score}
                    className={`radio-wrapper ${
                      selected === data.score ? 'active' : ''
                    }`}
                  >
                    <Radio value={data.score} id={`review${data.score}`}>
                      <span>{data.meaning}</span>
                    </Radio>
                  </div>
                ))}
              </Space>
            </Radio.Group>
          </div>
        </div>

        <div>
          <div className="comments-area">
            <h2>Comments</h2>
            <TextArea
              id="comment"
              placeholder="Text comment here"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 5 }}
              maxLength={500}
            />
          </div>

          <Space className="button-wrapper">
            <Button onClick={goBack} className="cancel">
              Cancel
            </Button>
            <Button onClick={onSubmit} className="submit">
              Submit
            </Button>
          </Space>
        </div>
      </>
    </Panel>
  );
};

export default PeerLearningPanel;
