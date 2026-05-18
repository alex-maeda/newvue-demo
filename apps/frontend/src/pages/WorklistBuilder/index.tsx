import { FC, useEffect } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';

import Panel from '../../components/Panel';
import WorklistNames from './WorklistNames';

import { getPatientListThunk } from '../../redux/thunks/patientThunk';
import {
  getAvailableFiltersData,
  getUsersListThunk,
  getWorklistCorrespondThunk,
  getWorklistThunk,
} from '../../redux/thunks/adminSettingsThunk';
import { getCurrentWorklist } from '../../redux/reducers/adminSettingsReducer';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { WorklistBuilderUrl, WorklistSettingsColumns } from '../../UrlsConfig';

import './style.scss';

const WorklistBuilderLayout: FC = () => {
  const dispatch = useAppDispatch();
  const { worklistId } = useParams();
  const navigator = useNavigate();
  const {
    getWorklists: { isFetching, worklists },
  } = useAppSelector(({ adminSettings }) => adminSettings);

  useEffect(() => {
    dispatch(getUsersListThunk());
    dispatch(getWorklistThunk());
    dispatch(getWorklistCorrespondThunk());
    dispatch(getPatientListThunk());
    dispatch(getAvailableFiltersData());
  }, []);

  useEffect(() => {
    const locationArr = location.pathname.split('/');
    if (locationArr.length === 3) {
      navigator(
        `${WorklistBuilderUrl}/${worklistId}/${WorklistSettingsColumns}`,
      );
    }
  }, [location.pathname]);

  useEffect(() => {
    if (worklistId && worklists.length) {
      dispatch(getCurrentWorklist(worklistId));
    }
  }, [worklistId, worklists]);

  return (
    <div className="settings-worklist-builder-layout">
      <WorklistNames />
      {!worklistId && !isFetching && (
        <Panel expanded className="info-message">
          <h6>No worklist selected to display information</h6>
        </Panel>
      )}
      <Outlet />
    </div>
  );
};

export default WorklistBuilderLayout;
