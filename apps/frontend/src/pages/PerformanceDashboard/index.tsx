import { FC, useState, useCallback } from 'react';
import { Button, Col, Row, Space } from 'antd';
import { BiExpand, BiSolidCog, BiSolidHelpCircle } from 'react-icons/bi';

import Panel from '../../components/Panel';
import { panelArrConfig } from './utils';

import './style.scss';

const PerformanceDashboardPage: FC = () => {
  const [expandId, setExpandId] = useState<number>(0);

  const handleExpand = useCallback(
    (id: number) => {
      if (expandId === id) {
        setExpandId(0);
      } else {
        setExpandId(id);
      }
    },
    [expandId],
  );

  return (
    <div className="dashboard-wrapper">
      <div className="header">
        <h1>Performance dashboard</h1>
      </div>
      <Row className="dashboard">
        <Col className="chart-panel">
          {panelArrConfig.map((panel, index) => (
            <Col
              key={panel.id}
              className={`${expandId === panel.id ? 'active' : ''}`}
              style={{
                display: expandId !== panel.id && !expandId ? 'block' : 'none',
              }}
              span={expandId === panel.id ? 24 : panel.size}
            >
              <Panel
                expanded
                header={
                  <div className="panel-title wide-center stack">
                    <div className="stack-item">
                      <h1>{panel.title}</h1>
                    </div>

                    <Space className="stack-item" size={2}>
                      {index !== 0 && (
                        <Button
                          icon={<BiExpand color="#999999" size={20} />}
                          onClick={() => handleExpand(panel.id)}
                        />
                      )}
                      <Button icon={<BiSolidCog color="#999999" size={20} />} />
                      <Button
                        icon={<BiSolidHelpCircle color="#999999" size={20} />}
                      />
                    </Space>
                  </div>
                }
              >
                {panel.getComponent(handleExpand)}
              </Panel>
            </Col>
          ))}
        </Col>
        <Col className="right-panel"></Col>
      </Row>
    </div>
  );
};

export default PerformanceDashboardPage;
