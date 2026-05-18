import { FC, useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Input, List } from 'antd';
import { IoLinkOutline, IoUnlinkOutline } from 'react-icons/io5';
import { Link, useLocation } from 'react-router-dom';
import { addSeconds, format, formatDistanceToNow, parse } from 'date-fns';

import { IAlert, IChat, IMessage } from '../../models/Chat';

import { useAppSelector } from '../../hooks/hooks';

import { ReactComponent as Plane } from '../../assets/img/plane.svg';
import { ReactComponent as ConsultRequest } from '../../assets/img/consultationRequest.svg';
import { ReactComponent as Close } from '../../assets/img/close.svg';
import { ClinicalInfoUrl } from '../../UrlsConfig';

const ChatBody: FC<{
  data: IChat | IAlert;
  isMini?: boolean;
}> = ({ data, isMini = true }) => {
  const {
    getPatient: { patient },
  } = useAppSelector(({ patients }) => patients);
  const [messages, setMessages] = useState<IMessage[]>(data.messages);
  const [newMessage, setNewMessage] = useState<string>('');
  const [isLink, setIsLink] = useState<boolean>(false);
  const [isRequest, setIsRequest] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const { pathname } = useLocation();

  const isShowPrefix = pathname.includes(`${ClinicalInfoUrl}/`);

  const linkJsx = (
    <div className="consult-request-message">
      <div>
        <ConsultRequest />
        <p>Consultation request</p>
      </div>
      {isLink && (
        <Link to={window.location.href} rel="noreferrer" target="_blank">
          <div className="link-message">
            <div>
              <IoLinkOutline size={28} color="#ffffff" />
            </div>
            <div>
              <p>
                {patient.firstName} {patient.lastName}
              </p>
              <p>{patient.examDescription}</p>
            </div>
          </div>
        </Link>
      )}
    </div>
  );

  const scrollToEnd = () => {
    const element = document.querySelector('div.modal-chat');

    if (element) {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    }
  };

  const handleSendMessage = useCallback(() => {
    const trimmedMessage = newMessage.trim();

    if (!trimmedMessage && !isRequest) {
      return;
    }

    setIsSending(true);

    const now = addSeconds(new Date(), 1);

    const message: IMessage = {
      text: newMessage,
      timestamp: format(now, 'yyyy.MM.dd HH:mm:ss'),
      isInterlocutor: false,
    };

    if (!isLink && !isRequest) {
      setMessages((prev) => {
        return [...prev, message];
      });
    }

    if (isRequest) {
      if (trimmedMessage) {
        setMessages((prev) => {
          return [...prev, message];
        });
      }

      const messageLink: IMessage = {
        text: linkJsx,
        timestamp: format(now, 'yyyy.MM.dd HH:mm:ss'),
        isInterlocutor: false,
      };

      setMessages((prev) => {
        return [...prev, messageLink];
      });
    }

    setTimeout(() => {
      setIsSending(false);
    }, 1000);

    setNewMessage('');
    setIsLink(false);
    setIsRequest(false);
    scrollToEnd();
  }, [messages, newMessage, isLink, isRequest]);

  const handleMessageChange = (val: string) => {
    setNewMessage(val);
  };

  const timeFormatter = useCallback((date: string | undefined) => {
    const newDataDate = date || '';
    const dateObject = parse(newDataDate, 'yyyy.MM.dd HH:mm:ss', new Date());
    return !!date
      ? formatDistanceToNow(dateObject, {
          addSuffix: true,
          includeSeconds: true,
        })
      : null;
  }, []);

  const handleChangeLink = () => {
    setIsLink((prev) => !prev);
  };

  const handleConsultRequest = () => {
    setIsRequest(true);
  };

  const handleRemoveRequest = () => {
    setIsRequest(false);

    if (isLink) {
      setIsLink(false);
    }
  };

  useEffect(() => {
    setMessages(data.messages);
    scrollToEnd();
  }, [data.messages]);

  const scssHeight = isMini
    ? { maxHeight: `${isLink ? 8 : isRequest ? 58 : 115}px` }
    : {};

  return (
    <div className={isMini ? 'mini-chat' : ''}>
      <div className="chat modal-chat" style={scssHeight}>
        {messages.map((message, index) => (
          <div
            key={index}
            className="chat-message"
            style={{
              justifyContent: message.isInterlocutor
                ? 'flex-start'
                : 'flex-end',
            }}
          >
            <List.Item.Meta
              avatar={
                <div className="avatar">
                  {message.isInterlocutor ? (
                    !!data?.isGroup ? (
                      <Avatar
                        shape="circle"
                        size="large"
                        className="avatar-grey"
                      >
                        {message?.author?.[0]}
                      </Avatar>
                    ) : (
                      <Avatar
                        shape="circle"
                        size="large"
                        className="avatar-grey"
                      >
                        {message?.author?.[0]}
                      </Avatar>
                    )
                  ) : (
                    <></>
                  )}
                </div>
              }
            />
            <div
              style={{
                textAlign: message.isInterlocutor ? 'left' : 'right',
              }}
            >
              <div
                className={`text ${
                  message.isInterlocutor ? 'interlocutor' : 'own'
                }`}
              >
                {message.text}
              </div>
              <div
                className="timestamp"
                style={{
                  justifyContent: message.isInterlocutor
                    ? 'flex-start'
                    : 'flex-end',
                }}
              >
                {isSending && index === messages.length - 1 ? (
                  'Sending...'
                ) : (
                  <>
                    Sent &nbsp; <span /> &nbsp;
                    {timeFormatter(message.timestamp)}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="chat-controller">
        {isRequest && (
          <div className="consult-request">
            <div>
              <div>
                <ConsultRequest />
                <p>Consultation request</p>
              </div>
              <div>
                <Button
                  className="btn-link"
                  type="link"
                  onClick={handleChangeLink}
                >
                  {!isLink ? (
                    <>
                      <IoLinkOutline size={20} color="#8A85FF" />
                      Link the case
                    </>
                  ) : (
                    <>
                      <IoUnlinkOutline size={20} color="#8A85FF" />
                      Unlink the case
                    </>
                  )}
                </Button>
              </div>
            </div>
            {isLink && (
              <div className="link">
                <div>
                  <IoLinkOutline size={28} color="#999999" />
                </div>
                <p>
                  <span>
                    {patient.firstName} {patient.lastName}
                  </span>
                  &nbsp;
                  {patient.examDescription}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="chat-part-input">
          <Input
            id="message"
            placeholder="Type a message..."
            suffix={<Plane onClick={handleSendMessage} />}
            prefix={
              isShowPrefix ? (
                !isRequest ? (
                  <ConsultRequest onClick={handleConsultRequest} />
                ) : (
                  <Close onClick={handleRemoveRequest} />
                )
              ) : (
                false
              )
            }
            type="text"
            value={newMessage}
            onChange={(e) => handleMessageChange(e.target.value)}
            onPressEnter={handleSendMessage}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatBody;
