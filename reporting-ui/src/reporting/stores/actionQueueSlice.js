/**
 * Action Queue Slice — FIFO Execution Queue
 *
 * Zustand slice managing the action queue, segment ledger, and typing lock.
 * The action queue is a true FIFO execution queue that drives ALL
 * text-modifying operations. Only the front-of-queue entry may execute;
 * all other entries buffer their work until they reach the front.
 *
 * Core rules:
 *   - One-at-a-time speech (single pending dictate entry)
 *   - Cursor-move = boundary
 *   - Serial resolution with position recomputation
 *   - Highlight-and-replace via selectionRange
 *   - Typing lock while ANY entries are pending/awaiting_final
 *
 * Entry types:
 *   - 'dictate' — ASR dictation burst (multiple incrementalInserts)
 *   - 'pass1'   — LLM Pass 1 sanitization (blocks queue while in-flight)
 *
 * FIFO gating:
 *   - incrementalInsert checks isEntryAtFront before executing
 *   - If not at front, text is buffered on the entry (pendingInsertions)
 *   - When a pass1 entry resolves, buffered insertions are replayed
 */

import { updateCaretPosition, getCaretPosition } from '../services/caretTracker';
import { notifyQueueDrained, notifyNewEntry, notifyContentDeletion } from '../services/actionQueueService';

function generateId(prefix = 'aq') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Splice text at a position, optionally replacing a selection range.
 * Returns the new full string.
 */
function spliceText(original, position, insertText, selectionRange) {
  if (selectionRange) {
    const before = original.slice(0, selectionRange.start);
    const after = original.slice(selectionRange.end);
    return before + insertText + after;
  }
  const before = original.slice(0, position);
  const after = original.slice(position);
  return before + insertText + after;
}

/**
 * Compute the length delta caused by an insertion.
 * If selectionRange is provided, the delta accounts for the deleted selection.
 */
function computeDelta(insertLength, selectionRange) {
  if (selectionRange) {
    const deletedLength = selectionRange.end - selectionRange.start;
    return insertLength - deletedLength;
  }
  return insertLength;
}

/**
 * Ensure proper spacing around inserted ASR text.
 * - Adds a leading space if the preceding character is not whitespace
 *   and the text doesn't already start with a space.
 * - Adds a trailing space if the following character is not whitespace
 *   and the text doesn't already end with a space.
 * - At position 0 or at end-of-text, no pad is added on that side.
 *
 * @param {string} text - The text to insert (post-autocorrect)
 * @param {string} fullText - The full content of the target textarea
 * @param {number} insertPos - Where the text will be inserted
 * @param {object|null} selectionRange - Optional selection being replaced
 * @returns {string} - The text with normalized spacing
 */
function normalizeSpacing(text, fullText, insertPos, selectionRange) {
  if (!text) return text;

  let padded = text;

  // Character immediately BEFORE the insertion point
  const charBefore = insertPos > 0 ? fullText[insertPos - 1] : null;

  // Character immediately AFTER the insertion/replacement end point
  const afterPos = selectionRange ? selectionRange.end : insertPos;
  const charAfter = afterPos < fullText.length ? fullText[afterPos] : null;

  // Leading space: needed if there's a non-whitespace char before AND
  // the inserted text doesn't already start with a space
  if (charBefore && charBefore !== ' ' && charBefore !== '\n' && !padded.startsWith(' ')) {
    padded = ' ' + padded;
  }

  // Trailing space: needed if there's a non-whitespace char after AND
  // the inserted text doesn't already end with a space
  if (charAfter && charAfter !== ' ' && charAfter !== '\n' && !padded.endsWith(' ')) {
    padded = padded + ' ';
  }

  return padded;
}

// ---- Segment Surgery Utilities ----

/**
 * Apply segment deletion geometry.
 *
 * Given a deletion range [delStart, delEnd], classifies each segment
 * into one of 6 geometric cases and returns updated segments.
 * Uses immutable updates — returns NEW segment objects.
 *
 * @param {Array} segments - Existing segment array for the textarea
 * @param {number} delStart - Start of deletion range (inclusive)
 * @param {number} delEnd - End of deletion range (exclusive)
 * @param {string} fullText - Full textarea text BEFORE deletion
 * @returns {{ updatedSegments: Array, removedSegments: Array, rollbackIds: string[] }}
 */
function applySegmentDeletion(segments, delStart, delEnd, fullText) {
  const deletedLength = delEnd - delStart;
  const updatedSegments = [];
  const removedSegments = [];
  const rollbackIds = [];

  for (const seg of segments) {
    // Case 1: Fully before deletion → unchanged
    if (seg.endOffset <= delStart) {
      updatedSegments.push(seg);
      continue;
    }

    // Case 2: Fully after deletion → shift left
    if (seg.startOffset >= delEnd) {
      updatedSegments.push({
        ...seg,
        startOffset: seg.startOffset - deletedLength,
        endOffset: seg.endOffset - deletedLength,
      });
      continue;
    }

    // Case 3: Fully inside deletion → remove
    if (seg.startOffset >= delStart && seg.endOffset <= delEnd) {
      removedSegments.push(seg);
      if (seg.status === 'structured') {
        rollbackIds.push(seg.segmentId);
      }
      continue;
    }

    // Case 4: Spans entire deletion → trim middle out, mark dirty
    if (seg.startOffset < delStart && seg.endOffset > delEnd) {
      const beforeText = fullText.slice(seg.startOffset, delStart);
      const afterText = fullText.slice(delEnd, seg.endOffset);
      const newText = beforeText + afterText;
      if (seg.status === 'structured') {
        rollbackIds.push(seg.segmentId);
      }
      // If trimmed segment is whitespace-only, remove it entirely
      if (!newText.trim()) {
        removedSegments.push(seg);
        continue;
      }
      updatedSegments.push({
        ...seg,
        endOffset: seg.endOffset - deletedLength,
        length: newText.length,
        text: newText,
        status: (seg.status === 'sanitized' || seg.status === 'structured') ? 'dirty' : seg.status,
      });
      continue;
    }

    // Case 5: Overlaps start of deletion (seg starts before, ends inside)
    if (seg.startOffset < delStart && seg.endOffset > delStart && seg.endOffset <= delEnd) {
      const trimmedText = fullText.slice(seg.startOffset, delStart);
      if (seg.status === 'structured') {
        rollbackIds.push(seg.segmentId);
      }
      // If trimmed segment is whitespace-only, remove it entirely
      if (!trimmedText.trim()) {
        removedSegments.push(seg);
        continue;
      }
      updatedSegments.push({
        ...seg,
        endOffset: delStart,
        length: trimmedText.length,
        text: trimmedText,
        status: (seg.status === 'sanitized' || seg.status === 'structured') ? 'dirty' : seg.status,
      });
      continue;
    }

    // Case 6: Overlaps end of deletion (seg starts inside, ends after)
    if (seg.startOffset >= delStart && seg.startOffset < delEnd && seg.endOffset > delEnd) {
      const trimmedText = fullText.slice(delEnd, seg.endOffset);
      const newStart = delStart;
      if (seg.status === 'structured') {
        rollbackIds.push(seg.segmentId);
      }
      // If trimmed segment is whitespace-only, remove it entirely
      if (!trimmedText.trim()) {
        removedSegments.push(seg);
        continue;
      }
      updatedSegments.push({
        ...seg,
        startOffset: newStart,
        endOffset: newStart + trimmedText.length,
        length: trimmedText.length,
        text: trimmedText,
        status: (seg.status === 'sanitized' || seg.status === 'structured') ? 'dirty' : seg.status,
      });
      continue;
    }

    // Fallback — shouldn't reach here, but preserve the segment
    console.warn('[applySegmentDeletion] Segment fell through all cases:', seg);
    updatedSegments.push(seg);
  }

  return { updatedSegments, removedSegments, rollbackIds };
}

/**
 * Apply segment insertion geometry.
 *
 * Given an insertion at insertPos with insertLength characters,
 * splits any overlapping segment at the insertion point and shifts
 * all downstream segments right.
 *
 * Returns a NEW array of segments (does NOT include the inserted text
 * as a segment — that's the caller's responsibility).
 *
 * @param {Array} segments - Existing segment array for the textarea
 * @param {number} insertPos - Position where text is being inserted
 * @param {number} insertLength - Length of inserted text
 * @param {string} fullText - Full textarea text BEFORE insertion
 * @returns {Array} Updated segment array
 */
function applySegmentInsertion(segments, insertPos, insertLength, fullText) {
  return segments.flatMap((seg) => {
    // Fully before or ending at insertion → unchanged
    if (seg.endOffset <= insertPos) {
      return [seg];
    }

    // Fully after insertion → shift right
    if (seg.startOffset >= insertPos) {
      return [{
        ...seg,
        startOffset: seg.startOffset + insertLength,
        endOffset: seg.endOffset + insertLength,
      }];
    }

    // Overlaps insertion point → split into two halves
    if (seg.startOffset < insertPos && seg.endOffset > insertPos) {
      const beforeText = fullText.slice(seg.startOffset, insertPos);
      const afterText = fullText.slice(insertPos, seg.endOffset);
      const parts = [];

      if (beforeText.length > 0) {
        parts.push({
          ...seg,
          endOffset: insertPos,
          length: beforeText.length,
          text: beforeText,
        });
      }

      if (afterText.length > 0) {
        parts.push({
          segmentId: generateId('seg'),
          textareaTarget: seg.textareaTarget,
          startOffset: insertPos + insertLength,
          endOffset: seg.endOffset + insertLength,
          length: afterText.length,
          text: afterText,
          status: seg.status,
          sourceActionId: seg.sourceActionId,
        });
      }

      return parts;
    }

    // Fallback — at boundary, unchanged
    return [seg];
  });
}

/**
 * Clean up orphaned whitespace gaps between segments after deletion surgery.
 *
 * When segment surgery removes a segment (because its remnant was whitespace-only),
 * the whitespace text may still remain in the textarea since it fell outside the
 * user's deletion range. This function detects those orphaned gaps and removes
 * them, keeping text and segments contiguous.
 *
 * Convention: inter-sentence spaces belong to the SUBSEQUENT segment.
 * So a gap like " " between two segments is orphaned whitespace that should
 * be removed (the next segment already has its own leading space).
 *
 * @param {Array} segments - Segments after deletion surgery
 * @param {string} fullText - Full textarea text after primary deletion
 * @returns {{ segments: Array, fullText: string, totalRemoved: number, removedBefore: Function }}
 */
function cleanupOrphanedGaps(segments, fullText) {
  const sorted = [...segments].sort((a, b) => a.startOffset - b.startOffset);
  const gaps = [];

  // Find whitespace-only gaps between consecutive segments
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endOffset;
    const currStart = sorted[i].startOffset;
    if (currStart > prevEnd) {
      const gapText = fullText.slice(prevEnd, currStart);
      if (gapText.length > 0 && !gapText.trim()) {
        gaps.push({ start: prevEnd, end: currStart, length: currStart - prevEnd });
      }
    }
  }

  if (gaps.length === 0) {
    return { segments: sorted, fullText, totalRemoved: 0, removedBefore: () => 0 };
  }

  // Process gaps from RIGHT to LEFT so earlier gap positions stay valid
  let newText = fullText;
  let adjustedSegs = sorted.map(s => ({ ...s }));

  for (let g = gaps.length - 1; g >= 0; g--) {
    const gap = gaps[g];
    const gapLen = gap.length;

    console.log(`[cleanupOrphanedGaps] Removing orphaned whitespace [${gap.start},${gap.end}] (${gapLen} char): ${JSON.stringify(fullText.slice(gap.start, gap.end))}`);

    // Remove gap text from the full string
    newText = newText.slice(0, gap.start) + newText.slice(gap.end);

    // Shift all segments that start at or after the gap end
    adjustedSegs = adjustedSegs.map(seg => {
      if (seg.startOffset >= gap.end) {
        return {
          ...seg,
          startOffset: seg.startOffset - gapLen,
          endOffset: seg.endOffset - gapLen,
        };
      }
      return seg;
    });
  }

  const totalRemoved = gaps.reduce((sum, g) => sum + g.length, 0);

  // Compute how many gap characters were removed before a given position
  // (positions are in pre-cleanup coordinates)
  const removedBefore = (pos) => {
    let count = 0;
    for (const gap of gaps) {
      if (gap.end <= pos) {
        count += gap.length;
      } else if (gap.start < pos) {
        count += pos - gap.start;
      }
    }
    return count;
  };

  return { segments: adjustedSegs, fullText: newText, totalRemoved, removedBefore };
}

/**
 * Create the action queue slice.
 * Called within the Zustand create() and merged into the main store.
 */
export function createActionQueueSlice(set, get) {
  return {
    // --- Action Queue State ---
    actionQueue: [],
    segments: { 'dictation-box': [] },   // Per-textarea segment arrays
    typingLocked: false,

    // -----------------------------------------------------------------
    // enqueueAction — add a new action to the queue
    // -----------------------------------------------------------------
    enqueueAction: ({ targetId, caretPosition, selectionRange = null, actionType = 'dictate' }) => {
      const state = get();

      // One-at-a-time speech: reject if a pending dictate entry already exists
      if (actionType === 'dictate') {
        const existingPending = state.actionQueue.find(
          (e) => e.status === 'pending' && e.actionType === 'dictate'
        );
        if (existingPending) {
          console.warn('[ActionQueue] Rejected enqueue: pending dictate entry already exists');
          return null;
        }
      }

      const entry = {
        actionId: generateId('aq'),
        timestamp: Date.now(),
        targetId,
        caretPosition,
        selectionRange,
        actionType,
        asrBuffer: [],
        resolvedText: null,
        pendingInsertions: [],  // buffered ASR finals waiting for front-of-queue
        status: 'pending',
      };

      set((s) => ({
        actionQueue: [...s.actionQueue, entry],
        typingLocked: actionType === 'dictate' ? true : s.typingLocked,
        // Ensure the segments map has an array for this target
        // (pass1 entries use '__pass1__' which doesn't need segments)
        segments: targetId !== '__pass1__' && !s.segments[targetId]
          ? { ...s.segments, [targetId]: [] }
          : s.segments,
      }));

      // Cancel any running Pass 1 debounce — new input arriving.
      // Skip for pass1 entries (they ARE the Pass 1 execution).
      if (actionType !== 'pass1') {
        notifyNewEntry();
      }

      return entry;
    },

    // -----------------------------------------------------------------
    // appendToAsrBuffer — add interim text to the active entry's buffer
    // -----------------------------------------------------------------
    appendToAsrBuffer: (actionId, text) => {
      set((s) => ({
        actionQueue: s.actionQueue.map((e) =>
          e.actionId === actionId
            ? { ...e, asrBuffer: [...e.asrBuffer, text] }
            : e
        ),
      }));
    },

    // -----------------------------------------------------------------
    // markAwaitingFinal — cursor moved, mark entry for finalization
    // -----------------------------------------------------------------
    markAwaitingFinal: (actionId) => {
      set((s) => ({
        actionQueue: s.actionQueue.map((e) =>
          e.actionId === actionId && e.status === 'pending'
            ? { ...e, status: 'awaiting_final' }
            : e
        ),
      }));
    },

    // -----------------------------------------------------------------
    // resolveAction — resolve an entry with final text
    // Core of the position recomputation engine (§4.2 rules 3-4, 7)
    // -----------------------------------------------------------------
    resolveAction: (actionId, resolvedText) => {
      set((s) => {
        const queue = [...s.actionQueue];
        const idx = queue.findIndex((e) => e.actionId === actionId);
        if (idx === -1) return s;

        const entry = { ...queue[idx] };

        // Must be pending or awaiting_final to resolve
        if (entry.status !== 'pending' && entry.status !== 'awaiting_final') {
          console.warn('[ActionQueue] Cannot resolve entry with status:', entry.status);
          return s;
        }

        // Capture status before resolving (needed for caretTracker logic)
        const prevStatus = entry.status;

        // --- Resolve the entry ---
        entry.resolvedText = resolvedText;
        entry.status = 'resolved';
        queue[idx] = entry;

        // --- Compute insertion position ---
        const insertPos = entry.selectionRange
          ? entry.selectionRange.start
          : entry.caretPosition;

        // --- Normalize spacing around ASR insertion ---
        // Look up the current full text of the target textarea so we can
        // check the characters surrounding the insertion point.
        const targetId = entry.targetId;
        let targetFullText;
        if (targetId === 'dictation-box') {
          targetFullText = s.dictationText;
        } else {
          targetFullText = s.contentBoxStates[targetId]?.currentText || '';
        }

        // Only apply spacing normalization for ASR dictation entries
        // (not for manual typing or other action types in the future)
        const paddedText = entry.actionType === 'dictate'
          ? normalizeSpacing(resolvedText, targetFullText, insertPos, entry.selectionRange)
          : resolvedText;

        // Update resolvedText on the entry to reflect padding
        entry.resolvedText = paddedText;

        const delta = computeDelta(paddedText.length, entry.selectionRange);

        // --- Adjust downstream entries' caretPositions ---
        for (let i = idx + 1; i < queue.length; i++) {
          if (queue[i].targetId === entry.targetId && queue[i].status !== 'resolved') {
            queue[i] = {
              ...queue[i],
              caretPosition: queue[i].caretPosition + delta,
              // Also shift selectionRange if present
              selectionRange: queue[i].selectionRange
                ? {
                    start: queue[i].selectionRange.start + delta,
                    end: queue[i].selectionRange.end + delta,
                  }
                : null,
            };

            // Phase 5a: Also shift position fields on active type/delete entries
            if (queue[i].status === 'active') {
              if (queue[i].actionType === 'type' && queue[i].insertStart !== undefined) {
                queue[i] = {
                  ...queue[i],
                  insertStart: queue[i].insertStart + delta,
                  insertEnd: queue[i].insertEnd + delta,
                };
              }
              if (queue[i].actionType === 'delete' && queue[i].deletionStart !== undefined) {
                queue[i] = {
                  ...queue[i],
                  deletionStart: queue[i].deletionStart + delta,
                };
              }
            }
          }
        }

        // --- Perform the text insertion ---
        let newDictationText = s.dictationText;
        let newContentBoxStates = s.contentBoxStates;

        if (targetId === 'dictation-box') {
          newDictationText = spliceText(s.dictationText, insertPos, paddedText, entry.selectionRange);
        } else {
          const box = s.contentBoxStates[targetId];
          if (box) {
            const newText = spliceText(box.currentText, insertPos, paddedText, entry.selectionRange);
            newContentBoxStates = {
              ...s.contentBoxStates,
              [targetId]: {
                ...box,
                currentText: newText,
                version: box.version + 1,
                manuallyEdited: true,
              },
            };
          }
        }

        // --- Create a segment for the inserted text ---
        const newSegment = {
          segmentId: generateId('seg'),
          textareaTarget: targetId,
          startOffset: insertPos,
          endOffset: insertPos + paddedText.length,
          length: paddedText.length,
          text: paddedText,
          status: 'raw',
          sourceActionId: actionId,
        };

        // Adjust existing segments in this textarea around the insertion.
        // If a segment is fully after the insertion → shift offsets.
        // If a segment overlaps the insertion point → SPLIT it into two
        // parts (before + after). This ensures context lookup works when
        // dictating inside an existing sanitized segment.
        const existingSegs = (s.segments[targetId] || []).flatMap((seg) => {
          if (seg.startOffset >= insertPos) {
            return [{
              ...seg,
              startOffset: seg.startOffset + delta,
              endOffset: seg.endOffset + delta,
            }];
          }
          // Segment overlaps insertion point — split into [before] + [after]
          if (seg.startOffset < insertPos && seg.endOffset > insertPos) {
            const beforeText = targetFullText.slice(seg.startOffset, insertPos);
            const afterText = targetFullText.slice(insertPos, seg.endOffset);
            const parts = [];

            // Part 1: text before the insertion (same start, ends at insertPos)
            if (beforeText.length > 0) {
              parts.push({
                ...seg,
                endOffset: insertPos,
                length: beforeText.length,
                text: beforeText,
              });
            }

            // Part 2: text after the insertion (shifted by delta)
            if (afterText.length > 0) {
              parts.push({
                segmentId: generateId('seg'),
                textareaTarget: targetId,
                startOffset: insertPos + paddedText.length,
                endOffset: seg.endOffset + delta,
                length: afterText.length,
                text: afterText,
                status: seg.status,
                sourceActionId: seg.sourceActionId,
              });
            }

            return parts;
          }
          return [seg];
        });

        const newSegments = {
          ...s.segments,
          [targetId]: [...existingSegs, newSegment],
        };

        // --- Check if queue is drained ---
        const hasPendingDictate = queue.some(
          (e) => (e.status === 'pending' || e.status === 'awaiting_final') && e.actionType === 'dictate'
        );
        const hasBlockingUnresolved = queue.some(
          (e) => (e.status === 'pending' || e.status === 'awaiting_final') &&
                 (e.actionType === 'dictate' || e.actionType === 'pass1')
        );

        // --- Clean up resolved entries (keep last 500 for undo/redo) ---
        const resolvedEntries = queue.filter((e) => e.status === 'resolved' || e.status === 'discarded');
        const unresolvedEntries = queue.filter((e) => e.status !== 'resolved' && e.status !== 'discarded');
        const trimmedResolved = resolvedEntries.slice(-500);
        const finalQueue = [...trimmedResolved, ...unresolvedEntries].sort(
          (a, b) => a.timestamp - b.timestamp
        );

        // --- Update caretTracker with position after insertion ---
        // Behavior depends on whether the user moved the cursor (awaiting_final)
        // or is still dictating at the original position (pending).
        if (prevStatus === 'awaiting_final') {
          // User explicitly moved cursor — don't overwrite their position.
          // Instead, adjust it by the delta (text was inserted before their
          // cursor position, shifting everything downstream).
          const userCaretPos = getCaretPosition(targetId);
          if (userCaretPos >= insertPos) {
            updateCaretPosition(targetId, userCaretPos + delta);
          }
          // If userCaretPos < insertPos, the user moved BEFORE the
          // insertion point — their position is unaffected.
        } else {
          // Pending → user hasn't moved → set to end of insertion
          updateCaretPosition(targetId, insertPos + paddedText.length);
        }

        // --- Phase 4: Notify if queue is drained (triggers Pass 1 debounce) ---
        if (!hasBlockingUnresolved) {
          // Use queueMicrotask so the state update finishes before the callback runs
          queueMicrotask(() => notifyQueueDrained());
        }

        return {
          actionQueue: finalQueue,
          dictationText: newDictationText,
          contentBoxStates: newContentBoxStates,
          segments: newSegments,
          typingLocked: hasPendingDictate,
        };
      });
    },

    // -----------------------------------------------------------------
    // incrementalInsert — insert a word into a persistent dictation entry
    // without marking it resolved. The entry stays pending so subsequent
    // per-word ASR finals are routed to the same target.
    // -----------------------------------------------------------------
    incrementalInsert: (actionId, text) => {
      // --- FIFO gate: only front-of-queue entry may execute ---
      const state = get();
      if (!state.isEntryAtFront(actionId)) {
        console.log('[ActionQueue] Buffering insertion — entry not at front:', actionId, JSON.stringify(text));
        state.bufferInsertion(actionId, text);
        return;
      }

      set((s) => {
        const queue = [...s.actionQueue];
        const idx = queue.findIndex((e) => e.actionId === actionId);
        if (idx === -1) return s;

        const entry = { ...queue[idx] };
        if (entry.status !== 'pending' && entry.status !== 'awaiting_final') {
          console.warn('[ActionQueue] Cannot incrementalInsert into entry with status:', entry.status);
          return s;
        }

        // --- Compute insertion position ---
        // On the first insertion, use selectionRange if present.
        // On subsequent insertions, selectionRange has been cleared.
        const insertPos = entry.selectionRange
          ? entry.selectionRange.start
          : entry.caretPosition;

        const targetId = entry.targetId;
        const targetFullText = targetId === 'dictation-box'
          ? s.dictationText
          : (s.contentBoxStates[targetId]?.currentText || '');

        // Capture selectionRange BEFORE clearing it on the entry.
        // This value is used by spliceText and segment adjustment below.
        const activeSelRange = entry.selectionRange;

        const paddedText = entry.actionType === 'dictate'
          ? normalizeSpacing(text, targetFullText, insertPos, activeSelRange)
          : text;

        const delta = computeDelta(paddedText.length, activeSelRange);

        // --- Update the entry: advance caret, clear selectionRange, keep status ---
        entry.caretPosition = insertPos + paddedText.length;
        entry.selectionRange = null; // Only meaningful for first insertion
        entry.resolvedText = (entry.resolvedText || '') + paddedText;
        queue[idx] = entry;

        // --- Shift downstream entries ---
        for (let i = idx + 1; i < queue.length; i++) {
          if (queue[i].targetId === targetId && queue[i].status !== 'resolved') {
            queue[i] = {
              ...queue[i],
              caretPosition: queue[i].caretPosition + delta,
              selectionRange: queue[i].selectionRange
                ? {
                    start: queue[i].selectionRange.start + delta,
                    end: queue[i].selectionRange.end + delta,
                  }
                : null,
            };
          }
        }

        // --- Perform the text insertion ---
        let newDictationText = s.dictationText;
        let newContentBoxStates = s.contentBoxStates;

        if (targetId === 'dictation-box') {
          newDictationText = spliceText(s.dictationText, insertPos, paddedText, activeSelRange);
        } else {
          const box = s.contentBoxStates[targetId];
          if (box) {
            const newText = spliceText(box.currentText, insertPos, paddedText, activeSelRange);
            newContentBoxStates = {
              ...s.contentBoxStates,
              [targetId]: {
                ...box,
                currentText: newText,
                version: box.version + 1,
                manuallyEdited: true,
              },
            };
          }
        }

        // --- Create segment + adjust existing segments ---
        // When there's a selectionRange, we need to handle:
        //   1. Segments fully inside the selection → REMOVE (they were deleted)
        //   2. Segments partially overlapping the selection → TRIM
        //   3. Segments after the selection → shift by delta
        //   4. Segments at insertPos (no selection) → SPLIT as before
        const selRange = activeSelRange; // Use the captured value
        const selEnd = selRange ? selRange.end : insertPos;

        const existingSegs = (s.segments[targetId] || []).flatMap((seg) => {
          if (selRange) {
            // --- Selection replacement mode ---
            // Segment fully inside the selection → remove
            if (seg.startOffset >= selRange.start && seg.endOffset <= selRange.end) {
              // Schedule rollback for structured segments being deleted
              if (seg.status === 'structured') {
                queueMicrotask(() => {
                  get().rollbackWithCoParticipantReplay(seg.segmentId);
                  notifyContentDeletion();
                });
              }
              return [];
            }
            // Segment starts before selection, ends inside or after → trim end before selection
            if (seg.startOffset < selRange.start && seg.endOffset > selRange.start && seg.endOffset <= selRange.end) {
              return [{
                ...seg,
                endOffset: selRange.start,
                length: selRange.start - seg.startOffset,
                text: targetFullText.slice(seg.startOffset, selRange.start),
              }];
            }
            // Segment starts inside selection, ends after → trim start, shift
            if (seg.startOffset >= selRange.start && seg.startOffset < selRange.end && seg.endOffset > selRange.end) {
              const newStart = insertPos + paddedText.length;
              const trimmedText = targetFullText.slice(selRange.end, seg.endOffset);
              return [{
                ...seg,
                startOffset: newStart,
                endOffset: newStart + trimmedText.length,
                length: trimmedText.length,
                text: trimmedText,
              }];
            }
            // Segment spans entire selection → split around it
            if (seg.startOffset < selRange.start && seg.endOffset > selRange.end) {
              const parts = [];
              const beforeText = targetFullText.slice(seg.startOffset, selRange.start);
              if (beforeText.length > 0) {
                parts.push({
                  ...seg,
                  endOffset: selRange.start,
                  length: beforeText.length,
                  text: beforeText,
                });
              }
              const afterText = targetFullText.slice(selRange.end, seg.endOffset);
              if (afterText.length > 0) {
                const newStart = insertPos + paddedText.length;
                parts.push({
                  segmentId: generateId('seg'),
                  textareaTarget: targetId,
                  startOffset: newStart,
                  endOffset: newStart + afterText.length,
                  length: afterText.length,
                  text: afterText,
                  status: seg.status,
                  sourceActionId: seg.sourceActionId,
                });
              }
              return parts;
            }
            // Segment fully after selection → shift by delta
            if (seg.startOffset >= selRange.end) {
              return [{
                ...seg,
                startOffset: seg.startOffset + delta,
                endOffset: seg.endOffset + delta,
              }];
            }
            // Segment fully before selection → unchanged
            return [seg];
          }

          // --- No selection: original split logic ---
          if (seg.startOffset >= insertPos) {
            return [{
              ...seg,
              startOffset: seg.startOffset + delta,
              endOffset: seg.endOffset + delta,
            }];
          }
          if (seg.startOffset < insertPos && seg.endOffset > insertPos) {
            const beforeText = targetFullText.slice(seg.startOffset, insertPos);
            const afterText = targetFullText.slice(insertPos, seg.endOffset);
            const parts = [];
            if (beforeText.length > 0) {
              parts.push({
                ...seg,
                endOffset: insertPos,
                length: beforeText.length,
                text: beforeText,
              });
            }
            if (afterText.length > 0) {
              parts.push({
                segmentId: generateId('seg'),
                textareaTarget: targetId,
                startOffset: insertPos + paddedText.length,
                endOffset: seg.endOffset + delta,
                length: afterText.length,
                text: afterText,
                status: seg.status,
                sourceActionId: seg.sourceActionId,
              });
            }
            return parts;
          }
          return [seg];
        });

        const newSegment = {
          segmentId: generateId('seg'),
          textareaTarget: targetId,
          startOffset: insertPos,
          endOffset: insertPos + paddedText.length,
          length: paddedText.length,
          text: paddedText,
          status: 'raw',
          sourceActionId: actionId,
        };

        const newSegments = {
          ...s.segments,
          [targetId]: [...existingSegs, newSegment],
        };

        // --- Diagnostic logging ---
        console.log('[incrementalInsert]', { insertPos, paddedText: JSON.stringify(paddedText), delta,
          selRange: activeSelRange ? `[${activeSelRange.start},${activeSelRange.end}]` : 'none' });
        console.log('  newText:', JSON.stringify(newDictationText.slice(0, 80)) + (newDictationText.length > 80 ? '…' : ''));
        for (const seg of [...existingSegs, newSegment]) {
          console.log(`  seg[${seg.segmentId}] ${seg.status} [${seg.startOffset},${seg.endOffset}] "${seg.text.slice(0, 40)}${seg.text.length > 40 ? '…' : ''}"`);
        }

        // --- Update caretTracker ---
        // Use preserveSelection so that if the user made a new selection
        // (for highlight-and-replace), it isn't wiped by this caret update.
        updateCaretPosition(targetId, insertPos + paddedText.length, null, { preserveSelection: true });

        return {
          actionQueue: queue,
          dictationText: newDictationText,
          contentBoxStates: newContentBoxStates,
          segments: newSegments,
        };
      });
    },

    // -----------------------------------------------------------------
    // closeDictationEntry — mark a persistent dictation entry as resolved
    // and trigger queue drain check (which starts Pass 1 debounce).
    // No text insertion — all words were already inserted incrementally.
    // -----------------------------------------------------------------
    closeDictationEntry: (actionId) => {
      set((s) => {
        const queue = s.actionQueue.map((e) =>
          e.actionId === actionId && (e.status === 'pending' || e.status === 'awaiting_final')
            ? { ...e, status: 'resolved' }
            : e
        );

        const hasPendingDictate = queue.some(
          (e) => (e.status === 'pending' || e.status === 'awaiting_final') && e.actionType === 'dictate'
        );
        const hasBlockingUnresolved = queue.some(
          (e) => (e.status === 'pending' || e.status === 'awaiting_final') &&
                 (e.actionType === 'dictate' || e.actionType === 'pass1')
        );

        // Trim old resolved entries (keep last 500 for undo/redo)
        const resolvedEntries = queue.filter((e) => e.status === 'resolved' || e.status === 'discarded');
        const unresolvedEntries = queue.filter((e) => e.status !== 'resolved' && e.status !== 'discarded');
        const trimmedResolved = resolvedEntries.slice(-500);
        const finalQueue = [...trimmedResolved, ...unresolvedEntries].sort(
          (a, b) => a.timestamp - b.timestamp
        );

        if (!hasBlockingUnresolved) {
          queueMicrotask(() => notifyQueueDrained());
        }

        return {
          actionQueue: finalQueue,
          typingLocked: hasPendingDictate,
        };
      });
    },

    // -----------------------------------------------------------------
    // resolveNextAwaitingFinal — resolve the first awaiting_final entry
    // Used by the safety timeout
    // -----------------------------------------------------------------
    resolveNextAwaitingFinal: (fallbackText = '') => {
      const state = get();
      const entry = state.actionQueue.find((e) => e.status === 'awaiting_final');
      if (entry) {
        state.resolveAction(entry.actionId, fallbackText || entry.asrBuffer.join(' '));
      }
    },

    // -----------------------------------------------------------------
    // getActiveEntry — returns the single pending dictate entry
    // -----------------------------------------------------------------
    getActiveEntry: () => {
      return get().actionQueue.find(
        (e) => e.status === 'pending' && e.actionType === 'dictate'
      ) || null;
    },

    // -----------------------------------------------------------------
    // getFirstUnresolved — returns the first pending or awaiting_final entry
    // -----------------------------------------------------------------
    getFirstUnresolved: () => {
      return get().actionQueue.find(
        (e) => e.status === 'pending' || e.status === 'awaiting_final'
      ) || null;
    },

    // -----------------------------------------------------------------
    // isQueueDrained — true when no pending/awaiting_final entries exist
    // -----------------------------------------------------------------
    isQueueDrained: () => {
      return !get().actionQueue.some(
        (e) => (e.status === 'pending' || e.status === 'awaiting_final') &&
               (e.actionType === 'dictate' || e.actionType === 'pass1')
      );
    },

    // -----------------------------------------------------------------
    // getFrontEntry — returns the front-of-queue entry (first pending
    // or awaiting_final). This is the entry that may currently execute.
    // -----------------------------------------------------------------
    getFrontEntry: () => {
      return get().actionQueue.find(
        (e) => e.status === 'pending' || e.status === 'awaiting_final'
      ) || null;
    },

    // -----------------------------------------------------------------
    // isEntryAtFront — true if the given entry is the front-of-queue
    // -----------------------------------------------------------------
    isEntryAtFront: (actionId) => {
      const front = get().getFrontEntry();
      return front !== null && front.actionId === actionId;
    },

    // -----------------------------------------------------------------
    // getActiveTypingEntry — returns the active type/delete entry for a target
    // -----------------------------------------------------------------
    getActiveTypingEntry: (targetId) => {
      return get().actionQueue.find(
        (e) => e.status === 'active' && e.targetId === targetId &&
               (e.actionType === 'type' || e.actionType === 'delete')
      ) || null;
    },

    // -----------------------------------------------------------------
    // bufferInsertion — store ASR final text on an entry for later replay.
    // Used when the entry is behind a pass1 entry in the queue.
    // -----------------------------------------------------------------
    bufferInsertion: (actionId, text) => {
      set((s) => ({
        actionQueue: s.actionQueue.map((e) =>
          e.actionId === actionId
            ? { ...e, pendingInsertions: [...(e.pendingInsertions || []), text] }
            : e
        ),
      }));
    },

    // -----------------------------------------------------------------
    // resolvePass1Entry — resolve a pass1 queue entry and replay any
    // buffered ASR insertions on the next front-of-queue entry.
    // -----------------------------------------------------------------
    resolvePass1Entry: (actionId) => {
      // Step 1: Resolve the pass1 entry
      set((s) => {
        const queue = s.actionQueue.map((e) =>
          e.actionId === actionId && e.actionType === 'pass1'
            ? { ...e, status: 'resolved' }
            : e
        );
        const hasPendingDictate = queue.some(
          (e) => (e.status === 'pending' || e.status === 'awaiting_final') && e.actionType === 'dictate'
        );
        const hasBlockingUnresolved = queue.some(
          (e) => (e.status === 'pending' || e.status === 'awaiting_final') &&
                 (e.actionType === 'dictate' || e.actionType === 'pass1')
        );
        if (!hasBlockingUnresolved) {
          queueMicrotask(() => notifyQueueDrained());
        }

        // Trim old resolved entries (keep last 500 for undo/redo)
        const resolvedEntries = queue.filter((e) => e.status === 'resolved' || e.status === 'discarded');
        const unresolvedEntries = queue.filter((e) => e.status !== 'resolved' && e.status !== 'discarded');
        const trimmedResolved = resolvedEntries.slice(-500);
        const finalQueue = [...trimmedResolved, ...unresolvedEntries].sort(
          (a, b) => a.timestamp - b.timestamp
        );

        return { actionQueue: finalQueue, typingLocked: hasPendingDictate };
      });

      // Step 2: Replay any buffered insertions on the next front entry
      const state = get();
      const nextFront = state.getFrontEntry();
      if (nextFront && nextFront.pendingInsertions?.length > 0) {
        const insertions = [...nextFront.pendingInsertions];
        // Clear the buffer first to prevent re-entrancy
        set((s) => ({
          actionQueue: s.actionQueue.map((e) =>
            e.actionId === nextFront.actionId
              ? { ...e, pendingInsertions: [] }
              : e
          ),
        }));
        // Replay each buffered insertion — entry is now at front
        console.log(`[ActionQueue] Replaying ${insertions.length} buffered insertions for entry ${nextFront.actionId}`);
        for (const text of insertions) {
          state.incrementalInsert(nextFront.actionId, text);
        }
      }
    },

    // =================================================================
    // STRUCTURAL NEWLINE INSERTION
    // =================================================================

    /**
     * Insert a structural newline segment at the given position.
     *
     * Creates a 1-character segment with status 'structural' covering
     * the \n character. The segment participates in all offset accounting
     * (shifts, surgery, gap detection) but is excluded from Pass 1/Pass 2
     * processing by its status.
     *
     * Caller is responsible for:
     *   - Resolving any active typing/delete entry beforehand
     *   - Updating currentText/dictationText to include the \n
     *
     * This function handles:
     *   - Splitting any existing segment that spans the insertion point
     *   - Shifting all downstream segment offsets by +1
     *   - Creating the structural segment
     *
     * @param {string} targetId - Textarea ID ('dictation-box' or contentBoxId)
     * @param {number} position - Character offset where \n is being inserted
     */
    insertStructuralNewline: (targetId, position) => {
      set((s) => {
        let segs = [...(s.segments[targetId] || [])];

        // Step 1: Check if any existing segment spans the insertion point.
        // If so, split it at the insertion point first.
        const spanningIdx = segs.findIndex(
          (seg) => seg.startOffset < position && seg.endOffset > position
        );

        if (spanningIdx !== -1) {
          const seg = segs[spanningIdx];
          const splitOffset = position - seg.startOffset;
          const leftText = seg.text.slice(0, splitOffset);
          const rightText = seg.text.slice(splitOffset);

          const leftSeg = {
            ...seg,
            endOffset: position,
            length: leftText.length,
            text: leftText,
          };
          const rightSeg = {
            ...seg,
            segmentId: generateId('seg'),
            startOffset: position,
            endOffset: seg.endOffset,
            length: rightText.length,
            text: rightText,
          };

          segs = [
            ...segs.slice(0, spanningIdx),
            leftSeg,
            rightSeg,
            ...segs.slice(spanningIdx + 1),
          ];

          console.log(
            `[insertStructuralNewline] Split segment ${seg.segmentId} at ${position}: ` +
            `left [${leftSeg.startOffset},${leftSeg.endOffset}] "${leftText.slice(0, 30)}", ` +
            `right [${rightSeg.startOffset},${rightSeg.endOffset}] "${rightText.slice(0, 30)}"`
          );
        }

        // Step 2: Shift all segments at or after the insertion point by +1
        const shifted = segs.map((seg) => {
          if (seg.startOffset >= position) {
            return {
              ...seg,
              startOffset: seg.startOffset + 1,
              endOffset: seg.endOffset + 1,
            };
          }
          return seg;
        });

        // Step 3: Create the structural newline segment
        const nlSegment = {
          segmentId: generateId('seg'),
          textareaTarget: targetId,
          startOffset: position,
          endOffset: position + 1,
          length: 1,
          text: '\n',
          status: 'structural',
          sourceActionId: null,
        };

        // Step 4: Insert and sort
        const allSegs = [...shifted, nlSegment].sort(
          (a, b) => a.startOffset - b.startOffset
        );

        console.log(
          `[insertStructuralNewline] Created structural segment at [${position},${position + 1}] in ${targetId}, ` +
          `shifted ${shifted.filter((seg) => seg.startOffset > position).length} downstream segments`
        );

        return {
          segments: { ...s.segments, [targetId]: allSegs },
        };
      });
    },

    // =================================================================
    // ARBITRARY TEXT INSERTION (for programmatic insert, e.g. replace)
    // =================================================================

    /**
     * Insert arbitrary text at a given position with full segment management.
     *
     * Mirrors the pattern of insertStructuralNewline but works with any text
     * and creates a segment with status 'raw' (eligible for Pass 1/Pass 2).
     *
     * Handles:
     *   - Splitting any existing segment spanning the insertion point
     *   - Shifting all downstream segment offsets by +text.length
     *   - Creating a new 'raw' segment for the inserted text
     *   - Splicing the text into dictationText or contentBoxStates
     *
     * @param {string} targetId - Textarea ID ('dictation-box' or contentBoxId)
     * @param {number} position - Character offset where text is being inserted
     * @param {string} text - The text to insert
     */
    insertTextAtPosition: (targetId, position, text, status = 'raw') => {
      if (!text || text.length === 0) return;

      set((s) => {
        let segs = [...(s.segments[targetId] || [])];

        // Step 1: Split any existing segment spanning the insertion point
        const spanningIdx = segs.findIndex(
          (seg) => seg.startOffset < position && seg.endOffset > position
        );

        if (spanningIdx !== -1) {
          const seg = segs[spanningIdx];
          const fullText = targetId === 'dictation-box'
            ? s.dictationText
            : (s.contentBoxStates[targetId]?.currentText || '');
          const splitOffset = position - seg.startOffset;
          const leftText = fullText.slice(seg.startOffset, position);
          const rightText = fullText.slice(position, seg.endOffset);

          const leftSeg = {
            ...seg,
            endOffset: position,
            length: leftText.length,
            text: leftText,
          };
          const rightSeg = {
            ...seg,
            segmentId: generateId('seg'),
            startOffset: position,
            endOffset: seg.endOffset,
            length: rightText.length,
            text: rightText,
          };

          segs = [
            ...segs.slice(0, spanningIdx),
            leftSeg,
            rightSeg,
            ...segs.slice(spanningIdx + 1),
          ];

          console.log(
            `[insertTextAtPosition] Split segment ${seg.segmentId} at ${position}: ` +
            `left [${leftSeg.startOffset},${leftSeg.endOffset}], ` +
            `right [${rightSeg.startOffset},${rightSeg.endOffset}]`
          );
        }

        const insertLen = text.length;

        // Step 2: Shift all segments at or after the insertion point by +text.length
        const shifted = segs.map((seg) => {
          if (seg.startOffset >= position) {
            return {
              ...seg,
              startOffset: seg.startOffset + insertLen,
              endOffset: seg.endOffset + insertLen,
            };
          }
          return seg;
        });

        // Step 3: Create a new segment for the inserted text
        const newSegment = {
          segmentId: generateId('seg'),
          textareaTarget: targetId,
          startOffset: position,
          endOffset: position + insertLen,
          length: insertLen,
          text: text,
          status: status,
          sourceActionId: null,
        };

        // Step 4: Insert and sort
        const allSegs = [...shifted, newSegment].sort(
          (a, b) => a.startOffset - b.startOffset
        );

        // Step 5: Splice text into the store
        let newDictationText = s.dictationText;
        let newContentBoxStates = s.contentBoxStates;

        if (targetId === 'dictation-box') {
          newDictationText =
            s.dictationText.slice(0, position) + text + s.dictationText.slice(position);
        } else {
          const box = s.contentBoxStates[targetId];
          if (box) {
            const newText =
              box.currentText.slice(0, position) + text + box.currentText.slice(position);
            newContentBoxStates = {
              ...s.contentBoxStates,
              [targetId]: {
                ...box,
                currentText: newText,
                version: box.version + 1,
                manuallyEdited: true,
              },
            };
          }
        }

        console.log(
          `[insertTextAtPosition] Inserted "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" ` +
          `at position ${position} in ${targetId}, ` +
          `shifted ${shifted.filter((seg) => seg.startOffset > position).length} downstream segments`
        );

        return {
          dictationText: newDictationText,
          contentBoxStates: newContentBoxStates,
          segments: { ...s.segments, [targetId]: allSegs },
        };
      });
    },

    // =================================================================
    // MANUAL TYPING ENTRY OPERATIONS (Phase 2)
    // =================================================================

    /**
     * Create a new typing entry in the action queue.
     *
     * Performs split-on-first-keystroke: if the cursor is inside an
     * existing segment, that segment is split at the cursor position
     * before the typing entry starts accumulating text.
     *
     * @param {{ targetId: string, caretPosition: number }} params
     * @returns {object|null} The created entry, or null on failure
     */
    enqueueTypingEntry: ({ targetId, caretPosition }) => {
      const entry = {
        actionId: generateId('aq'),
        actionType: 'type',
        status: 'active',
        targetId,
        timestamp: Date.now(),
        insertStart: caretPosition,
        insertEnd: caretPosition,
        typedText: '',
        caretPosition,
        splitSegmentId: null,
      };

      set((s) => {
        const currentSegs = s.segments[targetId] || [];
        const fullText = targetId === 'dictation-box'
          ? s.dictationText
          : (s.contentBoxStates[targetId]?.currentText || '');

        // Split-on-first-keystroke: if cursor is INSIDE a segment, split it
        let newSegs = currentSegs;
        for (const seg of currentSegs) {
          if (seg.startOffset < caretPosition && seg.endOffset > caretPosition) {
            // Cursor is inside this segment — split it
            newSegs = applySegmentInsertion(currentSegs, caretPosition, 0, fullText);
            entry.splitSegmentId = seg.segmentId;
            console.log(`[ActionQueue] Split segment ${seg.segmentId} at position ${caretPosition} for typing entry`);
            break;
          }
        }

        return {
          actionQueue: [...s.actionQueue, entry],
          segments: { ...s.segments, [targetId]: newSegs },
        };
      });

      console.log(`[ActionQueue] Created typing entry ${entry.actionId} at position ${caretPosition} in ${targetId}`);
      return entry;
    },

    /**
     * Update an active typing entry with a new character (or characters for paste).
     *
     * Extends typedText, advances insertEnd, and shifts all downstream
     * segment offsets by the insertion length.
     *
     * Also handles backspace within typed text (newCharCount < 0).
     *
     * @param {string} actionId - The typing entry ID
     * @param {string} newChars - Characters typed (empty string for backspace)
     * @param {number} newCaretPosition - Updated cursor position
     * @param {number} delta - +N for insertions, -N for backspace within typed text
     */
    updateTypingEntry: (actionId, newChars, newCaretPosition, delta) => {
      set((s) => {
        const queue = s.actionQueue.map((e) => {
          if (e.actionId !== actionId || e.status !== 'active') return e;

          if (delta > 0) {
            // Insertion: extend typed text
            return {
              ...e,
              typedText: e.typedText + newChars,
              insertEnd: e.insertEnd + delta,
              caretPosition: newCaretPosition,
            };
          } else {
            // Backspace within typed text: trim from end
            return {
              ...e,
              typedText: e.typedText.slice(0, delta), // delta is negative
              insertEnd: e.insertEnd + delta,
              caretPosition: newCaretPosition,
            };
          }
        });

        const entry = queue.find((e) => e.actionId === actionId);
        if (!entry) return { actionQueue: queue };

        // Shift downstream segment offsets
        const targetId = entry.targetId;
        const currentSegs = s.segments[targetId] || [];
        const updatedSegs = currentSegs.map((seg) => {
          // Only shift segments that start at or after the edit position
          if (seg.startOffset >= entry.insertEnd - (delta > 0 ? delta : 0)) {
            return {
              ...seg,
              startOffset: seg.startOffset + delta,
              endOffset: seg.endOffset + delta,
            };
          }
          return seg;
        });

        return {
          actionQueue: queue,
          segments: { ...s.segments, [targetId]: updatedSegs },
        };
      });
    },

    /**
     * Resolve a typing entry: create a raw segment from the typed text.
     *
     * Called when the typing session ends (debounce, cursor move, new entry, etc.).
     * If typedText is empty, the entry is discarded instead.
     *
     * @param {string} actionId - The typing entry ID
     */
    resolveTypingEntry: (actionId) => {
      const state = get();
      const entry = state.actionQueue.find(
        (e) => e.actionId === actionId && e.actionType === 'type'
      );

      if (!entry) return;

      if (!entry.typedText || entry.typedText.length === 0) {
        // Nothing typed — discard
        set((s) => ({
          actionQueue: s.actionQueue.map((e) =>
            e.actionId === actionId ? { ...e, status: 'discarded' } : e
          ),
        }));
        console.log(`[ActionQueue] Discarded empty typing entry ${actionId}`);
        return;
      }

      // Guard: typed text should never contain \n (handled by ContentBox/DictationPanel)
      if (entry.typedText.includes('\n')) {
        console.error(`[resolveTypingEntry] typedText contains \\n — this should have been intercepted by the input handler. Text: "${entry.typedText}"`);
      }

      // Create a raw segment for the typed text
      const newSegment = {
        segmentId: generateId('seg'),
        textareaTarget: entry.targetId,
        startOffset: entry.insertStart,
        endOffset: entry.insertEnd,
        length: entry.typedText.length,
        text: entry.typedText,
        status: 'raw',
        sourceActionId: entry.actionId,
      };

      set((s) => {
        const targetSegs = s.segments[entry.targetId] || [];
        // Insert the new segment at the correct sorted position
        const newSegs = [...targetSegs, newSegment].sort(
          (a, b) => a.startOffset - b.startOffset
        );

        return {
          actionQueue: s.actionQueue.map((e) =>
            e.actionId === actionId ? { ...e, status: 'resolved' } : e
          ),
          segments: { ...s.segments, [entry.targetId]: newSegs },
        };
      });

      console.log(`[ActionQueue] Resolved typing entry ${actionId}: created raw segment "${entry.typedText}" at [${entry.insertStart},${entry.insertEnd}]`);
    },

    /**
     * Discard a typing entry (all typed text was backspaced away).
     *
     * @param {string} actionId - The typing entry ID
     */
    discardTypingEntry: (actionId) => {
      set((s) => ({
        actionQueue: s.actionQueue.map((e) =>
          e.actionId === actionId && e.actionType === 'type'
            ? { ...e, status: 'discarded' }
            : e
        ),
      }));
      console.log(`[ActionQueue] Discarded typing entry ${actionId}`);
    },

    // =================================================================
    // MANUAL DELETION ENTRY OPERATIONS (Phase 3)
    // =================================================================

    /**
     * Create a deletion entry with immediate segment surgery.
     *
     * For one-shot highlight deletions, set immediateResolve=true to
     * resolve the entry immediately after surgery.
     *
     * @param {{ targetId: string, deletionStart: number, deletionEnd: number, deletedText: string, immediateResolve?: boolean }} params
     * @returns {object|null} The created entry
     */
    enqueueDeleteEntry: ({ targetId, deletionStart, deletionEnd, deletedText, immediateResolve = false, _isRedo = false }) => {
      const state = get();
      const currentSegs = state.segments[targetId] || [];
      const fullText = targetId === 'dictation-box'
        ? state.dictationText
        : (state.contentBoxStates[targetId]?.currentText || '');

      // Snapshot affected segments BEFORE surgery
      const affectedSegmentSnapshots = currentSegs
        .filter((seg) =>
          // Segments that overlap the deletion range (cases 3-6)
          !(seg.endOffset <= deletionStart || seg.startOffset >= deletionEnd)
        )
        .map((seg) => ({
          ...seg,
          _action: null, // Will be populated by inspection of the result
        }));

      // Apply 6-case segment surgery
      let { updatedSegments, removedSegments, rollbackIds } = applySegmentDeletion(
        currentSegs, deletionStart, deletionEnd, fullText
      );

      // Update affected segment snapshots with actions
      const removedIds = new Set(removedSegments.map((s) => s.segmentId));
      for (const snap of affectedSegmentSnapshots) {
        if (removedIds.has(snap.segmentId)) {
          snap._action = 'removed';
        } else {
          snap._action = 'trimmed';
        }
      }

      // Apply the deletion to textarea text
      let newText = fullText.slice(0, deletionStart) + fullText.slice(deletionEnd);

      // Clean up orphaned whitespace gaps left by removed segments.
      // When segment surgery removes a whitespace-only remnant, that whitespace
      // text may still exist in the textarea (outside the user's selection range).
      // This step detects and removes those orphaned gaps for contiguous coverage.
      const cleanup = cleanupOrphanedGaps(updatedSegments, newText);
      let adjustedCaretPos = deletionStart;
      let adjustedDeletionStart = deletionStart;
      if (cleanup.totalRemoved > 0) {
        updatedSegments = cleanup.segments;
        newText = cleanup.fullText;
        const shiftBack = cleanup.removedBefore(deletionStart);
        adjustedCaretPos = deletionStart - shiftBack;
        adjustedDeletionStart = deletionStart - shiftBack;
        console.log(`[enqueueDeleteEntry] Cleaned ${cleanup.totalRemoved} orphaned whitespace char(s), caret ${deletionStart}→${adjustedCaretPos}`);
      }

      const entry = {
        actionId: generateId('aq'),
        actionType: 'delete',
        status: immediateResolve ? 'resolved' : 'active',
        targetId,
        timestamp: Date.now(),
        deletionStart: adjustedDeletionStart,
        deletionEnd,
        deletedText,
        affectedSegmentSnapshots,
        caretPosition: adjustedCaretPos,
        // Pre-deletion snapshot for undo: capture the full segment array and
        // text BEFORE surgery. For accumulated deletions, this captures the
        // state at the first keystroke so the final resolve can pass it to
        // the action log for snapshot-based undo restoration.
        _preDeleteSegments: currentSegs.map(s => ({ ...s })),
        _preDeleteText: fullText,
      };

      set((s) => {
        const stateUpdate = {
          actionQueue: [...s.actionQueue, entry],
          segments: { ...s.segments, [targetId]: updatedSegments },
        };

        // Update the correct textarea text
        if (targetId === 'dictation-box') {
          stateUpdate.dictationText = newText;
        } else {
          stateUpdate.contentBoxStates = {
            ...s.contentBoxStates,
            [targetId]: {
              ...(s.contentBoxStates[targetId] || {}),
              currentText: newText,
            },
          };
        }

        return stateUpdate;
      });

      // Trigger rollbacks for structured segments
      for (const segId of rollbackIds) {
        get().rollbackWithCoParticipantReplay(segId);
      }

      // Notify that content was deleted with rollback — sets the dirty flag
      // in pass1Service so impression regeneration fires when appropriate.
      if (rollbackIds.length > 0) {
        notifyContentDeletion();
      }

      // Ensure caret tracker has the correct position after orphan cleanup.
      // queueMicrotask ensures this runs AFTER DictationPanel's trackCaret()
      // call (which would otherwise overwrite with the stale textarea position).
      if (cleanup.totalRemoved > 0) {
        queueMicrotask(() => updateCaretPosition(targetId, adjustedCaretPos));
      }

      console.log(`[ActionQueue] Created ${immediateResolve ? 'resolved' : 'active'} delete entry ${entry.actionId}: deleted "${deletedText}" at [${deletionStart},${deletionEnd}], ${removedSegments.length} segments removed, ${rollbackIds.length} rollbacks${cleanup.totalRemoved > 0 ? `, ${cleanup.totalRemoved} orphan char(s) cleaned` : ''}`);

      // Action Log: one-shot deletion (highlight-delete, voice command delete, etc.)
      // Skip if this is a redo operation (already tracked in the action log).
      if (immediateResolve && !_isRedo) {
        get().addActionLogEntry({
          type: 'deletion',
          targetId,
          deletedText,
          deletionStart: adjustedDeletionStart,
          deletionEnd,
          affectedSegmentIds: affectedSegmentSnapshots.map(s => s.segmentId),
          // Snapshot the FULL segment array and text BEFORE the deletion.
          // Used by undoDeletionEntry to restore exact pre-deletion state,
          // preserving segment boundaries so Pass 2 sees coherent segments.
          preDeleteSegments: currentSegs.map(s => ({ ...s })),
          preDeleteText: fullText,
          cursorBefore: deletionEnd,
          cursorAfter: adjustedCaretPos,
        });
      }

      return entry;
    },

    /**
     * Update an active deletion entry with an additional deleted character.
     *
     * Called per-keystroke during accumulated backspace. Performs immediate
     * segment surgery on each keystroke.
     *
     * @param {string} actionId - The deletion entry ID
     * @param {string} deletedChar - The character being deleted
     * @param {boolean} isBackspace - true for backspace (left), false for delete key (right)
     */
    updateDeleteEntry: (actionId, deletedChar, isBackspace) => {
      const state = get();
      const entry = state.actionQueue.find((e) => e.actionId === actionId);
      if (!entry || entry.status !== 'active') return;

      const targetId = entry.targetId;
      const fullText = targetId === 'dictation-box'
        ? state.dictationText
        : (state.contentBoxStates[targetId]?.currentText || '');

      // Determine deletion position
      const delPos = isBackspace ? entry.deletionStart - 1 : entry.deletionStart;
      if (delPos < 0 || delPos >= fullText.length) return;

      const actualDeletedChar = fullText[delPos];

      // Snapshot the segment being affected (if not already tracked)
      const currentSegs = state.segments[targetId] || [];
      const existingSnapshotIds = new Set(
        entry.affectedSegmentSnapshots.map((s) => s.segmentId)
      );

      const affectedSeg = currentSegs.find(
        (seg) => seg.startOffset <= delPos && seg.endOffset > delPos
      );

      let newSnapshots = [...entry.affectedSegmentSnapshots];
      if (affectedSeg && !existingSnapshotIds.has(affectedSeg.segmentId)) {
        newSnapshots.push({ ...affectedSeg, _action: 'trimmed' });
      }

      // Apply single-character deletion surgery
      let { updatedSegments, removedSegments, rollbackIds } = applySegmentDeletion(
        currentSegs, delPos, delPos + 1, fullText
      );

      // Update snapshots for removed segments
      const removedIds = new Set(removedSegments.map((s) => s.segmentId));
      newSnapshots = newSnapshots.map((snap) =>
        removedIds.has(snap.segmentId) ? { ...snap, _action: 'removed' } : snap
      );

      // Update the textarea text
      let newText = fullText.slice(0, delPos) + fullText.slice(delPos + 1);

      // Clean up orphaned whitespace gaps left by removed segments
      const cleanup = cleanupOrphanedGaps(updatedSegments, newText);
      let extraCaretShift = 0;
      if (cleanup.totalRemoved > 0) {
        updatedSegments = cleanup.segments;
        newText = cleanup.fullText;
        extraCaretShift = cleanup.removedBefore(delPos);
        console.log(`[updateDeleteEntry] Cleaned ${cleanup.totalRemoved} orphaned whitespace char(s)`);
      }

      set((s) => {
        const stateUpdate = {
          actionQueue: s.actionQueue.map((e) => {
            if (e.actionId !== actionId) return e;
            return {
              ...e,
              deletionStart: (isBackspace ? e.deletionStart - 1 : e.deletionStart) - extraCaretShift,
              deletedText: isBackspace
                ? actualDeletedChar + e.deletedText
                : e.deletedText + actualDeletedChar,
              affectedSegmentSnapshots: newSnapshots,
              caretPosition: (isBackspace ? e.caretPosition - 1 : e.caretPosition) - extraCaretShift,
            };
          }),
          segments: { ...s.segments, [targetId]: updatedSegments },
        };

        if (targetId === 'dictation-box') {
          stateUpdate.dictationText = newText;
        } else {
          stateUpdate.contentBoxStates = {
            ...s.contentBoxStates,
            [targetId]: {
              ...(s.contentBoxStates[targetId] || {}),
              currentText: newText,
            },
          };
        }

        return stateUpdate;
      });

      // Trigger rollbacks for structured segments
      for (const segId of rollbackIds) {
        get().rollbackWithCoParticipantReplay(segId);
      }

      if (rollbackIds.length > 0) {
        notifyContentDeletion();
      }
    },

    /**
     * Resolve a deletion entry. All segment surgery was already done
     * per-keystroke — this just marks the entry as resolved for history.
     *
     * @param {string} actionId - The deletion entry ID
     */
    resolveDeleteEntry: (actionId) => {
      // Read the entry data BEFORE marking resolved (for action log)
      const entryData = get().actionQueue.find(
        (e) => e.actionId === actionId && e.actionType === 'delete'
      );

      set((s) => ({
        actionQueue: s.actionQueue.map((e) =>
          e.actionId === actionId && e.actionType === 'delete'
            ? { ...e, status: 'resolved' }
            : e
        ),
      }));
      console.log(`[ActionQueue] Resolved delete entry ${actionId}`);

      // Action Log: accumulated deletion (backspace sequence)
      if (entryData && entryData.deletedText) {
        get().addActionLogEntry({
          type: 'deletion',
          targetId: entryData.targetId,
          deletedText: entryData.deletedText,
          deletionStart: entryData.deletionStart,
          deletionEnd: entryData.deletionEnd,
          affectedSegmentIds: (entryData.affectedSegmentSnapshots || []).map(s => s.segmentId),
          // Pass snapshot from first keystroke for snapshot-based undo
          preDeleteSegments: entryData._preDeleteSegments || [],
          preDeleteText: entryData._preDeleteText || '',
          cursorBefore: entryData.deletionStart + entryData.deletedText.length,
          cursorAfter: entryData.caretPosition,
        });
      }
    },

    //
    // Update the status of given segments to 'sanitized' without
    // modifying the textarea text. Used when Pass 1 output matches
    // the input (no-change optimization).
    // -----------------------------------------------------------------
    markSegmentsSanitized: (targetId, segmentIds) => {
      set((s) => {
        const segs = s.segments[targetId] || [];
        const idSet = new Set(segmentIds);
        const updated = segs.map((seg) =>
          idSet.has(seg.segmentId) ? { ...seg, status: 'sanitized' } : seg
        );
        return {
          segments: { ...s.segments, [targetId]: updated },
        };
      });
    },

    // -----------------------------------------------------------------
    // Phase 5: markSegmentsStructured
    //
    // Update the status of given segments to 'structured'.
    // Called after Pass 2 successfully processes and places them into the report.
    // -----------------------------------------------------------------
    markSegmentsStructured: (targetId, segmentIds) => {
      set((s) => {
        const segs = s.segments[targetId] || [];
        const idSet = new Set(segmentIds);
        const updated = segs.map((seg) =>
          idSet.has(seg.segmentId) ? { ...seg, status: 'structured' } : seg
        );
        return {
          segments: { ...s.segments, [targetId]: updated },
        };
      });
    },

    // -----------------------------------------------------------------
    // Phase 5: markSegmentsNA
    //
    // Set naFlagged=true on given segments (already structured).
    // Drives the yellow highlight overlay in DictationPanel to indicate
    // segments that Pass 2 judged as meaningless and did not insert.
    // The flag is implicitly cleared when the segment's status changes
    // from 'structured' (e.g., structured→dirty on edit, or segment
    // replaced by Pass 1 merge), because the highlight is derived from
    // status === 'structured' && naFlagged === true.
    // -----------------------------------------------------------------
    markSegmentsNA: (targetId, segmentIds) => {
      set((s) => {
        const segs = s.segments[targetId] || [];
        const idSet = new Set(segmentIds);
        const updated = segs.map((seg) =>
          idSet.has(seg.segmentId) ? { ...seg, naFlagged: true } : seg
        );
        return {
          segments: { ...s.segments, [targetId]: updated },
        };
      });
    },

    // -----------------------------------------------------------------
    // Phase 5: markSegmentsDirty
    //
    // Mark segments as 'dirty' (user edited them).
    // Used when manual typing changes text under existing segments.
    // -----------------------------------------------------------------
    markSegmentsDirty: (targetId, segmentIds) => {
      set((s) => {
        const segs = s.segments[targetId] || [];
        const idSet = new Set(segmentIds);
        const updated = segs.map((seg) =>
          idSet.has(seg.segmentId) ? { ...seg, status: 'dirty' } : seg
        );
        return {
          segments: { ...s.segments, [targetId]: updated },
        };
      });
    },

    // -----------------------------------------------------------------
    // Phase 5: applyManualEdit
    //
    // @deprecated — Replaced by enqueueTypingEntry/enqueueDeleteEntry.
    // Retained temporarily as reference during transition.
    // All callers (DictationPanel, ContentBox) now use the new entry-based
    // pipeline. This function should be removed once transition is verified.
    //
    // Original purpose: Atomically handle a manual text edit (typing/delete/paste) in
    // the dictation box. Diffs old vs new text to find the edit
    // position, then:
    //   1. Shifts all downstream segment offsets by the delta
    //   2. Adjusts overlapping segments' endOffset
    //   3. Marks dirty any segments whose stored text no longer matches
    //   4. Triggers rollback for structured segments going dirty
    //   5. Updates dictationText
    // -----------------------------------------------------------------
    applyManualEdit: (targetId, newText) => {
      console.warn('[ActionQueue] applyManualEdit is DEPRECATED. Use enqueueTypingEntry/enqueueDeleteEntry instead.');
      // Schedule rollbacks outside the set() call
      const rollbackIds = [];

      set((s) => {
        const oldText = targetId === 'dictation-box'
          ? s.dictationText
          : (s.contentBoxStates[targetId]?.currentText || '');

        if (oldText === newText) return s;

        const delta = newText.length - oldText.length;

        // --- Find the edit boundaries by diffing old vs new ---
        // Scan from front: first difference
        let editStart = 0;
        const minLen = Math.min(oldText.length, newText.length);
        while (editStart < minLen && oldText[editStart] === newText[editStart]) {
          editStart++;
        }

        // Scan from back: last difference (in old coordinates)
        // editEndOld: end of the changed region in old text
        // editEndNew: end of the changed region in new text
        let editEndOld = oldText.length;
        let editEndNew = newText.length;
        while (
          editEndOld > editStart &&
          editEndNew > editStart &&
          oldText[editEndOld - 1] === newText[editEndNew - 1]
        ) {
          editEndOld--;
          editEndNew--;
        }

        // Now: old[editStart..editEndOld] was replaced by new[editStart..editEndNew]
        // delta = editEndNew - editEndOld (same as newText.length - oldText.length)

        // --- Adjust segment offsets ---
        const oldSegs = s.segments[targetId] || [];
        const updatedSegs = oldSegs.map((seg) => {
          // Segment entirely before the edit → unchanged
          if (seg.endOffset <= editStart) {
            return seg;
          }

          // Segment entirely after the edit → shift by delta
          if (seg.startOffset >= editEndOld) {
            return {
              ...seg,
              startOffset: seg.startOffset + delta,
              endOffset: seg.endOffset + delta,
            };
          }

          // Segment overlaps the edit region → adjust endOffset by delta
          // and update the stored text to match the new textarea content.
          const newStart = seg.startOffset; // start doesn't move (it's before or at editStart)
          const newEnd = seg.endOffset + delta;
          const newSegText = newText.slice(newStart, newEnd);

          // Determine new status
          let newStatus = seg.status;
          if (seg.status === 'sanitized' || seg.status === 'structured') {
            if (newSegText !== seg.text) {
              // Text changed → mark dirty
              if (seg.status === 'structured') {
                rollbackIds.push(seg.segmentId);
              }
              newStatus = 'dirty';
            }
          }

          return {
            ...seg,
            endOffset: newEnd,
            length: newEnd - newStart,
            text: newSegText,
            status: newStatus,
          };
        });

        // --- Update text ---
        let newDictationText = s.dictationText;
        let newContentBoxStates = s.contentBoxStates;

        if (targetId === 'dictation-box') {
          newDictationText = newText;
        } else {
          const box = s.contentBoxStates[targetId];
          if (box) {
            newContentBoxStates = {
              ...s.contentBoxStates,
              [targetId]: {
                ...box,
                currentText: newText,
                version: box.version + 1,
                manuallyEdited: true,
              },
            };
          }
        }

        // --- Diagnostic logging ---
        console.log('[applyManualEdit] edit:', { editStart, editEndOld, editEndNew, delta });
        for (const seg of updatedSegs) {
          console.log(`  seg[${seg.segmentId}] ${seg.status} [${seg.startOffset},${seg.endOffset}] "${seg.text.slice(0, 40)}${seg.text.length > 40 ? '…' : ''}"`);
        }

        return {
          dictationText: newDictationText,
          contentBoxStates: newContentBoxStates,
          segments: {
            ...s.segments,
            [targetId]: updatedSegs,
          },
        };
      });

      // Trigger rollbacks for structured segments that became dirty
      if (rollbackIds.length > 0) {
        const store = get();
        for (const segId of rollbackIds) {
          store.rollbackWithCoParticipantReplay(segId);
        }
        notifyContentDeletion();
      }
    },

    // -----------------------------------------------------------------
    // Phase 4: replaceSegmentsWithSanitized
    //
    // Replace raw/dirty segments with new sanitized segments from Pass 1.
    // Updates textarea text content atomically and recomputes downstream
    // segment offsets based on the net length delta.
    //
    // @param {string} targetId - Textarea ID ('dictation-box' or contentBoxId)
    // @param {string[]} oldSegmentIds - IDs of raw segments being replaced
    // @param {Array} newSanitizedSegments - [{text, segmentId}] from Pass 1
    // @param {string} newFullText - The recomposed full text for the textarea
    // -----------------------------------------------------------------
    replaceSegmentsWithSanitized: (targetId, oldSegmentIds, newSanitizedSegments, newFullText) => {
      set((s) => {
        const oldSegs = s.segments[targetId] || [];
        const oldIdSet = new Set(oldSegmentIds);

        // Compute the range of the old segments being replaced
        const replacedSegs = oldSegs.filter((seg) => oldIdSet.has(seg.segmentId));
        if (replacedSegs.length === 0) return s;

        const oldStart = Math.min(...replacedSegs.map((seg) => seg.startOffset));
        const oldEnd = Math.max(...replacedSegs.map((seg) => seg.endOffset));

        // Delta = difference in total text length (drives downstream offset shifts)
        const currentText = targetId === 'dictation-box'
          ? s.dictationText
          : (s.contentBoxStates[targetId]?.currentText || '');
        const delta = newFullText.length - currentText.length;

        // Build new segment entries with correct offsets.
        // Segments include any leading space in their text, so offsets
        // are contiguous — no gaps between segments.
        let offset = oldStart;
        const builtSegments = newSanitizedSegments.map((seg) => {
          const newSeg = {
            segmentId: seg.segmentId || generateId('seg'),
            textareaTarget: targetId,
            startOffset: offset,
            endOffset: offset + seg.text.length,
            length: seg.text.length,
            text: seg.text,
            status: seg.status || 'sanitized',
            sourceActionId: seg.sourceActionId || null,
          };
          offset += seg.text.length;
          return newSeg;
        });

        // Guard: sanitized segment text should not contain \n
        for (const seg of builtSegments) {
          if (seg.text.includes('\n')) {
            console.error(`[replaceSegmentsWithSanitized] Sanitized segment contains \\n — this may corrupt structural newline tracking. Text: "${seg.text.slice(0, 50)}"`);
          }
        }

        // Keep non-replaced segments, shifting those after the replaced range
        const keptSegments = oldSegs
          .filter((seg) => !oldIdSet.has(seg.segmentId))
          .map((seg) => {
            if (seg.startOffset >= oldEnd) {
              return {
                ...seg,
                startOffset: seg.startOffset + delta,
                endOffset: seg.endOffset + delta,
              };
            }
            return seg;
          });

        const allSegments = [...keptSegments, ...builtSegments].sort(
          (a, b) => a.startOffset - b.startOffset
        );

        // --- Diagnostic logging for segment offset debugging ---
        console.log('[replaceSegmentsWithSanitized]', {
          targetId,
          oldSpan: `[${oldStart},${oldEnd}]`,
          replacedCount: replacedSegs.length,
          newCount: builtSegments.length,
          delta,
          textLenBefore: currentText.length,
          textLenAfter: newFullText.length,
        });
        for (const seg of allSegments) {
          const marker = oldIdSet.has(seg.segmentId) ? '(OLD) ' : '';
          console.log(`  ${marker}seg[${seg.segmentId}] ${seg.status} [${seg.startOffset},${seg.endOffset}] "${seg.text.slice(0, 50)}${seg.text.length > 50 ? '…' : ''}"`);
        }

        // Update textarea text
        let newDictationText = s.dictationText;
        let newContentBoxStates = s.contentBoxStates;

        if (targetId === 'dictation-box') {
          newDictationText = newFullText;
        } else {
          const box = s.contentBoxStates[targetId];
          if (box) {
            newContentBoxStates = {
              ...s.contentBoxStates,
              [targetId]: {
                ...box,
                currentText: newFullText,
                version: box.version + 1,
              },
            };
          }
        }

        // Update caret position to reflect text length changes.
        // When manually editing, preserve the user's caret position
        // instead of jumping to the end of the replaced span.
        const caretPos = getCaretPosition(targetId);
        if (caretPos !== null && caretPos !== undefined) {
          if (caretPos >= oldEnd) {
            // Caret was past the replaced span — shift by delta
            updateCaretPosition(targetId, caretPos + delta);
          } else if (caretPos > oldStart) {
            // Caret was inside the replaced span — preserve position,
            // clamped to the new span end (in case text got shorter)
            const newSpanEnd = builtSegments.length > 0
              ? builtSegments[builtSegments.length - 1].endOffset
              : oldStart;
            updateCaretPosition(targetId, Math.min(caretPos, newSpanEnd));
          }
          // If caretPos <= oldStart, caret is before the span — unchanged
        }

        // --- Adjust pending action queue entry positions ---
        // When text length changes during sanitization, pending/awaiting_final
        // entries that reference the same textarea may have stale caretPositions.
        // Shift them by delta so subsequent incrementalInserts write to the
        // correct location.
        const adjustedQueue = delta !== 0
          ? s.actionQueue.map((e) => {
              if (
                e.targetId === targetId &&
                (e.status === 'pending' || e.status === 'awaiting_final') &&
                e.caretPosition >= oldEnd
              ) {
                console.log(`[replaceSegmentsWithSanitized] Adjusting entry ${e.actionId} caretPosition by ${delta}: ${e.caretPosition} → ${e.caretPosition + delta}`);
                return {
                  ...e,
                  caretPosition: e.caretPosition + delta,
                  selectionRange: e.selectionRange
                    ? {
                        start: e.selectionRange.start + delta,
                        end: e.selectionRange.end + delta,
                      }
                    : null,
                };
              }
              return e;
            })
          : s.actionQueue;

        return {
          actionQueue: adjustedQueue,
          dictationText: newDictationText,
          contentBoxStates: newContentBoxStates,
          segments: {
            ...s.segments,
            [targetId]: allSegments,
          },
        };
      });
    },

    // -----------------------------------------------------------------
    // clearActionQueue — used by session reset
    // -----------------------------------------------------------------
    clearActionQueue: () => {
      set({
        actionQueue: [],
        segments: { 'dictation-box': [] },
        typingLocked: false,
      });
    },
  };
}
