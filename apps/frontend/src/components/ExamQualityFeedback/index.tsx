import { FC, useCallback, useState } from 'react';
import { IoChevronDown, IoArrowBackOutline } from 'react-icons/io5';
import { Button, Checkbox, Radio, Space } from 'antd';
import type { RadioChangeEvent, GetProp } from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { CheckboxValueType } from 'antd/lib/checkbox/Group';

import { ENotificationsType } from '../../models/enums';

import Panel from '../Panel';

import { useAppDispatch } from '../../hooks/hooks';
import { preliminaryExamQualityFeedbackState } from '../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../redux/reducers/utilsReducer';

import {
  optionalExamQualityQuestion,
  questionsConfigYesOrNo,
} from '../../utils/QuestionUtils';

import './style.scss';

const ExamQualityFeedbackPanel: FC = () => {
  const [selectedRadio, setSelectedRadio] = useState<number>(1);
  const [selected, setSelected] = useState<CheckboxValueType[]>([]);
  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();

  const onChange = (e: RadioChangeEvent) => {
    const { value } = e.target;
    setSelectedRadio(value);
  };

  const onChangeSecondQst: GetProp<typeof Checkbox.Group, 'onChange'> = (
    checkedValues,
  ) => {
    setSelected(checkedValues);
  };

  const onSubmit = () => {
    dispatch(
      addNotificationAlert({
        title: 'Exam feedback submitted successfully',
        description: 'Thank you! Your exam feedback has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );
    goBack();
  };

  const goBack = () => {
    dispatch(preliminaryExamQualityFeedbackState(false));
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

          <h1>Exam Quality Feedback</h1>

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
            <h2>Is the exam able to be reported?</h2>
            <Radio.Group
              className="radio-group-wrapper"
              onChange={onChange}
              value={selectedRadio}
            >
              <Space direction="vertical">
                {questionsConfigYesOrNo.map((data) => (
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
          <div>
            <h2>What issue(s) are present?</h2>
            <Checkbox.Group
              className="radio-group-wrapper"
              onChange={onChangeSecondQst}
              value={selected}
            >
              <Space direction="vertical">
                {optionalExamQualityQuestion.map((data) => (
                  <div
                    key={data.score}
                    className={`radio-wrapper ${
                      selected.includes(data.score) ? 'active' : ''
                    }`}
                  >
                    <Checkbox value={data.score} id={`status${data.score}`}>
                      <span>{data.meaning}</span>
                    </Checkbox>
                  </div>
                ))}
              </Space>
            </Checkbox.Group>
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

export default ExamQualityFeedbackPanel;
