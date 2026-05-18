import { FC, useCallback, useState } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown } from 'react-icons/io5';
import { Button, Radio, RadioChangeEvent, Space } from 'antd';

import { ENotificationsType } from '../../../models/enums';

import Panel from '../../../components/Panel';

import { addNotificationAlert } from '../../../redux/reducers/chatReducer';
import { sendFollowupRequest } from '../../../redux/reducers/followUpReducer';
import { toggleIsExpandedSidebar } from '../../../redux/reducers/utilsReducer';

import { useAppDispatch } from '../../../hooks/hooks';
import {
  followUpQuestionSecondBlock,
  followUpQuestionThirdBlock,
  questionsConfigYesOrNo,
} from '../../../utils/QuestionUtils';

const FollowupRequest: FC<{
  hided?: boolean;
}> = ({ hided }) => {
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<number>(1);
  const [subSelected, setSubSelected] = useState<number>(1);
  const dispatch = useAppDispatch();

  const onChangeFirstQst = (e: RadioChangeEvent) => {
    setSelected(e.target.value);
    setSubSelected(1);
  };

  const onChangeSecondQst = (e: RadioChangeEvent) => {
    setSubSelected(e.target.value);
  };

  const optionalBlockQuestion =
    selected === 1 ? followUpQuestionSecondBlock : followUpQuestionThirdBlock;

  const onSubmit = () => {
    dispatch(
      addNotificationAlert({
        title: 'Follow-up Completion submitted successfully',
        description: 'Thank you! Your Follow-up Completion has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );

    const { score, meaning } = questionsConfigYesOrNo[selected - 1];
    const selectedSub = optionalBlockQuestion[subSelected - 1];
    dispatch(
      sendFollowupRequest({
        score: String(score),
        meaning,
        subOption: `${selectedSub.score}${selectedSub.meaning}`,
        comment,
      }),
    );
    handleCancel();
  };

  const handleCancel = () => {
    setComment('');
    setSelected(1);
    setSubSelected(1);
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
          <h1>Follow-up Completion</h1>
          <Button
            shape="circle"
            className="open-hide-right-panel-button"
            icon={<IoChevronDown size={24} color="#282C34" />}
            onClick={() => handleShowRightPanel()}
          />
        </div>
      }
    >
      {hided ? (
        <></>
      ) : (
        <>
          <div>
            <div>
              <h2>Is there enough information to schedule?</h2>
              <Radio.Group
                className="radio-group-wrapper"
                onChange={onChangeFirstQst}
                value={selected}
              >
                <Space direction="vertical">
                  {questionsConfigYesOrNo.map((data) => (
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
            <div>
              <h2>What is the scheduling status?</h2>
              <Radio.Group
                className="radio-group-wrapper"
                onChange={onChangeSecondQst}
                value={subSelected}
              >
                <Space direction="vertical">
                  {optionalBlockQuestion.map((data) => (
                    <div
                      key={data.score}
                      className={`radio-wrapper ${
                        subSelected === data.score ? 'active' : ''
                      }`}
                    >
                      <Radio value={data.score} id={`status${data.score}`}>
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

            <Space className="button-wrapper" wrap>
              <Button onClick={handleCancel} className="cancel">
                Cancel
              </Button>
              <Button onClick={onSubmit} className="submit">
                Submit
              </Button>
            </Space>
          </div>
        </>
      )}
    </Panel>
  );
};

export default FollowupRequest;
