import { FC } from 'react';
import { BiDotsVerticalRounded } from 'react-icons/bi';
import { CiWarning } from 'react-icons/ci';
import { VscTasklist } from 'react-icons/vsc';
import { formatDistanceToNowStrict, parse } from 'date-fns';
import { List, Button } from 'antd';

import { IAlert, IChat } from '../../models/Chat';

const AlertList: FC<{
  data: IAlert[];
  callback: (activeItem: IAlert) => void;
  isActiveItem: IAlert | IChat;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
}> = ({ data, callback, isActiveItem }) => {
  const timeFormatter = (date: string | undefined) => {
    const newDataDate = !!date ? date : '';
    const dateObject = parse(newDataDate, 'yyyy.MM.dd HH:mm', new Date());
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
          className="alert"
          // className={isActiveItem.id === item.id ? 'active' : ''}
          // onClick={() => callback(true, item)}
          actions={[
            <Button
              key="1"
              className="btn-dots"
              icon={<BiDotsVerticalRounded size={20} />}
              onClick={() => console.log('show')}
            />,
          ]}
        >
          <List.Item.Meta
            avatar={
              item.usersOrTitle !== 'System' && (
                <div
                  className={`avatar ${
                    item.usersOrTitle === 'System Alert' ? 'warning' : 'default'
                  }`}
                >
                  {item.usersOrTitle === 'System Alert' ? (
                    <CiWarning />
                  ) : (
                    item.usersOrTitle === 'Peer Review' && <VscTasklist />
                  )}
                </div>
              )
            }
            title={
              !!item?.usersOrTitle &&
              item.usersOrTitle !== 'System' && (
                <div>
                  <strong>{item?.usersOrTitle}</strong>
                </div>
              )
            }
            description={
              <>
                <span>{item?.messages[0].text ?? ''}</span>
                <span className="time">
                  {timeFormatter(item?.messages[0].timestamp)}
                </span>
              </>
            }
          />
        </List.Item>
      )}
    />
  );
};

export default AlertList;
