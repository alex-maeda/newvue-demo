import { createSlice } from '@reduxjs/toolkit';
import { TUtilsInitialState } from '../types/utilsTypes';
import { EChatType } from '../../models/enums';

export const initialState: TUtilsInitialState = {
  hotKey: '',
  isExpandedSidebar: true,
  isExpandChatArea: true,
  chatActiveType: EChatType.CHAT,

  isKonicaBranding: false,
};

const UtilsReducer = createSlice({
  name: 'Menu',
  initialState,
  reducers: {
    setIsExpandedSidebar(state, action) {
      state.isExpandedSidebar = action.payload;
    },
    setIsKonicaBranding(state, action) {
      state.isKonicaBranding = action.payload;
    },
    resetIsKonicaBranding(state) {
      state.isKonicaBranding = false;
    },
    toggleIsExpandedSidebar(state) {
      state.isExpandedSidebar = !state.isExpandedSidebar;
    },
    setIsExpandChatArea(state, action) {
      state.isExpandChatArea = action.payload;
    },
    toggleIsExpandChatArea(state) {
      state.isExpandChatArea = !state.isExpandChatArea;
    },
    setChatType(state, action) {
      state.chatActiveType = action.payload;
    },
    setHotKey(state, action) {
      state.hotKey = action.payload;
    },
  },
});

export const {
  setIsExpandedSidebar,
  toggleIsExpandedSidebar,
  setIsExpandChatArea,
  toggleIsExpandChatArea,
  setChatType,
  setHotKey,

  setIsKonicaBranding,
  resetIsKonicaBranding,
} = UtilsReducer.actions;

export default UtilsReducer.reducer;
