import { FC, useState } from 'react';
import { Col, Row, Space, Button } from 'antd';
import { BiExpand, BiSolidCog, BiSolidHelpCircle } from 'react-icons/bi';

import Panel from '../../components/Panel';
import InsightDaily from './Components/InsightDaily';
import SchedulePanel from './Components/SchedulePanel';
import MenuSidebarRight from '../../components/MenuSidebarRight';

import { panelArrConfig } from './utils';

import './style.scss';

const DashboardPage: FC = () => {
  const [expandId, setExpandId] = useState<number>(0);

  const handleExpand = (id: number) => {
    if (expandId === id) {
      setExpandId(0);
    } else {
      setExpandId(id);
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="header">
        <h1>Daily Insights</h1>
      </div>
      <InsightDaily />
      <Row className="dashboard">
        <Col className="chart-panel">
          {panelArrConfig.map((panel) => (
            <Col
              key={panel.id}
              className={`${expandId === panel.id ? 'active' : ''}`}
              style={{
                display: expandId !== panel.id && !expandId ? 'block' : 'none',
              }}
            >
              <Panel
                expanded
                header={
                  <div className="panel-title wide-center stack">
                    <div className="stack-item">
                      <h1>{panel.title}</h1>
                    </div>

                    <Space className="stack-item">
                      <Button
                        ghost
                        icon={<BiExpand color="#999999" size={16} />}
                        onClick={() => handleExpand(panel.id)}
                      />
                      <Button
                        ghost
                        icon={<BiSolidCog color="#999999" size={16} />}
                      />
                      <Button
                        ghost
                        icon={<BiSolidHelpCircle color="#999999" size={16} />}
                      />
                    </Space>
                  </div>
                }
              >
                {panel.component}
              </Panel>
            </Col>
          ))}
        </Col>
        <Col className="right-panel">
          <MenuSidebarRight isShowProgressBlock={false}>
            <SchedulePanel />
          </MenuSidebarRight>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;
