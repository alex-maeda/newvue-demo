import React, { useEffect } from 'react';
import { Button, Col, Row } from 'antd';
import { MdArrowBackIos, MdArrowForwardIos } from 'react-icons/md';
// COMPONENTS
import MenuSidebarRight from '../../components/MenuSidebarRight';
import WorklistComponent from './components/WorklistPanel/WorklistPanel';
import DocumentsList from '../../components/DocumentsList';
import NoteList from '../../components/PatientNotes';
import WorkListControllerRight from './components/WorklistController/WorklistControllerRight';
import Panel from '../../components/Panel';
import TablePanelList from './components/TablePanelList/TablePanelList';
import WorkListControllerBottom from './components/WorklistController/WorklistControllerBottom';
// REDUX
import { getPatientListThunk } from '../../redux/thunks/patientThunk';
import { setIsShowWorklistControllerBlock } from '../../redux/reducers/toolbarSettingsReducer';
import {
  getLinkedResult,
  getStorageCheckedFilters,
  resetSearchResult,
} from '../../redux/reducers/filterReducer';
import {
  preliminaryEDOverReadState,
  preliminaryState,
} from '../../redux/reducers/followUpReducer';
// MODELS
import { EPositionWorkListController } from '../../models/enums';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { ReactComponent as Gear } from '../../assets/img/gear.svg';
import { checkStorage } from '../../utils/StorageUtil';

import './style.scss';

const WorkListPage: React.FunctionComponent = () => {
  const dispatch = useAppDispatch();
  const {
    getPatients: { patients },
  } = useAppSelector(({ patients }) => patients);
  const {
    worklistController: { isShowControllerBlock, position },
  } = useAppSelector(({ toolbarSettings }) => toolbarSettings);
  const { checkedFilters } = useAppSelector(({ filter }) => filter);
  const { isExpandedSidebar } = useAppSelector(({ utils }) => utils);

  const handleCloseSearchPanel = () => {
    dispatch(resetSearchResult());
  };

  const handleStateChangeControllerBlock = () => {
    dispatch(setIsShowWorklistControllerBlock(!isShowControllerBlock));
  };

  useEffect(() => {
    if (checkStorage('checked_filters')) {
      dispatch(getStorageCheckedFilters());
    }
    dispatch(getPatientListThunk());
    return () => {
      handleCloseSearchPanel();
      dispatch(preliminaryState(false));
      dispatch(preliminaryEDOverReadState(false));
    };
  }, []);

  useEffect(() => {
    const combinedArrLen = checkedFilters.filter(
      (item) => item.isCombine,
    ).length;
    !!combinedArrLen && dispatch(getLinkedResult());
  }, [checkedFilters, patients]);

  return (
    <Row>
      <Col
        className={`worklist-info ${!isExpandedSidebar ? 'hide' : ''}`}
        style={{
          display:
            isShowControllerBlock &&
            position === EPositionWorkListController.RIGHT
              ? 'flex'
              : 'block',
          justifyContent: isShowControllerBlock
            ? 'space-between'
            : 'flex-start',
          flexDirection: isShowControllerBlock ? 'row' : 'column',
        }}
      >
        <div
          className="panel-group"
          style={{
            width:
              isShowControllerBlock &&
              position === EPositionWorkListController.RIGHT
                ? 'calc(100% - 360px)'
                : '100%',
          }}
        >
          <TablePanelList />

          {isShowControllerBlock &&
            position === EPositionWorkListController.BOTTOM && (
              <WorkListControllerBottom />
            )}
        </div>

        {isShowControllerBlock &&
          position === EPositionWorkListController.RIGHT && (
            <WorkListControllerRight />
          )}
      </Col>
      <Col className={`right-panel ${!isExpandedSidebar ? 'hide' : ''}`}>
        <MenuSidebarRight isShowProgressIcons={false}>
          <>
            <WorklistComponent />
            <Panel className="side-controller-block">
              <div>
                <Gear
                  className={isShowControllerBlock ? 'show' : ''}
                  onClick={handleStateChangeControllerBlock}
                />
                <h1>Worklists Settings</h1>
              </div>
              <Button
                type="text"
                shape="circle"
                className="header-icon"
                icon={
                  isShowControllerBlock ? (
                    <MdArrowBackIos size={25} color="#999999" />
                  ) : (
                    <MdArrowForwardIos size={25} color="#999999" />
                  )
                }
                onClick={handleStateChangeControllerBlock}
              />
            </Panel>
          </>
        </MenuSidebarRight>
      </Col>
      <DocumentsList />
      <NoteList />
    </Row>
  );
};

export default WorkListPage;
