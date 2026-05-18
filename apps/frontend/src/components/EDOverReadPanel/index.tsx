import { FC, useCallback, useState } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown, IoArrowBackOutline } from 'react-icons/io5';
import { Button, Radio, Space } from 'antd';
import type { RadioChangeEvent } from 'antd';

import { ENotificationsType } from '../../models/enums';

import Panel from '../Panel';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { preliminaryEDOverReadState } from '../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../redux/reducers/utilsReducer';

import { edOverReadQuestions } from '../../utils/QuestionUtils';

import './style.scss';

const EDOverReadPanel: FC = () => {
  const { preliminaryInfo } = useAppSelector(({ followUp }) => followUp);
  const [selectedRadio, setSelectedRadio] = useState<number>(1);
  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();

  const onChange = (e: RadioChangeEvent) => {
    const { value } = e.target;
    setSelectedRadio(value);
  };

  const onSubmit = () => {
    dispatch(
      addNotificationAlert({
        title: 'ED Over-read submitted successfully',
        description: 'Thank you! Your prelim finding has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );
    goBack();
  };

  const goBack = () => {
    dispatch(preliminaryEDOverReadState(false));
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
          <Button
            type="link"
            className="go-back-button"
            icon={<IoArrowBackOutline size={24} color="#999" />}
            onClick={goBack}
          />

          <h1>ED Over-read</h1>

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
            <h2>Is the preliminary interpretation accurate?</h2>
            <Radio.Group
              className="radio-group-wrapper"
              onChange={onChange}
              value={selectedRadio}
            >
              <Space direction="vertical">
                {edOverReadQuestions.map((data) => (
                  <div
                    key={data.score}
                    className={`radio-wrapper ${
                      selectedRadio === data.score ? 'active' : ''
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

          <div className="preliminary-info-area">
            <p>
              <span>Preliminary finding: </span>
              {preliminaryInfo?.preliminary ?? '-'}
            </p>
            <p>
              <span>Comment: </span>
              {preliminaryInfo?.comment ?? '-'}
            </p>
            <p>
              <span>Physician: </span>
              {preliminaryInfo?.physician ?? '-'}
            </p>
            <p>
              <span>Date and time: </span>
              {preliminaryInfo?.date ?? '-'}
            </p>
          </div>
        </div>

        <div>
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

export default EDOverReadPanel;
