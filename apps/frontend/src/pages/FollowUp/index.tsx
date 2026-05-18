import { FC, useState } from 'react';
import { Col, Row } from 'antd';
// COMPONENTS
import MenuSidebarRight from '../../components/MenuSidebarRight';
import PeerReviewPanel from '../../components/PeerReviewPanel';
import PeerFeedback from './components/PeerFeedback';
import StatisticPanel from './components/StatisticPanel';
import ExamInformation from './components/ExamInformation';
import CreateAddendum from './components/CreateAddendum';
import FollowupRequest from './components/FollowupRequest';
import DeliveryMethod from './components/DeliveryMethod';
// MODELS
import { EMenuItem } from './types';

import { useAppSelector } from '../../hooks/hooks';

import './style.scss';

const FollowUpWrapper: FC = () => {
  const { isExpandedSidebar } = useAppSelector(({ utils }) => utils);
  const [selectedFeedback, setSelectedFeedback] = useState<EMenuItem>(
    EMenuItem.PEER_FEEDBACK,
  );
  const { peerFeedback, actionableFeedback, followupRequest, findingDelivery } =
    useAppSelector(({ followUp }) => followUp);

  const dataForTable =
    selectedFeedback === EMenuItem.ACTIONABLE_FEEDBACK
      ? actionableFeedback
      : selectedFeedback === EMenuItem.FOLLOW_UP_REQUESTS
      ? followupRequest
      : selectedFeedback === EMenuItem.FINDING_DELIVERY
      ? findingDelivery
      : peerFeedback;

  return (
    <Row className="follow-up-wrapper">
      <Col className={`follow-up ${!isExpandedSidebar ? 'hide' : ''}`}>
        <div>
          <StatisticPanel
            active={selectedFeedback}
            handleSelect={(val: EMenuItem) => setSelectedFeedback(val)}
          />
          <PeerFeedback
            data={dataForTable}
            selectedFeedback={selectedFeedback}
          />
          <ExamInformation
            selectedFeedback={selectedFeedback}
            isShow={!!dataForTable.length}
          />
        </div>
      </Col>
      <Col className={`right-panel ${!isExpandedSidebar ? 'hide' : ''}`}>
        <MenuSidebarRight>
          {selectedFeedback === EMenuItem.ACTIONABLE_FEEDBACK ? (
            <CreateAddendum hided={!actionableFeedback.length} />
          ) : selectedFeedback === EMenuItem.FOLLOW_UP_REQUESTS ? (
            <FollowupRequest hided={!followupRequest.length} />
          ) : selectedFeedback === EMenuItem.FINDING_DELIVERY ? (
            <DeliveryMethod hided={!findingDelivery.length} />
          ) : (
            <PeerReviewPanel isFinal hided={!peerFeedback.length} />
          )}
        </MenuSidebarRight>
      </Col>
    </Row>
  );
};

export default FollowUpWrapper;
