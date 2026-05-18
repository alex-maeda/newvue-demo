import { Flex, Progress } from 'antd';
import { FC } from 'react';

const Accuracy: FC = () => {
  const progressPeerReviewConcordanceValue = 96;
  const progressPathologyCorrelationsValue = 96;

  return (
    <Flex gap={0} vertical className="accuracy-panel">
      <Flex vertical gap={8} className="statistic" align="center">
        <p>Peer Learning Great Calls</p>
        <strong>45</strong>
      </Flex>
      <Flex vertical={false}>
        <Flex vertical className="statistic">
          <p>Peer Review Concordance</p>
          <div className="progress">
            <p style={{ color: '#89C4F4' }}>
              {progressPeerReviewConcordanceValue}%
            </p>
            <Progress
              strokeLinecap="butt"
              percent={progressPeerReviewConcordanceValue}
              showInfo={false}
              size={['100%', 20]}
              trailColor="#ADADAD"
              strokeColor="#89C4F4"
            />
          </div>
        </Flex>
        <Flex vertical className="statistic">
          <p>Breast Biopsy and Pathology Correlations</p>
          <div className="progress">
            <p style={{ color: '#A1D103' }}>
              {progressPathologyCorrelationsValue}%
            </p>
            <Progress
              strokeLinecap="butt"
              percent={progressPathologyCorrelationsValue}
              showInfo={false}
              size={['100%', 20]}
              trailColor="#a1d10380"
              strokeColor="#A1D103"
            />
          </div>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Accuracy;
