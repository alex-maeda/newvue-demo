import { FC, useState } from 'react';
import { Button, Dropdown, Input, Space } from 'antd';
import { IoIosAdd } from 'react-icons/io';
import { BsThreeDotsVertical } from 'react-icons/bs';
import { useNavigate, useParams } from 'react-router-dom';

import Panel from '../../components/Panel';
import Loader from '../../components/Loader';

import { updateWorklist } from '../../redux/reducers/adminSettingsReducer';

import { IUser } from '../../models/User';
import { IFilter, TUserOrUserGroupRights } from '../../models/Filter';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { menuItems } from './utils';
import { WorklistBuilderUrl } from '../../UrlsConfig';

const WorklistNames: FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { worklistId } = useParams();
  const [editIndex, setEditIndex] = useState<number>(-1);
  const [value, setValue] = useState<string>('');
  const [activeId, setActiveId] = useState<string | undefined>(worklistId);
  const {
    getWorklists: { worklists, isFetching },
    usersList,
  } = useAppSelector(({ adminSettings }) => adminSettings);

  const addWorklist = (index: number) => {
    setValue('');
    setEditIndex(index);
  };

  const saveWorklist = () => {
    const newWorklist = [...worklists];
    if (value && editIndex) {
      if (newWorklist[editIndex]) {
        newWorklist[editIndex] = { ...newWorklist[editIndex], label: value };
      } else {
        const usersRights: TUserOrUserGroupRights[] = [];
        const userGroupsRights: TUserOrUserGroupRights[] = [];
        usersList?.forEach((user: IUser) => {
          const { firstName, lastName, group } = user;
          usersRights.push({
            name: `${firstName} ${lastName}`,
            isView: false,
            isReport: false,
          });
          const isUserGroupExist = userGroupsRights.find(
            (el) => el.name === group,
          );
          if (!isUserGroupExist) {
            userGroupsRights.push({
              name: group,
              isView: false,
              isReport: false,
            });
          }
        });

        newWorklist[editIndex] = {
          id: String(editIndex),
          label: value,
          resultCount: 0,
          settings: {
            columnSettings: [],
            usersRights,
            userGroupsRights,
            sorting: [],
            filters: [],
          },
        };
      }
    }
    setValue('');
    setEditIndex(-1);
    dispatch(updateWorklist(newWorklist));
  };

  const handleMenuClick = (e: { key: string }, index: number) => {
    console.log('click', e);
    const key = e.key;
    const currentWorklist = worklists[index];

    switch (key) {
      case '1':
        navigator.clipboard.writeText(currentWorklist.label);
        break;
      case '2':
        setValue(currentWorklist.label);
        setEditIndex(index);
        break;
      case '3':
        const newWorklist = [...worklists];
        newWorklist.splice(index, 1);
        dispatch(updateWorklist(newWorklist));
        break;
    }
  };

  const handleOnClick = (item: IFilter) => {
    setActiveId(item.id);
    navigate(`${WorklistBuilderUrl}/${item.id}`);
  };

  return (
    <Panel
      className="settings"
      header={
        <div>
          <h1>Worklists</h1>
          <Button
            className="open-hide-right-panel-button"
            icon={<IoIosAdd size={28} color="#8A85FF" />}
            onClick={() => addWorklist(worklists.length)}
          />
        </div>
      }
      expanded
    >
      {isFetching ? (
        <div className="loader-wrapper">
          <Loader />
        </div>
      ) : (
        <>
          {worklists.map((item, index) => (
            <div
              key={index}
              className={`worklist-item ${
                item.id === activeId ? 'active' : ''
              }`}
              onClick={() => handleOnClick(item)}
            >
              {editIndex === index ? (
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter worklist name"
                  />
                  <Button type="primary" onClick={saveWorklist}>
                    Submit
                  </Button>
                </Space.Compact>
              ) : (
                <>
                  <span>{item.label}</span>
                  <Dropdown
                    menu={{
                      items: menuItems,
                      onClick: (e) => handleMenuClick(e, index),
                    }}
                    placement="bottom"
                  >
                    <BsThreeDotsVertical />
                  </Dropdown>
                </>
              )}
            </div>
          ))}
          {editIndex === worklists.length && (
            <div className="worklist-item">
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Enter worklist name"
                />
                <Button type="primary" onClick={saveWorklist}>
                  {value ? 'Add' : 'Cancel'}
                </Button>
              </Space.Compact>
            </div>
          )}
        </>
      )}
    </Panel>
  );
};

export default WorklistNames;
