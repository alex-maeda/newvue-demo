import React, { FunctionComponent, LazyExoticComponent } from 'react';
import {
  LoginUrl,
  NotFoundUrl,
  ClinicalInfoUrl,
  WorklistUrl,
  SettingsUrl,
  ClinicalInfoUrlPatientId,
  DashboardUrl,
  FolllowUpUrl,
  UserManagementUrl,
  WorklistBuilderUrl,
  GridViewUrl,
  WorklistlId,
  WorklistSettingsColumns,
  WorklistSettingsFilters,
  WorklistSettingsUsers,
  JobManagementUrl,
  JobId,
  // ChatUrl,
} from '../UrlsConfig';

import { ERole } from '../models/enums';

const NotFoundComponent = React.lazy(() => import('../pages/NotFound'));
const LoginComponent = React.lazy(() => import('../pages/Login'));
const ClinicalInfoWrapper = React.lazy(
  () => import('../pages/ClinicalInformation'),
);
const ClinicalInfoPage = React.lazy(
  () => import('../pages/ClinicalInformation/Components'),
);
const WorkListPage = React.lazy(() => import('../pages/Worklist'));
const SettingsPage = React.lazy(() => import('../pages/Settings'));
const DashboardPage = React.lazy(() => import('../pages/Dashboard'));
const FolllowUpPage = React.lazy(() => import('../pages/FollowUp'));
// const ChatPage = React.lazy(() => import('../pages/Chat'));
const UserManagement = React.lazy(
  () => import('../pages/UserManagement/UserManagement'),
);
const CorrespondenceTable = React.lazy(() => import('../pages/GridView'));
const WorklistBuilderLayout = React.lazy(
  () => import('../pages/WorklistBuilder'),
);
const WorklistSettingsMenu = React.lazy(
  () => import('../pages/WorklistBuilder/components/WorklistSettingsMenu'),
);
const ColumnsContent = React.lazy(
  () => import('../pages/WorklistBuilder/components/ColumnsContents'),
);
const FiltersContent = React.lazy(
  () => import('../pages/WorklistBuilder/components/FiltersContent'),
);
const UsersContent = React.lazy(
  () => import('../pages/WorklistBuilder/components/UsersContent'),
);
const JobManagementLayout = React.lazy(() => import('../pages/JobsManagement'));
const JobLayout = React.lazy(
  () => import('../pages/JobsManagement/JobContent'),
);
const PerformanceDashboardPage = React.lazy(
  () => import('../pages/PerformanceDashboard'),
);

interface IRouter {
  path: string;
  component: LazyExoticComponent<FunctionComponent<object>>;
  child?: {
    path: string;
    component: LazyExoticComponent<FunctionComponent<object>>;
    child?: {
      path: string;
      component: LazyExoticComponent<FunctionComponent<object>>;
    }[];
  }[];
  roles?: string[];
}

const authorizedRoutePart: IRouter[] = [
  {
    path: NotFoundUrl,
    component: NotFoundComponent,
    roles: [ERole.USER, ERole.ADMIN],
  },
  {
    path: ClinicalInfoUrl,
    component: ClinicalInfoWrapper,
    child: [
      {
        path: ClinicalInfoUrlPatientId,
        component: ClinicalInfoPage,
      },
    ],
    roles: [ERole.USER],
  },
  {
    path: WorklistUrl,
    component: WorkListPage,
    roles: [ERole.USER],
  },
  {
    path: UserManagementUrl,
    component: UserManagement,
    roles: [ERole.ADMIN],
  },
  {
    path: GridViewUrl,
    component: CorrespondenceTable,
    roles: [ERole.ADMIN],
  },
  {
    path: WorklistBuilderUrl,
    component: WorklistBuilderLayout,
    child: [
      {
        path: WorklistlId,
        component: WorklistSettingsMenu,
        child: [
          {
            path: WorklistSettingsFilters,
            component: FiltersContent,
          },
          {
            path: WorklistSettingsUsers,
            component: UsersContent,
          },
          {
            path: WorklistSettingsColumns,
            component: ColumnsContent,
          },
        ],
      },
    ],
    roles: [ERole.ADMIN],
  },
  {
    path: JobManagementUrl,
    component: JobManagementLayout,
    roles: [ERole.ADMIN],
    child: [
      {
        path: JobId,
        component: JobLayout,
      },
    ],
  },
  {
    path: SettingsUrl,
    component: SettingsPage,
    roles: [ERole.USER],
  },
  {
    path: DashboardUrl,
    component: DashboardPage,
    roles: [ERole.USER],
  },
  {
    path: DashboardUrl,
    component: PerformanceDashboardPage,
    roles: [ERole.ADMIN],
  },
  {
    path: FolllowUpUrl,
    component: FolllowUpPage,
    roles: [ERole.USER],
  },
  // {
  //   path: ChatUrl,
  //   component: ChatPage,
  // },
];

const unauthorizedRoutePart: IRouter[] = [
  {
    path: LoginUrl,
    component: LoginComponent,
  },
];

export const RouteConfig = {
  authList: authorizedRoutePart,
  notAuthList: unauthorizedRoutePart,
};
