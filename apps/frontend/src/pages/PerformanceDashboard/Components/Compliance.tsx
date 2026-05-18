import { Flex, Progress } from 'antd';
import { FC } from 'react';

const Compliance: FC = () => {
  const progressPeerLearningValue = 78;
  const progressPeerReviewValue = 96;

  return (
    <Flex gap={0} vertical className="compliance-panel">
      <Flex vertical gap={8} className="statistic" align="center">
        <p>Critical Results Delivered</p>
        <strong>196</strong>
      </Flex>
      <Flex vertical={false}>
        <Flex vertical className="statistic">
          <p>Peer Learning compliance vs. target, %</p>
          <div className="progress">
            <p style={{ color: '#A1D103' }}>{progressPeerLearningValue}%</p>
            <Progress
              strokeLinecap="butt"
              percent={progressPeerLearningValue}
              showInfo={false}
              size={['100%', 20]}
              trailColor="#A1D10380"
              strokeColor="#A1D103"
            />
          </div>
        </Flex>
        <Flex vertical className="statistic">
          <p>Peer Review engagement vs. target, %</p>
          <div className="progress">
            <p style={{ color: '#89C4F4' }}>{progressPeerReviewValue}%</p>
            <Progress
              strokeLinecap="butt"
              percent={progressPeerReviewValue}
              showInfo={false}
              size={['100%', 20]}
              trailColor="#ADADAD"
              strokeColor="#89C4F4"
            />
          </div>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Compliance;
