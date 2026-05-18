import { FC } from 'react';
import { Avatar, Button, List } from 'antd';
import { IoMdClose } from 'react-icons/io';

import { IAlert, IChat } from '../../models/Chat';

import Panel from '../Panel';
import { ReactComponent as SmallChatIcon } from '../../assets/img/twoArrowInside.svg';

import ChatBody from './ChatBody';
import { useAppDispatch } from '../../hooks/hooks';
import {
  closeChat,
  showChatInSmallFormat,
} from '../../redux/reducers/chatReducer';

const MessagesModal: FC<{
  data: IChat | IAlert;
}> = ({ data }) => {
  const dispatch = useAppDispatch();

  const handleModalClose = () => {
    dispatch(closeChat());
  };

  const handleModalChangeFormat = () => {
    dispatch(showChatInSmallFormat());
  };

  return (
    <Panel
      expanded
      className="modal"
      header={
        <>
          <div>
            <List.Item.Meta
              avatar={
                <div className="avatar">
                  {data?.isGroup ? (
                    <Avatar.Group maxCount={3} shape="circle">
                      {(data?.groupUsers ?? []).slice(0, 3).map((user) => {
                        return (
                          <Avatar key={user?.name} className="avatar-grey">
                            {user?.name?.[0]}
                          </Avatar>
                        );
                      })}
                    </Avatar.Group>
                  ) : (
                    <Avatar
                      key={data?.usersOrTitle}
                      size="large"
                      className="avatar-grey"
                    >
                      {data?.usersOrTitle?.[0]}
                    </Avatar>
                  )}
                </div>
              }
              title={
                !!data?.usersOrTitle && (
                  <div>
                    <strong>{data?.usersOrTitle}</strong>
                  </div>
                )
              }
            />
          </div>
          <div>
            <Button
              type="text"
              className="header-icon"
              icon={<SmallChatIcon />}
              onClick={handleModalChangeFormat}
            />
            <Button
              type="text"
              className="header-icon"
              icon={<IoMdClose size={30} color="#999999" />}
              onClick={handleModalClose}
            />
          </div>
        </>
      }
    >
      <ChatBody data={data} isMini={false} />
    </Panel>
  );
};

export default MessagesModal;
