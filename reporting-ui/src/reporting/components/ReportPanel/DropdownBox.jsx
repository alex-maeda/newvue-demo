import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react';
import useReportStore from '../../stores/useReportStore';
import { updateCaretPosition, getCaretPosition } from '../../services/caretTracker';
import { startSafetyTimeout } from '../../services/actionQueueService';
import { buildCaretBackdropHTML } from '../../utils/caretBackdrop';
import { findMatchingMacros, executeMacro } from '../../services/macroService';
import asrService from '../../services/asrService';
import AiEditBadge from './AiEditBadge';
import DotPhraseOverlay from '../DictationPanel/DotPhraseOverlay';

/**
 * Calculate pixel coordinates of the caret within a textarea.
 * Uses a mirror div technique for accurate positioning.
 */
function getCaretCoordinatesForDropdown(textarea, position) {
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

/**
 * Determine the character offset in a textarea from a click event's coordinates.
 * Approximation by binary search on a mirror element.
 */
function getCharOffsetFromClick(textarea, clientX, clientY) {
  const rect = textarea.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top + textarea.scrollTop;
  const text = textarea.value;

  // Use the textarea's native hit-test: set caret at the click point
  // We do this by checking what selection would be at the click position
  // Fallback: use the current selectionStart (already set by the browser on mousedown)
  return textarea.selectionStart;
}

/**
 * Build the background overlay HTML with picklist highlights.
 * This renders the same text as the textarea, but with highlighted spans
 * for active picklist regions and invisible text elsewhere.
 */
function buildPicklistOverlayHTML(text, picklists) {
  if (!picklists?.length || !text) return escapeHTML(text || '');

  const parts = [];
  let lastIdx = 0;

  // Sort picklists by startOffset
  const sorted = [...picklists].sort((a, b) => a.startOffset - b.startOffset);

  for (const pl of sorted) {
    if (!pl.active) continue;
    if (pl.startOffset < lastIdx) continue; // overlapping — skip

    // Text before this picklist
    if (pl.startOffset > lastIdx) {
      parts.push(`<span class="picklist-overlay__text">${escapeHTML(text.slice(lastIdx, pl.startOffset))}</span>`);
    }

    // The highlighted picklist region (pill style — no chevron needed)
    const plText = text.slice(pl.startOffset, pl.endOffset);
    parts.push(
      `<span class="picklist-overlay__highlight" data-picklist-index="${pl.partIndex}">` +
        `${escapeHTML(plText)}` +
      `</span>`
    );

    lastIdx = pl.endOffset;
  }

  // Remaining text after last picklist
  if (lastIdx < text.length) {
    parts.push(`<span class="picklist-overlay__text">${escapeHTML(text.slice(lastIdx))}</span>`);
  }

  return parts.join('');
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

/**
 * DropdownBox — A fully-editable textarea with inline picklist overlays.
 *
 * Architecture:
 * 1. Background overlay: renders text with highlighted picklist regions
 * 2. Foreground textarea: transparent background, fully editable
 * 3. Floating dropdown: appears when clicking within an active picklist region
 *
 * The text is always a plain string. Services only see the string.
 * Picklist offsets are tracked and maintained as edits occur.
 */
function DropdownBox({ node }) {
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const menuRef = useRef(null);

  const boxState = useReportStore((s) => s.contentBoxStates[node.id]);
  const setActiveTextarea = useReportStore((s) => s.setActiveTextarea);
  const setFocusedTextarea = useReportStore((s) => s.setFocusedTextarea);
  const clearFocusedTextarea = useReportStore((s) => s.clearFocusedTextarea);
  const activeTextareaId = useReportStore((s) => s.activeTextareaId);
  const focusedTextareaId = useReportStore((s) => s.focusedTextareaId);
  const caretVersion = useReportStore((s) => s.caretVersion);
  const typingLocked = useReportStore((s) => s.typingLocked);

  const currentText = boxState?.currentText ?? node.text ?? '';
  const picklists = boxState?.picklists ?? [];
  const isPass2Inserted = boxState?.pass2Inserted ?? false;
  const isSoftDeleted = boxState?.deleted ?? false;
  const isImpressionGenerated = boxState?.impressionGenerated ?? false;
  const isCritical = boxState?.isCritical ?? false;

  // AI-edit detection
  const editedBySegmentIds = boxState?.editedBySegmentIds;
  const originalText = boxState?.originalText ?? '';
  const isManuallyEdited = boxState?.manuallyEdited ?? false;
  const isAiEdited = !!(editedBySegmentIds?.length > 0 && !isManuallyEdited && originalText !== currentText);
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Floating dropdown state
  const [openPicklistIdx, setOpenPicklistIdx] = useState(null); // index into picklists array
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  // Virtual caret position
  const [caretPos, setCaretPos] = useState(0);
  const lastInternalTextRef = useRef(currentText);
  const preChangeStateRef = useRef({ text: '', selStart: 0, selEnd: 0 });
  const typingDebounceRef = useRef(null);

  // ── Dot-Phrase Overlay State ──
  const [dpOpen, setDpOpen] = useState(false);
  const [dpFilter, setDpFilter] = useState('');
  const [dpAnchor, setDpAnchor] = useState(null);
  const [dpSelectedIdx, setDpSelectedIdx] = useState(-1);
  const dpDotPosRef = useRef(-1);
  const dpMatchesRef = useRef([]);

  // Re-sync local caretPos when voice commands reposition externally
  useEffect(() => {
    if (caretVersion === 0) return;
    const pos = getCaretPosition(node.id);
    setCaretPos(pos);
  }, [caretVersion, node.id]);

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

  useEffect(() => {
    autoResize();
  }, [currentText, autoResize]);

  // Re-measure height when the textarea's container width changes
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

  // Close floating menu when clicking outside
  useEffect(() => {
    if (openPicklistIdx === null) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenPicklistIdx(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [openPicklistIdx]);

  // ── Dot-Phrase Close/Select ──
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

  // ── Resolve Active Entry ──
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

  // ── Picklist Offset Maintenance ──
  // Check edits against active picklist regions and disable any that are affected
  const checkPicklistIntegrity = useCallback((oldText, newText) => {
    if (!picklists?.length) return;

    const store = useReportStore.getState();
    const box = store.contentBoxStates[node.id];
    if (!box?.picklists?.length) return;

    // Diff to find the edit range
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

    // Calculate shift
    const delta = (newEnd - editStart) - (oldEnd - editStart);

    const updatedPicklists = box.picklists.map((pl) => {
      if (!pl.active) return pl;

      // Check if edit overlaps with this picklist's region
      const editOverlaps = editStart < pl.endOffset && oldEnd > pl.startOffset;

      if (editOverlaps) {
        // Edit is inside or overlapping this picklist — disable it
        return { ...pl, active: false };
      }

      // Edit is after this picklist — no change needed
      if (editStart >= pl.endOffset) return pl;

      // Edit is before this picklist — shift offsets
      return {
        ...pl,
        startOffset: pl.startOffset + delta,
        endOffset: pl.endOffset + delta,
      };
    });

    // Only update if something changed
    const changed = updatedPicklists.some((pl, i) =>
      pl.active !== box.picklists[i].active ||
      pl.startOffset !== box.picklists[i].startOffset ||
      pl.endOffset !== box.picklists[i].endOffset
    );

    if (changed) {
      useReportStore.setState((s) => ({
        contentBoxStates: {
          ...s.contentBoxStates,
          [node.id]: {
            ...(s.contentBoxStates[node.id] || {}),
            picklists: updatedPicklists,
          },
        },
      }));
    }
  }, [node.id, picklists]);

  // ── handleInput — mirrors ContentBox's full action-queue-aware approach ──
  const handleInput = useCallback((e) => {
    const newText = e.target.value;
    const oldText = preChangeStateRef.current.text;
    const preSelStart = preChangeStateRef.current.selStart;
    const preSelEnd = preChangeStateRef.current.selEnd;
    const hadSelection = preSelStart !== preSelEnd;

    lastInternalTextRef.current = newText;

    // Diff old vs new text
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

      // Newline interception
      if (insertedText.includes('\n')) {
        resolveActiveEntry();

        const parts = insertedText.split('\n');
        let currentOffset = editStart;

        for (let i = 0; i < parts.length; i++) {
          const textPart = parts[i];
          if (textPart.length > 0) {
            const entry = store.enqueueTypingEntry({ targetId, caretPosition: currentOffset });
            if (entry) {
              store.updateTypingEntry(entry.actionId, textPart, currentOffset + textPart.length, textPart.length);
              store.resolveTypingEntry(entry.actionId);
            }
            currentOffset += textPart.length;
          }
          if (i < parts.length - 1) {
            store.insertStructuralNewline(targetId, currentOffset);
            currentOffset += 1;
          }
        }

        useReportStore.setState((s) => ({
          contentBoxStates: {
            ...s.contentBoxStates,
            [targetId]: { ...(s.contentBoxStates[targetId] || {}), currentText: newText, manuallyEdited: true },
          },
        }));

        autoResize();
        trackCaret();

        import('../../services/impressionService.js').then((mod) => mod.cancelImpressionDebounce());
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = setTimeout(() => {
          typingDebounceRef.current = null;
          resolveActiveEntry();
          import('../../services/pass1Service.js').then((mod) => mod.default.startDebounce());
        }, 1500);

        // Check picklist integrity
        checkPicklistIntegrity(oldText, newText);

        return;
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

    // Check picklist integrity after any edit
    checkPicklistIntegrity(oldText, newText);

    // ── Dot-Phrase Detection ──
    const afterEl = e.target;
    if (afterEl && !dpOpen) {
      const cursorPos = afterEl.selectionStart;
      const newVal = afterEl.value;
      if (cursorPos > 0 && newVal[cursorPos - 1] === '.' &&
          (cursorPos === 1 || /\s/.test(newVal[cursorPos - 2]))) {
        dpDotPosRef.current = cursorPos - 1;
        const rect = getCaretCoordinatesForDropdown(afterEl, cursorPos);
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

    // Cancel impression debounce, start Pass 1 debounce
    import('../../services/impressionService.js').then((mod) => mod.cancelImpressionDebounce());
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    if (!dpOpen) {
      typingDebounceRef.current = setTimeout(() => {
        typingDebounceRef.current = null;
        resolveActiveEntry();
        import('../../services/pass1Service.js').then((mod) => mod.default.startDebounce());
      }, 1500);
    }
  }, [node.id, autoResize, trackCaret, resolveActiveEntry, checkPicklistIntegrity, dpOpen, closeDotPhrase]);

  // When text changes externally (ASR insertion), update the visual caret
  useEffect(() => {
    if (currentText === lastInternalTextRef.current) return;
    lastInternalTextRef.current = currentText;

    const el = textareaRef.current;
    if (!el) return;

    const caretPos2 = getCaretPosition(node.id);
    const maxPos = currentText.length;
    setCaretPos(Math.min(caretPos2, maxPos));
    requestAnimationFrame(() => {
      el.selectionStart = Math.min(caretPos2, maxPos);
      el.selectionEnd = Math.min(caretPos2, maxPos);
    });
  }, [currentText, node.id]);

  const handleFocus = useCallback(() => {
    setActiveTextarea(node.id);
    setFocusedTextarea(node.id);
    trackCaret();
  }, [node.id, setActiveTextarea, setFocusedTextarea, trackCaret]);

  const handleBlur = useCallback(() => {
    clearFocusedTextarea(node.id);
  }, [node.id, clearFocusedTextarea]);

  const handleSelect = useCallback(() => {
    trackCaret();
    const el = textareaRef.current;
    if (el && el.selectionStart !== el.selectionEnd) {
      resolveActiveEntry();
    }
  }, [trackCaret, resolveActiveEntry]);

  // ── Click handler: detect clicks within picklist regions ──
  const handleClick = useCallback((e) => {
    trackCaret();
    resolveActiveEntry();

    const el = textareaRef.current;
    if (!el) return;

    // Check if click is within an active picklist region
    const clickOffset = el.selectionStart;
    const activePicklists = picklists.filter((pl) => pl.active);

    for (let i = 0; i < activePicklists.length; i++) {
      const pl = activePicklists[i];
      if (clickOffset >= pl.startOffset && clickOffset <= pl.endOffset) {
        // Clicked inside a picklist region — open the dropdown at this location
        const coords = getCaretCoordinatesForDropdown(el, pl.startOffset);
        setMenuPosition(coords);
        setOpenPicklistIdx(picklists.indexOf(pl));
        return;
      }
    }

    // Close any open picklist menu
    setOpenPicklistIdx(null);

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
          (id) => store.actionQueue.find((e2) => e2.actionId === id)
        );
      }
    }
  }, [trackCaret, node.id, resolveActiveEntry, picklists]);

  const handleKeyUp = useCallback(() => {
    trackCaret();
  }, [trackCaret]);

  const handleKeyDown = useCallback((e) => {
    // Capture pre-change state
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

  // ── Handle Picklist Option Selection ──
  const handlePicklistSelect = useCallback((picklistArrayIdx, optionText) => {
    const store = useReportStore.getState();
    const box = store.contentBoxStates[node.id];
    if (!box?.picklists) return;

    const pl = box.picklists[picklistArrayIdx];
    if (!pl || !pl.active) return;

    // Replace text at [startOffset, endOffset] with new option text
    const oldText = box.currentText || '';
    const newText = oldText.slice(0, pl.startOffset) + optionText + oldText.slice(pl.endOffset);

    // Compute length difference
    const oldLen = pl.endOffset - pl.startOffset;
    const newLen = optionText.length;
    const delta = newLen - oldLen;

    // Find the option index for display
    const nodeData = store.nodeMap[node.id];
    const partsPicklist = nodeData?.parts?.[pl.partIndex];
    const optionIndex = partsPicklist?.options?.indexOf(optionText) ?? -1;

    // Update all picklist offsets
    const updatedPicklists = box.picklists.map((p, i) => {
      if (i === picklistArrayIdx) {
        return {
          ...p,
          endOffset: p.startOffset + newLen,
          selectedIndex: optionIndex >= 0 ? optionIndex : p.selectedIndex,
        };
      }
      if (i > picklistArrayIdx && p.active) {
        return {
          ...p,
          startOffset: p.startOffset + delta,
          endOffset: p.endOffset + delta,
        };
      }
      return p;
    });

    useReportStore.setState((s) => ({
      contentBoxStates: {
        ...s.contentBoxStates,
        [node.id]: {
          ...(s.contentBoxStates[node.id] || {}),
          currentText: newText,
          picklists: updatedPicklists,
          manuallyEdited: true,
          version: (s.contentBoxStates[node.id]?.version ?? 0) + 1,
        },
      },
    }));

    setOpenPicklistIdx(null);

    // Focus the textarea after selection
    setTimeout(() => {
      textareaRef.current?.focus();
      autoResize();
    }, 0);

    // Trigger impression re-generation
    import('../../services/impressionService.js').then((mod) => {
      mod.startImpressionDebounce();
    });
  }, [node.id, autoResize]);

  // Check if there are any active picklists to show
  const hasActivePicklists = picklists.some((pl) => pl.active);

  // Build overlay HTML
  const overlayHTML = useMemo(() => {
    if (!hasActivePicklists) return '';
    return buildPicklistOverlayHTML(currentText, picklists);
  }, [currentText, picklists, hasActivePicklists]);

  // Determine which picklist is currently open (for rendering the menu)
  const openPicklist = openPicklistIdx !== null ? picklists[openPicklistIdx] : null;
  const nodeData = useReportStore((s) => s.nodeMap[node.id]);
  const openPicklistParts = openPicklist ? nodeData?.parts?.[openPicklist.partIndex] : null;

  // Build CSS classes
  const wrapperClasses = [
    'content-box__wrapper',
    'dropdown-box__wrapper',
    isPass2Inserted ? 'content-box__wrapper--pass2' : '',
    isSoftDeleted ? 'content-box__wrapper--deleted' : '',
    isImpressionGenerated && !isCritical ? 'content-box__wrapper--impression' : '',
    isCritical ? 'content-box__wrapper--critical' : '',
    isAiEdited && overlayVisible ? 'content-box__wrapper--ai-overlay-active' : '',
  ].filter(Boolean).join(' ');

  // Virtual caret
  const showVirtualCaret = activeTextareaId === node.id && focusedTextareaId !== node.id;
  const caretBackdropHTML = useMemo(
    () => showVirtualCaret ? buildCaretBackdropHTML(currentText, caretPos) : '',
    [showVirtualCaret, currentText, caretPos]
  );

  return (
    <div className="content-box dropdown-box">
      <div className={wrapperClasses}>
        {/* AI source badge */}
        {isPass2Inserted && !isSoftDeleted && !isImpressionGenerated && (
          <span className="content-box__source-badge" title="Inserted by LLM Pass 2 from dictation">AI</span>
        )}
        {/* Critical finding flag */}
        {isCritical && !isSoftDeleted && (
          <span className="critical-flag-icon" title="Critical finding — may require urgent attention">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#e53e3e" stroke="#e53e3e" strokeWidth="1">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" stroke="#e53e3e" strokeWidth="2" />
            </svg>
          </span>
        )}

        {/* Virtual caret backdrop */}
        <div
          className="caret-backdrop caret-backdrop--content"
          aria-hidden="true"
          style={{ display: showVirtualCaret ? undefined : 'none' }}
          dangerouslySetInnerHTML={{ __html: caretBackdropHTML }}
        />

        {/* Background overlay — renders picklist highlights behind the textarea */}
        {hasActivePicklists && (
          <div
            ref={overlayRef}
            className="picklist-overlay"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: overlayHTML }}
          />
        )}

        {/* Foreground textarea — fully editable */}
        <textarea
          ref={textareaRef}
          className={`content-box__textarea dropdown-box__textarea ${
            hasActivePicklists ? 'dropdown-box__textarea--with-picklists' : ''
          } ${showVirtualCaret ? 'content-box__textarea--with-caret' : ''}`}
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

        {/* Typing lock indicator */}
        {typingLocked && (
          <div className="textarea-lock-indicator textarea-lock-indicator--compact">
            <span className="textarea-lock-indicator__icon">🎤</span>
          </div>
        )}

        {/* AI-edit indicator badge for Pass 2B-edited normals */}
        {isAiEdited && !isSoftDeleted && (
          <AiEditBadge
            originalText={originalText}
            currentText={currentText}
            onOverlayVisibleChange={setOverlayVisible}
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

        {/* Floating picklist dropdown menu */}
        {openPicklist && openPicklistParts && (
          <div
            ref={menuRef}
            className="picklist-menu"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
            id={`picklist-menu-${node.id}-${openPicklistIdx}`}
          >
            {openPicklistParts.options?.map((option, index) => {
              const optionText = typeof option === 'string' ? option : option.value ?? '';
              const isSelected = index === openPicklist.selectedIndex;
              return (
                <div
                  key={index}
                  className={`picklist-menu__option ${isSelected ? 'picklist-menu__option--selected' : ''}`}
                  onClick={() => handlePicklistSelect(openPicklistIdx, optionText)}
                  id={`picklist-option-${node.id}-${openPicklistIdx}-${index}`}
                >
                  {optionText}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(DropdownBox);
