/* eslint-disable @typescript-eslint/no-unused-vars */
import { FC, useEffect, useState } from 'react';
import { Avatar, Button, Input, List } from 'antd';
import { BiPlus } from 'react-icons/bi';
import { IoPaperPlaneSharp, IoSearch } from 'react-icons/io5';
import { AiOutlinePaperClip } from 'react-icons/ai';
import { LuFileEdit } from 'react-icons/lu';

import { EChatType } from '../../models/enums';
import { IAlert, IChat } from '../../models/Chat';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import {
  getAlertsListThunk,
  getChatListThunk,
} from '../../redux/thunks/chatThunk';

import Panel from '../../components/Panel';
import ChatList from '../../components/ChatPanel/ChatList';
import AlertList from '../../components/ChatPanel/AlertList';
import Loader from '../../components/Loader';

import './style.scss';

const Chat: FC = () => {
  const {
    getChats: { chats, isFetching: isFetchingChat },
    getAlerts: { alerts, isFetching: isFetchingAlert },
  } = useAppSelector((state) => state.chat);
  const dispatch = useAppDispatch();

  const [isActiveType, setIsActiveType] = useState<EChatType>(EChatType.CHAT);
  const [searchValue, setSearchValue] = useState<string>('');
  const [messageValue, setMessageValue] = useState<string>('');
  const [active, setActive] = useState<IChat | IAlert>({} as IChat);
  const [isActiveItem, setIsActiveItem] = useState<number | undefined>(
    undefined,
  );

  const handleChangeType = (type: EChatType) => {
    setActive({} as IChat);
    setSearchValue('');
    setIsActiveItem(undefined);
    setIsActiveType(type);
  };

  const handleSearchChange = (val: string) => {
    setSearchValue(val);
  };

  const handleMessageChange = (val: string) => {
    setMessageValue(val);
  };

  const handleMessageSend = () => {
    if (!!messageValue.trim().length) {
      console.log('messageValue', messageValue.trim());
    }
  };

  const handleSetActive = (item: IChat | IAlert) => {
    setActive(item);
    setIsActiveItem(item.id);
  };

  useEffect(() => {
    dispatch(getChatListThunk());
    dispatch(getAlertsListThunk());
  }, []);

  return (
    <div className="chat-wrapper">
      <div className="controller">
        <span
          className={isActiveType === EChatType.CHAT ? 'active' : ''}
          onClick={() => handleChangeType(EChatType.CHAT)}
        >
          Chat
        </span>
        <span
          className={isActiveType === EChatType.ALERT ? 'active' : ''}
          onClick={() => handleChangeType(EChatType.ALERT)}
        >
          Alert
        </span>
      </div>

      <div className="content">
        <Panel
          expanded
          className="chat-list-area"
          header={
            <>
              <div className="header-part-title">
                <h1>Messages</h1>
                <Button
                  type="text"
                  icon={<BiPlus size={20} color="#A1D103" />}
                  onClick={() => console.log('add')}
                  disabled={isFetchingChat || isFetchingAlert}
                />
              </div>
              <div className="header-part-search">
                <Input
                  id="search"
                  placeholder="Search or start new chat"
                  prefix={<IoSearch color="#999" size={16} />}
                  type="text"
                  value={searchValue}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onPressEnter={() => null}
                  disabled={isFetchingChat || isFetchingAlert}
                />
              </div>
            </>
          }
        >
          <div className="chat-content">
            {/* {isFetchingChat || isFetchingAlert ? (
              <Loader />
            ) : isActiveType === EChatType.ALERT ? (
              <AlertList
                data={alerts}
                callback={handleSetActive}
                isActiveItem={isActiveItem}
              />
            ) : (
              <ChatList
                data={chats}
                callback={handleSetActive}
                isActiveItem={isActiveItem}
              />
            )} */}
          </div>
        </Panel>
        {!Boolean(Object.keys(active).length) ? (
          <Panel expanded className="chat-area">
            <></>
          </Panel>
        ) : (
          <Panel
            expanded
            className="chat-area"
            header={
              <>
                <List.Item.Meta
                  avatar={
                    <div
                      className={`${active?.isOnline ? 'active' : ''}  avatar`}
                    >
                      {active?.isGroup ? (
                        <Avatar.Group maxCount={3} shape="circle">
                          {(active?.groupUsers ?? [])
                            .slice(0, 3)
                            .map((user) => {
                              return (
                                <Avatar key={user?.name}>
                                  {user?.name?.[0]}
                                </Avatar>
                              );
                            })}
                        </Avatar.Group>
                      ) : (
                        <Avatar key={active?.usersOrTitle} size="large">
                          {active?.usersOrTitle?.[0]}
                        </Avatar>
                      )}
                    </div>
                  }
                  title={
                    !!active?.usersOrTitle && (
                      <div>
                        <strong>{active?.usersOrTitle}</strong>
                      </div>
                    )
                  }
                  description={active?.isOnline && 'Active Now'}
                />
              </>
            }
          >
            {isActiveType === EChatType.CHAT ? (
              <div>
                <div className="chat"></div>
                <div className="chat-controller">
                  <Button
                    icon={<AiOutlinePaperClip size={25} color="#999" />}
                    onClick={() => console.log('show')}
                    type="text"
                  />
                  <Button
                    icon={<LuFileEdit size={25} color="#999" />}
                    onClick={() => console.log('show')}
                    type="text"
                  />
                  <div className="chat-part-input">
                    <Input
                      id="message"
                      placeholder="Enter your message"
                      suffix={<IoPaperPlaneSharp color="#8A85FF" size={24} />}
                      type="text"
                      value={messageValue}
                      onChange={(e) => handleMessageChange(e.target.value)}
                      onPressEnter={handleMessageSend}
                      disabled={isFetchingChat || isFetchingAlert}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div></div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
};

export default Chat;
