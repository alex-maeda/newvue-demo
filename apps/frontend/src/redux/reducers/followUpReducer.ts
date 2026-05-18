import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { TFollowUpReducerInitialState } from '../types/followUpTypes';
import { getFollowUpHistoryThunk } from '../thunks/followUpThunk';
import {
  TFindingDeliveryRequest,
  TFollowupRequestSaved,
  TPeerReviewSaved,
} from '../../models/PeerReview';
import { EExamStatus } from '../../models/enums';
import { defaultSortFn } from '../../utils/GeneralUtil';
import { IPatient } from '../../models/Patient';

export const initialState: TFollowUpReducerInitialState = {
  openedPeerReview: false,
  openedPeerLearning: false,
  openedPreliminary: false,
  openedEDOverRead: false,
  openedExamQualityFeedback: false,
  openedFindingsDeliveryFeedback: false,
  preliminaryInfo: {
    physician: null,
    preliminary: null,
    comment: null,
    date: null,
  },
  isFetching: false,
  currentPatientId: '',
  followUpData: {},
  peerFeedback: [],
  actionableFeedback: [],
  followupRequest: [],
  findingDelivery: [],
  selectedPatientFromWorklist: null,
};

const FollowUpReducer = createSlice({
  name: 'Menu',
  initialState,
  reducers: {
    openPeerReview(state) {
      state.openedPeerReview = true;
    },
    setCurrentPatientId(state, action) {
      state.currentPatientId = String(action.payload);
    },
    closePeerReview(state) {
      state.openedPeerReview = false;
    },
    peerLearningState(state, action) {
      state.openedPeerLearning = action.payload;
    },
    preliminaryState(state, action) {
      state.openedPreliminary = action.payload;
    },
    preliminaryInfoState(state, action) {
      state.preliminaryInfo = {
        physician: action.payload.physician,
        preliminary: action.payload.preliminary,
        comment: action.payload.comment,
        date: action.payload.date,
      };
    },
    resetPreliminaryInfoState(state) {
      state.preliminaryInfo = initialState.preliminaryInfo;
    },
    preliminaryEDOverReadState(state, action) {
      state.openedEDOverRead = action.payload;
    },
    preliminaryExamQualityFeedbackState(state, action) {
      state.openedExamQualityFeedback = action.payload;
    },
    findingsDeliveryFeedbackState(state, action) {
      state.openedFindingsDeliveryFeedback = action.payload;
    },
    sendFinalScore(state, action: PayloadAction<TPeerReviewSaved>) {
      if (!state.followUpData[state.currentPatientId]) {
        return;
      }
      const { isRequired, score, subOption } = action.payload;
      if (isRequired === 'Yes' && +score > 1) {
        state.followUpData[state.currentPatientId].examHistory.push({
          type: EExamStatus.FINALIZE,
          date: new Date().toISOString(),
          data: action.payload,
        });
        const { patientData } = state.followUpData[state.currentPatientId];
        state.actionableFeedback.push({
          ...patientData,
          ...action.payload,
          userFeedback: `${score}${subOption}`,
        });
        state.actionableFeedback.sort((a, b) =>
          defaultSortFn(a.lastName, b.lastName),
        );
      }
      state.peerFeedback = state.peerFeedback.filter(
        (item) => String(item.id) !== String(state.currentPatientId),
      );
    },
    completePeerReview(state, action: PayloadAction<TPeerReviewSaved>) {
      if (!state.followUpData[state.currentPatientId]) {
        return;
      }
      const historyLength =
        state.followUpData[state.currentPatientId].examHistory.length;
      state.followUpData[state.currentPatientId].examHistory.push({
        id: historyLength,
        type: EExamStatus.PEER_REVIEWED,
        date: new Date().toISOString(),
        data: action.payload,
      });
      const { patientData } = state.followUpData[state.currentPatientId];
      const { score, subOption } = action.payload;
      if (+score > 1) {
        state.peerFeedback.push({
          ...patientData,
          ...action.payload,
          userFeedback: `${score}${subOption}`,
        });
        state.peerFeedback.sort((a, b) =>
          defaultSortFn(a.lastName, b.lastName),
        );
      }
    },
    completePeerLearning(state, action: PayloadAction<TPeerReviewSaved>) {
      if (!state.followUpData[state.currentPatientId]) {
        return;
      }
      const historyLength =
        state.followUpData[state.currentPatientId].examHistory.length;
      state.followUpData[state.currentPatientId].examHistory.push({
        id: historyLength,
        type: EExamStatus.PEER_LEARNING,
        date: new Date().toISOString(),
        data: action.payload,
      });
      const { patientData } = state.followUpData[state.currentPatientId];
      state.peerFeedback.push({
        ...patientData,
        ...action.payload,
        userFeedback: action.payload.meaning,
      });
      state.peerFeedback.sort((a, b) => defaultSortFn(a.lastName, b.lastName));
    },
    sendAddendum(state) {
      if (!state.followUpData[state.currentPatientId]) {
        return;
      }
      state.actionableFeedback = state.actionableFeedback.filter(
        (item) => String(item.id) !== String(state.currentPatientId),
      );
    },
    sendFollowupRequest(state, action: PayloadAction<TPeerReviewSaved>) {
      if (!state.followUpData[state.currentPatientId]) {
        return;
      }
      const { subOption, score } = action.payload;
      if (+score === 2 && +subOption[0] === 1) {
        const data = {
          ...action.payload,
          userFeedback: subOption.substring(1),
        };
        const historyLength =
          state.followUpData[state.currentPatientId].examHistory.length;
        state.followUpData[state.currentPatientId].examHistory.push({
          type: EExamStatus.FINALIZE,
          date: new Date().toISOString(),
          data,
          id: historyLength,
        });
        const { patientData } = state.followUpData[state.currentPatientId];
        state.actionableFeedback.push({
          ...patientData,
          ...data,
        });
        state.actionableFeedback.sort((a, b) =>
          defaultSortFn(a.lastName, b.lastName),
        );
      }
      state.followupRequest = state.followupRequest.filter(
        (item) => String(item.id) !== String(state.currentPatientId),
      );
    },
    sendFindingDeliveryRequest(
      state,
      action: PayloadAction<{
        data: TFindingDeliveryRequest;
        isNeedRemove?: boolean;
      }>,
    ) {
      const {
        data: { id },
        isNeedRemove = false,
      } = action.payload;
      const currentIndex = state.findingDelivery.findIndex(
        (i) => String(i.id) === String(id),
      );

      if (isNeedRemove) {
        state.findingDelivery = state.findingDelivery.filter(
          (i) => String(i.id) !== String(id),
        );
      } else if (currentIndex === -1) {
        state.findingDelivery.push(action.payload.data);
      } else {
        state.findingDelivery.splice(currentIndex, 1, action.payload.data);
      }
    },
    setSelectedPatientFromWorklist(state, action: PayloadAction<IPatient>) {
      state.selectedPatientFromWorklist = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getFollowUpHistoryThunk.pending, (state) => {
        state.isFetching = true;
        state.followUpData = {};
        state.peerFeedback = [];
      })
      .addCase(getFollowUpHistoryThunk.fulfilled, (state, action) => {
        if (action.payload) {
          state.followUpData = action.payload;

          Object.values(action.payload).forEach((value) => {
            const { patientData, examHistory } = value;

            const hasFollowup = examHistory.some(
              ({ type }) => type === EExamStatus.FOLLOW_UP_REQUEST,
            );

            const hasPeerFeedback = examHistory.some(
              ({ type }) => type === EExamStatus.PEER_REVIEWED,
            );

            const hasActionableFeedback = examHistory.some(
              ({ type }) => type === EExamStatus.FINALIZE,
            );

            if (hasFollowup) {
              state.followupRequest.push({
                ...patientData,
                ...(examHistory[2].data as unknown as TFollowupRequestSaved),
              });
            }

            if (hasActionableFeedback) {
              const { score, subOption } = examHistory[3]
                .data as TPeerReviewSaved;
              state.actionableFeedback.push({
                ...patientData,
                ...(examHistory[3].data as TPeerReviewSaved),
                userFeedback: `${score}${subOption}`,
              });
            } else if (hasPeerFeedback) {
              const { score, subOption } = examHistory[2]
                .data as TPeerReviewSaved;
              state.peerFeedback.push({
                ...patientData,
                ...(examHistory[2].data as TPeerReviewSaved),
                userFeedback: `${score}${subOption}`,
              });
            }
          });
          state.peerFeedback.sort((a, b) =>
            defaultSortFn(a.lastName, b.lastName),
          );
          state.actionableFeedback.sort((a, b) =>
            defaultSortFn(a.lastName, b.lastName),
          );
        }
        state.isFetching = false;
      });
  },
});

export const {
  completePeerReview,
  openPeerReview,
  closePeerReview,
  sendFinalScore,
  sendAddendum,
  peerLearningState,
  preliminaryState,
  preliminaryEDOverReadState,
  preliminaryExamQualityFeedbackState,
  findingsDeliveryFeedbackState,
  preliminaryInfoState,
  sendFollowupRequest,
  sendFindingDeliveryRequest,
  setSelectedPatientFromWorklist,
  completePeerLearning,
  setCurrentPatientId,
} = FollowUpReducer.actions;

export default FollowUpReducer.reducer;
