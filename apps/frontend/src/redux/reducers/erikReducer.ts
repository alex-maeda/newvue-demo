import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ErikAction } from '../../services/erikActionsService';

export interface ErikState {
  question: string;
  answer: string;
  isLoading: boolean;
  error: string | null;
  // UI Action state
  pendingAction: ErikAction | null;
  lastExecutedAction: ErikAction | null;
  // Highlighted item for UI feedback
  highlightedItemId: string | number | null;
}

const initialState: ErikState = {
  question: '',
  answer: '',
  isLoading: false,
  error: null,
  pendingAction: null,
  lastExecutedAction: null,
  highlightedItemId: null,
};

const erikReducer = createSlice({
  name: 'erik',
  initialState,
  reducers: {
    setErikQuestion(state, action: PayloadAction<string>) {
      state.question = action.payload;
      state.answer = '';
      state.isLoading = true;
      state.error = null;
      state.pendingAction = null;
    },
    setErikAnswer(state, action: PayloadAction<string>) {
      state.answer = action.payload;
      state.isLoading = false;
    },
    setErikError(state, action: PayloadAction<string>) {
      state.error = action.payload;
      state.isLoading = false;
    },
    clearErikChat(state) {
      state.question = '';
      state.answer = '';
      state.isLoading = false;
      state.error = null;
      state.pendingAction = null;
    },
    // Action-related reducers
    setErikPendingAction(state, action: PayloadAction<ErikAction | null>) {
      state.pendingAction = action.payload;
    },
    setErikActionExecuted(state, action: PayloadAction<ErikAction>) {
      state.lastExecutedAction = action.payload;
      state.pendingAction = null;
    },
    clearErikAction(state) {
      state.pendingAction = null;
      state.lastExecutedAction = null;
    },
    // Highlight reducers
    setErikHighlightedItem(
      state,
      action: PayloadAction<string | number | null>,
    ) {
      state.highlightedItemId = action.payload;
    },
    clearErikHighlight(state) {
      state.highlightedItemId = null;
    },
  },
});

export const {
  setErikQuestion,
  setErikAnswer,
  setErikError,
  clearErikChat,
  setErikPendingAction,
  setErikActionExecuted,
  clearErikAction,
  setErikHighlightedItem,
  clearErikHighlight,
} = erikReducer.actions;

export default erikReducer.reducer;
