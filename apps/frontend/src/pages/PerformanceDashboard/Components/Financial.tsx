import { Flex, Progress } from 'antd';
import { FC } from 'react';

const Financial: FC = () => {
  const progressValue = 46;

  return (
    <Flex gap={0} vertical className="financial-panel">
      <Flex vertical={false}>
        <Flex vertical gap={8} className="statistic" align="center">
          <p>Coding Adjustments</p>
          <strong>164</strong>
        </Flex>
        <Flex vertical gap={8} className="statistic" align="center">
          <p>MIPS Measures applied</p>
          <strong>63</strong>
        </Flex>
      </Flex>
      <Flex vertical className="statistic">
        <p>Follow-up Imaging Recommended vs. Booked</p>
        <div className="progress">
          <div className="title">
            <p>
              Booked <span>145 ({progressValue}%)</span>
            </p>
            <p>
              Recommended <span style={{ color: '#A1D103' }}>323</span>
            </p>
          </div>
          <Progress
            strokeLinecap="butt"
            percent={progressValue}
            showInfo={false}
            size={['100%', 20]}
            trailColor="#A1D10380"
            strokeColor="#A1D103"
          />
        </div>
      </Flex>
    </Flex>
  );
};

export default Financial;
