import { FC, useCallback, useState } from 'react';
import { IoChevronDown, IoArrowBackOutline } from 'react-icons/io5';
import { Button, Radio, Select, Space } from 'antd';
import type { RadioChangeEvent } from 'antd';
import TextArea from 'antd/es/input/TextArea';

import { ENotificationsType } from '../../models/enums';
import { TFindingDeliveryRequest } from '../../models/PeerReview';

import Panel from '../Panel';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import {
  findingsDeliveryFeedbackState,
  sendFindingDeliveryRequest,
} from '../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../redux/reducers/utilsReducer';

import { findingsDeliveryQuestions } from '../../utils/QuestionUtils';

import './style.scss';

const FindingDeliveryFeedbackPanel: FC = () => {
  const [selectedRadio, setSelectedRadio] = useState<number>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();
  const { selectedPatientFromWorklist } = useAppSelector(
    ({ followUp }) => followUp,
  );

  const onChange = (e: RadioChangeEvent) => {
    const { value } = e.target;
    setSelectedRadio(value);
    value !== 3 && setSelected(null);
  };

  const handleChangeSelect = (value: string) => {
    setSelected(value);
  };

  const onSubmit = () => {
    dispatch(
      addNotificationAlert({
        title: 'Finding(s) submitted successfully',
        description: 'Thank you! Your finding information has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );

    const { meaning } = findingsDeliveryQuestions[selectedRadio - 1];
    const findingSeverity = selected ? `${meaning} - ${selected}` : meaning;

    dispatch(
      sendFindingDeliveryRequest({
        data: {
          ...selectedPatientFromWorklist,
          findingSeverity,
          comment,
          time: new Date(),
        } as TFindingDeliveryRequest,
      }),
    );
    goBack();
  };

  const goBack = () => {
    dispatch(findingsDeliveryFeedbackState(false));
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

          <h1>Findings Delivery</h1>

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
            <h2>What is the severity of the findings?</h2>
            <Radio.Group
              className="radio-group-wrapper"
              onChange={onChange}
              value={selectedRadio}
            >
              <Space direction="vertical">
                {findingsDeliveryQuestions.map((data) => (
                  <div
                    key={data.score}
                    className={`radio-wrapper ${
                      selectedRadio === data.score ? 'active' : ''
                    }`}
                  >
                    <Radio value={data.score} id={`findings${data.score}`}>
                      <span>{data.meaning}</span>
                    </Radio>
                  </div>
                ))}
              </Space>
            </Radio.Group>
            {selectedRadio === 3 && (
              <Select
                value={selected}
                style={{ width: '100%', marginTop: 8, minHeight: 40 }}
                onChange={handleChangeSelect}
                placeholder="Please select a finding"
                options={[
                  {
                    value: 'Unexpected pneumothorax',
                    label: 'Unexpected pneumothorax',
                  },
                  {
                    value: 'Unexpected intracranial hemorrhage',
                    label: 'Unexpected intracranial hemorrhage',
                  },
                  {
                    value: 'Unexpected free air',
                    label: 'Unexpected free air',
                  },
                  {
                    value: 'New cord compression',
                    label: 'New cord compression',
                  },
                  {
                    value: 'New arterial dissection',
                    label: 'New arterial dissection',
                  },
                  { value: 'Ectopic pregnancy', label: 'Ectopic pregnancy' },
                ]}
              />
            )}
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

export default FindingDeliveryFeedbackPanel;
