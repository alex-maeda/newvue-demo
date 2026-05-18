import React, { FC } from 'react';
import { Progress } from 'antd';
import Panel from '../../../components/Panel';
import Loader from '../../../components/Loader';
import { menuConfig } from '../utils';
import { useAppSelector } from '../../../hooks/hooks';
import { EMenuItem } from '../types';

const StatisticPanel: FC<{
  active: EMenuItem;
  handleSelect: (val: EMenuItem) => void;
}> = ({ active, handleSelect }) => {
  const {
    isFetching,
    peerFeedback,
    actionableFeedback,
    followupRequest,
    findingDelivery,
  } = useAppSelector(({ followUp }) => followUp);

  return (
    <Panel className="statistic-panel" expanded>
      {isFetching ? (
        <Loader />
      ) : (
        <>
          <div className="controllers">
            {menuConfig.map((item, index) => (
              <div
                key={index}
                className={active === item.title ? 'active' : ''}
                onClick={() => handleSelect(item.title)}
              >
                <strong>
                  {item.title === EMenuItem.PEER_FEEDBACK
                    ? peerFeedback.length
                    : item.title === EMenuItem.ACTIONABLE_FEEDBACK
                    ? actionableFeedback.length
                    : item.title === EMenuItem.FOLLOW_UP_REQUESTS
                    ? followupRequest.length
                    : item.title === EMenuItem.FINDING_DELIVERY
                    ? findingDelivery.length
                    : item.count}
                </strong>
                <p>{item.title}</p>
              </div>
            ))}
          </div>
          <div className="rates">
            <div>
              <p>Completed Requests</p>
              <Progress
                type="dashboard"
                percent={93.1}
                strokeColor={{ '0%': '#A1D103', '100%': '#89c4f4' }}
                gapDegree={175}
                size={120}
              />
            </div>
            <div>
              <p>Follow-up Success Rate</p>
              <Progress
                type="dashboard"
                percent={79}
                strokeColor={{ '0%': '#CE5179', '100%': '#80BBFF' }}
                size={120}
                gapDegree={175}
              />
            </div>
          </div>
        </>
      )}
    </Panel>
  );
};

export default StatisticPanel;
