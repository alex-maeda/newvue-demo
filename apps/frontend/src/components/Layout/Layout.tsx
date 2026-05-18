import { FC, useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Layout as LayoutAntd } from 'antd';
import { XYCoord, useDrop } from 'react-dnd';

import MenuSidebar from '../MenuSidebar';
import WorkListController from '../../pages/Worklist/components/WorklistController/WorklistControllerRight';

import { EPositionWorkListController } from '../../models/enums';

import { setHotKey } from '../../redux/reducers/utilsReducer';
import { setCoordWorklistControllerBlock } from '../../redux/reducers/toolbarSettingsReducer';
import { getFollowUpHistoryThunk } from '../../redux/thunks/followUpThunk';
import { getColumnSettingsListThunk } from '../../redux/thunks/adminSettingsThunk';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { CONTROLLER } from '../../pages/Worklist/utils';
import {
  ClinicalInfoUrl,
  DashboardUrl,
  FolllowUpUrl,
  WorklistUrl,
} from '../../UrlsConfig';
import { hotKeysMap } from '../../utils/HotKeysUtils';
import { useLocation } from 'react-router-dom';
import {
  fetchAccessToken,
  initializeWebSocket,
} from '../../redux/reducers/radpairReducer';
import { WindowProvider } from '../../contexts/WindowContext';

const { Content } = LayoutAntd;

export interface DragItem {
  type: string;
  id: string;
  top: number;
  left: number;
}

const Layout: FC = () => {
  const dispatch = useAppDispatch();
  const { hotKey } = useAppSelector(({ utils }) => utils);
  const { accessToken } = useAppSelector(({ radpair }) => radpair);
  const { isUserLogged } = useAppSelector(({ auth }) => auth);
  const {
    worklistController: { isShowControllerBlock, position },
    controllerPosition: { top, left },
  } = useAppSelector(({ toolbarSettings }) => toolbarSettings);
  const navigate = useNavigate();
  const location = useLocation();

  const isShowController =
    isShowControllerBlock &&
    position === EPositionWorkListController.FREE &&
    location.pathname === WorklistUrl;

  let keyLog: string[] = [];
  let lastKeyPressTime: number | null = null;

  const moveBox = useCallback(
    (left: number, top: number) => {
      dispatch(setCoordWorklistControllerBlock({ top, left }));
    },
    [top, left],
  );

  const [, drop] = useDrop(
    () => ({
      accept: CONTROLLER,
      drop(item: DragItem, monitor) {
        const delta = monitor.getDifferenceFromInitialOffset() as XYCoord;
        const left = Math.round(item.left + delta.x);
        const top = Math.round(item.top + delta.y);
        moveBox(left, top);
        return undefined;
      },
    }),
    [moveBox],
  );

  useEffect(() => {
    if (!hotKey) {
      return;
    }

    const keyIndex = hotKey.substring(2);

    switch (keyIndex) {
      case ',':
        navigate(WorklistUrl);
        break;
      case '.':
        navigate(ClinicalInfoUrl);
        break;
      case '/':
        navigate(FolllowUpUrl);
        break;
      // eslint-disable-next-line quotes
      case "'":
        navigate(DashboardUrl);
        break;
    }

    dispatch(setHotKey(''));
  }, [hotKey]);

  useEffect(() => {
    if (isUserLogged) {
      dispatch(getFollowUpHistoryThunk());
      dispatch(getColumnSettingsListThunk());
      dispatch(fetchAccessToken());
    }
  }, []);

  useEffect(() => {
    if (accessToken) {
      console.log('initialize socket');
      dispatch(initializeWebSocket(accessToken));
    }
  }, [accessToken]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.shiftKey || e.altKey || e.key === 'Enter') {
      return;
    }

    const currentTime = new Date().getTime();

    if (lastKeyPressTime !== null && currentTime - lastKeyPressTime > 300) {
      keyLog = [];
    }

    lastKeyPressTime = currentTime;

    if (keyLog.length === 1 && e.key === 'Control') {
      return;
    }

    keyLog.push(e.key === 'Control' ? 'CTRL' : e.key);

    if (keyLog.length < 2) {
      return;
    }

    const key = keyLog.join('+').toUpperCase();

    if (hotKeysMap[key] && hotKeysMap[key](e)) {
      dispatch(setHotKey(key));
    }

    lastKeyPressTime = null;
    keyLog = [];
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <>
      <MenuSidebar />

      <Content ref={drop}>
        <WindowProvider>
          <Outlet />
        </WindowProvider>
      </Content>

      {isShowController && <WorkListController />}
    </>
  );
};

export default Layout;
