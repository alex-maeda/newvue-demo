import { FC, useState } from 'react';
import { Button, Dropdown, Input, Space } from 'antd';
import { IoIosAdd } from 'react-icons/io';
import { BsThreeDotsVertical } from 'react-icons/bs';
import { useNavigate, useParams } from 'react-router-dom';

import Panel from '../../components/Panel';
import Loader from '../../components/Loader';

import { updateJobs } from '../../redux/reducers/adminSettingsReducer';

import { IJob } from '../../models/Job';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { menuItems } from './utils';
import { JobManagementUrl } from '../../UrlsConfig';

const JobsNames: FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { jobId } = useParams();
  const [editIndex, setEditIndex] = useState<number>(-1);
  const [value, setValue] = useState<string>('');
  const [activeId, setActiveId] = useState<string | undefined>(jobId);
  const {
    getJobs: { jobs, isFetching },
  } = useAppSelector(({ adminSettings }) => adminSettings);

  const addJob = (index: number) => {
    setValue('');
    setEditIndex(index);
  };

  const saveJob = () => {
    const newJob = [...jobs];
    if (value && editIndex) {
      if (newJob[editIndex]) {
        newJob[editIndex] = { ...newJob[editIndex], label: value };
      } else {
        newJob[editIndex] = {
          id: String(editIndex),
          label: value,
          settings: {
            studies: [],
            usersReceives: [],
            userGroupsReceives: [],
            intervals: [],
          },
        };
      }
    }
    setValue('');
    setEditIndex(-1);
    dispatch(updateJobs(newJob));
  };

  const handleMenuClick = (e: { key: string }, index: number) => {
    const key = e.key;
    const currentJob = jobs[index];

    switch (key) {
      case '1':
        navigator.clipboard.writeText(currentJob.label);
        break;
      case '2':
        setValue(currentJob.label);
        setEditIndex(index);
        break;
      case '3':
        const newJob = [...jobs];
        newJob.splice(index, 1);
        dispatch(updateJobs(newJob));
        break;
    }
  };

  const handleOnClick = (item: IJob) => {
    setActiveId(item.id);
    navigate(`${JobManagementUrl}/${item.id}`);
  };

  return (
    <Panel
      className="settings"
      header={
        <div>
          <h1>Jobs</h1>
          <Button
            className="open-hide-right-panel-button"
            icon={<IoIosAdd size={28} color="#8A85FF" />}
            onClick={() => addJob(jobs.length)}
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
          {jobs.map((item, index) => (
            <div
              key={index}
              className={`job-item ${item.id === activeId ? 'active' : ''}`}
              onClick={() => handleOnClick(item)}
            >
              {editIndex === index ? (
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter worklist name"
                  />
                  <Button type="primary" onClick={saveJob}>
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
          {editIndex === jobs.length && (
            <div className="job-item">
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Enter job name"
                />
                <Button type="primary" onClick={saveJob}>
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

export default JobsNames;
