import { FC, useEffect, useState } from 'react';
import { Menu } from 'antd';
import { Link, useLocation } from 'react-router-dom';

import Panel from '../../Panel';

import { NavLinksSettings } from './utils';

import './style.scss';

const SettingsSideMenu: FC<{ children: JSX.Element }> = ({ children }) => {
  const [activeKey, setActiveKey] = useState<string>('1');
  const location = useLocation();

  useEffect(() => {
    const currentLink = NavLinksSettings.find((link) =>
      location.pathname.includes(link.url),
    );

    if (currentLink) {
      setActiveKey(currentLink.id);
      return;
    }
  }, [location.pathname]);

  const items = NavLinksSettings.map((link) => ({
    key: link.id,
    label: <Link to={link.url}>{link.title}</Link>,
  }));

  return (
    <div className="settings">
      <Panel header={<h3>Settings</h3>} className="settings-side-menu">
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          onSelect={(item) => setActiveKey(item.key.toString())}
          items={items}
        />
      </Panel>
      {children}
    </div>
  );
};

export default SettingsSideMenu;
