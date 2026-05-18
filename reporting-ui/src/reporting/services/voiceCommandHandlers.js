/**
 * Voice Command Handlers — Phase 2
 *
 * Contains the implementation of voice command operations.
 * Each handler receives a context object from the Voice Command Engine:
 * {
 *   commandId: string,
 *   commandType: string,
 *   consumedText: string,
 *   consumedTokens: Array,
 * }
 *
 * Handlers interact with the store, DOM, and caret tracker to execute
 * the commanded operation.
 */

import useReportStore from '../stores/useReportStore';
import useUserStore from '../stores/useUserStore';
import { updateCaretPosition, getCaretPosition } from './caretTracker';
import autocorrectService from './autocorrectService';
import { getMicToggle } from './micToggleRegistry';
import pass1Service from './pass1Service';
import { startPass2Debounce } from './pass2Service';
import { startImpressionDebounce } from './impressionService';

// ─── Field Ordering Utility ──────────────────────────────────────────

/**
 * Build an ordered list of all navigable content box IDs in document
 * (visual) order. Uses depth-first traversal of templateNodes.
 *
 * Excludes:
 *   - The dictation box (voice commands "Next/Previous Field" cycle
 *     through report content boxes only, NOT the dictation box)
 *   - Soft-deleted content boxes (they're effectively gone from the report)
 *
 * @returns {string[]} Ordered content box IDs
 */
export function getOrderedContentBoxIds() {
  const store = useReportStore.getState();
  const ids = [];

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === 'content') {
        const box = store.contentBoxStates[node.id];
        if (!box?.deleted) {
          ids.push(node.id);
        }
      }
      if (node.children?.length) walk(node.children);
    }
  }

  walk(store.templateNodes);
  return ids;
}

/**
 * Get the DOM textarea element for a given content box ID.
 *
 * @param {string} boxId - Content box ID
 * @returns {HTMLTextAreaElement|null}
 */
function getTextareaElement(boxId) {
  if (boxId === 'dictation-box') {
    return document.getElementById('dictation-textarea');
  }
  return document.getElementById(`textarea-${boxId}`);
}

/**
 * Focus a content box textarea and place the caret at the end of its text.
 * Updates the caret tracker to reflect the new position.
 *
 * @param {string} boxId - Content box ID to focus
 */
function focusAndPlaceCaretAtEnd(boxId) {
  const el = getTextareaElement(boxId);
  if (!el) {
    console.warn(`[VoiceCommandHandlers] Could not find textarea for "${boxId}"`);
    return;
  }

  // Place caret at end of text BEFORE focusing.
  // el.focus() fires handleFocus → trackCaret() synchronously, which reads
  // el.selectionStart. Setting selection first ensures trackCaret picks up
  // the correct position rather than the stale one.
  const textLen = el.value.length;
  el.selectionStart = textLen;
  el.selectionEnd = textLen;

  el.focus();

  // Re-assert after focus
  el.selectionStart = textLen;
  el.selectionEnd = textLen;
  updateCaretPosition(boxId, textLen);

  // Post-React-reconciliation safety: set again in a setTimeout(0)
  setTimeout(() => {
    const len = el.value.length;
    el.selectionStart = len;
    el.selectionEnd = len;
    updateCaretPosition(boxId, len);
    useReportStore.getState().bumpCaretVersion();
  }, 0);
}

// ─── Navigation Handlers ─────────────────────────────────────────────

/**
 * Navigate to the next content field in the report.
 *
 * Behavior:
 *   - Moves cursor to the next content box in document order
 *   - Wraps from the last content box to the first (cycles within report)
 *   - Does NOT navigate to the dictation box
 *   - Calls setActiveTextarea() which handles all cursor-move boundary
 *     consequences (ASR finalize, awaiting_final, safety timeout)
 *   - Places caret at the END of the target content box
 *
 * @param {object} context - Voice command execution context
 */
export function navigateToNextField(context) {
  const store = useReportStore.getState();
  const orderedIds = getOrderedContentBoxIds();

  if (orderedIds.length === 0) {
    console.warn('[VoiceCommandHandlers] No navigable content boxes found');
    return;
  }

  const currentId = store.activeTextareaId;
  const currentIdx = orderedIds.indexOf(currentId);

  let nextIdx;
  if (currentIdx < 0) {
    // Current textarea is not in the ordered list (e.g., dictation-box
    // or an unknown ID) — go to the first content box
    nextIdx = 0;
  } else {
    // Move to next, wrapping to the first content box at the end
    nextIdx = (currentIdx + 1) % orderedIds.length;
  }

  const nextId = orderedIds[nextIdx];
  console.log(`[VoiceCommandHandlers] navigateToNextField: "${currentId}" → "${nextId}" (${currentIdx} → ${nextIdx} of ${orderedIds.length})`);

  // setActiveTextarea handles all boundary logic:
  //   - If ASR is active and a pending dictate entry exists for the old textarea,
  //     it calls asrService.finalize(), marks the entry as awaiting_final,
  //     and starts a safety timeout.
  //   - Then sets the new activeTextareaId.
  store.setActiveTextarea(nextId);

  // Focus the DOM element and place caret at end
  focusAndPlaceCaretAtEnd(nextId);
}

/**
 * Navigate to the previous content field in the report.
 *
 * Same behavior as navigateToNextField but in reverse direction.
 * Wraps from the first content box to the last.
 *
 * @param {object} context - Voice command execution context
 */
export function navigateToPreviousField(context) {
  const store = useReportStore.getState();
  const orderedIds = getOrderedContentBoxIds();

  if (orderedIds.length === 0) {
    console.warn('[VoiceCommandHandlers] No navigable content boxes found');
    return;
  }

  const currentId = store.activeTextareaId;
  const currentIdx = orderedIds.indexOf(currentId);

  let prevIdx;
  if (currentIdx < 0) {
    // Current textarea is not in the list — go to the last content box
    prevIdx = orderedIds.length - 1;
  } else {
    // Move to previous, wrapping to the last content box at the beginning
    prevIdx = (currentIdx - 1 + orderedIds.length) % orderedIds.length;
  }

  const prevId = orderedIds[prevIdx];
  console.log(`[VoiceCommandHandlers] navigateToPreviousField: "${currentId}" → "${prevId}" (${currentIdx} → ${prevIdx} of ${orderedIds.length})`);

  store.setActiveTextarea(prevId);
  focusAndPlaceCaretAtEnd(prevId);
}

// ─── Section Navigation (Phase 4) ───────────────────────────────────

/**
 * Build a mapping from section display labels to the first non-deleted
 * content box ID within each section (or headline).
 *
 * The mapping uses the CURRENT display label (respecting user edits via
 * nodeTextStates), lowercased for case-insensitive matching.
 *
 * Traverses the entire template tree. For each non-content node that has
 * content-box children, maps its label to the first navigable content box
 * found via depth-first search within that subtree.
 *
 * @returns {Map<string, { nodeId: string, label: string, targetContentBoxId: string }>}
 *          Keys are lowercase labels
 */
function buildSectionLabelMap() {
  const store = useReportStore.getState();
  const labelMap = new Map();

  /**
   * Find the first non-deleted content box ID via depth-first search
   * within a subtree rooted at `nodes`.
   */
  function findFirstContentBox(nodes) {
    for (const node of nodes) {
      if (node.type === 'content') {
        const box = store.contentBoxStates[node.id];
        if (!box?.deleted) return node.id;
      }
      if (node.children?.length) {
        const found = findFirstContentBox(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Walk the tree and register labels for all non-content nodes
   * that have at least one navigable content box descendant.
   */
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'content') {
        // Get the current display label (user-edited or original)
        const ntState = store.nodeTextStates?.[node.id];
        const label = ntState?.text || node.label || node.text || '';

        if (label) {
          // Find first content box within this node's subtree
          const targetId = node.children?.length
            ? findFirstContentBox(node.children)
            : null;

          if (targetId) {
            const lowerLabel = label.toLowerCase();
            // Don't overwrite — first registration wins (preserves document order)
            if (!labelMap.has(lowerLabel)) {
              labelMap.set(lowerLabel, {
                nodeId: node.id,
                label,
                targetContentBoxId: targetId,
              });
            }
          }
        }
      }
      // Continue walking children
      if (node.children?.length) walk(node.children);
    }
  }

  walk(store.templateNodes);
  return labelMap;
}

/**
 * Navigate to a named section of the report.
 *
 * The clarifier words (after "go to") are joined and matched against
 * section labels. Matching is case-insensitive and supports:
 *   - Exact match (e.g., "brain parenchyma")
 *   - Partial prefix match (e.g., "brain" matches "Brain Parenchyma")
 *
 * Navigates to the first content box within the matched section.
 *
 * @param {object} context - Voice command execution context
 * @param {string[]} context.clarifierWords - Words after the trigger ("go to")
 */
export function navigateToSection(context) {
  const clarifierWords = context.clarifierWords || [];
  if (clarifierWords.length === 0) {
    console.warn('[VoiceCommandHandlers] navigateToSection: no clarifier words provided');
    return;
  }

  const sectionName = clarifierWords.join(' ').toLowerCase();
  const labelMap = buildSectionLabelMap();

  // 1. Try exact match
  let match = labelMap.get(sectionName);

  // 2. Try partial prefix match (user said "brain", matches "brain parenchyma")
  if (!match) {
    for (const [lowerLabel, entry] of labelMap) {
      if (lowerLabel.startsWith(sectionName)) {
        match = entry;
        break;
      }
    }
  }

  // 3. Try contains match (user said "parenchyma", matches "brain parenchyma")
  if (!match) {
    for (const [lowerLabel, entry] of labelMap) {
      if (lowerLabel.includes(sectionName)) {
        match = entry;
        break;
      }
    }
  }

  if (!match) {
    console.warn(`[VoiceCommandHandlers] navigateToSection: no section matching "${sectionName}" found`);
    return;
  }

  console.log(`[VoiceCommandHandlers] navigateToSection: "${sectionName}" → "${match.label}" → content box "${match.targetContentBoxId}"`);

  const store = useReportStore.getState();
  store.setActiveTextarea(match.targetContentBoxId);
  focusAndPlaceCaretAtEnd(match.targetContentBoxId);
}

/**
 * Navigate to the dictation box.
 *
 * If the dictation box is currently collapsed, auto-expands it first
 * before navigating the cursor into it. This ensures the voice command
 * "go to dictation" always makes the dictation box accessible.
 *
 * @param {object} context - Voice command execution context
 */
export function navigateToDictation(context) {
  console.log('[VoiceCommandHandlers] navigateToDictation');

  // Auto-expand if dictation box is collapsed
  // NOTE: Read the preference directly — Zustand getters defined with `get`
  // keyword are evaluated once by Object.assign and become static values.
  const isCollapsed = useUserStore.getState().preferences.dictationPanel?.collapsed;
  if (isCollapsed) {
    console.log('[VoiceCommandHandlers] Dictation box was collapsed — expanding');
    useUserStore.getState().setDictationCollapsed(false);

    // Wait for React to re-render the expanded textarea before focusing
    requestAnimationFrame(() => {
      const store = useReportStore.getState();
      store.setActiveTextarea('dictation-box');
      focusAndPlaceCaretAtEnd('dictation-box');
    });
    return;
  }

  const store = useReportStore.getState();
  store.setActiveTextarea('dictation-box');
  focusAndPlaceCaretAtEnd('dictation-box');
}

// ─── Line Break Insertion (Type 1 Commands) ──────────────────────────

/**
 * Resolve any active typing/delete entry for the given textarea.
 * Must be called before inserting structural newlines to ensure
 * segment boundaries are clean.
 *
 * @param {string} targetId - Textarea ID
 */
function resolveActiveEntryForTarget(targetId) {
  const store = useReportStore.getState();
  const activeEntry = store.getActiveTypingEntry(targetId);
  if (activeEntry) {
    if (activeEntry.actionType === 'type') {
      store.resolveTypingEntry(activeEntry.actionId);
    } else if (activeEntry.actionType === 'delete') {
      store.resolveDeleteEntry(activeEntry.actionId);
    }
  }
}

/**
 * Insert one or more structural newline segments at the current caret
 * position in the active textarea.
 *
 * This is the shared implementation for "new line" (count=1) and
 * "new paragraph" (count=2). Each newline becomes a 1-character
 * structural segment with text '\n', consistent with the Enter-key
 * interception in DictationPanel and ContentBox.
 *
 * Steps:
 *   1. Resolve any active typing/delete entry (clean segment boundaries)
 *   2. Determine the target textarea and current caret position
 *   3. For each newline: call insertStructuralNewline, which handles
 *      splitting, shifting, and segment creation
 *   4. Update the underlying text (dictationText or contentBox currentText)
 *   5. Reposition the DOM cursor
 *
 * @param {number} count - Number of newlines to insert (1 or 2)
 */
function insertNewlines(count) {
  const store = useReportStore.getState();
  const targetId = store.activeTextareaId;

  if (!targetId) {
    console.warn('[VoiceCommandHandlers] insertNewlines: no active textarea');
    return;
  }

  // Step 1: Resolve any active typing/delete entry
  resolveActiveEntryForTarget(targetId);

  // Step 2: Get current caret position
  const caretPos = getCaretPosition(targetId);

  // Step 3: Get the current text for this target
  const freshStore = useReportStore.getState();
  let currentText;
  if (targetId === 'dictation-box') {
    currentText = freshStore.dictationText;
  } else {
    currentText = freshStore.contentBoxStates[targetId]?.currentText || '';
  }

  // Clamp caret to valid range
  const insertPos = Math.min(Math.max(caretPos, 0), currentText.length);

  console.log(
    `[VoiceCommandHandlers] insertNewlines: count=${count}, target="${targetId}", ` +
    `insertPos=${insertPos}, textLen=${currentText.length}`
  );

  // Step 4: Insert structural newline segments
  // Each call to insertStructuralNewline shifts downstream offsets by +1,
  // so insert at incrementing positions.
  for (let i = 0; i < count; i++) {
    useReportStore.getState().insertStructuralNewline(targetId, insertPos + i);
  }

  // Step 5: Build the new text with the inserted newlines
  const nlChars = '\n'.repeat(count);
  const newText = currentText.slice(0, insertPos) + nlChars + currentText.slice(insertPos);
  const newCaretPos = insertPos + count;

  // Step 6: Update store text
  if (targetId === 'dictation-box') {
    useReportStore.setState({ dictationText: newText });
  } else {
    useReportStore.setState((s) => ({
      contentBoxStates: {
        ...s.contentBoxStates,
        [targetId]: {
          ...(s.contentBoxStates[targetId] || {}),
          currentText: newText,
          manuallyEdited: true,
        },
      },
    }));
  }

  // Step 7: Update caret tracker and reposition DOM cursor
  updateCaretPosition(targetId, newCaretPos);

  const el = getTextareaElement(targetId);
  if (el) {
    // Set cursor position synchronously
    el.selectionStart = newCaretPos;
    el.selectionEnd = newCaretPos;
    // Post-React reconciliation safety (same pattern as focusAndPlaceCaretAtEnd)
    setTimeout(() => {
      el.selectionStart = newCaretPos;
      el.selectionEnd = newCaretPos;
    }, 0);
  }

  useReportStore.getState().bumpCaretVersion();
}

/**
 * Insert a single line break at the current caret position.
 * Equivalent to pressing Enter once.
 *
 * @param {object} context - Voice command execution context
 */
export function insertNewLine(context) {
  console.log('[VoiceCommandHandlers] insertNewLine');
  insertNewlines(1);
}

/**
 * Insert a paragraph break (two line breaks) at the current caret position.
 * Equivalent to pressing Enter twice.
 *
 * @param {object} context - Voice command execution context
 */
export function insertNewParagraph(context) {
  console.log('[VoiceCommandHandlers] insertNewParagraph');
  insertNewlines(2);
}

// ─── Cursor Positioning (Type 1 Commands) ────────────────────────────

/**
 * Move the cursor to the very start (position 0) of the active textarea.
 *
 * Resolves any active typing/delete entry first to ensure segment
 * boundaries are clean before repositioning.
 *
 * @param {object} context - Voice command execution context
 */
export function goToStart(context) {
  const store = useReportStore.getState();
  // Fall back to dictation-box when no textarea has been explicitly
  // activated (e.g. user started dictating without clicking anywhere).
  // This mirrors the same fallback used by ensurePendingEntry.
  const targetId = store.activeTextareaId || 'dictation-box';

  // Ensure the store knows which textarea we're operating on
  // (activates virtual caret rendering for this box)
  if (!store.activeTextareaId) {
    store.setActiveTextarea(targetId);
  }

  resolveActiveEntryForTarget(targetId);

  const newPos = 0;

  const el = getTextareaElement(targetId);
  if (el) {
    // Set selection BEFORE focus — el.focus() fires handleFocus → trackCaret()
    // synchronously, and trackCaret reads el.selectionStart. If we focus first,
    // trackCaret reads the OLD position and overwrites caretTracker.
    el.selectionStart = newPos;
    el.selectionEnd = newPos;
    el.focus();
    // Re-assert after focus in case handleFocus's trackCaret() ran before
    // the browser fully committed the selection change.
    el.selectionStart = newPos;
    el.selectionEnd = newPos;
    setTimeout(() => {
      el.selectionStart = newPos;
      el.selectionEnd = newPos;
    }, 0);
  }

  // Update caretTracker AFTER focus so it takes precedence over any
  // value that handleFocus → trackCaret() might have written.
  updateCaretPosition(targetId, newPos);

  console.log(`[VoiceCommandHandlers] goToStart: target="${targetId}", pos=0`);
  useReportStore.getState().bumpCaretVersion();
}

/**
 * Move the cursor to the very end of the active textarea.
 *
 * Resolves any active typing/delete entry first to ensure segment
 * boundaries are clean before repositioning.
 *
 * @param {object} context - Voice command execution context
 */
export function goToEnd(context) {
  const store = useReportStore.getState();
  // Fall back to dictation-box when no textarea has been explicitly
  // activated (e.g. user started dictating without clicking anywhere).
  const targetId = store.activeTextareaId || 'dictation-box';

  // Ensure the store knows which textarea we're operating on
  if (!store.activeTextareaId) {
    store.setActiveTextarea(targetId);
  }

  resolveActiveEntryForTarget(targetId);

  // Get the current text length for this target
  const freshStore = useReportStore.getState();
  let textLen;
  if (targetId === 'dictation-box') {
    textLen = freshStore.dictationText.length;
  } else {
    textLen = (freshStore.contentBoxStates[targetId]?.currentText || '').length;
  }

  const el = getTextareaElement(targetId);
  if (el) {
    // Set selection BEFORE focus — el.focus() fires handleFocus → trackCaret()
    // synchronously, and trackCaret reads el.selectionStart. If we focus first,
    // trackCaret reads the OLD position and overwrites caretTracker.
    el.selectionStart = textLen;
    el.selectionEnd = textLen;
    el.focus();
    // Re-assert after focus
    el.selectionStart = textLen;
    el.selectionEnd = textLen;
    setTimeout(() => {
      el.selectionStart = textLen;
      el.selectionEnd = textLen;
    }, 0);
  }

  // Update caretTracker AFTER focus so it takes precedence over any
  // value that handleFocus → trackCaret() might have written.
  updateCaretPosition(targetId, textLen);

  console.log(`[VoiceCommandHandlers] goToEnd: target="${targetId}", pos=${textLen}`);
  useReportStore.getState().bumpCaretVersion();
}

/**
 * Delete text from the active textarea.
 *
 * Behavior:
 *   - If text is currently highlighted (selected), delete only the
 *     selected portion and leave the rest intact.
 *   - If no text is highlighted, delete ALL text in the textarea.
 *
 * Uses enqueueDeleteEntry with immediateResolve=true for atomic,
 * one-shot segment surgery. Resolves any active typing/delete entry
 * before performing the deletion.
 *
 * @param {object} context - Voice command execution context
 */
export function deleteText(context) {
  const store = useReportStore.getState();
  const targetId = store.activeTextareaId;

  if (!targetId) {
    console.warn('[VoiceCommandHandlers] deleteText: no active textarea');
    return;
  }

  // Step 1: Resolve any active typing/delete entry
  resolveActiveEntryForTarget(targetId);

  // Step 2: Get the current text
  const freshStore = useReportStore.getState();
  let currentText;
  if (targetId === 'dictation-box') {
    currentText = freshStore.dictationText;
  } else {
    currentText = freshStore.contentBoxStates[targetId]?.currentText || '';
  }

  if (currentText.length === 0) {
    console.log('[VoiceCommandHandlers] deleteText: textarea is already empty');
    return;
  }

  // Step 3: Check if text is highlighted (selected) via the DOM element
  const el = getTextareaElement(targetId);
  let delStart, delEnd;

  if (el && el.selectionStart !== el.selectionEnd) {
    // Text is highlighted — delete only the selection
    delStart = Math.min(el.selectionStart, el.selectionEnd);
    delEnd = Math.max(el.selectionStart, el.selectionEnd);
    console.log(`[VoiceCommandHandlers] deleteText: deleting selection [${delStart},${delEnd}] in "${targetId}"`);
  } else {
    // No selection — delete all text
    delStart = 0;
    delEnd = currentText.length;
    console.log(`[VoiceCommandHandlers] deleteText: deleting all text (${delEnd} chars) in "${targetId}"`);
  }

  const deletedText = currentText.slice(delStart, delEnd);

  // Step 4: Perform the deletion via enqueueDeleteEntry
  useReportStore.getState().enqueueDeleteEntry({
    targetId,
    deletionStart: delStart,
    deletionEnd: delEnd,
    deletedText,
    immediateResolve: true,
  });

  // Step 5: Update caret position to the deletion start point
  const newCaretPos = delStart;
  updateCaretPosition(targetId, newCaretPos);

  if (el) {
    el.selectionStart = newCaretPos;
    el.selectionEnd = newCaretPos;
    setTimeout(() => {
      el.selectionStart = newCaretPos;
      el.selectionEnd = newCaretPos;
    }, 0);
  }

  useReportStore.getState().bumpCaretVersion();
}

// ─── Text Highlight / Selection (Type 2 Command) ─────────────────────

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Initialize payload state for the highlight text command.
 * Captures the current textarea text and cursor position at the
 * moment the trigger word is recognized.
 *
 * @returns {object} Initial payload state
 */
export function highlightInitPayload() {
  const store = useReportStore.getState();
  const targetId = store.activeTextareaId;

  if (!targetId) {
    return { targetId: null, fullText: '', caretPos: 0, payloadWords: [], candidates: [] };
  }

  let fullText;
  if (targetId === 'dictation-box') {
    fullText = store.dictationText;
  } else {
    fullText = store.contentBoxStates[targetId]?.currentText || '';
  }

  const caretPos = getCaretPosition(targetId);

  return {
    targetId,
    fullText,
    caretPos,
    payloadWords: [],
    candidates: [],   // [{ start, end }, ...]
    selectAll: false,
  };
}

/**
 * Process a payload token for the highlight text command.
 * Progressive narrowing: each word narrows the candidate matches
 * using case-insensitive regex with word boundaries and flexible whitespace.
 *
 * Special case: if the first word is "all", short-circuit to select-all.
 *
 * @param {string} word - Lowercase word from ASR
 * @param {object} payloadState - Current state
 * @returns {{ action: string, payloadState: object }}
 */
export function highlightOnPayloadToken(word, payloadState) {
  if (!payloadState.targetId || !payloadState.fullText) {
    return { action: 'abort' };
  }

  // Special case: "all" as first word → select all text
  if (payloadState.payloadWords.length === 0 && word === 'all') {
    return {
      action: 'complete',
      payloadState: {
        ...payloadState,
        payloadWords: ['all'],
        candidates: [{ start: 0, end: payloadState.fullText.length }],
        selectAll: true,
      },
    };
  }

  // Build search phrase with the new word
  const newWords = [...payloadState.payloadWords, word];
  const pattern = '\\b' + newWords.map(w => escapeRegex(w)).join('\\s+');
  const regex = new RegExp(pattern, 'gi');

  const matches = [];
  let match;
  while ((match = regex.exec(payloadState.fullText)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
  }

  if (matches.length > 0) {
    // Matches found — continue collecting
    return {
      action: 'continue',
      payloadState: {
        ...payloadState,
        payloadWords: newWords,
        candidates: matches,
      },
    };
  }

  // ── No direct matches — retry with autocorrect as a safety net ──
  // Run the full phrase through autocorrectService which handles
  // medical term normalization, number/unit conversions, etc.
  const rawPhrase = newWords.join(' ');
  const correctedPhrase = autocorrectService.apply(rawPhrase);

  if (correctedPhrase !== rawPhrase) {
    const correctedWords = correctedPhrase.trim().split(/\s+/);
    const correctedPattern = '\\b' + correctedWords.map(w => escapeRegex(w)).join('\\s+');
    const correctedRegex = new RegExp(correctedPattern, 'gi');

    const correctedMatches = [];
    let cm;
    while ((cm = correctedRegex.exec(payloadState.fullText)) !== null) {
      correctedMatches.push({ start: cm.index, end: cm.index + cm[0].length });
    }

    if (correctedMatches.length > 0) {
      console.log(`[VoiceCommandHandlers] highlightOnPayloadToken: autocorrect retry succeeded: "${rawPhrase}" → "${correctedPhrase}" (${correctedMatches.length} matches)`);
      return {
        action: 'continue',
        payloadState: {
          ...payloadState,
          payloadWords: correctedWords,
          candidates: correctedMatches,
        },
      };
    }
  }

  // No matches with the new word (even after autocorrect)
  if (payloadState.candidates.length > 0) {
    // We had previous matches — finalize with them, flush this word back
    return {
      action: 'finalize',
      payloadState,  // Keep the previous state (with valid candidates)
    };
  }

  // No matches at all (first word failed) — abort entirely
  return { action: 'abort' };
}

/**
 * Handle silence timeout during highlight payload collection.
 * If we have candidates, execute; otherwise abort.
 *
 * @param {object} payloadState
 * @returns {{ action: string, payloadState: object }}
 */
export function highlightOnPayloadTimeout(payloadState) {
  if (payloadState.candidates.length > 0) {
    return { action: 'execute', payloadState };
  }
  return { action: 'abort', payloadState };
}

/**
 * Execute the highlight text command — apply the text selection.
 *
 * Picks the best candidate match based on cursor proximity:
 *   1. Prefer the closest match AFTER the cursor
 *   2. Fallback: closest match BEFORE the cursor
 *
 * Sets the DOM selection range and updates the caret tracker.
 *
 * @param {object} context - Voice command execution context (includes payloadState)
 */
export function highlightText(context) {
  const { payloadState } = context;

  if (!payloadState || !payloadState.targetId) {
    console.warn('[VoiceCommandHandlers] highlightText: no target');
    return;
  }

  const { targetId, candidates, caretPos } = payloadState;

  if (!candidates || candidates.length === 0) {
    console.warn('[VoiceCommandHandlers] highlightText: no candidates');
    return;
  }

  // Pick the best candidate:
  // 1. Prefer the closest match AFTER the cursor
  // 2. Fallback: closest match BEFORE the cursor
  let bestMatch = null;
  let bestDistance = Infinity;

  // First pass: find closest match at or after cursor
  for (const c of candidates) {
    if (c.start >= caretPos) {
      const dist = c.start - caretPos;
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = c;
      }
    }
  }

  // Second pass: if none after cursor, find closest before
  if (!bestMatch) {
    bestDistance = Infinity;
    for (const c of candidates) {
      if (c.start < caretPos) {
        const dist = caretPos - c.start;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestMatch = c;
        }
      }
    }
  }

  // Safety fallback
  if (!bestMatch) {
    bestMatch = candidates[0];
  }

  console.log(
    `[VoiceCommandHandlers] highlightText: target="${targetId}", ` +
    `match=[${bestMatch.start},${bestMatch.end}] of ${candidates.length} candidates, ` +
    `words="${payloadState.payloadWords.join(' ')}"`
  );

  // Apply the selection
  resolveActiveEntryForTarget(targetId);

  // Update caret tracker with selection range
  updateCaretPosition(targetId, bestMatch.start, bestMatch.end);

  const el = getTextareaElement(targetId);
  if (el) {
    el.focus();
    el.selectionStart = bestMatch.start;
    el.selectionEnd = bestMatch.end;
    setTimeout(() => {
      el.selectionStart = bestMatch.start;
      el.selectionEnd = bestMatch.end;
    }, 0);
  }

  useReportStore.getState().bumpCaretVersion();
}

// ─── Text Replace (Type 2 Command) ──────────────────────────────────

/** Separator words that transition from searching → collecting replacement */
const SEPARATOR_WORDS = new Set(['with', 'to']);

/**
 * Pick the best candidate match based on cursor proximity.
 * Prefers closest match AFTER the cursor; falls back to closest BEFORE.
 * Shared by highlightText and replaceText.
 *
 * @param {Array<{start: number, end: number}>} candidates
 * @param {number} caretPos
 * @returns {{ start: number, end: number }}
 */
function pickBestMatch(candidates, caretPos) {
  let bestMatch = null;
  let bestDistance = Infinity;

  // First pass: closest match at or after cursor
  for (const c of candidates) {
    if (c.start >= caretPos) {
      const dist = c.start - caretPos;
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = c;
      }
    }
  }

  // Second pass: if none after cursor, find closest before
  if (!bestMatch) {
    bestDistance = Infinity;
    for (const c of candidates) {
      if (c.start < caretPos) {
        const dist = caretPos - c.start;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestMatch = c;
        }
      }
    }
  }

  return bestMatch || candidates[0];
}

/**
 * Initialize payload state for the replace text command.
 * Captures the current textarea text and cursor position.
 * Adds phase tracking for two-phase payload collection.
 *
 * @returns {object} Initial payload state
 */
export function replaceInitPayload() {
  const store = useReportStore.getState();
  const targetId = store.activeTextareaId;

  if (!targetId) {
    return {
      targetId: null, fullText: '', caretPos: 0,
      payloadWords: [], candidates: [],
      phase: 'searching', replacementWords: [],
    };
  }

  let fullText;
  if (targetId === 'dictation-box') {
    fullText = store.dictationText;
  } else {
    fullText = store.contentBoxStates[targetId]?.currentText || '';
  }

  const caretPos = getCaretPosition(targetId);

  return {
    targetId,
    fullText,
    caretPos,
    payloadWords: [],    // search words (the [X] part)
    candidates: [],      // [{ start, end }, ...]
    phase: 'searching',  // 'searching' | 'collecting_replacement'
    replacementWords: [], // the [Y] part
    selectAll: false,
  };
}

/**
 * Process a payload token for the replace text command.
 *
 * Phase 1 (searching): Progressive regex search identical to highlight.
 *   - When a word breaks the match, check if it's a separator ("with"/"to").
 *   - If separator → transition to phase 2.
 *   - If not separator → abort.
 *
 * Phase 2 (collecting_replacement): Blind accumulation of replacement words.
 *
 * @param {string} word - Lowercase word from ASR
 * @param {object} payloadState - Current state
 * @returns {{ action: string, payloadState: object }}
 */
export function replaceOnPayloadToken(word, payloadState) {
  if (!payloadState.targetId || !payloadState.fullText) {
    return { action: 'abort' };
  }

  // ── Phase 2: collecting replacement text ──
  if (payloadState.phase === 'collecting_replacement') {
    return {
      action: 'continue',
      payloadState: {
        ...payloadState,
        replacementWords: [...payloadState.replacementWords, word],
      },
    };
  }

  // ── Phase 1: searching for [X] ──

  // Special case: "all" as first word → select all text
  if (payloadState.payloadWords.length === 0 && word === 'all') {
    return {
      action: 'continue',
      payloadState: {
        ...payloadState,
        payloadWords: ['all'],
        candidates: [{ start: 0, end: payloadState.fullText.length }],
        selectAll: true,
      },
    };
  }

  // For "replace all with ...", after "all" the next word should be separator
  if (payloadState.selectAll && SEPARATOR_WORDS.has(word)) {
    return {
      action: 'continue',
      payloadState: {
        ...payloadState,
        phase: 'collecting_replacement',
      },
    };
  }

  // Build search phrase with the new word
  const newWords = [...payloadState.payloadWords, word];
  const pattern = '\\b' + newWords.map(w => escapeRegex(w)).join('\\s+');
  const regex = new RegExp(pattern, 'gi');

  const matches = [];
  let match;
  while ((match = regex.exec(payloadState.fullText)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
  }

  if (matches.length > 0) {
    // Matches found — continue searching
    return {
      action: 'continue',
      payloadState: {
        ...payloadState,
        payloadWords: newWords,
        candidates: matches,
      },
    };
  }

  // ── No direct matches — try autocorrect retry ──
  const rawPhrase = newWords.join(' ');
  const correctedPhrase = autocorrectService.apply(rawPhrase);

  if (correctedPhrase !== rawPhrase) {
    const correctedWords = correctedPhrase.trim().split(/\s+/);
    const correctedPattern = '\\b' + correctedWords.map(w => escapeRegex(w)).join('\\s+');
    const correctedRegex = new RegExp(correctedPattern, 'gi');

    const correctedMatches = [];
    let cm;
    while ((cm = correctedRegex.exec(payloadState.fullText)) !== null) {
      correctedMatches.push({ start: cm.index, end: cm.index + cm[0].length });
    }

    if (correctedMatches.length > 0) {
      console.log(`[VoiceCommandHandlers] replaceOnPayloadToken: autocorrect retry: "${rawPhrase}" → "${correctedPhrase}" (${correctedMatches.length} matches)`);
      return {
        action: 'continue',
        payloadState: {
          ...payloadState,
          payloadWords: correctedWords,
          candidates: correctedMatches,
        },
      };
    }
  }

  // ── No matches (even after autocorrect) — check for separator word ──
  if (payloadState.candidates.length > 0 && SEPARATOR_WORDS.has(word)) {
    console.log(`[VoiceCommandHandlers] replaceOnPayloadToken: separator "${word}" detected, transitioning to replacement collection`);
    return {
      action: 'continue',
      payloadState: {
        ...payloadState,
        phase: 'collecting_replacement',
      },
    };
  }

  // No candidates + not a separator → abort
  return { action: 'abort' };
}

/**
 * Handle silence timeout during replace payload collection.
 *
 * Execute only if:
 *   - We're in the replacement collection phase
 *   - We have at least one replacement word
 *   - We have at least one search candidate
 *
 * @param {object} payloadState
 * @returns {{ action: string, payloadState: object }}
 */
export function replaceOnPayloadTimeout(payloadState) {
  if (
    payloadState.phase === 'collecting_replacement' &&
    payloadState.replacementWords.length > 0 &&
    payloadState.candidates.length > 0
  ) {
    return { action: 'execute', payloadState };
  }
  return { action: 'abort', payloadState };
}

/**
 * Execute the replace text command.
 *
 * 1. Pick the best candidate match (closest to cursor)
 * 2. Delete the matched text via enqueueDeleteEntry
 * 3. Insert the replacement text via insertTextAtPosition
 * 4. Position cursor at end of inserted text
 *
 * @param {object} context - Voice command execution context (includes payloadState)
 */
export function replaceText(context) {
  const { payloadState } = context;

  if (!payloadState || !payloadState.targetId) {
    console.warn('[VoiceCommandHandlers] replaceText: no target');
    return;
  }

  const { targetId, candidates, caretPos, replacementWords, payloadWords } = payloadState;

  if (!candidates || candidates.length === 0) {
    console.warn('[VoiceCommandHandlers] replaceText: no candidates');
    return;
  }

  if (!replacementWords || replacementWords.length === 0) {
    console.warn('[VoiceCommandHandlers] replaceText: no replacement text');
    return;
  }

  // Pick the best candidate match
  const bestMatch = pickBestMatch(candidates, caretPos);
  const replacementText = replacementWords.join(' ');

  console.log(
    `[VoiceCommandHandlers] replaceText: target="${targetId}", ` +
    `match=[${bestMatch.start},${bestMatch.end}] "${payloadWords.join(' ')}" → "${replacementText}"`
  );

  // Step 1: Resolve any active typing/delete entry
  resolveActiveEntryForTarget(targetId);

  // Step 2: Get fresh text state
  const freshStore = useReportStore.getState();
  let currentText;
  if (targetId === 'dictation-box') {
    currentText = freshStore.dictationText;
  } else {
    currentText = freshStore.contentBoxStates[targetId]?.currentText || '';
  }

  const deletedText = currentText.slice(bestMatch.start, bestMatch.end);

  // Step 3: Delete the matched text
  freshStore.enqueueDeleteEntry({
    targetId,
    deletionStart: bestMatch.start,
    deletionEnd: bestMatch.end,
    deletedText,
    immediateResolve: true,
  });

  // Step 4: Insert the replacement text at the deletion point
  useReportStore.getState().insertTextAtPosition(targetId, bestMatch.start, replacementText);

  // Step 5: Position cursor at end of inserted text
  const newCaretPos = bestMatch.start + replacementText.length;
  updateCaretPosition(targetId, newCaretPos);

  const el = getTextareaElement(targetId);
  if (el) {
    el.focus();
    el.selectionStart = newCaretPos;
    el.selectionEnd = newCaretPos;
    setTimeout(() => {
      el.selectionStart = newCaretPos;
      el.selectionEnd = newCaretPos;
    }, 0);
  }

  useReportStore.getState().bumpCaretVersion();
}

// ─── Undo / Redo (Type 1 Commands) ──────────────────────────────────

/**
 * Undo the most recent text-modifying action.
 *
 * Calls the store's performUndo() which checks guard conditions
 * (queue drained, Pass 1 idle, stack non-empty) and executes the
 * appropriate undo logic (Pass 1 erasure or deletion re-insertion).
 * Then triggers downstream debounces so Pass 2 and Impression
 * regenerate based on the restored state.
 *
 * @param {object} context - Voice command execution context
 */
export function undoAction(context) {
  console.log('[VoiceCommandHandlers] undoAction');
  const store = useReportStore.getState();
  const result = store.performUndo();
  if (result) {
    if (result.type === 'pass1') {
      startPass2Debounce();
      startImpressionDebounce();
    } else if (result.type === 'deletion') {
      startPass2Debounce();
      startImpressionDebounce();
    }
  }
}

/**
 * Redo the most recently undone text-modifying action.
 *
 * Calls the store's performRedo() which checks guard conditions
 * and re-applies the action. Then triggers downstream debounces.
 *
 * @param {object} context - Voice command execution context
 */
export function redoAction(context) {
  console.log('[VoiceCommandHandlers] redoAction');
  const store = useReportStore.getState();
  const result = store.performRedo();
  if (result) {
    if (result.type === 'pass1') {
      startPass2Debounce();
      startImpressionDebounce();
    } else if (result.type === 'deletion') {
      startPass2Debounce();
      startImpressionDebounce();
    }
  }
}

/**
 * Turn off the microphone by calling the registered mic toggle function.
 *
 * Defers the call to the next microtask to avoid re-entrancy issues —
 * this handler runs INSIDE the VCE's command execution pipeline, and
 * calling toggle synchronously would call voiceCommandEngine.shutdown()
 * while the engine is still mid-execution.
 *
 * Uses the micToggleRegistry instead of document.getElementById() so
 * that the command works regardless of which document the MicButton
 * lives in (main window or Document Picture-in-Picture pop-out).
 *
 * @param {object} context - Voice command execution context
 */
export function micOff(context) {
  console.log('[VoiceCommandHandlers] micOff: turning off microphone');
  setTimeout(() => {
    const toggleFn = getMicToggle();
    if (toggleFn) {
      toggleFn();
    } else {
      console.warn('[VoiceCommandHandlers] micOff: no mic toggle function registered');
    }
  }, 0);
}
// ─── ERIK: Ask ERIK (Type 3 open_ended) ──────────────────────────────

/**
 * Handle the "Ask ERIK" voice command.
 * Sends the collected open-ended payload text through voice sanitization
 * (ASR error correction), then dispatches it to the cockpit ERIK pipeline
 * via postMessage.
 *
 * The handler runs inside the reporting iframe. ERIK lives in the cockpit
 * (parent window), so we use window.parent.postMessage to deliver the query.
 *
 * @param {object} context - Voice command execution context
 * @param {Array} context.openEndedPayloadTokens - Collected payload tokens
 * @param {string} context.openEndedPayloadText - Reassembled payload text
 */
export async function askErik(context) {
  const rawText = context.openEndedPayloadText;
  console.log(`[VoiceCommandHandlers] askErik: raw payload = "${rawText}"`);

  if (!rawText || !rawText.trim()) {
    console.warn('[VoiceCommandHandlers] askErik: empty payload, skipping');
    return;
  }

  // Sanitize via dedicated voice-sanitize API (ASR error correction)
  let sanitizedText = rawText.trim();
  try {
    const response = await fetch('/api/dictation/voice-sanitize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sanitizedText }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        sanitizedText = data.result;
        console.log(`[VoiceCommandHandlers] askErik: sanitized = "${sanitizedText}"`);
      }
    } else {
      console.warn('[VoiceCommandHandlers] askErik: voice-sanitize returned non-OK, using raw text');
    }
  } catch (err) {
    console.warn('[VoiceCommandHandlers] askErik: voice-sanitize call failed, using raw text:', err.message);
  }

  // Send to cockpit ERIK pipeline via postMessage
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      { type: 'REPORTING:ERIK_QUERY', payload: { question: sanitizedText } },
      window.location.origin,
    );
    console.log(`[VoiceCommandHandlers] askErik: sent REPORTING:ERIK_QUERY to parent`);
  } else {
    console.warn('[VoiceCommandHandlers] askErik: not in iframe, cannot postMessage to parent');
  }
}

export default {
  navigateToNextField,
  navigateToPreviousField,
  navigateToSection,
  navigateToDictation,
  insertNewLine,
  insertNewParagraph,
  goToStart,
  goToEnd,
  deleteText,
  highlightText,
  highlightInitPayload,
  highlightOnPayloadToken,
  highlightOnPayloadTimeout,
  replaceText,
  replaceInitPayload,
  replaceOnPayloadToken,
  replaceOnPayloadTimeout,
  undoAction,
  redoAction,
  micOff,
  askErik,
  getOrderedContentBoxIds,
};
