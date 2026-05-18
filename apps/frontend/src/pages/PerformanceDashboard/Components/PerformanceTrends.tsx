import { FC } from 'react';
import { Heatmap } from '@ant-design/plots';
import { Button, Progress, Space } from 'antd';
import { BiExpand, BiSolidCog, BiSolidHelpCircle } from 'react-icons/bi';

import Panel from '../../../components/Panel';

import { ERadiologyTypeColor } from '../../../models/enums';

import { configHeatmap, reportingTime } from '../utils';

const PerformanceTrends: FC<{ onExpand: () => void }> = ({ onExpand }) => {
  const SLA = 95;

  return (
    <div className="performance-trends">
      <div className="main-info">
        <div className="main-info-top">
          <div>
            <strong>Average RVU/case</strong>
            <p>4.8</p>
          </div>
          <div>
            <strong>Average Monthly Cases from Gap Coverage</strong>
            <p>36</p>
          </div>
          <div>
            <strong>SLA compliance rates</strong>
            <div>
              <p>{SLA}%</p>
              <Progress
                strokeLinecap="butt"
                percent={SLA}
                showInfo={false}
                size={['100%', 20]}
                trailColor="#adadad"
                strokeColor="#A1D103"
              />
            </div>
          </div>
        </div>
        <div className="rvu-by-month">
          <Panel
            expanded
            header={
              <div className="panel-title wide-center stack">
                <div className="stack-item">
                  <h1>Avg. RVU/Hour by Month</h1>
                </div>

                <Space className="stack-item">
                  <Button
                    ghost
                    icon={<BiExpand color="#999999" size={20} />}
                    onClick={() => onExpand()}
                  />
                  <Button
                    ghost
                    icon={<BiSolidCog color="#999999" size={20} />}
                  />
                  <Button
                    ghost
                    icon={<BiSolidHelpCircle color="#999999" size={20} />}
                  />
                </Space>
              </div>
            }
          >
            <Heatmap {...configHeatmap} renderer="svg" />
          </Panel>
        </div>
      </div>
      <div className="side-info">
        <strong>Avg. Reporting Time by Modality</strong>
        <div>
          {reportingTime.map((item, index) => {
            const color = ERadiologyTypeColor[item.type];
            return (
              <div className="bar" key={index}>
                <p className="name">{item.type}</p>
                {/* <p className="value" style={{ color: item.color }}>
                  {item.value}
                </p> */}
                <div className="bar-content">
                  <div
                    style={{
                      width: item.value ? `${item.value}%` : '2px',
                      background: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PerformanceTrends;
