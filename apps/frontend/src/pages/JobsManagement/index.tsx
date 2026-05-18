import { FC, useEffect } from 'react';
import { Tabs } from 'antd';
import { Outlet, useNavigate, useParams } from 'react-router-dom';

import Panel from '../../components/Panel';
import JobsNames from './JobsNames';

import { getJobsListThunk } from '../../redux/thunks/adminSettingsThunk';
import { getCurrentJob } from '../../redux/reducers/adminSettingsReducer';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { JobManagementUrl } from '../../UrlsConfig';

import './style.scss';

const JobsManagementPage: FC = () => {
  const dispatch = useAppDispatch();
  const { jobId } = useParams();
  const navigator = useNavigate();
  const {
    getJobs: { isFetching, jobs },
  } = useAppSelector(({ adminSettings }) => adminSettings);

  useEffect(() => {
    dispatch(getJobsListThunk());
  }, []);

  useEffect(() => {
    const locationArr = location.pathname.split('/');
    if (locationArr.length === 3) {
      navigator(`${JobManagementUrl}/${jobId}`);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (jobId && jobs.length) {
      dispatch(getCurrentJob(jobId));
    }
  }, [jobId, jobs]);

  return (
    <div className="job-management-wrap">
      <h1>Job Management</h1>
      <Tabs
        defaultActiveKey="1"
        size="large"
        items={[
          {
            label: 'Assignment',
            key: '1',
            children: (
              <div className="settings-job-management-layout">
                <JobsNames />
                {!jobId && !isFetching && (
                  <Panel expanded className="info-message">
                    <h6>No job selected to display information</h6>
                  </Panel>
                )}
                <Outlet />
              </div>
            ),
          },
          {
            label: 'Load balancing',
            key: '2',
            children: 'Load balancing',
            disabled: true,
          },
        ]}
      />
    </div>
  );
};

export default JobsManagementPage;
