import { UserManagementUrl, WorklistBuilderUrl } from '../../../UrlsConfig';

interface INavSettings {
  title: string;
  url: string;
  id: string;
}

export const NavLinksSettings: INavSettings[] = [
  {
    id: '1',
    title: 'Edit users',
    url: UserManagementUrl,
  },
  {
    id: '2',
    title: 'Worklists builder',
    url: WorklistBuilderUrl,
  },
];
