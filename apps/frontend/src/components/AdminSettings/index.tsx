import { FC, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import SettingsSideMenu from './SideMenu';

import { AdminSettingsUrl, UserManagementUrl } from '../../UrlsConfig';

const AdminSettingsUrlPage: FC = () => {
  const location = useLocation();
  const navigator = useNavigate();

  useEffect(() => {
    if (location.pathname === AdminSettingsUrl) {
      navigator(`${AdminSettingsUrl}/${UserManagementUrl}`);
    }
  }, [location.pathname]);

  return (
    <SettingsSideMenu>
      <Outlet />
    </SettingsSideMenu>
  );
};

export default AdminSettingsUrlPage;
