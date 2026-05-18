import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from './hooks';
import {
  setErikActionExecuted,
  clearErikAction,
  setErikHighlightedItem,
  clearErikHighlight,
} from '../redux/reducers/erikReducer';
import {
  ErikAction,
  getTabEnumFromActionParam,
  findRadiologyByModality,
  findRadiologyByModalityAndRegion,
  findLatestRadiology,
  findNote,
} from '../services/erikActionsService';
import { EExaminations } from '../models/enums';

interface UseErikActionsOptions {
  onTabChange?: (tab: EExaminations) => void;
}

interface UseErikActionsReturn {
  pendingAction: ErikAction | null;
  lastExecutedAction: ErikAction | null;
  highlightedItemId: string | number | null;
  executeAction: (action: ErikAction) => void;
  clearAction: () => void;
  clearHighlight: () => void;
}

/**
 * Hook for handling ERIK UI actions
 * Automatically executes pending actions and provides manual execution
 * Stores highlighted item ID in Redux for components to consume
 */
export function useErikActions(
  options: UseErikActionsOptions = {},
): UseErikActionsReturn {
  const dispatch = useAppDispatch();
  const { pendingAction, lastExecutedAction, highlightedItemId } =
    useAppSelector(({ erik }) => erik);
  const { data: clinicalData } = useAppSelector(
    ({ clinical }) => clinical.getPatientClinicalHistory,
  );

  const { onTabChange } = options;

  // Helper to set highlight with auto-clear after 3 seconds
  const highlightItem = useCallback(
    (itemId: string | number) => {
      dispatch(setErikHighlightedItem(itemId));
      setTimeout(() => {
        dispatch(clearErikHighlight());
      }, 3000);
    },
    [dispatch],
  );

  const executeAction = useCallback(
    (action: ErikAction) => {
      console.log('Executing ERIK action:', action);

      switch (action.type) {
        case 'open_tab': {
          const tabName = action.params[0];
          const tabEnum = getTabEnumFromActionParam(tabName);
          if (tabEnum && onTabChange) {
            onTabChange(tabEnum);
          } else {
            console.warn(`Tab '${tabName}' not found or no handler provided`);
          }
          break;
        }

        case 'open_rad': {
          // First switch to radiology tab (shows list view)
          if (onTabChange) {
            onTabChange(EExaminations.RADIOLOGY);
          }

          const radiologyReports =
            clinicalData?.visitHistory?.filter(
              (item) => item.type === EExaminations.RADIOLOGY,
            ) || [];

          if (action.params[0] === 'latest') {
            // Highlight most recent radiology report in list
            const latest = findLatestRadiology(radiologyReports);
            if (latest && latest.id !== undefined) {
              highlightItem(latest.id);
            }
          } else if (action.params[0] === 'latest_mod') {
            // Highlight latest by modality (e.g., CT, MR, US) in list
            const modality = action.params[1];
            const report = findRadiologyByModality(radiologyReports, modality);
            if (report && report.id !== undefined) {
              highlightItem(report.id);
            }
          } else if (action.params[0] === 'latest_mod_region') {
            // Highlight latest by modality + region (e.g., CT:head) in list
            const modality = action.params[1];
            const region = action.params[2];
            const report = findRadiologyByModalityAndRegion(
              radiologyReports,
              modality,
              region,
            );
            if (report && report.id !== undefined) {
              highlightItem(report.id);
            }
          }
          break;
        }

        case 'open_note': {
          // First switch to notes tab (shows list view)
          if (onTabChange) {
            onTabChange(EExaminations.PHYSICIAN_NOTES);
          }

          const notes =
            clinicalData?.visitHistory?.filter(
              (item) => item.type === EExaminations.PHYSICIAN_NOTES,
            ) || [];

          const noteType = action.params.join(':'); // Handle 'recent:1' format
          const note = findNote(notes, noteType);
          if (note && note.id !== undefined) {
            highlightItem(note.id);
          }
          break;
        }

        default:
          console.warn('Unknown action type:', action.type);
      }

      dispatch(setErikActionExecuted(action));
    },
    [dispatch, clinicalData, onTabChange, highlightItem],
  );

  const clearAction = useCallback(() => {
    dispatch(clearErikAction());
  }, [dispatch]);

  const clearHighlight = useCallback(() => {
    dispatch(clearErikHighlight());
  }, [dispatch]);

  // Auto-execute pending actions
  useEffect(() => {
    if (pendingAction) {
      executeAction(pendingAction);
    }
  }, [pendingAction, executeAction]);

  return {
    pendingAction,
    lastExecutedAction,
    highlightedItemId,
    executeAction,
    clearAction,
    clearHighlight,
  };
}

export default useErikActions;
