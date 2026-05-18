import { FC } from 'react';
import { BiDotsVerticalRounded } from 'react-icons/bi';
import { formatDistanceToNowStrict, parse } from 'date-fns';
import { Badge, List, Button, Avatar } from 'antd';

import { IAlert, IChat } from '../../models/Chat';

const ChatList: FC<{
  data: IChat[];
  callback: (activeItem: IChat) => void;
  isActiveItem: IChat | IAlert;
}> = ({ data, callback, isActiveItem }) => {
  const timeFormatter = (date: string | undefined) => {
    const newDataDate = !!date ? date : '';
    const dateObject = parse(newDataDate, 'yyyy.MM.dd HH:mm:ss', new Date());
    return !!date
      ? formatDistanceToNowStrict(dateObject, { addSuffix: true })
      : null;
  };

  return (
    <List
      itemLayout="horizontal"
      dataSource={data}
      renderItem={(item) => (
        <List.Item
          className={`${!!item?.unreadCount ? 'new-message' : ''} ${
            isActiveItem.id === item.id ? 'active' : ''
          }`}
          onClick={() => callback(item)}
          actions={[
            <Button
              key="1"
              className="btn-dots"
              icon={<BiDotsVerticalRounded size={20} />}
              onClick={() => console.log('show')}
            />,
            item?.unreadCount ? (
              <Badge
                color="#f04f43"
                count={item.unreadCount}
                overflowCount={99}
              />
            ) : null,
          ]}
        >
          <List.Item.Meta
            avatar={
              <div className={`${item?.isOnline ? 'active' : ''}  avatar`}>
                {item?.isGroup ? (
                  <Avatar.Group maxCount={3} shape="circle">
                    {(item?.groupUsers ?? []).slice(0, 3).map((user) => {
                      return (
                        <Avatar key={user.name} className="avatar-grey">
                          {user.name[0]}
                        </Avatar>
                      );
                    })}
                  </Avatar.Group>
                ) : (
                  <Avatar
                    key={item.usersOrTitle}
                    size="large"
                    className="avatar-grey"
                  >
                    {item.usersOrTitle[0]}
                  </Avatar>
                )}
              </div>
            }
            title={
              !!item?.usersOrTitle && (
                <div>
                  <strong>{item?.usersOrTitle}</strong>
                </div>
              )
            }
            description={
              <>
                <span>
                  {item?.messages.findLast((i) => i.isInterlocutor)?.text}
                </span>
                <span className="time">
                  {timeFormatter(
                    item?.messages.findLast((i) => i.isInterlocutor)
                      ?.timestamp ?? '',
                  )}
                </span>
              </>
            }
          />
        </List.Item>
      )}
    />
  );
};

export default ChatList;
