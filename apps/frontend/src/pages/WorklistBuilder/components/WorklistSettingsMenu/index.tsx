import { FC, useEffect, useState } from 'react';
import { Menu } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';

import Panel from '../../../../components/Panel';
import PreviewPanel from './PreviewPanel';

import { useAppSelector } from '../../../../hooks/hooks';

import { NavLinksWorklistSettings } from './utils';

import './style.scss';

const WorklistSettingsMenu: FC = () => {
  const {
    getWorklists: { isFetching },
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const [activeKey, setActiveKey] = useState<string>('1');
  const location = useLocation();

  useEffect(() => {
    const currentLink = NavLinksWorklistSettings.find((link) =>
      location.pathname.includes(link.url),
    );

    if (currentLink) {
      setActiveKey(currentLink.id);
      return;
    }
  }, [location.pathname]);

  const items = NavLinksWorklistSettings.map((link) => ({
    key: link.id,
    label: <Link to={link.url}>{link.title}</Link>,
  }));

  return (
    <>
      {!isFetching && (
        <div className="worklist-settings">
          <div>
            <Panel
              header={<h3>Worklist Settings</h3>}
              className="worklist-settings-side-menu"
            >
              <Menu
                mode="inline"
                selectedKeys={[activeKey]}
                onSelect={(item) => setActiveKey(item.key.toString())}
                items={items}
              />
            </Panel>
            <Outlet />
          </div>
          <PreviewPanel />
        </div>
      )}
    </>
  );
};

export default WorklistSettingsMenu;
