/**
 * Action Log Slice — Undo/Redo System & QA Traceability
 *
 * Zustand slice managing the Action Log (unlimited QA record),
 * undo stack (capped at MAX_UNDO), and redo stack.
 *
 * Stack model:
 *   New action  → push undoStack (cap 50), clear redoStack, append actionLog
 *   Undo        → pop undoStack, execute undo, push redoStack
 *   Redo        → pop redoStack, execute redo, push undoStack
 *
 * Entry types:
 *   'pass1'     — LLM Pass 1 result (text-changed, Ok-consolidation,
 *                 deterministic merge, null-response removal, all-echo removal)
 *   'deletion'  — User deletion (backspace, highlight-delete, voice command)
 *
 * Undo strategy (erasure):
 *   Pass 1 → remove output segments + text, restore absorbed context segments
 *   Deletion → restore pre-deletion snapshot; selectively downgrade only
 *              affected segments from 'structured' → 'sanitized' for Pass 2
 *
 * Downstream debounce triggering:
 *   Pass 1 undo  → startPass2Debounce() + startImpressionDebounce()
 *   Deletion undo → startPass2Debounce() + startImpressionDebounce()
 *                   (Pass 2 re-processes sanitized segments → triggers impression)
 *
 * This avoids circular imports between the slice and pipeline services.
 *
 * @module actionLogSlice
 */

import { updateCaretPosition } from '../services/caretTracker';

const MAX_UNDO = 50;

function generateId(prefix = 'ulog') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ===================================================================
// UNDO EXECUTION HELPERS
// ===================================================================

/**
 * Undo a Pass 1 entry.
 *
 * Strategy (erasure):
 *   1. Find output segments by ID in the current segment array
 *   2. Rollback any structured ones (Pass 2 findings removal)
 *   3. Remove output segments and their text from the textarea
 *   4. Restore absorbed context segments (preceding/following) as sanitized
 *   5. Shift downstream segment offsets by the net delta
 *   6. Record anchoring metadata on the entry for future redo
 *
 * @param {object} entry - The action log entry
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {{ success: boolean, reason?: string }}
 */
function undoPass1Entry(entry, set, get) {
  const { targetId, outputSegmentIds, absorbedContext, cursorBefore } = entry;

  if (!outputSegmentIds || outputSegmentIds.length === 0) {
    return { success: false, reason: 'No output segment IDs recorded' };
  }

  const store = get();
  const segs = store.segments[targetId] || [];
  const outputIdSet = new Set(outputSegmentIds);

  // Find the output segments in the current segment array
  const outputSegs = segs.filter((seg) => outputIdSet.has(seg.segmentId));
  if (outputSegs.length === 0) {
    return {
      success: false,
      reason: `Output segments not found in ${targetId} — state may have diverged`,
    };
  }

  // Calculate the span occupied by the output segments
  const spanStart = Math.min(...outputSegs.map((s) => s.startOffset));
  const spanEnd = Math.max(...outputSegs.map((s) => s.endOffset));

  // --- Step 1: Rollback structured segments BEFORE removing them ---
  // rollbackWithCoParticipantReplay triggers its own set() calls, which is
  // safe because our subsequent set() reads the latest state.
  for (const seg of outputSegs) {
    if (seg.status === 'structured') {
      console.log(`[ActionLog Undo] Rolling back structured segment ${seg.segmentId}`);
      get().rollbackWithCoParticipantReplay(seg.segmentId);
    }
  }

  // --- Step 2: Build restored context segments ---
  const allAbsorbed = [
    ...(absorbedContext?.preceding || []),
    ...(absorbedContext?.following || []),
  ];

  const restoredSegs = [];
  let ofs = spanStart;
  for (const ctx of allAbsorbed) {
    restoredSegs.push({
      segmentId: generateId('seg'),
      textareaTarget: targetId,
      startOffset: ofs,
      endOffset: ofs + ctx.text.length,
      length: ctx.text.length,
      text: ctx.text,
      status: 'sanitized', // Restore as sanitized to prevent Pass 1 re-fire
      sourceActionId: null,
    });
    ofs += ctx.text.length;
  }

  const contextText = allAbsorbed.map((c) => c.text).join('');
  const delta = contextText.length - (spanEnd - spanStart);

  // --- Step 3: Atomic state update (remove output, add context, shift offsets) ---
  set((s) => {
    const currentSegs = s.segments[targetId] || [];

    // Remove output segments
    const filteredSegs = currentSegs.filter(
      (seg) => !outputIdSet.has(seg.segmentId)
    );

    // Shift downstream segments by the net delta
    const shiftedSegs = filteredSegs.map((seg) => {
      if (seg.startOffset >= spanEnd) {
        return {
          ...seg,
          startOffset: seg.startOffset + delta,
          endOffset: seg.endOffset + delta,
        };
      }
      return seg;
    });

    const newSegs = [...shiftedSegs, ...restoredSegs].sort(
      (a, b) => a.startOffset - b.startOffset
    );

    // Splice text: remove output text, insert context text
    const currentText =
      targetId === 'dictation-box'
        ? s.dictationText
        : s.contentBoxStates[targetId]?.currentText || '';
    const newText =
      currentText.slice(0, spanStart) + contextText + currentText.slice(spanEnd);

    const stateUpdate = {
      segments: { ...s.segments, [targetId]: newSegs },
      activeTextareaId: targetId,
      caretVersion: s.caretVersion + 1,
    };

    if (targetId === 'dictation-box') {
      stateUpdate.dictationText = newText;
    } else {
      const box = s.contentBoxStates[targetId];
      if (box) {
        // Check if content box reverted to original text → clear manuallyEdited
        const shouldClearManualEdit = box.manuallyEdited && newText === box.originalText;
        stateUpdate.contentBoxStates = {
          ...s.contentBoxStates,
          [targetId]: {
            ...box,
            currentText: newText,
            manuallyEdited: shouldClearManualEdit ? false : box.manuallyEdited,
          },
        };
      }
    }

    return stateUpdate;
  });

  // --- Step 4: Compute redo anchoring metadata ---
  // Read the POST-undo segment array to find adjacent segments for anchoring
  const postUndoSegs = get().segments[targetId] || [];
  const sortedPostUndo = [...postUndoSegs].sort(
    (a, b) => a.startOffset - b.startOffset
  );
  const precedingAnchor = sortedPostUndo
    .filter((s) => s.endOffset <= spanStart)
    .pop();
  const effectiveUndoEnd = spanStart + contextText.length;
  const followingAnchor = sortedPostUndo.find(
    (s) => s.startOffset >= effectiveUndoEnd
  );

  entry._undoMeta = {
    undoPosition: spanStart,
    restoredContextSegmentIds: restoredSegs.map((s) => s.segmentId),
    precedingAnchorSegId: precedingAnchor?.segmentId || null,
    followingAnchorSegId: followingAnchor?.segmentId || null,
  };

  // --- Step 5: Update caret position ---
  updateCaretPosition(targetId, cursorBefore ?? spanStart);

  console.log(`[ActionLog Undo] Pass 1 entry ${entry.logId}: removed ${outputSegs.length} output segment(s), restored ${restoredSegs.length} context segment(s), delta=${delta}`);
  return { success: true };
}

/**
 * Undo a deletion entry: restore the pre-deletion state.
 *
 * Snapshot approach (preferred): restores the exact pre-deletion text and
 * segment array. Only segments that were actually affected by the deletion
 * are downgraded from 'structured' → 'sanitized' for Pass 2 replay.
 * Unaffected segments (still 'structured' in the current state with their
 * findings intact) are kept as-is to prevent duplicate finding insertion.
 *
 * Affected segments are identified by comparing pre-deletion snapshot IDs
 * against the current segment state — segments missing or already marked
 * 'sanitized' (by co-participant replay) had their findings rolled back 
 * and need Pass 2 re-processing.
 *
 * Fallback (for entries without snapshot): inserts text at the original
 * position as a 'sanitized' segment.
 *
 * In both cases, the caller triggers startPass2Debounce() +
 * startImpressionDebounce() so the pipeline re-processes.
 *
 * @param {object} entry - The action log entry
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {{ success: boolean, reason?: string }}
 */
function undoDeletionEntry(entry, set, get) {
  const { targetId, deletedText, deletionStart, cursorBefore,
          preDeleteSegments, preDeleteText } = entry;

  if (!deletedText || deletedText.length === 0) {
    return { success: false, reason: 'No deleted text to restore' };
  }

  // --- Snapshot approach: restore the exact pre-deletion state ---
  // This preserves segment boundaries so Pass 2 sees coherent segments
  // instead of fragmented orphans. It also prevents Pass 1 from needing
  // to re-run on the restored text.
  if (preDeleteSegments && preDeleteSegments.length > 0 && preDeleteText) {
    // Compute redo anchoring BEFORE restoring
    const preInsertSegs = get().segments[targetId] || [];
    const sortedPre = [...preInsertSegs].sort((a, b) => a.startOffset - b.startOffset);
    const precedingAnchor = sortedPre.filter(s => s.endOffset <= deletionStart).pop();
    const followingAnchor = sortedPre.find(s => s.startOffset >= deletionStart);

    // Restore the full text and segment array from the snapshot.
    // CRITICAL: Only downgrade segments that were actually affected by the
    // deletion. Segments that survived intact (still 'structured' in the
    // current state with their findings in the report) must NOT be
    // downgraded, or Pass 2 will re-insert duplicate findings.
    //
    // Strategy: compare pre-deletion snapshot against current segment state.
    // - Segments still present and 'structured' in current state → keep status
    // - Segments missing from current state (removed by deletion) → 'sanitized'
    // - Segments that were 'sanitized' in current state (co-participant replay
    //   already rolled back their findings) → 'sanitized'
    const currentSegs = get().segments[targetId] || [];
    const currentSegMap = new Map(
      currentSegs.map(s => [s.segmentId, s])
    );

    set((s) => {
      const restoredSegs = preDeleteSegments.map(seg => {
        const currentSeg = currentSegMap.get(seg.segmentId);
        if (currentSeg && currentSeg.status === 'structured') {
          // This segment survived the deletion with its findings intact.
          // Keep it as 'structured' — its finding content box is still
          // in the report and doesn't need to be re-created.
          return { ...seg };
        }
        // Segment was removed/trimmed by the deletion, or was already
        // re-marked as 'sanitized' by co-participant replay. Its findings
        // were rolled back, so it must re-enter the Pass 2 pipeline.
        return {
          ...seg,
          status: seg.status === 'structured' ? 'sanitized' : seg.status,
        };
      });
      const update = {
        segments: { ...s.segments, [targetId]: restoredSegs },
      };
      if (targetId === 'dictation-box') {
        update.dictationText = preDeleteText;
      } else {
        update.contentBoxStates = {
          ...s.contentBoxStates,
          [targetId]: {
            ...(s.contentBoxStates[targetId] || {}),
            currentText: preDeleteText,
            version: (s.contentBoxStates[targetId]?.version || 0) + 1,
          },
        };
      }
      return update;
    });

    // Store redo anchoring metadata
    entry._undoMeta = {
      reinsertPosition: deletionStart,
      reinsertLength: deletedText.length,
      precedingAnchorSegId: precedingAnchor?.segmentId || null,
      followingAnchorSegId: followingAnchor?.segmentId || null,
    };

    // Update focus and cursor
    const restorePos = cursorBefore ?? (deletionStart + deletedText.length);
    updateCaretPosition(targetId, restorePos);
    set((s) => ({
      activeTextareaId: targetId,
      caretVersion: s.caretVersion + 1,
    }));

    console.log(`[ActionLog Undo] Deletion entry ${entry.logId}: restored pre-deletion snapshot (${preDeleteSegments.length} segments, ${preDeleteText.length} chars)`);
    return { success: true };
  }

  // --- Fallback: insertTextAtPosition (for entries without snapshot) ---
  const store = get();
  const currentText =
    targetId === 'dictation-box'
      ? store.dictationText
      : store.contentBoxStates[targetId]?.currentText || '';

  if (deletionStart > currentText.length) {
    return {
      success: false,
      reason: `Insertion position ${deletionStart} exceeds text length ${currentText.length}`,
    };
  }

  const preInsertSegs = store.segments[targetId] || [];
  const sortedPre = [...preInsertSegs].sort((a, b) => a.startOffset - b.startOffset);
  const precedingAnchor = sortedPre.filter(s => s.endOffset <= deletionStart).pop();
  const followingAnchor = sortedPre.find(s => s.startOffset >= deletionStart);

  get().insertTextAtPosition(targetId, deletionStart, deletedText, 'sanitized');

  entry._undoMeta = {
    reinsertPosition: deletionStart,
    reinsertLength: deletedText.length,
    precedingAnchorSegId: precedingAnchor?.segmentId || null,
    followingAnchorSegId: followingAnchor?.segmentId || null,
  };

  const restorePos = cursorBefore ?? (deletionStart + deletedText.length);
  updateCaretPosition(targetId, restorePos);
  set((s) => ({
    activeTextareaId: targetId,
    caretVersion: s.caretVersion + 1,
  }));

  console.log(`[ActionLog Undo] Deletion entry ${entry.logId}: re-inserted "${deletedText.slice(0, 40)}${deletedText.length > 40 ? '…' : ''}" at position ${deletionStart} (fallback)`);
  return { success: true };
}


// ===================================================================
// REDO EXECUTION HELPERS
// ===================================================================

/**
 * Resolve the correct insertion/deletion position for a redo operation
 * using anchor segment IDs. Falls back to the stored position if anchors
 * can't be found.
 *
 * @param {object} undoMeta - The _undoMeta from the undo execution
 * @param {Array} segs - Current segment array for the target textarea
 * @param {'after_preceding' | 'before_following'} strategy - How to resolve
 * @returns {number} The resolved position
 */
function resolveAnchoredPosition(undoMeta, segs, strategy = 'after_preceding') {
  if (strategy === 'after_preceding' && undoMeta.precedingAnchorSegId) {
    const anchor = segs.find(
      (s) => s.segmentId === undoMeta.precedingAnchorSegId
    );
    if (anchor) return anchor.endOffset;
  }

  if (undoMeta.followingAnchorSegId) {
    const anchor = segs.find(
      (s) => s.segmentId === undoMeta.followingAnchorSegId
    );
    if (anchor) return anchor.startOffset;
  }

  // Fallback to stored position
  return undoMeta.undoPosition ?? undoMeta.reinsertPosition ?? 0;
}

/**
 * Redo a Pass 1 entry: re-insert the output text with sanitized segments.
 *
 * If absorbed context was restored during undo, finds and replaces those
 * context segments. Otherwise, inserts at the anchored position.
 * Updates entry.outputSegmentIds with the new segment IDs for future undos.
 *
 * @param {object} entry - The action log entry
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {{ success: boolean, reason?: string }}
 */
function redoPass1Entry(entry, set, get) {
  const { targetId, outputText, outputSegmentTexts, cursorAfter } = entry;
  const undoMeta = entry._undoMeta;

  if (!undoMeta) {
    return { success: false, reason: 'No undo metadata — cannot redo' };
  }

  if (!outputText && (!outputSegmentTexts || outputSegmentTexts.length === 0)) {
    return { success: false, reason: 'No output text recorded for redo' };
  }

  const store = get();
  const currentSegs = store.segments[targetId] || [];

  // --- Determine the span to replace ---
  let replaceStart;
  let replaceEnd;
  const segsToRemove = [];

  if (
    undoMeta.restoredContextSegmentIds &&
    undoMeta.restoredContextSegmentIds.length > 0
  ) {
    // Find restored context segments
    const contextIdSet = new Set(undoMeta.restoredContextSegmentIds);
    const foundContextSegs = currentSegs.filter((seg) =>
      contextIdSet.has(seg.segmentId)
    );

    if (foundContextSegs.length > 0) {
      replaceStart = Math.min(...foundContextSegs.map((s) => s.startOffset));
      replaceEnd = Math.max(...foundContextSegs.map((s) => s.endOffset));
      segsToRemove.push(...foundContextSegs);
    } else {
      // Context segments not found — use anchored position
      replaceStart = resolveAnchoredPosition(undoMeta, currentSegs);
      replaceEnd = replaceStart; // No text to replace (pure insertion)
    }
  } else {
    // No absorbed context — pure insertion at anchored position
    replaceStart = resolveAnchoredPosition(undoMeta, currentSegs);
    replaceEnd = replaceStart;
  }

  // --- Build new sanitized segments ---
  // Use per-segment texts if available, otherwise single segment from outputText
  const segTexts =
    outputSegmentTexts && outputSegmentTexts.length > 0
      ? outputSegmentTexts
      : [outputText];

  const fullOutputText = segTexts.join('');
  let segOfs = replaceStart;
  const newSegments = segTexts.map((text) => {
    const seg = {
      segmentId: generateId('seg'),
      textareaTarget: targetId,
      startOffset: segOfs,
      endOffset: segOfs + text.length,
      length: text.length,
      text,
      status: 'sanitized',
      sourceActionId: null,
    };
    segOfs += text.length;
    return seg;
  });

  // Update entry's outputSegmentIds for future undos
  entry.outputSegmentIds = newSegments.map((s) => s.segmentId);

  // Net delta = output text length - replaced text length
  const replaceLen = replaceEnd - replaceStart;
  const delta = fullOutputText.length - replaceLen;

  const removeIdSet = new Set(segsToRemove.map((s) => s.segmentId));

  // --- Atomic state update ---
  set((s) => {
    const segs = s.segments[targetId] || [];

    // Remove replaced segments (restored context)
    const filtered = segs.filter((seg) => !removeIdSet.has(seg.segmentId));

    // Shift downstream segments
    const shifted = filtered.map((seg) => {
      if (seg.startOffset >= replaceEnd) {
        return {
          ...seg,
          startOffset: seg.startOffset + delta,
          endOffset: seg.endOffset + delta,
        };
      }
      return seg;
    });

    const allSegs = [...shifted, ...newSegments].sort(
      (a, b) => a.startOffset - b.startOffset
    );

    // Splice text
    const currentText =
      targetId === 'dictation-box'
        ? s.dictationText
        : s.contentBoxStates[targetId]?.currentText || '';
    const newText =
      currentText.slice(0, replaceStart) +
      fullOutputText +
      currentText.slice(replaceEnd);

    const stateUpdate = {
      segments: { ...s.segments, [targetId]: allSegs },
      activeTextareaId: targetId,
      caretVersion: s.caretVersion + 1,
    };

    if (targetId === 'dictation-box') {
      stateUpdate.dictationText = newText;
    } else {
      const box = s.contentBoxStates[targetId];
      if (box) {
        stateUpdate.contentBoxStates = {
          ...s.contentBoxStates,
          [targetId]: { ...box, currentText: newText },
        };
      }
    }

    return stateUpdate;
  });

  updateCaretPosition(
    targetId,
    cursorAfter ?? replaceStart + fullOutputText.length
  );

  console.log(`[ActionLog Redo] Pass 1 entry ${entry.logId}: re-inserted ${newSegments.length} segment(s), ${fullOutputText.length} chars at position ${replaceStart}`);
  return { success: true };
}

/**
 * Redo a deletion entry: re-delete the text that was restored by undo.
 *
 * Uses anchor-based position resolution to find the correct deletion range
 * even after intervening undo/redo operations may have shifted offsets.
 * Delegates to the store's enqueueDeleteEntry for full segment surgery.
 *
 * @param {object} entry - The action log entry
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {{ success: boolean, reason?: string }}
 */
function redoDeletionEntry(entry, set, get) {
  const { targetId, cursorAfter } = entry;
  const undoMeta = entry._undoMeta;

  if (!undoMeta) {
    return { success: false, reason: 'No undo metadata — cannot redo' };
  }

  const store = get();
  const currentSegs = store.segments[targetId] || [];
  const currentText =
    targetId === 'dictation-box'
      ? store.dictationText
      : store.contentBoxStates[targetId]?.currentText || '';

  // Resolve the deletion range using anchors
  const deleteStart = resolveAnchoredPosition(
    undoMeta,
    currentSegs,
    'after_preceding'
  );

  // Determine the deletion end: use following anchor if available
  let deleteEnd;
  if (undoMeta.followingAnchorSegId) {
    const followAnchor = currentSegs.find(
      (s) => s.segmentId === undoMeta.followingAnchorSegId
    );
    if (followAnchor) {
      deleteEnd = followAnchor.startOffset;
    } else {
      deleteEnd = deleteStart + undoMeta.reinsertLength;
    }
  } else {
    deleteEnd = deleteStart + undoMeta.reinsertLength;
  }

  // Clamp to valid range
  const clampedEnd = Math.min(deleteEnd, currentText.length);
  if (deleteStart >= clampedEnd) {
    return {
      success: false,
      reason: `Delete range [${deleteStart}, ${clampedEnd}] is empty or invalid`,
    };
  }

  const textToDelete = currentText.slice(deleteStart, clampedEnd);

  // Delegate to existing deletion machinery for full segment surgery,
  // rollback handling, and orphaned gap cleanup.
  // The _isRedo flag allows Step 4 to skip creating a duplicate action log entry.
  get().enqueueDeleteEntry({
    targetId,
    deletionStart: deleteStart,
    deletionEnd: clampedEnd,
    deletedText: textToDelete,
    immediateResolve: true,
    _isRedo: true,
  });

  // Update focus and cursor
  updateCaretPosition(targetId, cursorAfter ?? deleteStart);
  set((s) => ({
    activeTextareaId: targetId,
    caretVersion: s.caretVersion + 1,
  }));

  console.log(`[ActionLog Redo] Deletion entry ${entry.logId}: re-deleted ${clampedEnd - deleteStart} chars at [${deleteStart}, ${clampedEnd}]`);
  return { success: true };
}


// ===================================================================
// SLICE FACTORY
// ===================================================================

/**
 * Create the Action Log slice for merging into useReportStore.
 *
 * Entry schema (Pass 1):
 * {
 *   logId:              string,     // unique ID (ulog_xxx)
 *   timestamp:          number,     // Date.now()
 *   type:               'pass1',
 *   subtype:            string,     // 'text_changed' | 'ok_consolidation' |
 *                                   // 'deterministic_merge' | 'null_response' | 'all_echo_removed'
 *   targetId:           string,     // 'dictation-box' or contentBoxId
 *   inputText:          string,     // raw text that was sent to Pass 1
 *   outputText:         string,     // combined text of output segments
 *   outputSegmentTexts: string[],   // per-segment text array (for sentence-level redo)
 *   outputSegmentIds:   string[],   // IDs of the sanitized segments created
 *   absorbedContext: {
 *     preceding: [{ segmentId, text, status }],
 *     following: [{ segmentId, text, status }],
 *   },
 *   cursorBefore:       number,     // caret position before the action
 *   cursorAfter:        number,     // caret position after the action
 *   pass1RunId:         string,     // correlates with QA log entry
 *   _undoMeta:          object|null // populated during undo for redo anchoring
 * }
 *
 * Entry schema (Deletion):
 * {
 *   logId:              string,
 *   timestamp:          number,
 *   type:               'deletion',
 *   targetId:           string,
 *   deletedText:        string,     // the text that was deleted
 *   deletionStart:      number,     // start offset of the deletion
 *   deletionEnd:        number,     // end offset of the deletion
 *   affectedSegmentIds: string[],   // segment IDs that were removed/trimmed
 *   cursorBefore:       number,
 *   cursorAfter:        number,
 *   _undoMeta:          object|null
 * }
 *
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {object} Slice state + methods
 */
export function createActionLogSlice(set, get) {
  return {
    // --- State ---
    actionLog: [],    // Unlimited QA traceability record (never pruned during session)
    undoStack: [],    // LIFO stack of undoable entries (capped at MAX_UNDO)
    redoStack: [],    // LIFO stack of redoable entries (cleared on any new action)

    // --- Add Entry ---

    /**
     * Append a new action log entry.
     *
     * By default, pushes to undoStack (capping at MAX_UNDO), clears
     * redoStack, and appends to the permanent actionLog.
     *
     * If rawEntry.undoable === false, the entry is added to the actionLog
     * for QA traceability but is NOT pushed to the undoStack and the
     * redoStack is left intact. Use this for Pass 1 re-runs that produce
     * no material text change — they shouldn't be undoable because there
     * is nothing to reverse.
     *
     * @param {object} rawEntry - Entry data (type, targetId, outputText, etc.)
     * @returns {object} The completed entry with logId and timestamp
     */
    addActionLogEntry: (rawEntry) => {
      const undoable = rawEntry.undoable !== false; // Default: true

      const entry = {
        ...rawEntry,
        logId: generateId('ulog'),
        timestamp: Date.now(),
        _undoMeta: null,
      };

      set((s) => ({
        actionLog: [...s.actionLog, entry],
        undoStack: undoable
          ? [...s.undoStack.slice(-(MAX_UNDO - 1)), entry]
          : s.undoStack,
        redoStack: undoable ? [] : s.redoStack,
      }));

      // --- Diagnostic logging ---
      const postState = get();
      const inputPreview = (entry.inputText || entry.deletedText || '').slice(0, 40);
      const outputPreview = (entry.outputText || '').slice(0, 40);
      console.log(
        `[ActionLog] Added ${entry.type}${entry.subtype ? ':' + entry.subtype : ''} | ` +
        `${entry.logId} | target=${entry.targetId} | undoable=${undoable} | ` +
        `input="${inputPreview}" | output="${outputPreview}" | ` +
        `undoStack=[${postState.undoStack.map(e => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}] (${postState.undoStack.length}) | ` +
        `redoStack=[${postState.redoStack.map(e => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}] (${postState.redoStack.length})`
      );
      return entry;
    },

    // --- Guard Conditions ---

    /**
     * Check if undo is available and safe to perform.
     *
     * Guards:
     *   - undoStack is non-empty
     *   - Action queue drained (no pending/awaiting_final dictate/pass1 entries)
     *   - Pass 1 is idle (not debouncing or in-flight)
     *   - No active typing or delete entries in progress
     *
     * @returns {boolean}
     */
    canUndo: () => {
      const state = get();
      if (state.undoStack.length === 0) {
        console.log('[ActionLog] canUndo=false: undoStack empty');
        return false;
      }
      if (!state.isQueueDrained()) {
        console.log('[ActionLog] canUndo=false: queue not drained');
        return false;
      }
      if (state.pass1Status !== 'idle') {
        console.log(`[ActionLog] canUndo=false: pass1Status=${state.pass1Status}`);
        return false;
      }
      const hasActiveEntries = state.actionQueue.some(
        (e) =>
          e.status === 'active' &&
          (e.actionType === 'type' || e.actionType === 'delete')
      );
      if (hasActiveEntries) {
        console.log('[ActionLog] canUndo=false: active type/delete entries');
        return false;
      }
      console.log(`[ActionLog] canUndo=true: undoStack has ${state.undoStack.length} entries, top=${state.undoStack[state.undoStack.length - 1]?.type}:${state.undoStack[state.undoStack.length - 1]?.subtype || ''}`);
      return true;
    },

    canRedo: () => {
      const state = get();
      if (state.redoStack.length === 0) {
        console.log('[ActionLog] canRedo=false: redoStack empty');
        return false;
      }
      if (!state.isQueueDrained()) {
        console.log('[ActionLog] canRedo=false: queue not drained');
        return false;
      }
      if (state.pass1Status !== 'idle') {
        console.log(`[ActionLog] canRedo=false: pass1Status=${state.pass1Status}`);
        return false;
      }
      const hasActiveEntries = state.actionQueue.some(
        (e) =>
          e.status === 'active' &&
          (e.actionType === 'type' || e.actionType === 'delete')
      );
      if (hasActiveEntries) {
        console.log('[ActionLog] canRedo=false: active type/delete entries');
        return false;
      }
      console.log(`[ActionLog] canRedo=true: redoStack has ${state.redoStack.length} entries`);
      return true;
    },

    // --- Undo ---

    /**
     * Pop the top entry from the undo stack and execute its undo operation.
     *
     * On success: moves the entry to the redo stack and returns
     * { type, targetId } so the caller can trigger downstream debounces.
     *
     * On failure (guards not met or execution failed): returns null
     * and leaves the stacks unchanged.
     *
     * @returns {{ type: string, targetId: string } | null}
     */
    performUndo: () => {
      const state = get();
      if (!state.canUndo()) {
        console.log('[ActionLog] Undo blocked — guard conditions not met');
        return null;
      }

      // Pop from undo stack
      const undoStack = [...state.undoStack];
      const entry = undoStack.pop();
      if (!entry) return null;

      console.log(
        `[ActionLog] ▶ Performing undo: ${entry.type}${entry.subtype ? ':' + entry.subtype : ''} ${entry.logId} | ` +
        `undoStack before: [${state.undoStack.map(e => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}] | ` +
        `redoStack before: [${state.redoStack.map(e => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}]`
      );

      // Dispatch to type-specific undo handler
      let result;
      if (entry.type === 'pass1') {
        result = undoPass1Entry(entry, set, get);
      } else if (entry.type === 'deletion') {
        result = undoDeletionEntry(entry, set, get);
      } else {
        console.warn(`[ActionLog] Unknown entry type for undo: ${entry.type}`);
        return null;
      }

      if (!result.success) {
        console.warn(
          `[ActionLog] Undo failed for ${entry.logId}: ${result.reason}`
        );
        return null;
      }

      // Transfer entry from undo stack to redo stack
      set((s) => ({
        undoStack: undoStack,
        redoStack: [...s.redoStack, entry],
      }));

      const postUndoState = get();
      console.log(
        `[ActionLog] ✓ Undo complete: ${entry.logId} | ` +
        `undoStack after: [${postUndoState.undoStack.map(e => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}] (${postUndoState.undoStack.length}) | ` +
        `redoStack after: [${postUndoState.redoStack.map(e => e.type + (e.subtype ? ':' + e.subtype : '')).join(', ')}] (${postUndoState.redoStack.length})`
      );

      return { type: entry.type, targetId: entry.targetId };
    },

    // --- Redo ---

    /**
     * Pop the top entry from the redo stack and execute its redo operation.
     *
     * On success: moves the entry back to the undo stack and returns
     * { type, targetId } so the caller can trigger downstream debounces.
     *
     * On failure: returns null and leaves the stacks unchanged.
     *
     * @returns {{ type: string, targetId: string } | null}
     */
    performRedo: () => {
      const state = get();
      if (!state.canRedo()) {
        console.log('[ActionLog] Redo blocked — guard conditions not met');
        return null;
      }

      // Pop from redo stack
      const redoStack = [...state.redoStack];
      const entry = redoStack.pop();
      if (!entry) return null;

      console.log(
        `[ActionLog] Performing redo: ${entry.type}${entry.subtype ? ':' + entry.subtype : ''} ${entry.logId}`
      );

      // Dispatch to type-specific redo handler
      let result;
      if (entry.type === 'pass1') {
        result = redoPass1Entry(entry, set, get);
      } else if (entry.type === 'deletion') {
        result = redoDeletionEntry(entry, set, get);
      } else {
        console.warn(`[ActionLog] Unknown entry type for redo: ${entry.type}`);
        return null;
      }

      if (!result.success) {
        console.warn(
          `[ActionLog] Redo failed for ${entry.logId}: ${result.reason}`
        );
        return null;
      }

      // Transfer entry from redo stack back to undo stack
      set((s) => ({
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), entry],
        redoStack: redoStack,
      }));

      return { type: entry.type, targetId: entry.targetId };
    },

    // --- Utilities ---

    /**
     * Clear the action log and both stacks (used by resetSession).
     */
    clearActionLog: () => {
      set({
        actionLog: [],
        undoStack: [],
        redoStack: [],
      });
    },
  };
}
