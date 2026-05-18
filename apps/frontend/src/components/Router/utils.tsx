import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../hooks/hooks';

type PrivateRouteProps = {
  children: JSX.Element;
};

export const PrivateRoute = ({ children }: PrivateRouteProps) => {
  const { isUserLogged } = useAppSelector((state) => state.auth);
  const location = useLocation();
  if (isUserLogged) {
    return children;
  }
  return <Navigate to="/login" state={{ from: location }} />;
};
