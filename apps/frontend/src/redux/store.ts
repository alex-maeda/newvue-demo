import { configureStore } from '@reduxjs/toolkit';
import patientReducer from './reducers/patientReducer';
import authReducer from './reducers/authReducer';
import chatReducer from './reducers/chatReducer';
import menuReducer from './reducers/menuReducer';
import clinicalReducer from './reducers/clinicalReducer';
import followUpReducer from './reducers/followUpReducer';
import adminSettingsReducer from './reducers/adminSettingsReducer';
import filterReducer from './reducers/filterReducer';
import toolbarSettingsReducer from './reducers/toolbarSettingsReducer';
import utilsReducer from './reducers/utilsReducer';
import radpairReducer from './reducers/radpairReducer';
import mdaiReducer from './reducers/mdaiReducer';
import erikReducer from './reducers/erikReducer';
import medicalReportReducer from './reducers/medicalReportReducer';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    patients: patientReducer,
    chat: chatReducer,
    clinical: clinicalReducer,
    menu: menuReducer,
    followUp: followUpReducer,
    adminSettings: adminSettingsReducer,
    filter: filterReducer,
    toolbarSettings: toolbarSettingsReducer,
    utils: utilsReducer,
    radpair: radpairReducer,
    mdai: mdaiReducer,
    erik: erikReducer,
    medicalReport: medicalReportReducer,
  },
});
