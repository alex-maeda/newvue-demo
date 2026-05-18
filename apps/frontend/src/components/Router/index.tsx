import { lazy, FC, Suspense, useMemo, ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RouteConfig } from '../../utils/RouterUtil';
import { LoginUrl, WorklistBuilderUrl, WorklistUrl } from '../../UrlsConfig';
import { useAppSelector } from '../../hooks/hooks';
import { PrivateRoute } from './utils';
import Layout from '../Layout/Layout';

const PageNotFound = lazy(() => import('../../pages/NotFound'));

const RouterComponent: FC = () => {
  const { isUserLogged, isAdmin, user } = useAppSelector((state) => state.auth);

  const renderAuthRoutes = useMemo(() => {
    if (!RouteConfig || (RouteConfig && !RouteConfig.authList) || !user) {
      return [];
    }

    const result: ReactElement[] = [];

    RouteConfig.authList.forEach((item) => {
      if (
        !item.roles?.length ||
        (user.role && item.roles.includes(user.role))
      ) {
        result.push(
          <Route
            key={item.path}
            path={item.path}
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route
              path={item.path}
              element={
                <PrivateRoute>
                  <Suspense fallback={null}>
                    <item.component />
                  </Suspense>
                </PrivateRoute>
              }
            >
              {!!item.child?.length &&
                item.child.map((i, index) => {
                  return (
                    <Route
                      key={index}
                      path={i.path}
                      element={
                        <PrivateRoute>
                          <Suspense fallback={null}>
                            <i.component />
                          </Suspense>
                        </PrivateRoute>
                      }
                    >
                      {!!i.child?.length &&
                        i.child.map((inner, index) => {
                          return (
                            <Route
                              key={index}
                              path={inner.path}
                              element={
                                <PrivateRoute>
                                  <Suspense fallback={null}>
                                    <inner.component />
                                  </Suspense>
                                </PrivateRoute>
                              }
                            />
                          );
                        })}
                    </Route>
                  );
                })}
            </Route>
          </Route>,
        );
      }
    });

    const navigateUrl = isAdmin ? WorklistBuilderUrl : WorklistUrl;

    return [
      ...result,
      <Route key="/" path="/" element={<Navigate to={navigateUrl} />} />,
      <Route
        key="/login"
        path="/login"
        element={<Navigate to={navigateUrl} />}
      />,
      <Route
        key="*"
        path="*"
        element={
          isAdmin ? (
            <Navigate to={navigateUrl} />
          ) : (
            <Suspense fallback={null}>
              <PageNotFound />
            </Suspense>
          )
        }
      />,
    ];
  }, [user, isAdmin]);

  const renderNotAuthRoutes = useMemo(() => {
    if (!RouteConfig || (RouteConfig && !RouteConfig.notAuthList)) {
      return [];
    }

    const result = RouteConfig.notAuthList.map((item) => (
      <Route
        key={item.path}
        path={item.path}
        element={
          <Suspense fallback={null}>
            <item.component key={item.path} />
          </Suspense>
        }
      />
    ));

    return [
      ...result,
      <Route key="/" path="/" element={<Navigate to={LoginUrl} />} />,
      <Route key="*" path="*" element={<Navigate to={LoginUrl} />} />,
    ];
  }, []);

  return (
    <Routes>{isUserLogged ? renderAuthRoutes : renderNotAuthRoutes}</Routes>
  );
};

export default RouterComponent;
