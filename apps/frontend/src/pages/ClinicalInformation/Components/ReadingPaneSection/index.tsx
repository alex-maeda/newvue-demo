import { FC, useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Tooltip } from 'antd';

import { EExaminations } from '../../../../models/enums';

import ChartSummary from './ChartSummary';
import ClinicalTimeLine from './ClinicalTimeLine';
import Loader from '../../../../components/Loader';
import ErikAskbar from '../../../../components/ErikAskbar';

import {
  setHotKey,
  // setPieMenuProps,
} from '../../../../redux/reducers/utilsReducer';
import { askErikThunk } from '../../../../redux/thunks/erikThunk';
import { setErikQuestion } from '../../../../redux/reducers/erikReducer';
import RadPairEmbed from '../../../../components/RadPairEmbed';
import MDaiEmbed from '../../../../components/MDaiEmbed';
import PeerReviewPanel from '../../../../components/PeerReviewPanel';
import MenuSidebarRight from '../../../../components/MenuSidebarRight';
import PeerLearningPanel from '../../../../components/PeerLearningPanel';
import SmartReportingEmbed from '../../../../components/SmartReportingEmbed';
import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';
import { createReportThunk } from '../../../../redux/reducers/radpairReducer';
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { useErikActions } from '../../../../hooks/useErikActions';

import { readingPaneConfig, readingPaneOrder } from './utils';

import './style.scss';

const ReadingPaneSection: FC<{
  isShow: boolean;
  setIsShow: (value: boolean | ((value: boolean) => boolean)) => void;
  handleShowRightPanelByHat: () => void;
}> = ({ isShow, setIsShow, handleShowRightPanelByHat }) => {
  const dispatch = useAppDispatch();
  const {
    getPatient: { patient },
  } = useAppSelector(({ patients }) => patients);
  const { user } = useAppSelector(({ auth }) => auth);
  const erikState = useAppSelector(({ erik }) => erik);

  // Get feature flags from patient data
  const isSummaryEnabled = patient?.isSummaryEnabled ?? false;
  const isErikEnabled = patient?.isErikEnabled ?? false;

  const {
    getPatientClinicalHistory: {
      currentExamination,
      data,
      isFetching: isFetchingClinicalHistory,
    },
  } = useAppSelector(({ clinical }) => clinical);
  const { hotKey, isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const { isSocketConnected } = useAppSelector(({ radpair }) => radpair);
  const { openedPeerLearning, openedPeerReview } = useAppSelector(
    ({ followUp }) => followUp,
  );
  const { isExpandedSidebar, isExpandChatArea } = useAppSelector(
    ({ utils }) => utils,
  );

  // Set default activeKey based on feature flags
  const getDefaultActiveKey = () => {
    if (isSummaryEnabled) return EExaminations.SUMMARY;
    if (data?.visitHistory && data.visitHistory.length > 0) {
      return data.visitHistory[0].type;
    }
    return EExaminations.RADIOLOGY;
  };

  const [activeKey, setActiveKey] = useState<string>(getDefaultActiveKey());
  const [textAreaValue, setTextAreaValue] = useState<string>('');
  const [panelWidth, setPanelWidth] = useState<number>(40); // percentage
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const { patientId: patientIdParam } = useParams();

  // ERIK Actions hook - handles UI commands from ERIK AI
  // When ERIK returns an action (e.g., "open_rad:latest_mod:CT"), this hook:
  // 1. Switches to the appropriate tab
  // 2. Sets currentExamination to directly open the matching report
  const handleErikTabChange = useCallback((tab: EExaminations) => {
    setActiveKey(tab);
  }, []);

  useErikActions({
    onTabChange: handleErikTabChange,
  });

  // Update activeKey when patient changes
  useEffect(() => {
    if (isSummaryEnabled) {
      setActiveKey(EExaminations.SUMMARY);
    } else if (data?.visitHistory && data.visitHistory.length > 0) {
      // Find the latest radiology report
      const latestRadiologyReport = data.visitHistory.find(
        (item) => item.type === EExaminations.RADIOLOGY,
      );

      if (latestRadiologyReport) {
        setActiveKey(EExaminations.RADIOLOGY);
        dispatch(setCurrentExamination(latestRadiologyReport));
      } else {
        // Fallback to most recent file if no radiology report exists
        const mostRecentFile = data.visitHistory[0];
        setActiveKey(mostRecentFile.type);
        dispatch(setCurrentExamination(mostRecentFile));
      }
    } else if (activeKey === EExaminations.SUMMARY) {
      setActiveKey(EExaminations.RADIOLOGY);
    }
  }, [patient?.id, isSummaryEnabled, data]);

  useEffect(() => {
    if (currentExamination && currentExamination.type !== activeKey) {
      setActiveKey(currentExamination?.type);
    }
  }, [currentExamination]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const container = document.querySelector('.clinical-wrapper');
      const timeline = document.querySelector('.clinical-timeline-wrapper');
      if (!container || !timeline) return;

      const containerRect = container.getBoundingClientRect();
      const timelineRect = timeline.getBoundingClientRect();

      // Calculate available width (excluding timeline)
      const availableWidth = containerRect.width - timelineRect.width;
      const mousePositionRelativeToTimeline = e.clientX - timelineRect.right;

      // Calculate percentage relative to available width
      const newWidth = (mousePositionRelativeToTimeline / availableWidth) * 100;

      // Constrain between 25% and 60%
      const constrainedWidth = Math.min(Math.max(newWidth, 25), 60);
      setPanelWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  useEffect(() => {
    if (hotKey) {
      const id = hotKey.substring(2);
      const type = Object.keys(readingPaneConfig).find(
        (key) => readingPaneConfig[key as EExaminations]?.id === id,
      );

      if (type && type !== activeKey) {
        handleActivateMenu(type as EExaminations);
      }
      dispatch(setHotKey(''));
    }
  }, [hotKey]);

  useEffect(() => {
    if (!isSocketConnected || !Object.keys(patient).length) {
      return;
    }
    const { modality, examDescription, clinicalIndications, bodyPart } =
      patient;

    dispatch(
      createReportThunk({
        study: modality,
        clinical_history: clinicalIndications,
        comparison: examDescription,
        contrast: '',
        laterality: bodyPart,
        views: 1,
      }),
    );
  }, [isSocketConnected, patient]);

  // const captureStartPosition = (e: MouseEvent) => {
  //   e.stopPropagation();
  //   const target = e.target as HTMLElement;

  //   const { top, left, width } = target.getBoundingClientRect();

  //   dispatch(
  //     setPieMenuProps({
  //       x: left + width / 2,
  //       y: top + width / 2,
  //       id: patientId,
  //       sectionId: '0',
  //     }),
  //   );
  // };

  const handleActivateMenu = (type: EExaminations) => {
    setActiveKey(type);
    // Clear currentExamination when clicking toolbar to show list view
    dispatch(setCurrentExamination(null));
  };

  const isSidebarExist =
    (openedPeerLearning || openedPeerReview) && patientIdParam;

  const calculatePaddingRight = () => {
    if (!isExpandChatArea) return '';
    if (!isSidebarExist) return '341px';
    if (!isExpandedSidebar) return '275px';

    return '';
  };

  if (!patientIdParam) {
    return <></>;
  }

  return (
    <div
      className={`clinical-wrapper ${isShow ? '' : 'hidden-content'}`}
      style={{
        paddingRight: calculatePaddingRight(),
      }}
    >
      {isFetchingClinicalHistory || !Object.values(patient).length ? (
        <div className="loader-wrap">
          <Loader />
        </div>
      ) : (
        <>
          <ClinicalTimeLine setIsShow={setIsShow} />
          <div
            className="clinical-detail-wrap"
            style={{ width: `${panelWidth}%`, flex: `0 0 ${panelWidth}%` }}
          >
            <ChartSummary
              handleShowRightPanelByHat={handleShowRightPanelByHat}
            />

            <div className="clinical-detail">
              <div className="toolbar-container">
                <div
                  className={`btn-toolbar${
                    isKonicaBranding ? ' isKonicaBranding' : ''
                  }`}
                >
                  {readingPaneOrder
                    .filter((key) => {
                      // Hide Summary if not enabled
                      if (key === EExaminations.SUMMARY && !isSummaryEnabled) {
                        return false;
                      }
                      // Hide ERIK AI if not enabled
                      if (key === EExaminations.AI_RESULTS && !isErikEnabled) {
                        return false;
                      }
                      return true;
                    })
                    .map((key) => {
                      const item = readingPaneConfig[key];
                      return (
                        <Tooltip
                          key={item.id}
                          placement="bottom"
                          arrow={false}
                          trigger="hover"
                          title={item.tooltip}
                          destroyTooltipOnHide={true}
                        >
                          <span
                            className={`icon-btn ${item.icon} ${
                              activeKey === key ? 'active' : ''
                            }`}
                            onClick={() =>
                              handleActivateMenu(key as EExaminations)
                            }
                          />
                        </Tooltip>
                      );
                    })}
                  {/* <span className="inline-menu" onClick={captureStartPosition} /> */}
                </div>
                {isErikEnabled && (
                  <ErikAskbar
                    value={textAreaValue}
                    onChange={setTextAreaValue}
                    disabled={erikState.isLoading}
                    onSubmit={() => {
                      if (textAreaValue.trim()) {
                        const questionText = textAreaValue;

                        // Clear input immediately
                        setTextAreaValue('');

                        // Switch to ERIK AI tab
                        handleActivateMenu(EExaminations.AI_RESULTS);

                        // Set question in state immediately for instant feedback
                        dispatch(setErikQuestion(questionText));

                        // Use patient ID as case key for ERIK API
                        const caseKey = String(patient?.id || patientIdParam);
                        dispatch(
                          askErikThunk({
                            caseKey,
                            question: questionText,
                          }),
                        );
                      }
                    }}
                  />
                )}
              </div>
              <div className="detail">
                {readingPaneConfig[activeKey as EExaminations].component}
              </div>
            </div>
          </div>
          <div
            className="resize-handle"
            onMouseDown={() => setIsResizing(true)}
          />
        </>
      )}
      {(() => {
        // Wait for user to load before determining embedding type
        // Also wait if patient ID doesn't match URL param (patient is switching)
        const isPatientSwitching =
          patient?.id && String(patient.id) !== patientIdParam;
        if (!user || isPatientSwitching) {
          return (
            <div style={{ width: '100%' }}>
              <Loader />
            </div>
          );
        }

        // Check for patient-specific override first
        const patientIdStr = String(patient?.id);
        const embeddingOverride = user.embeddingOverrides?.[patientIdStr];
        const embeddingType =
          embeddingOverride || user.embeddingType || 'radpair';

        // Use key to force remount when patient or embedding type changes
        const embedKey = `${patientIdStr}-${embeddingType}`;

        if (embeddingType === 'mdai') {
          return <MDaiEmbed key={embedKey} />;
        } else if (embeddingType === 'smartreporting') {
          return <SmartReportingEmbed key={embedKey} />;
        } else if (isSocketConnected) {
          return <RadPairEmbed key={embedKey} />;
        } else {
          return (
            <div style={{ width: '100%' }}>
              <Loader />
            </div>
          );
        }
      })()}
      {isSidebarExist && (
        <div
          className={`right-panel ${!isExpandedSidebar ? 'hide' : ''} ${
            isShow ? '' : 'absoluted'
          }`}
        >
          <MenuSidebarRight isShowChatBlock={false} isShowProgressBlock={false}>
            {openedPeerReview ? (
              <PeerReviewPanel />
            ) : openedPeerLearning ? (
              <PeerLearningPanel />
            ) : (
              <></>
            )}
          </MenuSidebarRight>
        </div>
      )}
    </div>
  );
};

export default ReadingPaneSection;
