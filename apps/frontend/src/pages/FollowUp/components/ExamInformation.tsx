import { useState, useCallback, useMemo, FC, Fragment } from 'react';
import { IoChevronDown } from 'react-icons/io5';
import { Button } from 'antd';

import { EMenuItem } from '../types';
import { EExamStatus } from '../../../models/enums';

import Panel from '../../../components/Panel';
import Loader from '../../../components/Loader';
import PatientInfoBlock from '../../../components/PatientInfo';
import VerticalTimeline from './TimeLine';
import PeerFeedbackExamBody from './PeerFeedbackExamBody';
import FollowupExamBody from './FollowupExamBody';

import { useAppSelector } from '../../../hooks/hooks';

import { TExamHistory } from '../../../redux/types/followUpTypes';
import ReportTextExamBody from './ReportTextExamBody';
import FindingDeliveryExamBody from './FindingDeliveryExamBody';

const ExamInformation: FC<{ selectedFeedback: EMenuItem; isShow: boolean }> = ({
  selectedFeedback,
  isShow,
}) => {
  const { followUpData, currentPatientId, isFetching } = useAppSelector(
    ({ followUp }) => followUp,
  );
  const [expanded, setExpanded] = useState<boolean>(false);
  const [active, setActive] = useState<number>();

  const examHistory: TExamHistory[] = useMemo(
    () => followUpData[currentPatientId]?.examHistory || [],
    [followUpData, currentPatientId],
  );
  console.log('followUpData', followUpData);
  console.log('currentPatientId', currentPatientId);

  const patientData = useMemo(() => {
    if (!followUpData[currentPatientId]) {
      return undefined;
    }

    const result = { ...followUpData[currentPatientId]?.patientData };
    let prevType = '';

    examHistory.forEach((item) => {
      if (item.type === EExamStatus.PEER_REVIEWED) {
        prevType = 'Peer Review';
        return;
      }
      if (item.type === EExamStatus.PEER_LEARNING) {
        prevType = 'Peer Learning';
        return;
      }
      if (
        item.type === EExamStatus.FOLLOW_UP_REQUEST &&
        selectedFeedback === EMenuItem.ACTIONABLE_FEEDBACK
      ) {
        prevType = 'Follow-up Requested';
        return;
      }
    });

    result.prevType = prevType;
    return result;
  }, [followUpData, currentPatientId, selectedFeedback]);

  const componentsByType = (historyItem: TExamHistory) => {
    const { type } = historyItem;

    if (type === EExamStatus.FINDING_DELIVERY) {
      return (
        <FindingDeliveryExamBody historyItem={historyItem} active={active} />
      );
    }
    if (type === EExamStatus.REPORTED) {
      return <ReportTextExamBody data={historyItem} active={active} />;
    }
    if (
      type === EExamStatus.PEER_REVIEWED ||
      type === EExamStatus.PEER_LEARNING
    ) {
      const title =
        selectedFeedback === EMenuItem.ACTIONABLE_FEEDBACK
          ? 'Original Score'
          : 'Review Submittedllllll';
      return (
        <PeerFeedbackExamBody
          historyItem={historyItem}
          active={active}
          title={title}
          selectedFeedback={selectedFeedback}
        />
      );
    }
    if (type === EExamStatus.FINALIZE) {
      return (
        <PeerFeedbackExamBody
          historyItem={historyItem}
          active={active}
          title={'Final Score'}
          selectedFeedback={selectedFeedback}
        />
      );
    }
    if (type === EExamStatus.FOLLOW_UP_REQUEST) {
      return <FollowupExamBody historyItem={historyItem} active={active} />;
    }

    return <></>;
  };

  const navigateToTypeArea = useCallback(
    (id: number) => {
      setExpanded(false);
      const element = document.getElementById(`section${id}`);
      setActive(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [followUpData, currentPatientId],
  );

  return (
    <div className={`exam-wrapper ${expanded ? 'hide' : ''}`}>
      <Panel className={`read-panel ${expanded ? 'hide' : ''}`}>
        {isFetching ? (
          <Loader />
        ) : (
          <>
            <div className="body">
              {isShow && !!examHistory.length ? (
                <>
                  <div>
                    {patientData && <PatientInfoBlock data={patientData} />}
                    <Button
                      shape="circle"
                      className="open-hide-exam-panel-button"
                      icon={<IoChevronDown size={24} color="#282C34" />}
                      onClick={() => setExpanded((prev) => !prev)}
                    />
                  </div>
                  <div>
                    <div>
                      {examHistory.map((item, index) => (
                        <Fragment key={index}>
                          {componentsByType(item)}
                        </Fragment>
                      ))}
                    </div>
                    <div className="timeline-wrapper">
                      <VerticalTimeline
                        examHistory={examHistory}
                        navigateToTypeArea={navigateToTypeArea}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <h6 className="info-message">
                  No patient selected to display information
                </h6>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
};

export default ExamInformation;
