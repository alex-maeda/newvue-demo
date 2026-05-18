import { FC, useEffect, useState } from 'react';
import { Badge } from 'antd';

import {
  closeChat,
  showChatInLargeFormat,
} from '../../redux/reducers/chatReducer';
import {
  setChatType,
  setIsExpandChatArea,
  setIsExpandedSidebar,
  toggleIsExpandedSidebar,
} from '../../redux/reducers/utilsReducer';

import { EChatType } from '../../models/enums';
import { IAlert, IChat } from '../../models/Chat';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import useDetectClickOutside from '../../hooks/useClickOutside';

import ProgressPanel from '../ProgressPanel/ProgressPanel';
import ChatPanels from '../ChatPanel';
import MessagesModal from './MessagesModal';

import './style.scss';

interface IMenu {
  children: JSX.Element;
  isShowProgressBlock?: boolean;
  isShowChatBlock?: boolean;
  isOpenInitially?: boolean;
  isShowProgressIcons?: boolean;
}

const MenuSidebarRight: FC<IMenu> = ({
  children,
  isShowProgressBlock = true,
  isShowChatBlock = true,
  isOpenInitially = true,
  isShowProgressIcons = true,
}) => {
  const {
    getChats: { unreadCount, isShowLarge },
    getAlerts: { unreadCount: unreadCountAlerts },
  } = useAppSelector((state) => state.chat);
  const { chatActiveType, isKonicaBranding } = useAppSelector(
    ({ utils }) => utils,
  );
  const [isActiveItem, setIsActiveItem] = useState<IChat | IAlert>({} as IChat);
  const dispatch = useAppDispatch();

  const handleChangeModalState = (activeItem: IChat | IAlert) => {
    dispatch(showChatInLargeFormat());
    setIsActiveItem(activeItem);
  };

  const handleCloseModal = () => {
    dispatch(closeChat());
    setIsActiveItem({} as IChat);
  };

  const handleShowRightPanel = (type = chatActiveType) => {
    dispatch(setChatType(type));
    dispatch(toggleIsExpandedSidebar());
  };

  const handleShowRightPanelExpandedChat = (type: EChatType) => {
    handleShowRightPanel(type);
    dispatch(setIsExpandChatArea(true));
  };

  useEffect(() => {
    isOpenInitially
      ? dispatch(setIsExpandedSidebar(true))
      : dispatch(setIsExpandedSidebar(false));
  }, []);

  const notificationRef = useDetectClickOutside(handleCloseModal);

  return (
    <>
      <div ref={notificationRef}>
        <div className="panel-group">
          {isShowProgressBlock && (
            <ProgressPanel isShowProgressIcons={isShowProgressIcons} />
          )}
          {children}
          {isShowChatBlock && (
            <ChatPanels
              handleChangeModalState={handleChangeModalState}
              isActiveItem={isActiveItem}
              setIsActiveItem={setIsActiveItem}
              isChatOpenInitially={false}
            />
          )}
        </div>

        <div
          className={`right-side-chat-info-btn${
            isKonicaBranding ? ' isKonicaBranding' : ''
          }`}
        >
          <div>
            <span
              className="right-side-alert-icon"
              onClick={() => handleShowRightPanelExpandedChat(EChatType.ALERT)}
            >
              {!!unreadCountAlerts && (
                <Badge
                  color="#f04f43"
                  count={unreadCountAlerts}
                  overflowCount={99}
                />
              )}
            </span>
          </div>
          <div>
            <span
              className="right-side-chat-icon"
              onClick={() => handleShowRightPanelExpandedChat(EChatType.CHAT)}
            >
              {!!unreadCount && (
                <Badge color="#f04f43" count={unreadCount} overflowCount={99} />
              )}
            </span>
          </div>
        </div>
      </div>
      {isShowLarge ? <MessagesModal data={isActiveItem} /> : null}
    </>
  );
};

export default MenuSidebarRight;
