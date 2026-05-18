import { FC, useCallback, useState } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown } from 'react-icons/io5';
import { Button, Radio, RadioChangeEvent, Space } from 'antd';

import { ENotificationsType } from '../../../models/enums';

import Panel from '../../../components/Panel';

import { addNotificationAlert } from '../../../redux/reducers/chatReducer';
import { sendFindingDeliveryRequest } from '../../../redux/reducers/followUpReducer';
import { toggleIsExpandedSidebar } from '../../../redux/reducers/utilsReducer';

import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import { deliveryMethodConfig } from '../../../utils/QuestionUtils';

import patientData from '../../../redux/fakeApi/patients.json';
import { TFindingDeliveryRequest } from '../../../models/PeerReview';

const DeliveryMethod: FC<{
  hided?: boolean;
}> = ({ hided }) => {
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<number>(1);
  const dispatch = useAppDispatch();
  const { currentPatientId } = useAppSelector(({ followUp }) => followUp);

  const onChangeFirstQst = (e: RadioChangeEvent) => {
    setSelected(e.target.value);
  };

  const onSubmit = () => {
    dispatch(
      addNotificationAlert({
        title: 'Delivery Method submitted successfully',
        description: 'Thank you! Your Delivery Method has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );

    const { meaning } = deliveryMethodConfig[selected - 1];
    const currentPatient = Object.values(patientData).find(
      (i) => String(i.id) === String(currentPatientId),
    );

    dispatch(
      sendFindingDeliveryRequest({
        data: {
          ...currentPatient,
          findingSeverity: meaning,
          comment,
        } as TFindingDeliveryRequest,
        isNeedRemove: true,
      }),
    );
    handleCancel();
  };

  const handleCancel = () => {
    setComment('');
    setSelected(1);
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
          <h1>Delivery Method</h1>
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
              <h2>Please record the method of delivery:</h2>
              <Radio.Group
                className="radio-group-wrapper"
                onChange={onChangeFirstQst}
                value={selected}
              >
                <Space direction="vertical">
                  {deliveryMethodConfig.map((data) => (
                    <div
                      key={data.score}
                      className={`radio-wrapper ${
                        selected === data.score ? 'active' : ''
                      }`}
                    >
                      <Radio
                        value={data.score}
                        id={`deliveryMethod${data.score}`}
                      >
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

export default DeliveryMethod;
