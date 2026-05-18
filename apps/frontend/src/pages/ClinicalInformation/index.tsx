import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Col, Row } from 'antd';
import { Outlet, useParams } from 'react-router-dom';
// COMPONENTS
import Panel from '../../components/Panel';
import ClinicalUpNextTable from './Components/ClinicalUpnextTable';
import PanelTable from '../Worklist/components/TablePanel/TablePanel';
import DocumentsList from '../../components/DocumentsList';
import NoteList from '../../components/PatientNotes';
// REDUX
import { getPatientListThunk } from '../../redux/thunks/patientThunk';
import { resetPatientStore } from '../../redux/reducers/patientReducer';
import {
  getConsiderationListThunk,
  getPatientHistoryThunk,
} from '../../redux/thunks/clinicalThunk';
import {
  closePeerReview,
  openPeerReview,
  peerLearningState,
  setCurrentPatientId,
} from '../../redux/reducers/followUpReducer';
import { setCurrentExamination } from '../../redux/reducers/clinicalReducer';
import {
  resetCurrentFilterId,
  resetSearchClinicalResult,
} from '../../redux/reducers/filterReducer';
import { setIsExpandChatArea } from '../../redux/reducers/utilsReducer';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';

import './style.scss';
import ChatPanels from '../../components/ChatPanel';
import {
  closeChat,
  showChatInLargeFormat,
} from '../../redux/reducers/chatReducer';
import { resetReportLink } from '../../redux/reducers/mdaiReducer';
import { IAlert, IChat } from '../../models/Chat';
import MessagesModal from '../../components/MenuSidebarRight/MessagesModal';
import useDetectClickOutside from '../../hooks/useClickOutside';

// Use same hostname as browser so iframe works via IP or localhost
const COCKPIT_URL =
  process.env.REACT_APP_COCKPIT_URL ||
  `${window.location.protocol}//${window.location.hostname}:5174`;

const ClinicalInfoWrapper: FC = () => {
  const {
    getPatients: { patients },
    getPatient: { isFetching: isFetchingGetPatient },
  } = useAppSelector(({ patients }) => patients);
  const {
    getPatientClinicalHistory: { isFetching: isFetchingHistory },
  } = useAppSelector(({ clinical }) => clinical);
  const { followUpData, openedPeerLearning } = useAppSelector(
    ({ followUp }) => followUp,
  );
  const { searchClinicalQuery, currentFilterId } = useAppSelector(
    ({ filter }) => filter,
  );
  const { isExpandedSidebar } = useAppSelector(({ utils }) => utils);
  const { isExpandChatArea } = useAppSelector(({ utils }) => utils);
  const {
    getChats: { isShowLarge },
  } = useAppSelector((state) => state.chat);
  const dispatch = useAppDispatch();
  const [isShowDetail, setIsShowDetail] = useState<boolean>(true);
  const [isActiveItem, setIsActiveItem] = useState<IChat | IAlert>({} as IChat);
  const { patientId: patientIdParam } = useParams();

  const patientId = useMemo(
    () => (patientIdParam ? +patientIdParam : 0),
    [patientIdParam],
  );

  const handleChangeIsShowDetail = () => {
    setIsShowDetail((prev) => !prev);

    if (!isExpandChatArea && isShowDetail) {
      dispatch(setIsExpandChatArea(true));
    } else if (isExpandChatArea && !isShowDetail) {
      dispatch(setIsExpandChatArea(false));
    }
  };

  const handleCloseSearchPanel = useCallback(() => {
    dispatch(resetSearchClinicalResult());
  }, []);

  const handleChangeModalState = (activeItem: IChat | IAlert) => {
    dispatch(showChatInLargeFormat());
    setIsActiveItem(activeItem);
  };

  const handleCloseModal = () => {
    dispatch(closeChat());
    setIsActiveItem({} as IChat);
  };

  useEffect(() => {
    dispatch(setCurrentExamination(null));
    dispatch(getPatientListThunk());
    dispatch(getConsiderationListThunk());
    return () => {
      dispatch(resetPatientStore());
      dispatch(resetCurrentFilterId());
      handleCloseSearchPanel();
      openedPeerLearning && dispatch(peerLearningState(false));
    };
  }, []);

  useEffect(() => {
    if (!patientId) {
      return;
    }
    dispatch(resetReportLink());
    dispatch(getPatientHistoryThunk(patientId));
    setIsShowDetail(true);
    dispatch(setCurrentPatientId(patientId));

    const currentPatient = patients.find((p) => p.id === patientId);

    if (!currentPatient) {
      return;
    }

    const hasOverride = currentPatient.isPeerReviewEnabled !== undefined;

    if (hasOverride) {
      if (currentPatient.isPeerReviewEnabled) {
        dispatch(openPeerReview());
      } else {
        dispatch(closePeerReview());
      }
    } else {
      const hasValidExamHistory =
        followUpData[patientId]?.examHistory.length === 2;
      if (hasValidExamHistory) {
        dispatch(openPeerReview());
      } else {
        dispatch(closePeerReview());
      }
    }
  }, [patientId, patients, followUpData]);

  const sortedPatients = useMemo(() => {
    return patients.slice().filter((patient) => {
      if (patient.sectionId.includes(currentFilterId)) {
        return Object.values(patient).some((value) =>
          String(value).toLowerCase().includes(searchClinicalQuery),
        );
      }
    });
  }, [currentFilterId, searchClinicalQuery, patients]);

  const clinicalRef = useDetectClickOutside(handleCloseModal);

  // Pass patient name to Cockpit iframe for matching
  const currentPatient = useMemo(
    () => patients.find((p) => p.id === patientId),
    [patients, patientId],
  );
  const cockpitIframeSrc = useMemo(
    () =>
      currentPatient
        ? `${COCKPIT_URL}?firstName=${encodeURIComponent(
            currentPatient.firstName,
          )}&lastName=${encodeURIComponent(currentPatient.lastName)}`
        : COCKPIT_URL,
    [currentPatient],
  );

  return (
    <Row ref={clinicalRef}>
      <Col className={`clinical-info ${!isExpandedSidebar ? 'hide' : ''}`}>
        <div>
          {!searchClinicalQuery && (
            <>
              {!patientId && !isFetchingGetPatient && !isFetchingHistory && (
                <Panel expanded className="info-message">
                  <h6>No patient selected to display information</h6>
                </Panel>
              )}
              <Outlet />
              {patientId && (
                <div className="cockpit-iframe-wrapper">
                  <iframe
                    src={cockpitIframeSrc}
                    title="NewVue Cockpit"
                    allow="microphone"
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                    }}
                  />
                </div>
              )}
            </>
          )}
          {searchClinicalQuery && (
            <PanelTable
              className="search-table"
              filter={{
                id: '0',
                label: `Search result for "${searchClinicalQuery}"`,
              }}
              searchParams={searchClinicalQuery}
              callback={handleCloseSearchPanel}
              dataArr={sortedPatients}
            />
          )}

          <div className="bottom-block">
            <ClinicalUpNextTable
              handleChangeIsShowDetail={handleChangeIsShowDetail}
              expanded={!isShowDetail}
            />
            <ChatPanels
              handleChangeModalState={handleChangeModalState}
              isActiveItem={isActiveItem}
              setIsActiveItem={setIsActiveItem}
              isChatOpenInitially={false}
            />
            {isShowLarge && <MessagesModal data={isActiveItem} />}
          </div>
        </div>
      </Col>
      <DocumentsList />
      <NoteList />
    </Row>
  );
};

export default ClinicalInfoWrapper;
