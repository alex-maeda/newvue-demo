import { FC, useEffect, useState, useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Menu, Layout } from 'antd';

import { signOut } from '../../redux/reducers/authReducer';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { ReactComponent as Logo } from '../../assets/img/logoNV.svg';
import { ReactComponent as LogoKonicaBranding } from '../../assets/img/logoNVKonicaBranding.svg';
import { setStorage } from '../../utils/StorageUtil';
import { NavLinks, NavLinksAdmin, NavLinksBottom } from './NavigationUtil';
import { ClinicalInfoUrl, WorklistUrl, HelpUrl } from '../../UrlsConfig';
import { MENU_WIDTH_COLLAPSE } from '../../utils/GeneralUtil';
//import { ClinicalInfoUrl } from '../../UrlsConfig';

import './style.scss';
import { resetIsKonicaBranding } from '../../redux/reducers/utilsReducer';

const MenuSidebar: FC = () => {
  const location = useLocation();
  const { patientId } = useParams();
  const dispatch = useAppDispatch();
  const { isAdmin } = useAppSelector(({ auth }) => auth);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const [activeKey, setActiveKey] = useState<string>('2');

  const { Sider } = Layout;

  const TopLinks = useMemo(
    () => (isAdmin ? NavLinksAdmin : NavLinks),
    [isAdmin],
  );

  if (location && location.pathname.indexOf('login') < 0) {
    setStorage('route', location.pathname);
  }

  const checkUrl = (url: string) => {
    if (url.includes(ClinicalInfoUrl) && !!patientId)
      return `${url}/${patientId}`;
    else return url;
  };

  useEffect(() => {
    let currentLink = TopLinks.find((link) =>
      location.pathname.startsWith(link.url),
    );

    if (!currentLink) {
      currentLink = NavLinksBottom.find((link) =>
        location.pathname.startsWith(link.url),
      );
    }

    if (currentLink) {
      setActiveKey(currentLink.id);
      return;
    }
  }, [location.pathname]);

  const handleClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      dispatch(signOut());
      dispatch(resetIsKonicaBranding());
    }
  };

  const itemsTop = TopLinks.map((link) => ({
    key: link.id,
    icon: <span className={link.iconName} />,
    label: <Link to={checkUrl(link.url)}>{link.title}</Link>,
  }));

  // Show Help icon only when on Worklist page; hide it on Clinical Info and other pages
  const bottomLinksFiltered = NavLinksBottom.filter((link) => {
    // If this is the Help link, only include it when the current path is the Worklist
    if (link.url === HelpUrl) {
      return location.pathname.startsWith(WorklistUrl);
    }
    return true;
  });

  const itemsBottom = [
    ...bottomLinksFiltered.map((link) => ({
      key: link.id,
      icon: <span className={link.iconName} />,
      label: <Link to={checkUrl(link.url)}>{link.title}</Link>,
    })),
    {
      key: 'logout',
      icon: <span className="logout-icon" />,
      label: <span>Sign out</span>,
    },
  ];

  return (
    <div className="menu-sidebar">
      <Sider
        // collapsible
        collapsed={true}
        collapsedWidth={MENU_WIDTH_COLLAPSE}
      >
        <div className={`brand${isKonicaBranding ? ' isKonicaBranding' : ''}`}>
          {isKonicaBranding ? <LogoKonicaBranding /> : <Logo />}
        </div>

        <div
          className={
            isKonicaBranding
              ? 'isKonicaBranding menu-sidebar-content'
              : 'menu-sidebar-content'
          }
        >
          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            onSelect={(item) => setActiveKey(item.key.toString())}
            items={itemsTop}
          />

          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            onSelect={(item) => setActiveKey(item.key.toString())}
            onClick={handleClick}
            className="sidenav-bottom"
            items={itemsBottom}
          />
        </div>
      </Sider>
    </div>
  );
};

export default MenuSidebar;
