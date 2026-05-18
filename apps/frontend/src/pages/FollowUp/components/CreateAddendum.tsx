import { FC, useState, useCallback } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown } from 'react-icons/io5';
import { Button, Space } from 'antd';

import { ENotificationsType } from '../../../models/enums';

import Panel from '../../../components/Panel';

import { sendAddendum } from '../../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../../redux/reducers/utilsReducer';

import { useAppDispatch } from '../../../hooks/hooks';

const CreateAddendum: FC<{
  hided?: boolean;
}> = ({ hided }) => {
  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();

  const onSubmit = () => {
    dispatch(sendAddendum());
    dispatch(
      addNotificationAlert({
        title: 'Create Addendum submitted successfully',
        description: 'Thank you! Your Create Addendum has been submitted.',
        type: ENotificationsType.SUCCESS,
      }),
    );
    handleReset();
  };

  const handleReset = () => {
    setComment('');
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
          <h1>Create Addendum</h1>
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
          <div className="comments-area">
            <p className="info">
              Please submit when the addendum is complete. Comments are
              optional.
            </p>
            <h2>Comments</h2>
            <TextArea
              id="comment"
              placeholder="Text comment here"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 10 }}
              maxLength={500}
            />
          </div>

          <Space className="button-wrapper" wrap>
            <Button onClick={handleReset} className="cancel">
              Cancel
            </Button>
            <Button onClick={onSubmit} className="submit">
              Submit
            </Button>
          </Space>
        </>
      )}
    </Panel>
  );
};

export default CreateAddendum;
