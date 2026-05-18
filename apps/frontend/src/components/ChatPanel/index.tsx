import { FC, useEffect } from 'react';
import { Avatar, Badge, Button, notification } from 'antd';
import { IoArrowBackOutline, IoChevronDown } from 'react-icons/io5';
import { IoMdClose } from 'react-icons/io';

import { EChatType } from '../../models/enums';
import { IAlert, IChat } from '../../models/Chat';

import {
  getAlertsListThunk,
  getChatListThunk,
} from '../../redux/thunks/chatThunk';
import {
  setChatType,
  setIsExpandChatArea,
  toggleIsExpandChatArea,
} from '../../redux/reducers/utilsReducer';

import ChatList from './ChatList';
import AlertList from './AlertList';
import Panel from '../Panel';
import Loader from '../Loader';
import { ReactComponent as LargeFormatIcon } from '../../assets/img/towArrowsUotside.svg';
import ChatBody from '../MenuSidebarRight/ChatBody';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import {
  closeChat,
  showChatInLargeFormat,
  showChatInSmallFormat,
  resetNotification,
} from '../../redux/reducers/chatReducer';

import './style.scss';

const ChatPanels: FC<{
  handleChangeModalState: (activeItem: IChat | IAlert) => void;
  isActiveItem: IChat | IAlert;
  isChatOpenInitially?: boolean;
  setIsActiveItem: (
    value: IChat | IAlert | ((value: IChat | IAlert) => IChat | IAlert),
  ) => void;
}> = ({
  handleChangeModalState,
  isActiveItem,
  setIsActiveItem,
  isChatOpenInitially = true,
}) => {
  const {
    getChats: {
      chats,
      unreadCount,
      isFetching: isFetchingChat,
      isShowSmall,
      isShowLarge,
    },
    getAlerts: {
      alerts,
      isFetching: isFetchingAlert,
      unreadCount: unreadCountAlerts,
    },
    getNotifications: { title, type, description },
  } = useAppSelector((state) => state.chat);
  const { isExpandChatArea, chatActiveType, isKonicaBranding } = useAppSelector(
    ({ utils }) => utils,
  );
  const dispatch = useAppDispatch();
  const [api, contextHolder] = notification.useNotification();

  const handleShowMiniChat = (item: IChat) => {
    setIsActiveItem(item);
    if (!isShowLarge) {
      dispatch(showChatInSmallFormat());
    }
  };

  const handleCloseAnyFormatChats = () => {
    dispatch(closeChat());
    setIsActiveItem({} as IChat);
  };

  const handleClick = (type: EChatType) => {
    dispatch(setChatType(type));
    handleCloseAnyFormatChats();
    if (!isExpandChatArea) {
      dispatch(setIsExpandChatArea(true));
    }
  };

  const handleChangeStateExpandChat = () => {
    dispatch(toggleIsExpandChatArea());
  };

  const handleCloseMiniAndOpenLarge = (isActiveItem: IChat | IAlert) => {
    handleChangeModalState(isActiveItem);
    dispatch(showChatInLargeFormat());
  };

  useEffect(() => {
    dispatch(getChatListThunk());
    dispatch(getAlertsListThunk());

    isChatOpenInitially
      ? dispatch(setIsExpandChatArea(true))
      : dispatch(setIsExpandChatArea(false));
  }, []);

  useEffect(() => {
    if (title) {
      api[type]({
        message: title,
        description,
        placement: 'topRight',
        onClose() {
          dispatch(resetNotification());
        },
      });
    }
  }, [title]);

  return (
    <Panel
      expanded
      className={`panel-chat${isKonicaBranding ? ' isKonicaBranding' : ''}${
        isExpandChatArea ? '' : ' hide'
      }`}
    >
      {contextHolder}
      {isFetchingChat || isFetchingAlert ? (
        <Loader />
      ) : (
        <>
          <div className="open-hide-chat-panel-button-wrapper">
            <Button
              shape="circle"
              className="open-hide-chat-panel-button"
              icon={<IoChevronDown size={24} color="#282C34" />}
              onClick={handleChangeStateExpandChat}
            />
          </div>
          <div className="chat nav-panel">
            <a
              href="#"
              role="button"
              className={`nav-item ${
                chatActiveType === EChatType.CHAT ? 'active' : ''
              }`}
              onClick={() => handleClick(EChatType.CHAT)}
            >
              {isExpandChatArea ? (
                'Chat'
              ) : (
                <span className="right-side-chat-icon" />
              )}
              {!!unreadCount && (
                <Badge color="ce5179" count={unreadCount} overflowCount={99} />
              )}
            </a>
            <a
              href="#"
              role="button"
              className={`nav-item ${
                chatActiveType === EChatType.ALERT ? 'active' : ''
              }`}
              onClick={() => handleClick(EChatType.ALERT)}
            >
              {isExpandChatArea ? (
                'Alert'
              ) : (
                <span className="right-side-alert-icon" />
              )}
              {!!unreadCountAlerts && (
                <Badge
                  color="ce5179"
                  count={unreadCountAlerts}
                  overflowCount={99}
                />
              )}
            </a>
            <div className="line">
              <div>&nbsp;</div>
            </div>
            {isShowSmall && (
              <div className="mini-chat-title">
                <div>
                  <Button
                    type="link"
                    // className="go-back-button"
                    icon={<IoArrowBackOutline size={24} color="#999" />}
                    onClick={handleCloseAnyFormatChats}
                  />
                  <div className="avatar">
                    {isActiveItem?.isGroup ? (
                      <Avatar.Group maxCount={3} shape="circle">
                        {(isActiveItem?.groupUsers ?? [])
                          .slice(0, 3)
                          .map((user) => {
                            return (
                              <Avatar key={user?.name} className="avatar-grey">
                                {user?.name?.[0]}
                              </Avatar>
                            );
                          })}
                      </Avatar.Group>
                    ) : (
                      <Avatar
                        key={isActiveItem?.usersOrTitle}
                        size="large"
                        className="avatar-grey"
                      >
                        {isActiveItem?.usersOrTitle?.[0]}
                      </Avatar>
                    )}
                  </div>
                  <div>{isActiveItem?.usersOrTitle}</div>
                </div>
                <div>
                  <Button
                    type="text"
                    icon={<LargeFormatIcon />}
                    onClick={() => handleCloseMiniAndOpenLarge(isActiveItem)}
                  />
                  <Button
                    type="text"
                    icon={<IoMdClose size={30} color="#999999" />}
                    onClick={handleCloseAnyFormatChats}
                  />
                </div>
              </div>
            )}
          </div>
          {isExpandChatArea && (
            <div className="chat-content">
              {isShowSmall ? (
                <ChatBody data={isActiveItem} />
              ) : (
                <>
                  {chatActiveType === EChatType.ALERT ? (
                    <AlertList
                      data={alerts}
                      callback={handleChangeModalState}
                      isActiveItem={isActiveItem}
                    />
                  ) : (
                    <ChatList
                      data={chats}
                      callback={handleShowMiniChat}
                      isActiveItem={isActiveItem}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
};

export default ChatPanels;
