import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import useReportStore from '../../stores/useReportStore';
import useUserStore from '../../stores/useUserStore';
import { updateCaretPosition, getCaretPosition } from '../../services/caretTracker';
import { startSafetyTimeout } from '../../services/actionQueueService';
import { buildCaretBackdropHTML } from '../../utils/caretBackdrop';
import { findMatchingMacros, executeMacro } from '../../services/macroService';
import asrService from '../../services/asrService';
import MicButton from './MicButton';
import EhrToggleButton from './EhrToggleButton';
import CollapseToggleButton from './CollapseToggleButton';
import ResetButton from './ResetButton';
import HamburgerMenu from './HamburgerMenu';
import ReGenerateButton from './ReGenerateButton';
import PopoutButton from './PopoutButton';
import DotPhraseOverlay from './DotPhraseOverlay';

/**
 * Build safe HTML for the highlight backdrop.
 * Escapes all user text, then wraps ranges in <mark> tags.
 * Each range may carry a `className` for distinct visual treatment.
 * @param {string} text - The full dictation text
 * @param {Array<{start: number, end: number, className?: string}>} ranges - Highlight ranges
 * @returns {string} Safe HTML string
 */
function buildHighlightHTML(text, ranges) {
  if (!text || ranges.length === 0) {
    return escapeHTML(text || '') + '\n'; // trailing newline for scroll height parity
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;

  for (const range of sorted) {
    // Clamp ranges to text bounds
    const start = Math.max(0, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));

    if (start > cursor) {
      html += escapeHTML(text.slice(cursor, start));
    }
    const cls = range.className ? ` class="${range.className}"` : '';
    html += `<mark${cls}>` + escapeHTML(text.slice(start, end)) + '</mark>';
    cursor = end;
  }

  if (cursor < text.length) {
    html += escapeHTML(text.slice(cursor));
  }

  // Trailing newline ensures the backdrop has the same scrollable height
  // as the textarea (textareas add an implicit trailing line).
  return html + '\n';
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Calculate pixel coordinates of the caret within a textarea.
 * Creates a hidden mirror div with identical styling, inserts text up to
 * the cursor position, and measures the cursor span's offset within the
 * mirror's text flow using offsetTop/offsetLeft.
 *
 * Returns coordinates relative to the textarea's offsetParent (the wrapper
 * with position: relative), accounting for textarea scroll position.
 *
 * @param {HTMLTextAreaElement} textarea - The textarea element
 * @param {number} position - Character offset of the caret
 * @returns {{ top: number, left: number }} Pixel coordinates relative to textarea's wrapper
 */
function getCaretCoordinates(textarea, position) {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(textarea);

  // Copy relevant styles for accurate text measurement
  const stylesToCopy = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap',
  ];

  // Position off-screen so it doesn't affect layout
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
  const textNode = document.createTextNode(textBefore);
  mirror.appendChild(textNode);

  // Add a span at the cursor position to measure its offset within the text flow
  const cursorSpan = document.createElement('span');
  cursorSpan.textContent = '|';
  mirror.appendChild(cursorSpan);

  document.body.appendChild(mirror);

  // Use offsetTop/offsetLeft — these give the position of the span within
  // the mirror's text flow, independent of the mirror's screen position.
  const spanOffsetTop = cursorSpan.offsetTop;
  const spanOffsetLeft = cursorSpan.offsetLeft;

  document.body.removeChild(mirror);

  const lineHeight = parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) * 1.2;

  // Return position relative to the textarea's offsetParent (the wrapper).
  // textarea.offsetTop accounts for the textarea's position within its wrapper.
  // Subtract textarea.scrollTop to handle scrolled textareas.
  return {
    top: textarea.offsetTop + spanOffsetTop - textarea.scrollTop + lineHeight + 4,
    left: textarea.offsetLeft + spanOffsetLeft - textarea.scrollLeft,
  };
}

export default function DictationPanel() {
  const textareaRef = useRef(null);
  const backdropRef = useRef(null);
  const setActiveTextarea = useReportStore((s) => s.setActiveTextarea);
  const setFocusedTextarea = useReportStore((s) => s.setFocusedTextarea);
  const clearFocusedTextarea = useReportStore((s) => s.clearFocusedTextarea);
  const activeTextareaId = useReportStore((s) => s.activeTextareaId);
  const focusedTextareaId = useReportStore((s) => s.focusedTextareaId);
  const caretVersion = useReportStore((s) => s.caretVersion);
  const asrStatus = useReportStore((s) => s.asrStatus);
  const asrError = useReportStore((s) => s.asrError);
  const interimText = useReportStore((s) => s.interimText);
  const dictationText = useReportStore((s) => s.dictationText);
  const typingLocked = useReportStore((s) => s.typingLocked);
  const pass1Status = useReportStore((s) => s.pass1Status);
  const pass2Status = useReportStore((s) => s.pass2Status);
  const impressionStatus = useReportStore((s) => s.impressionStatus);
  const dictSegments = useReportStore((s) => s.segments['dictation-box'] || []);
  const lastVoiceCommand = useReportStore((s) => s.lastVoiceCommand);
  const clearLastVoiceCommand = useReportStore((s) => s.clearLastVoiceCommand);
  const erikCollecting = useReportStore((s) => s.erikCollecting);

  // --- Provenance Tracing State ---
  const provenanceHighlightSegmentIds = useReportStore((s) => s.provenanceHighlightSegmentIds);
  const setProvenanceHighlightContentBoxes = useReportStore((s) => s.setProvenanceHighlightContentBoxes);
  const clearProvenanceHighlightContentBoxes = useReportStore((s) => s.clearProvenanceHighlightContentBoxes);

  // Track whether caret is inside an NA segment
  const [caretInNA, setCaretInNA] = useState(false);

  // ── Dot-Phrase Overlay State ──
  const [dpOpen, setDpOpen] = useState(false);       // Whether overlay is visible
  const [dpFilter, setDpFilter] = useState('');       // Characters typed after "."
  const [dpAnchor, setDpAnchor] = useState(null);     // { top, left } for positioning
  const [dpSelectedIdx, setDpSelectedIdx] = useState(-1); // Selected index in overlay
  const dpDotPosRef = useRef(-1);                     // Position of the "." in text
  const dpMatchesRef = useRef([]);                     // Current matching macros

  // ── Dot-Phrase Helpers ──

  /**
   * Close the dot-phrase overlay and clean up the '.' + filter text from textarea.
   * Removes the entire ".xyz" sequence and restores the original text.
   */
  const closeDotPhrase = useCallback(() => {
    if (dpDotPosRef.current >= 0) {
      // Remove the '.' and any filter text from the textarea
      const store = useReportStore.getState();
      const currentText = store.dictationText;
      const dotPos = dpDotPosRef.current;
      const el = textareaRef.current;
      const cursorAfterDot = el ? el.selectionStart : dotPos + 1;
      const removeEnd = Math.max(cursorAfterDot, dotPos + 1);

      if (dotPos < currentText.length) {
        const newText = currentText.slice(0, dotPos) + currentText.slice(removeEnd);
        useReportStore.setState({ dictationText: newText });

        // Update cursor position
        requestAnimationFrame(() => {
          if (el) {
            el.selectionStart = dotPos;
            el.selectionEnd = dotPos;
          }
          updateCaretPosition('dictation-box', dotPos);
        });
      }
    }

    setDpOpen(false);
    setDpFilter('');
    setDpAnchor(null);
    setDpSelectedIdx(-1);
    dpDotPosRef.current = -1;
    dpMatchesRef.current = [];
  }, []);

  /**
   * Handle macro selection from the dot-phrase overlay.
   * Removes the '.' + filter text and executes the selected macro.
   */
  const handleDpSelect = useCallback((macro) => {
    const dotPos = dpDotPosRef.current;
    const el = textareaRef.current;

    if (dotPos >= 0) {
      // Remove '.' and filter text from textarea
      const store = useReportStore.getState();
      const currentText = store.dictationText;
      const cursorAfterDot = el ? el.selectionStart : dotPos + 1;
      const removeEnd = Math.max(cursorAfterDot, dotPos + 1);
      const newText = currentText.slice(0, dotPos) + currentText.slice(removeEnd);
      useReportStore.setState({ dictationText: newText });

      // Update cursor to the dot position
      requestAnimationFrame(() => {
        if (el) {
          el.selectionStart = dotPos;
          el.selectionEnd = dotPos;
        }
        updateCaretPosition('dictation-box', dotPos);

        // Execute the macro after text cleanup
        executeMacro(macro.id);
      });
    }

    // Close the overlay
    setDpOpen(false);
    setDpFilter('');
    setDpAnchor(null);
    setDpSelectedIdx(-1);
    dpDotPosRef.current = -1;
    dpMatchesRef.current = [];
  }, []);

  // Virtual caret position (local state for reactive re-render)
  const [caretPos, setCaretPos] = useState(0);
  const caretBackdropRef = useRef(null);

  // Re-sync local caretPos when voice commands reposition externally
  useEffect(() => {
    if (caretVersion === 0) return; // skip initial mount
    const pos = getCaretPosition('dictation-box');
    setCaretPos(pos);
  }, [caretVersion]);

  // Voice command toast auto-dismiss (2s visible, then fade-out)
  const [vcToastVisible, setVcToastVisible] = useState(false);
  const vcTimerRef = useRef(null);

  useEffect(() => {
    if (lastVoiceCommand) {
      setVcToastVisible(true);
      // Clear any existing timer
      if (vcTimerRef.current) clearTimeout(vcTimerRef.current);
      // Auto-dismiss after 2s
      vcTimerRef.current = setTimeout(() => {
        setVcToastVisible(false);
        // Clear store state after fade-out completes (300ms transition)
        setTimeout(() => clearLastVoiceCommand(), 350);
      }, 2000);
    }
    return () => {
      if (vcTimerRef.current) clearTimeout(vcTimerRef.current);
    };
  }, [lastVoiceCommand, clearLastVoiceCommand]);

  // Track last text set by user typing (not from ASR).
  // Used to detect external updates and reposition the cursor.
  const lastInternalTextRef = useRef(dictationText);

  // Captures textarea state BEFORE the browser applies any change.
  // handleKeyDown writes this, handleChange reads it for diff computation.
  const preChangeStateRef = useRef({ text: '', selStart: 0, selEnd: 0 });

  // Track the currently active typing entry ID
  const activeTypingEntryRef = useRef(null);

  // --- NA Highlight Ranges ---
  // Derived from segments with status 'structured' and naFlagged === true
  const naRanges = useMemo(() =>
    dictSegments
      .filter((s) => s.status === 'structured' && s.naFlagged)
      .map((s) => ({ start: s.startOffset, end: s.endOffset })),
    [dictSegments]
  );

  // --- Provenance Highlight Ranges ---
  // Derived from dictation segments whose IDs are in provenanceHighlightSegmentIds
  const provenanceRanges = useMemo(() => {
    if (provenanceHighlightSegmentIds.length === 0) return [];
    const idSet = new Set(provenanceHighlightSegmentIds);
    return dictSegments
      .filter((s) => idSet.has(s.segmentId))
      .map((s) => ({ start: s.startOffset, end: s.endOffset, className: 'provenance' }));
  }, [dictSegments, provenanceHighlightSegmentIds]);

  // --- Bidirectional: Reverse Lookup (segment → content boxes) ---
  // Build a map from segmentId → [contentBoxIds] for the dictation → report direction
  const contentBoxStates = useReportStore((s) => s.contentBoxStates);
  const segmentToContentBoxMap = useMemo(() => {
    const map = {};
    for (const [boxId, box] of Object.entries(contentBoxStates)) {
      // Pass 2A insertions
      if (box.pass2Inserted && box.sourceSegmentIds?.length > 0) {
        for (const segId of box.sourceSegmentIds) {
          if (!map[segId]) map[segId] = [];
          if (!map[segId].includes(boxId)) map[segId].push(boxId);
        }
      }
      // Pass 2B edits
      if (box.editedBySegmentIds?.length > 0) {
        for (const segId of box.editedBySegmentIds) {
          if (!map[segId]) map[segId] = [];
          if (!map[segId].includes(boxId)) map[segId].push(boxId);
        }
      }
      // Pass 2B suppressions
      if (box.suppressedBySegmentIds?.length > 0) {
        for (const segId of box.suppressedBySegmentIds) {
          if (!map[segId]) map[segId] = [];
          if (!map[segId].includes(boxId)) map[segId].push(boxId);
        }
      }
    }
    return map;
  }, [contentBoxStates]);

  // Check if a caret position falls within a segment that has content box associations
  const checkCaretProvenance = useCallback((pos) => {
    // Find the segment at this caret position
    const atSegment = dictSegments.find(
      (s) => pos >= s.startOffset && pos <= s.endOffset && s.status === 'structured'
    );
    if (atSegment && segmentToContentBoxMap[atSegment.segmentId]) {
      setProvenanceHighlightContentBoxes(segmentToContentBoxMap[atSegment.segmentId]);
    } else {
      clearProvenanceHighlightContentBoxes();
    }
  }, [dictSegments, segmentToContentBoxMap, setProvenanceHighlightContentBoxes, clearProvenanceHighlightContentBoxes]);

  // Merge NA + provenance ranges for the highlight backdrop
  const allHighlightRanges = useMemo(() => {
    return [...naRanges, ...provenanceRanges];
  }, [naRanges, provenanceRanges]);

  // Build highlighted HTML for the backdrop
  const highlightHTML = useMemo(
    () => buildHighlightHTML(dictationText, allHighlightRanges),
    [dictationText, allHighlightRanges]
  );

  // Check if a caret position falls within any NA range
  const checkCaretInNA = useCallback((pos) => {
    if (naRanges.length === 0) {
      if (caretInNA) setCaretInNA(false);
      return;
    }
    const inNA = naRanges.some(
      (r) => pos >= r.start && pos <= r.end
    );
    setCaretInNA(inNA);
  }, [naRanges, caretInNA]);

  // Track caret position on every relevant event
  const trackCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    updateCaretPosition('dictation-box', el.selectionStart, el.selectionEnd);
    setCaretPos(el.selectionStart);
    checkCaretInNA(el.selectionStart);
    // Bidirectional: check if caret is in a segment with content box associations
    checkCaretProvenance(el.selectionStart);
  }, [checkCaretInNA, checkCaretProvenance]);

  // Sync backdrop scroll with textarea
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      const scrollTop = textareaRef.current.scrollTop;
      if (backdropRef.current) backdropRef.current.scrollTop = scrollTop;
      if (caretBackdropRef.current) caretBackdropRef.current.scrollTop = scrollTop;
    }
  }, []);

  const handleFocus = useCallback(() => {
    setActiveTextarea('dictation-box');
    setFocusedTextarea('dictation-box');
    trackCaret();
  }, [setActiveTextarea, setFocusedTextarea, trackCaret]);

  const handleBlur = useCallback(() => {
    clearFocusedTextarea('dictation-box');
    // Bidirectional: clear content box highlights when leaving dictation box
    clearProvenanceHighlightContentBoxes();
  }, [clearFocusedTextarea, clearProvenanceHighlightContentBoxes]);

  /**
   * Resolve any active typing/delete entry for this textarea.
   * Called on cursor moves, selections, and other boundary events.
   */
  const resolveActiveEntry = useCallback(() => {
    const store = useReportStore.getState();
    const activeEntry = store.getActiveTypingEntry('dictation-box');
    if (activeEntry) {
      if (activeEntry.actionType === 'type') {
        store.resolveTypingEntry(activeEntry.actionId);
      } else if (activeEntry.actionType === 'delete') {
        store.resolveDeleteEntry(activeEntry.actionId);
      }
      activeTypingEntryRef.current = null;
    }
  }, []);

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

    // Resolve any active typing/delete entry on cursor move
    resolveActiveEntry();

    // Intra-textarea cursor-move boundary detection (§4.2):
    // If the user clicks at a new position in the textarea while ASR is
    // active and a pending entry exists, force-finalize the current
    // Deepgram utterance and mark the entry as awaiting_final.
    const store = useReportStore.getState();
    if (store.asrStatus === 'listening' || store.asrStatus === 'reconnecting') {
      const pendingEntry = store.getActiveEntry();
      if (pendingEntry && pendingEntry.targetId === 'dictation-box') {
        asrService.finalize();

        store.markAwaitingFinal(pendingEntry.actionId);
        startSafetyTimeout(
          pendingEntry.actionId,
          store.resolveAction,
          (id) => store.actionQueue.find((e) => e.actionId === id)
        );
      }
    }
  }, [trackCaret, resolveActiveEntry]);

  const handleKeyUp = useCallback(() => {
    trackCaret();
  }, [trackCaret]);

  // Block typing/paste when dictation is in progress (pending dictate entry)
  const handleKeyDown = useCallback((e) => {
    // Capture pre-change state for diff computation in handleChange
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
        // If we'd delete the '.', close the overlay
        if (dpFilter.length === 0) {
          e.preventDefault();
          closeDotPhrase();
          return;
        }
        // Otherwise let the default backspace happen; handleChange will update filter
      }
    }

    if (typingLocked) {
      // Allow navigation keys but block text input
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
  }, [typingLocked, dpOpen, dpFilter, dpSelectedIdx]);

  const handlePaste = useCallback((e) => {
    if (typingLocked) {
      e.preventDefault();
      return;
    }
    // Paste will be handled by handleChange (large insertion diff)
  }, [typingLocked]);

  // Keystroke debounce timer ref for manual typing → Pass 1
  const typingDebounceRef = useRef(null);

  // Handle manual typing — controlled component onChange
  // Routes changes through the new typing/deletion entry system
  const handleChange = useCallback((e) => {
    const el = e.target;
    if (!el) return;
    const newText = el.value;
    const oldText = preChangeStateRef.current.text;
    const preSelStart = preChangeStateRef.current.selStart;
    const preSelEnd = preChangeStateRef.current.selEnd;
    const hadSelection = preSelStart !== preSelEnd;

    lastInternalTextRef.current = newText;

    // --- Diff old vs new text ---
    // Find where the change starts (from front)
    let editStart = 0;
    while (editStart < oldText.length && editStart < newText.length &&
           oldText[editStart] === newText[editStart]) {
      editStart++;
    }

    // Find where the change ends (from back)
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

    // --- Route to appropriate handler ---

    if (hadSelection) {
      // HIGHLIGHT OPERATION: selection existed before the change
      // Step 1: Create a one-shot resolved delete entry for the selected range
      resolveActiveEntry(); // Resolve any existing active entry first

      if (deletedLength > 0) {
        const selStart = Math.min(preSelStart, preSelEnd);
        const selEnd = Math.max(preSelStart, preSelEnd);
        store.enqueueDeleteEntry({
          targetId: 'dictation-box',
          deletionStart: selStart,
          deletionEnd: selEnd,
          deletedText: oldText.slice(selStart, selEnd),
          immediateResolve: true,
        });
      }

      // Step 2: If a character was also typed, start a new typing session
      if (insertedLength > 0) {
        // The delete entry already updated store text with the deletion.
        // Now we need to create a typing entry for the new character(s).
        const entry = store.enqueueTypingEntry({
          targetId: 'dictation-box',
          caretPosition: editStart,
        });
        if (entry) {
          store.updateTypingEntry(entry.actionId, insertedText, editStart + insertedLength, insertedLength);
          activeTypingEntryRef.current = entry.actionId;
        }
        // Update the store text to reflect the typed character
        useReportStore.setState({ dictationText: newText });
      }
    } else if (insertedLength > 0 && deletedLength === 0) {
      // PURE INSERTION (typing or paste)

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
            const entry = store.enqueueTypingEntry({ targetId: 'dictation-box', caretPosition: currentOffset });
            if (entry) {
              store.updateTypingEntry(entry.actionId, textPart, currentOffset + textPart.length, textPart.length);
              store.resolveTypingEntry(entry.actionId);
            }
            currentOffset += textPart.length;
          }

          // Insert structural newline (except after the last part)
          if (i < parts.length - 1) {
            store.insertStructuralNewline('dictation-box', currentOffset);
            currentOffset += 1; // \n occupies 1 character
          }
        }

        // Update dictationText with the full new value (including \n)
        useReportStore.setState({ dictationText: newText });
        activeTypingEntryRef.current = null;

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

      const activeEntry = store.getActiveTypingEntry('dictation-box');

      if (activeEntry && activeEntry.actionType === 'type' &&
          editStart === activeEntry.insertEnd) {
        // Continue existing typing session
        store.updateTypingEntry(
          activeEntry.actionId, insertedText, editStart + insertedLength, insertedLength
        );
      } else {
        // Start new typing session
        resolveActiveEntry();
        const entry = store.enqueueTypingEntry({
          targetId: 'dictation-box',
          caretPosition: editStart,
        });
        if (entry) {
          store.updateTypingEntry(entry.actionId, insertedText, editStart + insertedLength, insertedLength);
          activeTypingEntryRef.current = entry.actionId;
        }
      }
      // Update store text
      useReportStore.setState({ dictationText: newText });

    } else if (deletedLength > 0 && insertedLength === 0) {
      // PURE DELETION (backspace or delete key)
      const activeTypingEntry = store.getActiveTypingEntry('dictation-box');

      if (activeTypingEntry && activeTypingEntry.actionType === 'type') {
        // Check if deletion is within the typed text
        if (editStart >= activeTypingEntry.insertStart && oldEnd <= activeTypingEntry.insertEnd) {
          // Backspace within typed text — just trim
          store.updateTypingEntry(
            activeTypingEntry.actionId, '', editStart, -deletedLength
          );
          useReportStore.setState({ dictationText: newText });
        } else {
          // Deletion went past typing boundary — resolve typing, start deletion
          resolveActiveEntry();
          store.enqueueDeleteEntry({
            targetId: 'dictation-box',
            deletionStart: editStart,
            deletionEnd: oldEnd,
            deletedText,
            immediateResolve: false,
          });
          // Note: enqueueDeleteEntry already updates dictationText
        }
      } else if (activeTypingEntry && activeTypingEntry.actionType === 'delete') {
        // Continue existing delete session
        const isBackspace = editStart < activeTypingEntry.caretPosition;
        store.updateDeleteEntry(activeTypingEntry.actionId, deletedText, isBackspace);
      } else {
        // Start new deletion session
        store.enqueueDeleteEntry({
          targetId: 'dictation-box',
          deletionStart: editStart,
          deletionEnd: oldEnd,
          deletedText,
          immediateResolve: false,
        });
        // Note: enqueueDeleteEntry already updates dictationText
      }
    }

    trackCaret();

    // ── Dot-Phrase Detection & Filter Update ──
    const afterEl = e.target;
    if (afterEl && !dpOpen) {
      // Check if user just typed a '.'
      const cursorPos = afterEl.selectionStart;
      const newVal = afterEl.value;
      if (cursorPos > 0 && newVal[cursorPos - 1] === '.' &&
          (cursorPos === 1 || /\s/.test(newVal[cursorPos - 2]))) {
        // Activate dot-phrase overlay
        dpDotPosRef.current = cursorPos - 1;
        const rect = getCaretCoordinates(afterEl, cursorPos);
        setDpAnchor(rect);
        setDpOpen(true);
        setDpFilter('');
        dpMatchesRef.current = findMatchingMacros('');
        setDpSelectedIdx(-1);
      }
    } else if (dpOpen && afterEl) {
      // Update filter: extract text between dot position and current cursor
      const cursorPos = afterEl.selectionStart;
      const newVal = afterEl.value;
      const dotPos = dpDotPosRef.current;

      if (dotPos >= 0 && cursorPos > dotPos) {
        const filterChars = newVal.slice(dotPos + 1, cursorPos);
        setDpFilter(filterChars);
        const matches = findMatchingMacros(filterChars);
        dpMatchesRef.current = matches;

        if (matches.length === 0 && filterChars.length > 0) {
          // No matches — close overlay but leave the text as-is
          closeDotPhrase();
        } else if (matches.length > 0 && filterChars.length > 0) {
          setDpSelectedIdx(0);
        }
      } else {
        // Cursor moved before the dot — close
        closeDotPhrase();
      }
    }

    // Start keystroke debounce: wait 1.5s after last keystroke, then trigger Pass 1.
    // SKIP debounce while dot-phrase overlay is open — prevents Pass 1 from
    // consuming/mangling the '.' and filter characters mid-typing.
    // Cancel any pending impression debounce on new keystroke
    import('../../services/impressionService.js').then((mod) => {
      mod.cancelImpressionDebounce();
    });

    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    if (!dpOpen) {
      typingDebounceRef.current = setTimeout(() => {
        typingDebounceRef.current = null;
        // Resolve any active typing/delete entry before triggering Pass 1
        resolveActiveEntry();
        // Import pass1Service dynamically to avoid circular imports
        import('../../services/pass1Service.js').then((mod) => {
          mod.default.startDebounce();
        });
      }, 1500);
    }
  }, [trackCaret, resolveActiveEntry, dpOpen]);

  // Auto-resize textarea when content changes
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [dictationText]);

  // When text changes externally (ASR insertion), update the visual caret
  // position from caretTracker. Skip for user-typed changes (already correct).
  // caretTracker is updated by:
  //   - resolveAction() after ASR insertion → insertPos + resolvedText.length
  //   - trackCaret() from user click/select/keyUp → actual cursor position
  useEffect(() => {
    if (dictationText === lastInternalTextRef.current) return;
    lastInternalTextRef.current = dictationText;

    const el = textareaRef.current;
    if (!el) return;

    const caretPos2 = getCaretPosition('dictation-box');
    const maxPos = dictationText.length;
    setCaretPos(Math.min(caretPos2, maxPos));
    // Use requestAnimationFrame so React finishes reconciling the value first
    requestAnimationFrame(() => {
      el.selectionStart = Math.min(caretPos2, maxPos);
      el.selectionEnd = Math.min(caretPos2, maxPos);
    });
  }, [dictationText]);

  // Build interim status display
  let interimDisplay = null;
  if (asrStatus === 'error' && asrError) {
    interimDisplay = <span className="interim--error">{asrError}</span>;
  } else if (asrStatus === 'connecting') {
    interimDisplay = <span className="interim--connecting">Connecting…</span>;
  } else if (asrStatus === 'reconnecting') {
    interimDisplay = <span className="interim--reconnecting">Reconnecting…</span>;
  } else if (asrStatus === 'listening' && interimText) {
    interimDisplay = <span className="interim--listening">… {interimText}</span>;
  } else if (asrStatus === 'listening') {
    interimDisplay = <span className="interim--listening">Listening…</span>;
  } else if (caretInNA && naRanges.length > 0) {
    // Lowest priority: show NA warning when caret is in an ambiguous segment
    interimDisplay = <span className="interim--na-warning">⚠ Ambiguous text — not inserted into report</span>;
  }

  const hasNAHighlights = naRanges.length > 0;
  const hasProvenanceHighlights = provenanceRanges.length > 0;
  const hasAnyHighlights = hasNAHighlights || hasProvenanceHighlights;

  // --- Virtual caret ---
  const showVirtualCaret = activeTextareaId === 'dictation-box' && focusedTextareaId !== 'dictation-box';
  const caretBackdropHTML = useMemo(
    () => showVirtualCaret ? buildCaretBackdropHTML(dictationText, caretPos) : '',
    [showVirtualCaret, dictationText, caretPos]
  );

  // --- Dictation box collapse state ---
  const isDictationCollapsed = useUserStore(
    (s) => s.preferences.dictationPanel?.collapsed ?? false
  );
  const isDictationPoppedOut = useReportStore((s) => s.isDictationPoppedOut);
  const popoutWindowRef = useReportStore((s) => s.popoutWindowRef);

  // On startup: if the dictation box loads already collapsed from persisted
  // preferences, ensure the cursor is relocated out of the dictation box
  // so ASR text doesn't land in a hidden textarea.
  const startupCollapseHandledRef = useRef(false);
  useEffect(() => {
    if (startupCollapseHandledRef.current) return;
    if (!isDictationCollapsed) return;

    startupCollapseHandledRef.current = true;

    // Import lazily to avoid circular dependency issues
    import('../../services/voiceCommandHandlers').then(({ getOrderedContentBoxIds }) => {
      const store = useReportStore.getState();
      const currentId = store.activeTextareaId;

      // Only relocate if cursor is effectively in dictation box
      if (currentId === 'dictation-box' || currentId === null) {
        const orderedIds = getOrderedContentBoxIds();
        if (orderedIds.length > 0) {
          const targetId = orderedIds[0];
          store.setActiveTextarea(targetId);
          console.log(`[DictationPanel] Startup: dictation box collapsed — cursor moved to ${targetId}`);
        }
      }
    });
  }, [isDictationCollapsed]);

  // Popout window resize on collapse/expand
  const popoutPreCollapseDimsRef = useRef(null);
  useEffect(() => {
    if (!isDictationPoppedOut || !popoutWindowRef || popoutWindowRef.closed) return;

    if (isDictationCollapsed) {
      // Save current dimensions before shrinking
      try {
        popoutPreCollapseDimsRef.current = {
          width: popoutWindowRef.outerWidth,
          height: popoutWindowRef.outerHeight,
        };
        // Shrink to just the toolbar height (~60px + some padding)
        popoutWindowRef.resizeTo(popoutWindowRef.outerWidth, 80);
      } catch { /* PiP windows don't support resizeTo — CSS handles it */ }
    } else {
      // Restore to previous dimensions
      if (popoutPreCollapseDimsRef.current) {
        try {
          popoutWindowRef.resizeTo(
            popoutPreCollapseDimsRef.current.width,
            popoutPreCollapseDimsRef.current.height
          );
        } catch { /* PiP windows don't support resizeTo — CSS handles it */ }
        popoutPreCollapseDimsRef.current = null;
      }
    }
  }, [isDictationCollapsed, isDictationPoppedOut, popoutWindowRef]);

  return (
    <div className={`dictation-panel${isDictationCollapsed ? ' dictation-panel--collapsed' : ''}`} id="dictation-panel">
      <div className="dictation-panel__header">
        <div className="dictation-panel__title">
          <MicButton />
          <div 
            className={`dictation-panel__interim ${interimDisplay ? 'dictation-panel__interim--visible' : ''}`} 
            id="dictation-interim"
            style={{ marginLeft: '36px' }}
          >
            {interimDisplay}
          </div>
          {/* Pass 1 status indicator */}
          {pass1Status === 'in_flight' && (
            <span className="pass1-status-dot pass1-status-dot--active" title="Pass 1 processing…" />
          )}
          {pass1Status === 'debouncing' && (
            <span className="pass1-status-dot pass1-status-dot--debouncing" title="Pass 1 pending…" />
          )}
          {/* Pass 2 status indicator */}
          {pass2Status === 'in_flight' && (
            <span className="pass2-status-dot pass2-status-dot--active" title="Pass 2 processing — placing findings…" />
          )}
          {pass2Status === 'debouncing' && (
            <span className="pass2-status-dot pass2-status-dot--debouncing" title="Pass 2 pending…" />
          )}
          {/* Impression status indicator */}
          {impressionStatus === 'in_flight' && (
            <span className="impression-status-dot impression-status-dot--active" title="Generating impression…" />
          )}
          {impressionStatus === 'debouncing' && (
            <span className="impression-status-dot impression-status-dot--debouncing" title="Impression pending…" />
          )}
          {impressionStatus === 'stale' && (
            <span className="impression-status-dot impression-status-dot--stale" title="Impression may be outdated" />
          )}
          {/* Voice command feedback toast */}
          {lastVoiceCommand && (
            <span
              className={`vc-toast ${vcToastVisible ? 'vc-toast--visible' : ''}`}
              id="voice-command-toast"
            >
              <span className="vc-toast__icon">✓</span>
              <span className="vc-toast__text">{lastVoiceCommand.description}</span>
            </span>
          )}
          {/* ERIK open-ended collection indicator */}
          {erikCollecting && (
            <span
              className="vc-toast vc-toast--erik vc-toast--visible"
              id="erik-collection-toast"
            >
              <span className="vc-toast__icon vc-toast__icon--erik">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 5-3 6.5V18a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.5C6.5 14 5 11.5 5 9a7 7 0 0 1 7-7z"/>
                  <path d="M10 22h4"/>
                </svg>
              </span>
              <span className="vc-toast__text vc-toast__text--erik">Listening for ERIK…</span>
            </span>
          )}
        </div>
        <div className="dictation-panel__toolbar">
          <CollapseToggleButton />
          <EhrToggleButton />
          <ResetButton />
          <HamburgerMenu />
          <ReGenerateButton />
          <PopoutButton />
        </div>
      </div>

      {/* Textarea wrapper with highlight backdrop, virtual caret, and typing lock overlay */}
      <div className="dictation-panel__textarea-wrapper">
        {/* Highlight backdrop: renders behind the textarea with <mark> for NA/provenance segments */}
        {hasAnyHighlights && (
          <div
            ref={backdropRef}
            className="highlight-backdrop"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightHTML }}
          />
        )}
        {/* Virtual caret backdrop: shows tracked cursor position when textarea unfocused */}
        {showVirtualCaret && (
          <div
            ref={caretBackdropRef}
            className="caret-backdrop caret-backdrop--dictation"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: caretBackdropHTML }}
          />
        )}
        <textarea
          ref={textareaRef}
          className={`dictation-panel__textarea ${hasAnyHighlights ? 'dictation-panel__textarea--with-highlights' : ''} ${showVirtualCaret ? 'dictation-panel__textarea--with-caret' : ''}`}
          id="dictation-textarea"
          placeholder="Start dictating or type here..."
          spellCheck={false}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
          onSelect={handleSelect}
          onClick={handleClick}
          onKeyUp={handleKeyUp}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onScroll={handleScroll}
          rows={3}
          value={dictationText}
        />
        {/* Dot-Phrase Overlay */}
        <DotPhraseOverlay
          isOpen={dpOpen}
          filterText={dpFilter}
          onSelect={handleDpSelect}
          onClose={closeDotPhrase}
          anchorRect={dpAnchor}
        />
      </div>



      {/* Phase 4: Degraded-mode notification when Pass 1 fails */}
      {pass1Status === 'error' && (
        <div className="degraded-mode-notice" id="pass1-degraded-notice">
          <span className="degraded-mode-notice__icon">⚠</span>
          <span className="degraded-mode-notice__text">LLM cleanup unavailable — raw text preserved</span>
        </div>
      )}
    </div>
  );
}
