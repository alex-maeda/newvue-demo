import { PayloadAction, createSlice } from '@reduxjs/toolkit';

import { EPositionWorkListController } from '../../models/enums';
import { IToolBarSettingsInitialState } from '../types/toolbarSettingsTypes';

export const initialState: IToolBarSettingsInitialState = {
  worklistController: {
    specificList: [
      'auto-next',
      'add-assigned-to-me',
      'report-in-progress',
      'show-assigned-to-others',
    ],
    displayMode: 'Mode 4',
    expanded: true,
    position: EPositionWorkListController.BOTTOM,
    isShowControllerBlock: false,
  },

  controllerPosition: {
    top: 0,
    left: 0,
  },
};

const ToolbarSettingsReducer = createSlice({
  name: 'toolbarSettings',
  initialState,
  reducers: {
    toggleWorklistControllerPin({ worklistController }) {
      worklistController.expanded = !worklistController.expanded;
    },
    setWorklistSpecificList(
      { worklistController },
      actions: PayloadAction<string>,
    ) {
      const value: string = actions.payload;

      if (worklistController.specificList.includes(value)) {
        worklistController.specificList =
          worklistController.specificList.filter((item) => item !== value);
      } else {
        worklistController.specificList.push(value as string);
      }
    },
    setWorklistDisplayMode({ worklistController }, actions) {
      const value: string = actions.payload;

      worklistController.displayMode = value;
    },
    setWorklistControllerPosition({ worklistController }, actions) {
      const value: EPositionWorkListController = actions.payload;

      worklistController.position = value;
    },
    setIsShowWorklistControllerBlock({ worklistController }, actions) {
      const value: boolean = actions.payload;

      worklistController.isShowControllerBlock = value;
    },
    setCoordWorklistControllerBlock({ controllerPosition }, actions) {
      const { top, left } = actions.payload;

      controllerPosition.top = top;
      controllerPosition.left = left;
    },
  },
});

export const {
  toggleWorklistControllerPin,
  setWorklistSpecificList,
  setWorklistDisplayMode,
  setWorklistControllerPosition,
  setIsShowWorklistControllerBlock,
  setCoordWorklistControllerBlock,
} = ToolbarSettingsReducer.actions;

export default ToolbarSettingsReducer.reducer;
