import {
  // AdminSettingsUrl,
  // ChatUrl,
  ClinicalInfoUrl,
  DashboardUrl,
  FolllowUpUrl,
  GridViewUrl,
  HelpUrl,
  JobManagementUrl,
  SettingsUrl,
  UserManagementUrl,
  WorklistBuilderUrl,
  WorklistUrl,
} from '../../UrlsConfig';

interface INavLinks {
  title: string;
  iconName: string;
  url: string;
  id: string;
}

export const NavLinks: INavLinks[] = [
  {
    id: '1',
    title: 'Worklist',
    iconName: 'worklist-icon',
    url: WorklistUrl,
  },
  {
    id: '2',
    title: 'Clinical Info',
    iconName: 'clinical-icon',
    url: ClinicalInfoUrl,
  },
  // {
  //   id: '3',
  //   title: 'Chat',
  //   iconName: 'chat-icon',
  //   url: ChatUrl,
  // },
  {
    id: '4',
    title: 'Follow-up Management',
    iconName: 'management-icon',
    url: FolllowUpUrl,
  },
  {
    id: '5',
    title: 'Dashboard',
    iconName: 'dashboard-icon',
    url: DashboardUrl,
  },
];

export const NavLinksAdmin: INavLinks[] = [
  {
    id: '1',
    title: 'Worklists',
    iconName: 'worklist-builder-icon',
    url: WorklistBuilderUrl,
  },
  {
    id: '2',
    title: 'User Management',
    iconName: 'user-management-icon',
    url: UserManagementUrl,
  },
  {
    id: '3',
    title: 'User Mapping',
    iconName: 'grid-view-icon',
    url: GridViewUrl,
  },
  {
    id: '4',
    title: 'Job Management',
    iconName: 'job-builder-icon',
    url: JobManagementUrl,
  },
  {
    id: '5',
    title: 'Dashboard',
    iconName: 'dashboard-admin-icon',
    url: DashboardUrl,
  },
];

export const NavLinksBottom: INavLinks[] = [
  {
    id: '7',
    title: 'Help',
    iconName: 'help-icon',
    url: HelpUrl,
  },
  {
    id: '8',
    title: 'Settings',
    iconName: 'settings-icon',
    url: SettingsUrl,
  },
];
