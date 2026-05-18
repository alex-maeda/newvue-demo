import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import useReportStore from '../../stores/useReportStore';
import { updateCaretPosition, getCaretPosition } from '../../services/caretTracker';
import { startSafetyTimeout } from '../../services/actionQueueService';
import { buildCaretBackdropHTML } from '../../utils/caretBackdrop';
import { findMatchingMacros, executeMacro } from '../../services/macroService';
import asrService from '../../services/asrService';
import AiEditBadge from './AiEditBadge';
import AiProvenanceBadge from './AiProvenanceBadge';
import DotPhraseOverlay from '../DictationPanel/DotPhraseOverlay';

/**
 * Calculate pixel coordinates of the caret within a textarea.
 * Uses a mirror div technique identical to DictationPanel's version.
 */
function getCaretCoordinatesForContentBox(textarea, position) {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(textarea);

  const stylesToCopy = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap',
  ];

  mirror.style.position = 'absolute';
  mirror.style.top = '-9999px';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.width = computed.width;
  mirror.style.height = 'auto';
  mirror.style.overflow = 'hidden';

  for (const prop of stylesToCopy) {
    mirror.style[prop] = computed[prop];
  }
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';

  const textBefore = textarea.value.slice(0, position);
  mirror.appendChild(document.createTextNode(textBefore));

  const cursorSpan = document.createElement('span');
  cursorSpan.textContent = '|';
  mirror.appendChild(cursorSpan);

  document.body.appendChild(mirror);

  const spanOffsetTop = cursorSpan.offsetTop;
  const spanOffsetLeft = cursorSpan.offsetLeft;

  document.body.removeChild(mirror);

  const lineHeight = parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) * 1.2;

  return {
    top: textarea.offsetTop + spanOffsetTop - textarea.scrollTop + lineHeight + 4,
    left: textarea.offsetLeft + spanOffsetLeft - textarea.scrollLeft,
  };
}

export default function ContentBox({ node }) {
  const textareaRef = useRef(null);
  const boxState = useReportStore((s) => s.contentBoxStates[node.id]);
  const setActiveTextarea = useReportStore((s) => s.setActiveTextarea);
  const setFocusedTextarea = useReportStore((s) => s.setFocusedTextarea);
  const clearFocusedTextarea = useReportStore((s) => s.clearFocusedTextarea);
  const activeTextareaId = useReportStore((s) => s.activeTextareaId);
  const focusedTextareaId = useReportStore((s) => s.focusedTextareaId);
  const caretVersion = useReportStore((s) => s.caretVersion);
  const typingLocked = useReportStore((s) => s.typingLocked);

  // Provenance tracing: store subscriptions
  const setProvenanceHighlight = useReportStore((s) => s.setProvenanceHighlight);
  const clearProvenanceHighlight = useReportStore((s) => s.clearProvenanceHighlight);
  const setProvenanceHighlightContentBoxes = useReportStore((s) => s.setProvenanceHighlightContentBoxes);
  const clearProvenanceHighlightContentBoxes = useReportStore((s) => s.clearProvenanceHighlightContentBoxes);
  const isProvenanceHighlighted = useReportStore(
    (s) => s.provenanceHighlightContentBoxIds.includes(node.id)
  );
  // Reverse lookup: which impression boxes used THIS report body box as a source?
  const impressionBoxesFromMe = useReportStore(
    (s) => s.impressionSourceMap[node.id]
  );

  // Keystroke debounce timer ref for manual typing → Pass 1
  const typingDebounceRef = useRef(null);

  // ── Dot-Phrase Overlay State ──
  const [dpOpen, setDpOpen] = useState(false);
  const [dpFilter, setDpFilter] = useState('');
  const [dpAnchor, setDpAnchor] = useState(null);
  const [dpSelectedIdx, setDpSelectedIdx] = useState(-1);
  const dpDotPosRef = useRef(-1);
  const dpMatchesRef = useRef([]);

  /**
   * Close the dot-phrase overlay and clean up.
   */
  const closeDotPhrase = useCallback(() => {
    if (dpDotPosRef.current >= 0) {
      const store = useReportStore.getState();
      const box = store.contentBoxStates[node.id];
      const currText = box?.currentText || '';
      const dotPos = dpDotPosRef.current;
      const el = textareaRef.current;
      const cursorAfterDot = el ? el.selectionStart : dotPos + 1;
      const removeEnd = Math.max(cursorAfterDot, dotPos + 1);

      if (dotPos < currText.length) {
        const newText = currText.slice(0, dotPos) + currText.slice(removeEnd);
        useReportStore.setState((s) => ({
          contentBoxStates: {
            ...s.contentBoxStates,
            [node.id]: { ...(s.contentBoxStates[node.id] || {}), currentText: newText },
          },
        }));
        requestAnimationFrame(() => {
          if (el) {
            el.selectionStart = dotPos;
            el.selectionEnd = dotPos;
          }
          updateCaretPosition(node.id, dotPos);
        });
      }
    }
    setDpOpen(false);
    setDpFilter('');
    setDpAnchor(null);
    setDpSelectedIdx(-1);
    dpDotPosRef.current = -1;
    dpMatchesRef.current = [];
  }, [node.id]);

  /**
   * Handle macro selection from the overlay.
   */
  const handleDpSelect = useCallback((macro) => {
    const dotPos = dpDotPosRef.current;
    const el = textareaRef.current;

    if (dotPos >= 0) {
      const store = useReportStore.getState();
      const box = store.contentBoxStates[node.id];
      const currText = box?.currentText || '';
      const cursorAfterDot = el ? el.selectionStart : dotPos + 1;
      const removeEnd = Math.max(cursorAfterDot, dotPos + 1);
      const newText = currText.slice(0, dotPos) + currText.slice(removeEnd);
      useReportStore.setState((s) => ({
        contentBoxStates: {
          ...s.contentBoxStates,
          [node.id]: { ...(s.contentBoxStates[node.id] || {}), currentText: newText },
        },
      }));
      requestAnimationFrame(() => {
        if (el) {
          el.selectionStart = dotPos;
          el.selectionEnd = dotPos;
        }
        updateCaretPosition(node.id, dotPos);
        executeMacro(macro.id);
      });
    }
    setDpOpen(false);
    setDpFilter('');
    setDpAnchor(null);
    setDpSelectedIdx(-1);
    dpDotPosRef.current = -1;
    dpMatchesRef.current = [];
  }, [node.id]);

  const currentText = boxState?.currentText ?? node.text ?? '';
  const isPass2Inserted = boxState?.pass2Inserted ?? false;
  const isSoftDeleted = boxState?.deleted ?? false;
  const isImpressionGenerated = boxState?.impressionGenerated ?? false;
  const isCritical = boxState?.isCritical ?? false;

  // Synthetic provenance fields (recommendations/guidelines sections)
  const syntheticContent = boxState?.syntheticContent ?? null;
  const sourceImpressionBoxId = boxState?.sourceImpressionBoxId ?? null;

  // AI-edit detection: Pass 2B edited this normal finding
  const editedBySegmentIds = boxState?.editedBySegmentIds;
  const originalText = boxState?.originalText ?? '';
  const isManuallyEdited = boxState?.manuallyEdited ?? false;
  const isAiEdited = !!(editedBySegmentIds?.length > 0 && !isManuallyEdited && originalText !== currentText);

  // Track whether the diff overlay is open (for amber border highlight)
  const [overlayVisible, setOverlayVisible] = useState(false);

  // --- Provenance Tracing ---
  // Collect all provenance segment IDs for this content box (dictation → report)
  const sourceSegmentIds = boxState?.sourceSegmentIds;
  const suppressedBySegmentIds = boxState?.suppressedBySegmentIds;
  const sourceContentBoxIds = boxState?.sourceContentBoxIds;
  const provenanceSegmentIds = useMemo(() => {
    const ids = [];
    if (isPass2Inserted && sourceSegmentIds?.length > 0) ids.push(...sourceSegmentIds);
    if (editedBySegmentIds?.length > 0) ids.push(...editedBySegmentIds);
    if (suppressedBySegmentIds?.length > 0) ids.push(...suppressedBySegmentIds);
    return ids;
  }, [isPass2Inserted, sourceSegmentIds, editedBySegmentIds, suppressedBySegmentIds]);

  // Has any provenance data to show?
  const hasProvenance = provenanceSegmentIds.length > 0;
  const hasImpressionProvenance = isImpressionGenerated && sourceContentBoxIds?.length > 0;
  // Reverse: this report body box is a source for impression items
  const hasReverseImpressionProvenance = !isImpressionGenerated && impressionBoxesFromMe?.length > 0;
  const isFocusedRef = useRef(false);

  // Virtual caret position (local state for reactive re-render)
  const [caretPos, setCaretPos] = useState(0);

  // Re-sync local caretPos when voice commands reposition externally
  useEffect(() => {
    if (caretVersion === 0) return; // skip initial mount
    const pos = getCaretPosition(node.id);
    setCaretPos(pos);
  }, [caretVersion, node.id]);

  // Track last text set by user typing (not from ASR).
  // Used to detect external updates and reposition the cursor.
  const lastInternalTextRef = useRef(currentText);

  // Captures textarea state BEFORE the browser applies any change.
  const preChangeStateRef = useRef({ text: '', selStart: 0, selEnd: 0 });

  // Track caret position for this content box
  const trackCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    updateCaretPosition(node.id, el.selectionStart, el.selectionEnd);
    setCaretPos(el.selectionStart);
  }, [node.id]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  // Initial resize and on text change
  useEffect(() => {
    autoResize();
  }, [currentText, autoResize]);

  // Re-measure height when the textarea's container width changes
  // (e.g., when the user resizes the report panel horizontally)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      autoResize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoResize]);

  // Clean up typing debounce on unmount
  useEffect(() => {
    return () => {
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    };
  }, []);

  /**
   * Resolve any active typing/delete entry for this content box.
   */
  const resolveActiveEntry = useCallback(() => {
    const store = useReportStore.getState();
    const activeEntry = store.getActiveTypingEntry(node.id);
    if (activeEntry) {
      if (activeEntry.actionType === 'type') {
        store.resolveTypingEntry(activeEntry.actionId);
      } else if (activeEntry.actionType === 'delete') {
        store.resolveDeleteEntry(activeEntry.actionId);
      }
    }
  }, [node.id]);

  const handleInput = useCallback((e) => {
    const newText = e.target.value;
    const oldText = preChangeStateRef.current.text;
    const preSelStart = preChangeStateRef.current.selStart;
    const preSelEnd = preChangeStateRef.current.selEnd;
    const hadSelection = preSelStart !== preSelEnd;

    lastInternalTextRef.current = newText;

    // --- Diff old vs new text ---
    let editStart = 0;
    while (editStart < oldText.length && editStart < newText.length &&
           oldText[editStart] === newText[editStart]) {
      editStart++;
    }

    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > editStart && newEnd > editStart &&
           oldText[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    const deletedLength = oldEnd - editStart;
    const insertedLength = newEnd - editStart;
    const deletedText = oldText.slice(editStart, oldEnd);
    const insertedText = newText.slice(editStart, newEnd);

    const store = useReportStore.getState();
    const targetId = node.id;

    // --- Route to appropriate handler ---

    if (hadSelection) {
      resolveActiveEntry();

      if (deletedLength > 0) {
        const selStart = Math.min(preSelStart, preSelEnd);
        const selEnd = Math.max(preSelStart, preSelEnd);
        store.enqueueDeleteEntry({
          targetId,
          deletionStart: selStart,
          deletionEnd: selEnd,
          deletedText: oldText.slice(selStart, selEnd),
          immediateResolve: true,
        });
      }

      if (insertedLength > 0) {
        const entry = store.enqueueTypingEntry({ targetId, caretPosition: editStart });
        if (entry) {
          store.updateTypingEntry(entry.actionId, insertedText, editStart + insertedLength, insertedLength);
        }
        useReportStore.setState((s) => ({
          contentBoxStates: {
            ...s.contentBoxStates,
            [targetId]: { ...(s.contentBoxStates[targetId] || {}), currentText: newText },
          },
        }));
      }
    } else if (insertedLength > 0 && deletedLength === 0) {
      // PURE INSERTION

      // --- Newline interception ---
      // When Enter is pressed (or text with \n is pasted), create structural
      // newline segments instead of including \n in a typing entry's text.
      // Each \n becomes a 1-char 'structural' segment that participates in
      // offset accounting but is excluded from Pass 1/Pass 2 processing.
      if (insertedText.includes('\n')) {
        resolveActiveEntry();

        const parts = insertedText.split('\n');
        let currentOffset = editStart;

        for (let i = 0; i < parts.length; i++) {
          const textPart = parts[i];

          // Handle non-newline text (if any)
          if (textPart.length > 0) {
            const entry = store.enqueueTypingEntry({ targetId, caretPosition: currentOffset });
            if (entry) {
              store.updateTypingEntry(entry.actionId, textPart, currentOffset + textPart.length, textPart.length);
              store.resolveTypingEntry(entry.actionId);
            }
            currentOffset += textPart.length;
          }

          // Insert structural newline (except after the last part)
          if (i < parts.length - 1) {
            store.insertStructuralNewline(targetId, currentOffset);
            currentOffset += 1; // \n occupies 1 character
          }
        }

        // Update currentText with the full new value (including \n)
        useReportStore.setState((s) => ({
          contentBoxStates: {
            ...s.contentBoxStates,
            [targetId]: { ...(s.contentBoxStates[targetId] || {}), currentText: newText, manuallyEdited: true },
          },
        }));

        autoResize();
        trackCaret();

        // Cancel impression debounce, start Pass 1 debounce (same as normal flow)
        import('../../services/impressionService.js').then((mod) => mod.cancelImpressionDebounce());
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = setTimeout(() => {
          typingDebounceRef.current = null;
          resolveActiveEntry();
          import('../../services/pass1Service.js').then((mod) => mod.default.startDebounce());
        }, 1500);

        return; // early exit — newline handled above
      }

      const activeEntry = store.getActiveTypingEntry(targetId);

      if (activeEntry && activeEntry.actionType === 'type' &&
          editStart === activeEntry.insertEnd) {
        store.updateTypingEntry(activeEntry.actionId, insertedText, editStart + insertedLength, insertedLength);
      } else {
        resolveActiveEntry();
        const entry = store.enqueueTypingEntry({ targetId, caretPosition: editStart });
        if (entry) {
          store.updateTypingEntry(entry.actionId, insertedText, editStart + insertedLength, insertedLength);
        }
      }
      useReportStore.setState((s) => ({
        contentBoxStates: {
          ...s.contentBoxStates,
          [targetId]: { ...(s.contentBoxStates[targetId] || {}), currentText: newText },
        },
      }));

    } else if (deletedLength > 0 && insertedLength === 0) {
      // PURE DELETION
      const activeTypingEntry = store.getActiveTypingEntry(targetId);

      if (activeTypingEntry && activeTypingEntry.actionType === 'type') {
        if (editStart >= activeTypingEntry.insertStart && oldEnd <= activeTypingEntry.insertEnd) {
          store.updateTypingEntry(activeTypingEntry.actionId, '', editStart, -deletedLength);
          useReportStore.setState((s) => ({
            contentBoxStates: {
              ...s.contentBoxStates,
              [targetId]: { ...(s.contentBoxStates[targetId] || {}), currentText: newText },
            },
          }));
        } else {
          resolveActiveEntry();
          store.enqueueDeleteEntry({ targetId, deletionStart: editStart, deletionEnd: oldEnd, deletedText });
        }
      } else if (activeTypingEntry && activeTypingEntry.actionType === 'delete') {
        const isBackspace = editStart < activeTypingEntry.caretPosition;
        store.updateDeleteEntry(activeTypingEntry.actionId, deletedText, isBackspace);
      } else {
        store.enqueueDeleteEntry({ targetId, deletionStart: editStart, deletionEnd: oldEnd, deletedText });
      }
    }

    autoResize();
    trackCaret();

    // ── Dot-Phrase Detection & Filter Update ──
    const afterEl = e.target;
    if (afterEl && !dpOpen) {
      const cursorPos = afterEl.selectionStart;
      const newVal = afterEl.value;
      if (cursorPos > 0 && newVal[cursorPos - 1] === '.' &&
          (cursorPos === 1 || /\s/.test(newVal[cursorPos - 2]))) {
        dpDotPosRef.current = cursorPos - 1;
        const rect = getCaretCoordinatesForContentBox(afterEl, cursorPos);
        setDpAnchor(rect);
        setDpOpen(true);
        setDpFilter('');
        dpMatchesRef.current = findMatchingMacros('');
        setDpSelectedIdx(-1);
      }
    } else if (dpOpen && afterEl) {
      const cursorPos = afterEl.selectionStart;
      const newVal = afterEl.value;
      const dotPos = dpDotPosRef.current;
      if (dotPos >= 0 && cursorPos > dotPos) {
        const filterChars = newVal.slice(dotPos + 1, cursorPos);
        setDpFilter(filterChars);
        const matches = findMatchingMacros(filterChars);
        dpMatchesRef.current = matches;
        if (matches.length === 0 && filterChars.length > 0) {
          closeDotPhrase();
        } else if (matches.length > 0 && filterChars.length > 0) {
          setDpSelectedIdx(0);
        }
      } else {
        closeDotPhrase();
      }
    }

    // Cancel any pending impression debounce on new keystroke
    import('../../services/impressionService.js').then((mod) => {
      mod.cancelImpressionDebounce();
    });

    // Start keystroke debounce: wait 1.5s after last keystroke, then trigger Pass 1.
    // SKIP debounce while dot-phrase overlay is open.
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    if (!dpOpen) {
      typingDebounceRef.current = setTimeout(() => {
        typingDebounceRef.current = null;
        resolveActiveEntry();
        import('../../services/pass1Service.js').then((mod) => {
          mod.default.startDebounce();
        });
      }, 1500);
    }
  }, [node.id, autoResize, trackCaret, resolveActiveEntry, dpOpen, closeDotPhrase]);

  // When text changes externally (ASR insertion), update the visual caret
  // position from caretTracker. Skip for user-typed changes (already correct).
  useEffect(() => {
    if (currentText === lastInternalTextRef.current) return;
    lastInternalTextRef.current = currentText;

    const el = textareaRef.current;
    if (!el) return;

    const caretPos2 = getCaretPosition(node.id);
    const maxPos = currentText.length;
    setCaretPos(Math.min(caretPos2, maxPos));
    // Use requestAnimationFrame so React finishes reconciling the value first
    requestAnimationFrame(() => {
      el.selectionStart = Math.min(caretPos2, maxPos);
      el.selectionEnd = Math.min(caretPos2, maxPos);
    });
  }, [currentText, node.id]);

  const handleFocus = useCallback(() => {
    setActiveTextarea(node.id);
    setFocusedTextarea(node.id);
    trackCaret();
    // Provenance: persist highlight while focused
    isFocusedRef.current = true;
    if (hasProvenance) {
      setProvenanceHighlight(provenanceSegmentIds);
    }
    if (hasImpressionProvenance) {
      // Impression box → highlight source report body boxes
      setProvenanceHighlightContentBoxes(sourceContentBoxIds);
    } else if (hasReverseImpressionProvenance) {
      // Report body box → highlight impression boxes that drew from it
      setProvenanceHighlightContentBoxes(impressionBoxesFromMe);
    }
  }, [node.id, setActiveTextarea, setFocusedTextarea, trackCaret,
      hasProvenance, provenanceSegmentIds, setProvenanceHighlight,
      hasImpressionProvenance, sourceContentBoxIds,
      hasReverseImpressionProvenance, impressionBoxesFromMe,
      setProvenanceHighlightContentBoxes]);

  const handleBlur = useCallback(() => {
    clearFocusedTextarea(node.id);
    // Provenance: clear persistent highlight on blur
    isFocusedRef.current = false;
    if (hasProvenance) {
      clearProvenanceHighlight();
    }
    if (hasImpressionProvenance || hasReverseImpressionProvenance) {
      clearProvenanceHighlightContentBoxes();
    }
  }, [node.id, clearFocusedTextarea,
      hasProvenance, clearProvenanceHighlight,
      hasImpressionProvenance, hasReverseImpressionProvenance,
      clearProvenanceHighlightContentBoxes]);

  const handleSelect = useCallback(() => {
    trackCaret();
    // If user makes a selection, resolve any active typing/delete entry
    const el = textareaRef.current;
    if (el && el.selectionStart !== el.selectionEnd) {
      resolveActiveEntry();
    }
  }, [trackCaret, resolveActiveEntry]);

  const handleClick = useCallback(() => {
    trackCaret();
    resolveActiveEntry();

    // Intra-textarea cursor-move boundary detection (§4.2)
    const store = useReportStore.getState();
    if (store.asrStatus === 'listening' || store.asrStatus === 'reconnecting') {
      const pendingEntry = store.getActiveEntry();
      if (pendingEntry && pendingEntry.targetId === node.id) {
        asrService.finalize();

        store.markAwaitingFinal(pendingEntry.actionId);
        startSafetyTimeout(
          pendingEntry.actionId,
          store.resolveAction,
          (id) => store.actionQueue.find((e) => e.actionId === id)
        );
      }
    }
  }, [trackCaret, node.id, resolveActiveEntry]);

  const handleKeyUp = useCallback(() => {
    trackCaret();
  }, [trackCaret]);

  // Block typing/paste when dictation is in progress (pending dictate entry)
  const handleKeyDown = useCallback((e) => {
    // Capture pre-change state for diff computation
    const el = e.target;
    if (el) {
      preChangeStateRef.current = {
        text: el.value,
        selStart: el.selectionStart,
        selEnd: el.selectionEnd,
      };
    }

    // ── Dot-Phrase Overlay Interception ──
    if (dpOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setDpSelectedIdx((prev) => {
          const len = dpMatchesRef.current.length;
          if (len === 0) return -1;
          return prev >= len - 1 ? 0 : prev + 1;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setDpSelectedIdx((prev) => {
          const len = dpMatchesRef.current.length;
          if (len === 0) return -1;
          return prev <= 0 ? len - 1 : prev - 1;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (dpSelectedIdx >= 0 && dpSelectedIdx < dpMatchesRef.current.length) {
          handleDpSelect(dpMatchesRef.current[dpSelectedIdx]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDotPhrase();
        return;
      }
      if (e.key === 'Backspace') {
        if (dpFilter.length === 0) {
          e.preventDefault();
          closeDotPhrase();
          return;
        }
      }
    }

    if (typingLocked) {
      const allowedKeys = [
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End', 'PageUp', 'PageDown',
        'Shift', 'Control', 'Alt', 'Meta',
        'Tab', 'Escape', 'F1', 'F2', 'F3', 'F4', 'F5',
        'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
      ];
      if (!allowedKeys.includes(e.key)) {
        e.preventDefault();
        return;
      }
    }
  }, [typingLocked, dpOpen, dpFilter, dpSelectedIdx, closeDotPhrase, handleDpSelect]);

  const handlePaste = useCallback((e) => {
    if (typingLocked) {
      e.preventDefault();
      return;
    }
  }, [typingLocked]);

  // --- Provenance: hover handlers for ephemeral highlights ---
  const handleMouseEnter = useCallback(() => {
    if (isFocusedRef.current) return; // Focus already set persistent highlight
    if (hasProvenance) {
      setProvenanceHighlight(provenanceSegmentIds);
    }
    if (hasImpressionProvenance) {
      setProvenanceHighlightContentBoxes(sourceContentBoxIds);
    } else if (hasReverseImpressionProvenance) {
      setProvenanceHighlightContentBoxes(impressionBoxesFromMe);
    }
  }, [hasProvenance, provenanceSegmentIds, setProvenanceHighlight,
      hasImpressionProvenance, sourceContentBoxIds,
      hasReverseImpressionProvenance, impressionBoxesFromMe,
      setProvenanceHighlightContentBoxes]);

  const handleMouseLeave = useCallback(() => {
    if (isFocusedRef.current) return; // Don't clear — focus is holding it
    if (hasProvenance) {
      clearProvenanceHighlight();
    }
    if (hasImpressionProvenance || hasReverseImpressionProvenance) {
      clearProvenanceHighlightContentBoxes();
    }
  }, [hasProvenance, clearProvenanceHighlight,
      hasImpressionProvenance, hasReverseImpressionProvenance,
      clearProvenanceHighlightContentBoxes]);

  // Build CSS classes for the content box
  const wrapperClasses = [
    'content-box__wrapper',
    isPass2Inserted ? 'content-box__wrapper--pass2' : '',
    isSoftDeleted ? 'content-box__wrapper--deleted' : '',
    isImpressionGenerated && !isCritical ? 'content-box__wrapper--impression' : '',
    isCritical ? 'content-box__wrapper--critical' : '',
    isAiEdited && overlayVisible ? 'content-box__wrapper--ai-overlay-active' : '',
    // Provenance: content box is being highlighted by another element's hover/focus
    isProvenanceHighlighted ? 'content-box__wrapper--provenance-highlight' : '',
    // Provenance: this content box has provenance data (subtle hover hint)
    (hasProvenance || hasImpressionProvenance || hasReverseImpressionProvenance) ? 'content-box__wrapper--has-provenance' : '',
  ].filter(Boolean).join(' ');

  // --- Virtual caret ---
  const showVirtualCaret = activeTextareaId === node.id && focusedTextareaId !== node.id;
  const caretBackdropHTML = useMemo(
    () => showVirtualCaret ? buildCaretBackdropHTML(currentText, caretPos) : '',
    [showVirtualCaret, currentText, caretPos]
  );

  return (
    <div
      className="content-box"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={wrapperClasses}>
        {/* AI source badge for Pass 2-inserted findings */}
        {isPass2Inserted && !isSoftDeleted && !isImpressionGenerated && (
          <span className="content-box__source-badge" title="Inserted by LLM Pass 2 from dictation">
            AI
          </span>
        )}
        {/* Critical finding flag icon */}
        {isCritical && !isSoftDeleted && (
          <span className="critical-flag-icon" title="Critical finding — may require urgent attention">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#e53e3e" stroke="#e53e3e" strokeWidth="1">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" stroke="#e53e3e" strokeWidth="2" />
            </svg>
          </span>
        )}
        <div
          className="caret-backdrop caret-backdrop--content"
          aria-hidden="true"
          style={{ display: showVirtualCaret ? undefined : 'none' }}
          dangerouslySetInnerHTML={{ __html: caretBackdropHTML }}
        />
        <textarea
          ref={textareaRef}
          className={`content-box__textarea ${showVirtualCaret ? 'content-box__textarea--with-caret' : ''}`}
          id={`textarea-${node.id}`}
          value={currentText}
          onChange={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSelect={handleSelect}
          onClick={handleClick}
          onKeyUp={handleKeyUp}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          spellCheck={false}
          rows={1}
          readOnly={isSoftDeleted}
        />
        {/* AI-edit indicator badge for Pass 2B-edited normals */}
        {isAiEdited && !isSoftDeleted && (
          <AiEditBadge
            originalText={originalText}
            currentText={currentText}
            onOverlayVisibleChange={setOverlayVisible}
          />
        )}
        {/* Provenance badge for synthetic recommendation/guideline content boxes */}
        {syntheticContent && !isSoftDeleted && (
          <AiProvenanceBadge
            sourceImpressionBoxId={sourceImpressionBoxId}
            syntheticType={syntheticContent}
          />
        )}
        {/* Dot-Phrase Overlay */}
        <DotPhraseOverlay
          isOpen={dpOpen}
          filterText={dpFilter}
          onSelect={handleDpSelect}
          onClose={closeDotPhrase}
          anchorRect={dpAnchor}
        />
      </div>
    </div>
  );
}
