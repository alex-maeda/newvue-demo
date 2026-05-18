import { createAsyncThunk } from '@reduxjs/toolkit';
import erikService, { ErikStreamResponse } from '../../services/erikService';
import {
  setErikAnswer,
  setErikError,
  setErikPendingAction,
} from '../reducers/erikReducer';
import { parseErikAction } from '../../services/erikActionsService';
import { AppDispatch } from '../types';

interface AskErikParams {
  caseKey: string;
  question: string;
}

export const askErikThunk = createAsyncThunk<
  ErikStreamResponse,
  AskErikParams,
  { dispatch: AppDispatch }
>('erik/ask', async ({ caseKey, question }, { dispatch, rejectWithValue }) => {
  try {
    let fullAnswer = '';
    let detectedAction: string | null = null;

    await erikService.askStreaming(
      caseKey,
      question,
      (_chunk, fullText) => {
        fullAnswer = fullText;
        dispatch(setErikAnswer(fullText));
      },
      (action) => {
        // Handle action from X-ERIK-Action header
        detectedAction = action;
        const parsedAction = parseErikAction(action);
        if (parsedAction) {
          dispatch(setErikPendingAction(parsedAction));
        }
      },
    );

    return { answer: fullAnswer, action: detectedAction };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to get response from ERIK';
    dispatch(setErikError(errorMessage));
    return rejectWithValue(errorMessage);
  }
});
