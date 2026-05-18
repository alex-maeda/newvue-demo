import React, { useEffect, useMemo, useState } from 'react';
import WebFont from 'webfontloader';
import packageJson from '../package.json';
import Loader from './components/Loader';
import RouterComponent from './components/Router';
import { refreshTokenThunk } from './redux/thunks/authThunk';
import { useAppDispatch, useAppSelector } from './hooks/hooks';
import { EStorageKeys } from './models/enums';
import { checkStorage, getStorage, setStorage } from './utils/StorageUtil';
import { ConfigProvider } from 'antd';
import { configTheme } from './utils/GeneralUtil';

import './assets/scss/main.scss';
import socketService from './utils/SocketService';
import { setIsKonicaBranding } from './redux/reducers/utilsReducer';

const App: React.FunctionComponent = () => {
  const dispatch = useAppDispatch();
  const { isPending } = useAppSelector(({ auth }) => auth);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const [isApplicationLoading, setIsApplicationLoading] = useState(true);

  useEffect(() => {
    if (getStorage(EStorageKeys.VERSION) !== packageJson.version) {
      window.localStorage.clear();
      window.sessionStorage.clear();
      setStorage(EStorageKeys.VERSION, packageJson.version);
    }

    if (checkStorage(EStorageKeys.TOKENS)) {
      dispatch(refreshTokenThunk());
    }
    setIsApplicationLoading(false);

    WebFont.load({
      custom: {
        families: ['Open Sans:400;600;700'],
      },
    });
  }, []);

  const setCssVariable = (name: string, value: string) => {
    document.documentElement.style.setProperty(`--${name}`, value);
  };

  useEffect(() => {
    return () => {
      socketService.disconnect();
    };
  }, []);

  const username = getStorage(EStorageKeys.USERNAME);
  useEffect(() => {
    if (username && username === 'konicaminolta') {
      dispatch(setIsKonicaBranding(true));

      setCssVariable('purple100', 'rgb(0, 104, 180)');
      setCssVariable('purple', 'rgb(0, 104, 180)');
      setCssVariable('mutedPurple', 'rgb(30, 114, 174)');
      setCssVariable('green', 'rgb(166, 218, 239)');
      setCssVariable('row-hover', 'rgb(0, 22, 49)');
      setCssVariable('purple70', 'rgb(0, 98, 194)');
      setCssVariable('purple40', 'rgb(0, 68, 153)');
    } else {
      dispatch(setIsKonicaBranding(false));

      setCssVariable('purple100', '#8A85FF');
      setCssVariable('purple', '#8A85FF');
      setCssVariable('mutedPurple', '#888bbd');
      setCssVariable('green', '#A1D103');
      setCssVariable('row-hover', '#2E2E47');
      setCssVariable('purple70', '#535099');
      setCssVariable('purple40', '#373566');
    }
  }, [username, isApplicationLoading]);

  const theme = useMemo(() => {
    return configTheme(isKonicaBranding);
  }, [isKonicaBranding]);

  return (
    <ConfigProvider theme={theme}>
      {!isApplicationLoading && !isPending ? (
        <RouterComponent />
      ) : (
        <Loader className="lg" />
      )}
    </ConfigProvider>
  );
};

export default App;
