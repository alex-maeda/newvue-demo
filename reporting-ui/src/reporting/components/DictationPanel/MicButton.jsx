import { useCallback, useRef, useEffect, useState } from 'react';
import useReportStore from '../../stores/useReportStore';
import asrService from '../../services/asrService';
import autocorrectService from '../../services/autocorrectService';
import { getCaretPosition, getSelectionRange } from '../../services/caretTracker';
import { startSafetyTimeout, cancelSafetyTimeout } from '../../services/actionQueueService';
import { cancelImpressionDebounce } from '../../services/impressionService';
import voiceCommandEngine from '../../services/voiceCommandEngine';
import ambientListenerService from '../../services/ambientListenerService';
import { registerMicToggle } from '../../services/micToggleRegistry';
import useUserStore from '../../stores/useUserStore';

/**
 * Inactivity timeout (ms). After this long without a new ASR final,
 * the persistent dictation entry is closed, triggering queue drain
 * and the Pass 1 debounce timer.
 */
const INACTIVITY_CLOSE_MS = 750;

export default function MicButton() {
  const asrStatus = useReportStore((s) => s.asrStatus);
  const setAsrStatus = useReportStore((s) => s.setAsrStatus);
  const setAsrError = useReportStore((s) => s.setAsrError);
  const setInterimText = useReportStore((s) => s.setInterimText);
  const addQaLogEntry = useReportStore((s) => s.addQaLogEntry);

  // Action queue actions
  const enqueueAction = useReportStore((s) => s.enqueueAction);
  const incrementalInsert = useReportStore((s) => s.incrementalInsert);
  const closeDictationEntry = useReportStore((s) => s.closeDictationEntry);
  const appendToAsrBuffer = useReportStore((s) => s.appendToAsrBuffer);
  const markAwaitingFinal = useReportStore((s) => s.markAwaitingFinal);

  // Ref to track the current active entry ID (avoids stale closure issues)
  const activeEntryRef = useRef(null);

  // Ref for the button DOM element — used to resolve the correct `window`
  // for the backtick hotkey listener (main window vs PiP pop-out window)
  const buttonRef = useRef(null);

  // Ref for the inactivity timer that closes the persistent entry
  const inactivityTimerRef = useRef(null);

  const isActive = asrStatus === 'listening' || asrStatus === 'connecting' || asrStatus === 'reconnecting';

  /**
   * Clear the inactivity close timer.
   */
  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  /**
   * Start (or restart) the inactivity timer. After INACTIVITY_CLOSE_MS
   * without a new ASR final, the persistent entry is closed, which
   * triggers queue drain → Pass 1 debounce.
   */
  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimer();

    const entryId = activeEntryRef.current;
    if (!entryId) return;

    inactivityTimerRef.current = setTimeout(() => {
      inactivityTimerRef.current = null;

      // Verify the entry is still pending before closing
      const store = useReportStore.getState();
      const entry = store.actionQueue.find((e) => e.actionId === entryId);
      if (entry && entry.status === 'pending') {
        closeDictationEntry(entryId);
        activeEntryRef.current = null;
      }
    }, INACTIVITY_CLOSE_MS);
  }, [clearInactivityTimer, closeDictationEntry]);

  /**
   * Lazily create a persistent action queue entry at the CURRENT
   * activeTextareaId and caret position. The entry persists across
   * multiple per-word ASR finals — all words for this dictation burst
   * are inserted into the same entry via incrementalInsert.
   */
  const ensurePendingEntry = useCallback(() => {
    const store = useReportStore.getState();
    const existing = store.getActiveEntry();
    if (existing) {
      activeEntryRef.current = existing.actionId;
      return existing;
    }

    const targetId = store.activeTextareaId || 'dictation-box';
    const caretPos = getCaretPosition(targetId);
    let selRange = getSelectionRange(targetId);

    // Fallback: if the caretTracker's selection was cleared (e.g., by a
    // prior incrementalInsert from boundary detection), read the actual
    // DOM textarea selection as ground truth.
    if (!selRange) {
      const el = targetId === 'dictation-box'
        ? document.getElementById('dictation-textarea')
        : document.querySelector(`textarea[data-content-box-id="${targetId}"]`);
      if (el && el.selectionStart !== undefined && el.selectionStart !== el.selectionEnd) {
        selRange = {
          start: Math.min(el.selectionStart, el.selectionEnd),
          end: Math.max(el.selectionStart, el.selectionEnd),
        };
      }
    }

    const entry = enqueueAction({
      targetId,
      caretPosition: caretPos,
      selectionRange: selRange,
      actionType: 'dictate',
    });

    if (entry) {
      activeEntryRef.current = entry.actionId;
      // Phase 6: Cancel impression debounce — new ASR activity
      cancelImpressionDebounce();
    }

    return entry;
  }, [enqueueAction]);

  // ─── Voice Command Engine: passthrough handler ─────────────────────
  // This function contains the core onFinal text-handling logic.
  // It is called either directly (if engine is bypassed) or by the
  // engine's passthrough callback when words are determined to NOT
  // be a voice command.
  // ──────────────────────────────────────────────────────────────────
  const handleAsrFinalText = useCallback((text) => {
    // Find the right entry for this final.
    // Priority: pending > awaiting_final. When the user highlights text
    // while ASR is active, boundary detection marks the old entry as
    // awaiting_final and a new pending entry is created with the
    // selection range. We must route the final to the pending entry.
    const currentStore = useReportStore.getState();
    let entry = currentStore.actionQueue.find(
      (e) => e.status === 'pending' && e.actionType === 'dictate'
    );
    if (!entry) {
      entry = currentStore.actionQueue.find(
        (e) => e.status === 'awaiting_final'
      );
    }

    if (!entry) {
      // Edge case: no pending entry (e.g., no interims came first).
      entry = ensurePendingEntry();
    }

    if (entry) {
      cancelSafetyTimeout(entry.actionId);

      const isClosing = entry.status === 'awaiting_final';

      // Log for debugging
      const isFront = currentStore.isEntryAtFront(entry.actionId);
      console.log(`[MicButton] handleAsrFinalText: "${text}" → entry ${entry.actionId} (${entry.status})`,
        entry.selectionRange ? `sel=[${entry.selectionRange.start},${entry.selectionRange.end}]` : 'no-sel',
        `caret=${entry.caretPosition}`,
        isFront ? '(front)' : '(buffered — pass1 in flight)');

      // Incrementally insert the word — if this entry is not at front
      // of queue (e.g., pass1 is ahead), incrementalInsert will buffer
      // the text for replay after pass1 resolves.
      incrementalInsert(entry.actionId, text);

      if (isClosing) {
        // Entry was marked awaiting_final (user switched textareas
        // or stopped mic). This is the flush from finalize().
        // Close the entry now → queue drains → Pass 1 fires.
        closeDictationEntry(entry.actionId);
        activeEntryRef.current = null;
        clearInactivityTimer();
      } else {
        // Entry is still pending — reset the inactivity timer.
        // If no more finals arrive within INACTIVITY_CLOSE_MS, the entry auto-closes.
        resetInactivityTimer();
      }
    } else {
      console.warn('[MicButton] ASR final text received but could not create entry');
    }
  }, [ensurePendingEntry, incrementalInsert, closeDictationEntry,
      clearInactivityTimer, resetInactivityTimer]);

  const handleToggle = async () => {
    if (isActive) {
      // --- Stopping ASR ---
      voiceCommandEngine.shutdown();
      asrService.stop();
      setAsrStatus('idle');
      setInterimText('');
      clearInactivityTimer();

      // If there's a pending entry, mark it awaiting_final with safety timeout
      if (activeEntryRef.current) {
        const entryId = activeEntryRef.current;
        markAwaitingFinal(entryId);

        // Safety timeout: if no final arrives within 1s, close the entry.
        // With persistent entries, text was already inserted incrementally,
        // so the safety timeout just closes the entry (no re-insertion).
        startSafetyTimeout(
          entryId,
          // Wrap closeDictationEntry to match startSafetyTimeout's (actionId, text) signature
          (actionId) => useReportStore.getState().closeDictationEntry(actionId),
          (id) => useReportStore.getState().actionQueue.find((e) => e.actionId === id)
        );

        activeEntryRef.current = null;
      }
      return;
    }

    // --- Starting ASR ---
    // Stop the ambient wake-word listener and WAIT for the mic to be
    // fully released before getUserMedia() grabs it for Speechmatics.
    // Skip deactivation if ambient is off or degraded (no point waiting).
    const wakeEnabled = useUserStore.getState().preferences.voiceWakeEnabled;
    const wakeActive = wakeEnabled && !ambientDegradedRef.current;
    if (wakeActive) {
      await ambientListenerService.deactivate();
    }

    await autocorrectService.load();

    // Initialize the Voice Command Engine with callbacks
    voiceCommandEngine.init({
      passthrough: (text) => {
        // Called by the engine when words are NOT a voice command.
        // Feed them through the regular text pipeline.
        console.log(`[VCE-DIAG] passthrough: "${text}", activeEntryRef=${activeEntryRef.current}`);
        handleAsrFinalText(text);
      },
      onCommandExecuted: (commandId, description) => {
        console.log(`[MicButton] Voice command executed: "${commandId}" — ${description}`);
        useReportStore.getState().setLastVoiceCommand(commandId, description);
      },
      onBeforeCommandExecute: () => {
        // Clean up orphaned action queue entries created by onInterim
        // for command-word interims. If we don't do this, the command
        // handler's setActiveTextarea() call will find the pending entry
        // and call asrService.finalize(), disrupting the ASR stream.
        if (activeEntryRef.current) {
          const store = useReportStore.getState();
          const orphanedEntry = store.actionQueue.find(
            (e) => e.actionId === activeEntryRef.current && e.status === 'pending'
          );
          if (orphanedEntry) {
            console.log(`[VCE-DIAG] onBeforeCommandExecute: closing orphaned entry ${orphanedEntry.actionId}`);
            closeDictationEntry(orphanedEntry.actionId);
          }
          activeEntryRef.current = null;
        }
        clearInactivityTimer();
      },
      suspendInactivityTimer: () => {
        clearInactivityTimer();
      },
      resumeInactivityTimer: () => {
        resetInactivityTimer();
      },
      onOpenEndedCollectionStarted: (commandId, description) => {
        console.log(`[MicButton] Open-ended collection started: "${commandId}" — ${description}`);
        useReportStore.getState().setErikCollecting(true);
      },
      onOpenEndedCollectionEnded: () => {
        console.log('[MicButton] Open-ended collection ended');
        useReportStore.getState().setErikCollecting(false);
      },
    });

    // NOTE: We do NOT create a pending entry here. The entry is lazily
    // created on the first onInterim/onFinal callback. This gives the user
    // time to click their target textarea after pressing the mic button.
    // Creating it eagerly here would lock the entry to 'dictation-box'
    // before the user has selected a content box.

    const vendor = useReportStore.getState().asrVendor;
    asrService.start('head', {
      onInterim: (text) => {
        setInterimText(text);

        // Signal the voice command engine that speech is ongoing.
        // If the engine is BUFFERING, this resets the silence timer
        // to prevent premature timeout while ASR is still processing.
        voiceCommandEngine.signalSpeechActivity();

        console.log(`[VCE-DIAG] onInterim: "${text}", enginePhase=${voiceCommandEngine.getState().phase}, activeEntryRef=${activeEntryRef.current}`);

        // Ensure a pending entry exists. With persistent entries, this
        // usually returns the existing entry. A new entry is only created
        // if the previous one was closed (user paused > 500ms, or switched
        // textareas and the old entry was resolved).
        const entry = ensurePendingEntry();

        // Buffer interim results in the active entry
        if (entry && activeEntryRef.current) {
          appendToAsrBuffer(activeEntryRef.current, text);
        }
      },

      onFinal: (rawText) => {
        // Discard punctuation-only finals
        const hasAlphanumeric = /[a-zA-Z0-9]/.test(rawText);
        if (!hasAlphanumeric) {
          console.log('[MicButton] Discarding punctuation-only final:', JSON.stringify(rawText));
          addQaLogEntry({
            type: 'ASR',
            raw: rawText,
            corrected: '(discarded — punctuation-only)',
            autocorrected: false,
          });
          return;
        }

        console.log(`[VCE-DIAG] onFinal: "${rawText}", enginePhase=${voiceCommandEngine.getState().phase}, activeEntryRef=${activeEntryRef.current}`);

        // ── Voice Command Engine integration ──
        // Tokenize the ASR final into individual words and feed them
        // through the Voice Command Engine. The engine will either:
        //   (a) consume the words as part of a voice command, or
        //   (b) pass them through to handleAsrFinalText via the callback.
        const tokens = voiceCommandEngine.tokenize(rawText);
        voiceCommandEngine.processTokens(tokens);

        console.log(`[VCE-DIAG] onFinal after processTokens: enginePhase=${voiceCommandEngine.getState().phase}, activeEntryRef=${activeEntryRef.current}`);

        // Clear interim
        setInterimText('');

        // Log to QA
        addQaLogEntry({
          type: 'ASR',
          raw: rawText,
          corrected: null,
          autocorrected: false,
        });
      },

      onStatus: (status) => {
        setAsrStatus(status);
        if (status === 'listening') {
          setInterimText('');
        }
      },

      onError: (err) => {
        setAsrError(err.message || 'Microphone error');
        voiceCommandEngine.shutdown();
        clearInactivityTimer();
        activeEntryRef.current = null;
        addQaLogEntry({
          type: 'ASR_ERROR',
          raw: err.message || 'Unknown error',
          corrected: null,
          autocorrected: false,
        });
      },
    }, vendor);
  };

  const handleToggleRef = useRef(handleToggle);
  useEffect(() => {
    handleToggleRef.current = handleToggle;
    registerMicToggle(handleToggle);
  });

  // Clean up registry on unmount
  useEffect(() => {
    return () => registerMicToggle(null);
  }, []);

  useEffect(() => {
    // Resolve the window that owns this button's DOM node.
    // When portaled into a PiP window, this is the PiP's window;
    // otherwise it's the main window. This ensures the backtick
    // hotkey works regardless of which document context we're in.
    const targetWindow = buttonRef.current?.ownerDocument?.defaultView || window;

    const handleKeyDown = (e) => {
      if (e.key === '`') {
        e.preventDefault();
        if (handleToggleRef.current) {
          handleToggleRef.current();
        }
      }
    };
    targetWindow.addEventListener('keydown', handleKeyDown);
    return () => targetWindow.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- AMBIENT WAKE-WORD LISTENER ---
  // Re-engage ambient listening whenever the primary mic goes idle/error,
  // but only if the user has the feature enabled.
  const voiceWakeEnabled = useUserStore((s) => s.preferences.voiceWakeEnabled);

  // Track ambient listener health (degraded after 3 consecutive failures)
  const [ambientDegraded, setAmbientDegraded] = useState(
    () => ambientListenerService.isDegraded()
  );
  const ambientDegradedRef = useRef(ambientDegraded);
  ambientDegradedRef.current = ambientDegraded;

  useEffect(() => {
    ambientListenerService.onDegradedChange(setAmbientDegraded);
    return () => ambientListenerService.onDegradedChange(null);
  }, []);

  useEffect(() => {
    if (asrStatus !== 'idle' && asrStatus !== 'error') return;
    if (!voiceWakeEnabled) return; // User disabled voice wake

    ambientListenerService.activate(() => {
      if (handleToggleRef.current) {
        handleToggleRef.current();
      }
    });

    return () => {
      ambientListenerService.deactivate();
    };
  }, [asrStatus, voiceWakeEnabled]);

  // Determine button class and label based on status
  let className = 'mic-btn';
  let label = 'Start dictation (Toggle with ` )';
  if (asrStatus === 'listening') {
    className += ' mic-btn--active';
    label = 'Stop dictation (Toggle with ` )';
  } else if (asrStatus === 'connecting') {
    className += ' mic-btn--connecting';
    label = 'Connecting…';
  } else if (asrStatus === 'reconnecting') {
    className += ' mic-btn--reconnecting';
    label = 'Reconnecting…';
  } else if (asrStatus === 'error') {
    className += ' mic-btn--error';
    label = 'Microphone error — click to retry';
  }

  // Ambient degraded indicator — only when user has voice wake ON but
  // the service is failing. If user turned the feature OFF, no indicator.
  if (asrStatus === 'idle' && voiceWakeEnabled && ambientDegraded) {
    className += ' mic-btn--ambient-degraded';
    label += '\nWake up by voice temporarily disabled\nDisable this feature in Settings';
  }

  return (
    <button
      ref={buttonRef}
      className={className}
      onClick={handleToggle}
      title={label}
      aria-label={label}
      aria-pressed={isActive ? 'true' : 'false'}
      id="mic-toggle-btn"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {asrStatus === 'listening' ? (
          <>
            {/* Microphone icon — active (filled) */}
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor" opacity="0.2" />
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </>
        ) : (
          <>
            {/* Microphone icon — idle */}
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </>
        )}
      </svg>
    </button>
  );
}
