import { FC, useCallback, useState } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown, IoArrowBackOutline } from 'react-icons/io5';
import { Button, Radio, Select, Space } from 'antd';
import type { RadioChangeEvent } from 'antd';

import { ENotificationsType } from '../../models/enums';

import Panel from '../Panel';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import {
  preliminaryInfoState,
  preliminaryState,
} from '../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../redux/reducers/utilsReducer';

import { preliminaryQuestions } from '../../utils/QuestionUtils';
import { formateDateTime } from '../../utils/DateUtils';

import './style.scss';

const EDPreliminaryPanel: FC = () => {
  const { user } = useAppSelector(({ auth }) => auth);
  const [selectedRadio, setSelectedRadio] = useState<number>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();

  const onChange = (e: RadioChangeEvent) => {
    const { value } = e.target;
    setSelectedRadio(value);
    value === 1 && setSelected(null);
  };

  const handleChangeSelect = (value: string) => {
    setSelected(value);
  };

  const onSubmit = () => {
    dispatch(
      preliminaryInfoState({
        physician: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`,
        preliminary: selected,
        comment: comment?.trim() ? comment?.trim() : null,
        date: formateDateTime(String(new Date())),
      }),
    );

    dispatch(
      addNotificationAlert({
        title: 'Preliminary submitted successfully',
        description: 'Thank you! Your prelim finding has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );
    goBack();
  };

  const goBack = () => {
    dispatch(preliminaryState(false));
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

          <h1>ED Preliminary</h1>

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
            <h2>Is this a normal exam?</h2>
            <Radio.Group
              className="radio-group-wrapper"
              onChange={onChange}
              value={selectedRadio}
            >
              <Space direction="vertical">
                {preliminaryQuestions.map((data) => (
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
            {selectedRadio === 2 && (
              <Select
                value={selected}
                style={{ width: '100%', marginTop: 8, minHeight: 40 }}
                onChange={handleChangeSelect}
                placeholder="Please select a finding"
                options={[
                  { value: 'Fracture', label: 'Fracture' },
                  { value: 'Pneumonia', label: 'Pneumonia' },
                  { value: 'Covid-19', label: 'Covid-19' },
                  {
                    value: 'Cardiovascular Issue',
                    label: 'Cardiovascular Issue',
                  },
                  { value: 'Other', label: 'Other (please add comment)' },
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

export default EDPreliminaryPanel;
