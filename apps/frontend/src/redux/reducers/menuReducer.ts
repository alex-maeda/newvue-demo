import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { TMenuReducerInitialState } from '../types/menuTypes';
import { EWheelMenuItemName } from '../../models/enums';

export const initialState: TMenuReducerInitialState = {
  menuProps: null,
  documentListProps: null,
  noteProps: null,
  openedMenu: '',
  isFetching: false,
  currentPatientId: '',
};

const MenuReducer = createSlice({
  name: 'Menu',
  initialState,
  reducers: {
    setMenuProps(state, action) {
      state.menuProps = action.payload;
    },
    resetMenuProps(state) {
      state.menuProps = null;
    },
    setDocumentListProps(state, action) {
      state.documentListProps = action.payload;
    },
    resetDocumentListProps(state) {
      state.documentListProps = null;
    },
    setNoteProps(state, action) {
      state.noteProps = action.payload;
    },
    resetNoteProps(state) {
      state.noteProps = null;
    },
    setOpenedMenu(
      state,
      action: PayloadAction<{ id: string; menu: EWheelMenuItemName | '' }>,
    ) {
      const { id, menu } = action.payload;
      state.currentPatientId = id;
      state.openedMenu = menu;
    },
  },
});

export const {
  setMenuProps,
  resetMenuProps,
  setOpenedMenu,
  setDocumentListProps,
  resetDocumentListProps,
  setNoteProps,
  resetNoteProps,
} = MenuReducer.actions;

export default MenuReducer.reducer;
