import { Flex } from 'antd';
import { FC } from 'react';

import DiagramList from './DiagramList';

import { chartGrowhData } from '../utils';

const ProfessionalGrowth: FC = () => {
  return (
    <Flex gap={0} vertical className="growth-panel">
      <Flex vertical={false}>
        <Flex gap={8} vertical className="statistic" align="center">
          <p>Teaching or Reference Cases Created</p>
          <strong>116</strong>
        </Flex>
        <Flex gap={8} vertical className="statistic" align="center">
          <p>Conferences Attended</p>
          <strong>5</strong>
        </Flex>
      </Flex>

      <DiagramList data={chartGrowhData} />
      <DiagramList data={chartGrowhData} />
    </Flex>
  );
};

export default ProfessionalGrowth;
