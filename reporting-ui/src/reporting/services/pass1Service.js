/**
 * Pass 1 Service — Phase 4 (sentence-level consolidation)
 *
 * Orchestrates the LLM Pass 1 text sanitization pipeline:
 *   1. 450ms debounce after action queue drains (cancelled on new ASR entry)
 *   2. Collect raw/dirty/open_fragment segments per textarea
 *   3. Include up to 2 preceding + 1 following sanitized segment for LLM context
 *   4. Fire parallel API calls for non-contiguous blocks
 *   5. Apply results: split LLM output by newlines → 1 segment per sentence
 *
 * KEY DESIGN: After Pass 1, word-level ASR segments are consolidated into
 * sentence-level segments. Each sentence from the LLM output becomes one
 * sanitized segment. This ensures segments represent semantic units
 * (sentences/ideas) suitable for Pass 2 report insertion.
 */

import useReportStore from '../stores/useReportStore';
import autocorrectService from './autocorrectService';
import { getCaretPosition } from './caretTracker';
import { startPass2Debounce } from './pass2Service';
import { startImpressionDebounce, cancelImpressionDebounce } from './impressionService';

const DEBOUNCE_MS = 450;
const SESSION_ID = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let debounceTimer = null;

// Dirty flag: set to true when report content is modified by a deletion
// with segment rollback. Consumed in firePass1()'s empty-work branch to
// decide whether impression regeneration is needed. Without this guard,
// non-text-inserting voice commands (e.g., "go to start") spuriously
// trigger impression because their orphaned queue entry drains the queue,
// which fires Pass 1, which finds nothing to process and blindly triggers
// impression.
let reportContentDirty = false;

/**
 * Mark report content as dirty (content was modified outside the
 * normal Pass 1 → Pass 2 → Impression pipeline, e.g., by a deletion
 * with segment rollback). This flag is consumed by firePass1() to
 * decide whether to trigger impression when no processable segments
 * exist.
 */
export function markReportContentDirty() {
  reportContentDirty = true;
}

// --- Helpers ---

/**
 * Simple client-side sentence splitter for the "Ok" case.
 * Used when the LLM confirms no changes are needed but we still
 * need to define sentence boundaries in the raw text.
 */
function splitIntoSentences(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  const sentences = [];
  let buf = '';

  const isDigit = (c) => c >= '0' && c <= '9';

  for (let i = 0; i < t.length; i++) {
    buf += t[i];

    if (t[i] === '.' || t[i] === '!' || t[i] === '?') {
      // Skip decimals: digit.digit
      if (t[i] === '.' && i > 0 && i + 1 < t.length &&
        isDigit(t[i - 1]) && isDigit(t[i + 1])) continue;

      // Look ahead for sentence boundary: end of string, or space + uppercase/digit
      let j = i + 1;
      while (j < t.length && t[j] === ' ') j++;

      if (j >= t.length || (t[j] >= 'A' && t[j] <= 'Z') || isDigit(t[j])) {
        sentences.push(buf.trim());
        buf = '';
      }
    }
  }

  if (buf.trim()) sentences.push(buf.trim());
  return sentences;
}

// --- Public API ---

export function startDebounce() {
  const store = useReportStore.getState();
  if (store.pass1Status === 'in_flight') return;

  if (debounceTimer) clearTimeout(debounceTimer);

  store.setPass1Status('debouncing');
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    firePass1();
  }, DEBOUNCE_MS);
}

export function cancelDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const store = useReportStore.getState();
  if (store.pass1Status === 'debouncing') {
    store.setPass1Status('idle');
  }
}

export function resetPass1() {
  cancelDebounce();
  useReportStore.getState().setPass1Status('idle');
}

// --- Core Logic ---

/**
 * Build a diagnostic segment snapshot for a textarea.
 * Returns { segments, gaps, coverageEnd, textLen } for QA logging.
 */
function buildSegmentSnapshot(targetId, segments, fullText) {
  const sorted = [...segments].sort((a, b) => a.startOffset - b.startOffset);
  const textLen = fullText.length;
  const gaps = [];
  const segList = sorted.map((seg) => {
    const textSlice = fullText.slice(seg.startOffset, seg.endOffset);
    return {
      id: seg.segmentId.slice(-8),
      range: `[${seg.startOffset},${seg.endOffset}]`,
      status: seg.status,
      textMatch: textSlice === seg.text,
      preview: seg.text.slice(0, 35) + (seg.text.length > 35 ? '…' : ''),
    };
  });

  // Detect gaps
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startOffset - sorted[i - 1].endOffset;
    if (gap > 0) {
      const gapText = fullText.slice(sorted[i - 1].endOffset, sorted[i].startOffset);
      gaps.push({
        after: sorted[i - 1].segmentId.slice(-8),
        before: sorted[i].segmentId.slice(-8),
        range: `[${sorted[i - 1].endOffset},${sorted[i].startOffset}]`,
        chars: gap,
        text: JSON.stringify(gapText),
      });
      console.warn(`[Pass1Service] ⚠ SEGMENT GAP in ${targetId}: [${sorted[i - 1].endOffset},${sorted[i].startOffset}] (${gap} chars) text=${JSON.stringify(gapText)}`);
    }
  }

  // Check coverage: does last segment reach end of text?
  const coverageEnd = sorted.length > 0 ? sorted[sorted.length - 1].endOffset : 0;
  if (coverageEnd < textLen) {
    const uncoveredText = fullText.slice(coverageEnd);
    console.warn(`[Pass1Service] ⚠ UNCOVERED TEXT in ${targetId}: [${coverageEnd},${textLen}] (${textLen - coverageEnd} chars) text=${JSON.stringify(uncoveredText.slice(0, 60))}`);
  }

  return { segments: segList, gaps, coverageEnd, textLen };
}

async function firePass1() {
  const store = useReportStore.getState();

  // Phase 5e: Resolve any active typing/delete entries so their segments
  // are created before we collect segments for processing
  const allActive = store.actionQueue.filter(
    (e) => e.status === 'active' && (e.actionType === 'type' || e.actionType === 'delete')
  );
  for (const entry of allActive) {
    if (entry.actionType === 'type') store.resolveTypingEntry(entry.actionId);
    if (entry.actionType === 'delete') store.resolveDeleteEntry(entry.actionId);
  }

  if (!store.isQueueDrained()) {
    store.setPass1Status('idle');
    return;
  }

  const segmentsByTextarea = store.segments;
  const textareasToProcess = [];

  // --- Diagnostic: segment snapshot at fire time ---
  const segmentSnapshots = {};
  for (const [targetId, segments] of Object.entries(segmentsByTextarea)) {
    if (segments.length === 0) continue;
    const fullText = targetId === 'dictation-box'
      ? store.dictationText
      : (store.contentBoxStates[targetId]?.currentText || '');
    segmentSnapshots[targetId] = buildSegmentSnapshot(targetId, segments, fullText);

    // Console dump for active debugging
    const snap = segmentSnapshots[targetId];
    console.log(`[Pass1Service] SEGMENT SNAPSHOT ${targetId} (${segments.length} segs, textLen=${snap.textLen}, coverage→${snap.coverageEnd}):`);
    for (const s of snap.segments) {
      console.log(`  ${s.range} ${s.status} match=${s.textMatch} "${s.preview}"`);
    }
    if (snap.gaps.length > 0) {
      console.warn(`  ⚠ ${snap.gaps.length} GAP(S) DETECTED`);
    }
  }

  for (const [targetId, segments] of Object.entries(segmentsByTextarea)) {
    const hasRawDirty = segments.some(
      (seg) => seg.status === 'raw' || seg.status === 'dirty'
    );
    if (!hasRawDirty) continue;

    const processableSegs = segments.filter(
      (seg) => seg.status === 'raw' || seg.status === 'dirty' || seg.status === 'open_fragment'
    );
    if (processableSegs.length > 0) {
      textareasToProcess.push({
        targetId,
        segments: processableSegs,
        allSegments: segments,
        segmentSnapshot: segmentSnapshots[targetId] || null,
      });
    }
  }

  if (textareasToProcess.length === 0) {
    store.setPass1Status('idle');
    // Phase 5: No raw/dirty segments left — trigger Pass 2 debounce
    // (there may be newly sanitized segments ready for finding placement)
    startPass2Debounce();

    // Phase 6: If there are also no sanitized segments pending Pass 2,
    // the report may have changed via rollback (e.g., user deleted a
    // dictated segment -> findings removed, normals restored). Trigger
    // impression regeneration directly since no pipeline step will fire.
    const dictSegs = store.segments['dictation-box'] || [];
    const hasSanitized = dictSegs.some((s) => s.status === 'sanitized');
    if (!hasSanitized && reportContentDirty) {
      reportContentDirty = false;
      startImpressionDebounce();
    }
    return;
  }

  // --- Set status BEFORE enqueuing to prevent cancelDebounce race ---
  // (enqueueAction calls notifyNewEntry which calls cancelDebounce;
  //  but pass1 entries skip notifyNewEntry, so this is extra safety)
  store.setPass1Status('in_flight');

  // --- Enqueue a pass1 entry to block the queue ---
  const pass1Entry = store.enqueueAction({
    targetId: '__pass1__',
    caretPosition: 0,
    actionType: 'pass1',
  });

  if (!pass1Entry) {
    console.error('[Pass1Service] Failed to enqueue pass1 entry');
    store.setPass1Status('idle');
    return;
  }

  console.log('[Pass1Service] Pass 1 entry enqueued:', pass1Entry.actionId);

  // Phase 6: Cancel impression debounce — Pass 1 is now active
  cancelImpressionDebounce();

  let pass1Succeeded = false;

  try {
    const results = await Promise.allSettled(
      textareasToProcess.map((item) =>
        processTextarea(item.targetId, item.segments, item.allSegments, item.segmentSnapshot)
      )
    );

    const anyFailed = results.some((r) => r.status === 'rejected');
    if (anyFailed) {
      store.setPass1Status('error');
      setTimeout(() => {
        const s = useReportStore.getState();
        if (s.pass1Status === 'error') s.setPass1Status('idle');
      }, 5000);
    } else {
      store.setPass1Status('idle');
      pass1Succeeded = true;
    }
  } finally {
    // ALWAYS resolve the pass1 entry to unblock the queue,
    // even if an error occurred. This also replays any buffered
    // ASR insertions that arrived during the API call.
    console.log('[Pass1Service] Resolving pass1 entry:', pass1Entry.actionId);
    useReportStore.getState().resolvePass1Entry(pass1Entry.actionId);
  }

  // Trigger downstream pipelines AFTER queue resolution.
  // This ensures isQueueDrained() returns true when readiness is checked.
  if (pass1Succeeded) {
    startPass2Debounce();
    startImpressionDebounce();
    reportContentDirty = false;
  }
}

/**
 * Process a single textarea.
 *
 * For each contiguous block of raw/dirty segments:
 *   - Find up to 2 preceding segments for context (any status)
 *   - Find 1 following segment for context (any status)
 *   - Send to API with [BEFORE]/[REVIEW]/[AFTER] markers
 *   - Split result by newlines → 1 segment per sentence
 *   - Detect echoes vs merges → strip echoes, absorb merges
 */
async function processTextarea(targetId, processableSegments, allSegments, segmentSnapshot) {
  const store = useReportStore.getState();
  let hadWarnings = false;

  const sorted = [...processableSegments].sort((a, b) => a.startOffset - b.startOffset);
  const allBlocks = groupContiguousBlocks(sorted);

  const blocks = allBlocks.filter(
    (block) => block.segments.some((seg) => seg.status === 'raw' || seg.status === 'dirty')
  );
  if (blocks.length === 0) return { hadWarnings };

  const currentFullText = targetId === 'dictation-box'
    ? store.dictationText
    : (store.contentBoxStates[targetId]?.currentText || '');

  const sortedAll = [...allSegments].sort((a, b) => a.startOffset - b.startOffset);

  // --- Absorb NA-flagged structured segments adjacent to raw/dirty blocks ---
  // When new dictation arrives next to an NA-flagged segment (e.g., "There is also"),
  // include it in [REVIEW] so the LLM can merge or remove the incomplete fragment
  // rather than leaving it as an orphaned structured segment.
  for (const block of blocks) {
    const blockStart = block.segments[0].startOffset;
    // Find the nearest preceding segment that is NA-flagged and directly adjacent
    const precNASeg = sortedAll.find(
      s => s.endOffset === blockStart && s.status === 'structured' && s.naFlagged
    );
    if (precNASeg) {
      block.segments.unshift(precNASeg);
      console.log(`[Pass1Service] Absorbed NA-flagged structured segment into block: [${precNASeg.startOffset},${precNASeg.endOffset}] "${precNASeg.text}"`);
    }
  }

  // --- Diagnostic: block grouping details ---
  const blockDetails = blocks.map((block, i) => {
    const bStart = block.segments[0].startOffset;
    const bEnd = block.segments[block.segments.length - 1].endOffset;
    return {
      index: i,
      range: `[${bStart},${bEnd}]`,
      segCount: block.segments.length,
      preview: currentFullText.slice(bStart, bEnd).slice(0, 50) + (bEnd - bStart > 50 ? '…' : ''),
    };
  });

  console.log(`[Pass1Service] processTextarea(${targetId}): ${allBlocks.length} total blocks, ${blocks.length} with raw/dirty`);
  for (const bd of blockDetails) {
    console.log(`  Block ${bd.index}: ${bd.range} (${bd.segCount} segs) "${bd.preview}"`);
  }

  // Fire API calls in parallel (skip whitespace-only blocks)
  const skippedBlocks = [];
  const apiBlocks = [];

  for (const block of blocks) {
    const blockStart = block.segments[0].startOffset;
    const blockEnd = block.segments[block.segments.length - 1].endOffset;
    let chunkText = currentFullText.slice(blockStart, blockEnd);
    chunkText = autocorrectService.apply(chunkText);

    // Skip whitespace-only blocks — remove their segments and text
    if (!chunkText.trim()) {
      // Safety: if the block text contains \n, a structural newline segment
      // should exist here. In normal operation, structural segments are excluded
      // from processable segments, so this shouldn't happen. But as a guard,
      // only remove the raw/dirty segments — do NOT erase the text from currentText.
      const blockText = currentFullText.slice(blockStart, blockEnd);
      if (blockText.includes('\n')) {
        console.warn(`[Pass1Service] Whitespace block [${blockStart},${blockEnd}] contains \\n — removing segments only, preserving text`);
        const blockSegmentIds = block.segments.map(s => s.segmentId);
        const store2 = useReportStore.getState();
        const currentSegs = store2.segments[targetId] || [];
        const filteredSegs = currentSegs.filter(s => !blockSegmentIds.includes(s.segmentId));

        useReportStore.setState({
          segments: { ...store2.segments, [targetId]: filteredSegs },
        });
        skippedBlocks.push(block);
        continue;
      }

      console.log(`[Pass1Service] Skipping whitespace-only block [${blockStart},${blockEnd}] — removing ghost segments`);
      const blockSegmentIds = block.segments.map(s => s.segmentId);
      const store2 = useReportStore.getState();
      const currentSegs = store2.segments[targetId] || [];
      const filteredSegs = currentSegs.filter(s => !blockSegmentIds.includes(s.segmentId));

      // Remove the whitespace text from the textarea
      const currentText = targetId === 'dictation-box'
        ? store2.dictationText
        : (store2.contentBoxStates[targetId]?.currentText || '');
      const newText = currentText.slice(0, blockStart) + currentText.slice(blockEnd);
      const delta = blockStart - blockEnd; // negative

      // Shift downstream segments
      const shiftedSegs = filteredSegs.map(seg => {
        if (seg.startOffset >= blockEnd) {
          return { ...seg, startOffset: seg.startOffset + delta, endOffset: seg.endOffset + delta };
        }
        return seg;
      });

      if (targetId === 'dictation-box') {
        useReportStore.setState({
          dictationText: newText,
          segments: { ...store2.segments, [targetId]: shiftedSegs },
        });
      } else {
        const box = store2.contentBoxStates[targetId];
        if (box) {
          useReportStore.setState({
            segments: { ...store2.segments, [targetId]: shiftedSegs },
            contentBoxStates: {
              ...store2.contentBoxStates,
              [targetId]: { ...box, currentText: newText },
            },
          });
        }
      }
      skippedBlocks.push(block);
      continue;
    }

    // Deterministic merge: isolated punctuation blocks (. ! ? , ; :)
    // These are handled without an LLM call — the user's intent is unambiguous.
    if (tryMergeIsolatedPunctuation(block, sortedAll, targetId, currentFullText, segmentSnapshot, blockDetails)) {
      skippedBlocks.push(block);
      continue;
    }

    // Find up to 2 preceding sanitized/structured segments for context
    const precedingSegs = findPrecedingContext(sortedAll, blockStart, 2);
    const precedingText = precedingSegs.length > 0
      ? precedingSegs
        .sort((a, b) => a.startOffset - b.startOffset) // chronological order
        .map(seg => currentFullText.slice(seg.startOffset, seg.endOffset).trim())
        .join(' ')
      : '';

    // Find 1 following sanitized/structured segment for context
    const followingSeg = findFollowingContext(sortedAll, blockEnd);
    const followingText = followingSeg
      ? currentFullText.slice(followingSeg.startOffset, followingSeg.endOffset).trim()
      : '';

    // --- Pre-lowercase fixup ---
    // ASR auto-capitalizes the first word of each new utterance, creating a
    // false sentence-boundary signal. When [BEFORE] ends without terminal
    // punctuation (indicating a continuation), lowercase the first word of
    // [REVIEW] so the LLM sees it as a continuation, not a new sentence.
    if (precedingText.length > 0 && chunkText.trim().length > 0) {
      const precTrimmed = precedingText.trimEnd();
      const lastPrecChar = precTrimmed[precTrimmed.length - 1];
      if (!'.!?'.includes(lastPrecChar)) {
        // Preceding text doesn't end with terminal punctuation → continuation
        chunkText = chunkText.replace(/^(\s*)([A-Z])/, (_, ws, ch) => ws + ch.toLowerCase());
        console.log(`[Pass1Service] Pre-lowercase fixup: first word lowercased (preceding lacks terminal punct)`);
      }
    }

    apiBlocks.push({
      block,
      promise: callPass1API(chunkText, precedingText, followingText, {
        block,
        blockStart,
        blockEnd,
        precedingSegs,
        followingSeg,
        precedingText,
        followingText,
        chunkText,
        sortedAll,
      }),
    });
  }

  if (apiBlocks.length === 0) {
    return { hadWarnings: skippedBlocks.length > 0 };
  }

  const callPromises = apiBlocks.map(ab => ab.promise);

  const responses = await Promise.allSettled(callPromises);

  for (let i = 0; i < apiBlocks.length; i++) {
    const response = responses[i];

    if (response.status === 'rejected') {
      console.error('[Pass1Service] API call failed:', response.reason);
      hadWarnings = true;
      logPass1ToQA(apiBlocks[i].block, null, 0, ['pass1_call_failed'], null, segmentSnapshot, blockDetails);
      continue;
    }

    const { data, latencyMs, meta } = response.value;

    // --- Refresh block offsets from the store ---
    // Earlier blocks may have shifted downstream segment offsets via
    // replaceSegmentsWithSanitized. Re-read current positions by segmentId.
    const block = refreshBlockOffsets(apiBlocks[i].block, targetId);
    const blockStart = block.segments[0].startOffset;
    const blockEnd = block.segments[block.segments.length - 1].endOffset;

    // Rebuild meta with fresh offsets, sortedAll, and context references
    const currentStore = useReportStore.getState();
    const freshSortedAll = [...(currentStore.segments[targetId] || [])]
      .sort((a, b) => a.startOffset - b.startOffset);
    const freshCurrentText = targetId === 'dictation-box'
      ? currentStore.dictationText
      : (currentStore.contentBoxStates[targetId]?.currentText || '');
    const freshPrecedingSegs = findPrecedingContext(freshSortedAll, blockStart, 2);
    const freshFollowingSeg = findFollowingContext(freshSortedAll, blockEnd);

    const freshMeta = {
      ...meta,
      blockStart,
      blockEnd,
      sortedAll: freshSortedAll,
      precedingSegs: freshPrecedingSegs,
      followingSeg: freshFollowingSeg,
      precedingText: freshPrecedingSegs.length > 0
        ? freshPrecedingSegs
            .sort((a, b) => a.startOffset - b.startOffset)
            .map(seg => freshCurrentText.slice(seg.startOffset, seg.endOffset).trim())
            .join(' ')
        : '',
      followingText: freshFollowingSeg
        ? freshCurrentText.slice(freshFollowingSeg.startOffset, freshFollowingSeg.endOffset).trim()
        : '',
      chunkText: freshCurrentText.slice(blockStart, blockEnd),
    };

    // Edge case §4.6: conflict check
    const conflicting = currentStore.actionQueue.some(
      (e) =>
        ((e.status === 'pending' || e.status === 'awaiting_final') ||
         (e.status === 'active' && (e.actionType === 'type' || e.actionType === 'delete'))) &&
        e.targetId === targetId &&
        e.caretPosition >= blockStart &&
        e.caretPosition <= blockEnd
    );

    if (conflicting) {
      console.log('[Pass1Service] Discarding — active editing within processed block');
      logPass1ToQA(block, data, latencyMs, ['discarded_conflict'], freshMeta, segmentSnapshot, blockDetails);
      continue;
    }

    if (data.warnings?.length) hadWarnings = true;

    const afterData = applyPass1Result(targetId, block, data, freshMeta);
    logPass1ToQA(block, data, latencyMs, data.warnings || [], freshMeta, segmentSnapshot, blockDetails, afterData);
  }

  return { hadWarnings };
}

// --- Segment lookup ---

/**
 * Find up to `count` nearest preceding segments before blockStart.
 * All statuses are eligible — the LLM always needs surrounding context
 * regardless of whether adjacent segments are raw, sanitized or structured.
 *
 * However, structural newline segments act as paragraph boundaries:
 * if a structural '\n' segment exists between a candidate and the block,
 * the candidate is on a different line and must NOT be used as context.
 *
 * Returns an array sorted nearest-first (descending endOffset).
 */
function findPrecedingContext(sortedAll, blockStart, count = 2) {
  // Find the nearest structural newline before blockStart — this is the barrier
  const nearestNewline = sortedAll
    .filter(seg => seg.status === 'structural' && seg.text === '\n' && seg.endOffset <= blockStart)
    .sort((a, b) => b.endOffset - a.endOffset)[0]; // nearest first

  const barrierOffset = nearestNewline ? nearestNewline.endOffset : -1;

  const candidates = sortedAll
    .filter(seg =>
      seg.endOffset <= blockStart &&
      seg.status !== 'structural' &&       // don't use \n itself as context
      seg.startOffset >= barrierOffset      // must be on same side of newline
    )
    .sort((a, b) => b.endOffset - a.endOffset); // nearest first
  return candidates.slice(0, count);
}

/**
 * Find the nearest following segment after blockEnd.
 * All statuses are eligible — same reasoning as findPrecedingContext.
 *
 * However, structural newline segments act as paragraph boundaries:
 * if a structural '\n' segment exists between the block and a candidate,
 * the candidate is on a different line and must NOT be used as context.
 */
function findFollowingContext(sortedAll, blockEnd) {
  // Find the nearest structural newline after blockEnd — this is the barrier
  const nearestNewline = sortedAll.find(
    seg => seg.status === 'structural' && seg.text === '\n' && seg.startOffset >= blockEnd
  );

  const barrierOffset = nearestNewline ? nearestNewline.startOffset : Infinity;

  for (const seg of sortedAll) {
    if (seg.startOffset >= blockEnd && seg.status !== 'structural' && seg.startOffset < barrierOffset) {
      return seg;
    }
  }
  return null;
}

// --- Block grouping ---

function groupContiguousBlocks(sortedSegments) {
  if (sortedSegments.length === 0) return [];
  const blocks = [];
  let currentBlock = { segments: [sortedSegments[0]] };

  for (let i = 1; i < sortedSegments.length; i++) {
    const prev = currentBlock.segments[currentBlock.segments.length - 1];
    const curr = sortedSegments[i];
    // Segments are contiguous (no gaps) — leading spaces are included
    // in subsequent segments, so prev.endOffset === curr.startOffset.
    if (curr.startOffset <= prev.endOffset) {
      currentBlock.segments.push(curr);
    } else {
      blocks.push(currentBlock);
      currentBlock = { segments: [curr] };
    }
  }
  blocks.push(currentBlock);
  return blocks;
}

/**
 * Re-resolve a block's segment offsets from the current store state.
 *
 * When multiple blocks are processed sequentially, earlier blocks may
 * shift downstream segment offsets via replaceSegmentsWithSanitized.
 * The block objects in the processing loop retain their original offsets,
 * so we must look up the current offsets by segmentId before applying
 * each result.
 *
 * @param {object} block - The block with potentially stale segment offsets
 * @param {string} targetId - Textarea identifier
 * @returns {object} New block with refreshed offsets (or original if no change)
 */
function refreshBlockOffsets(block, targetId) {
  const store = useReportStore.getState();
  const currentSegs = store.segments[targetId] || [];
  const segById = new Map(currentSegs.map(s => [s.segmentId, s]));

  let anyChanged = false;
  const refreshed = block.segments.map(seg => {
    const current = segById.get(seg.segmentId);
    if (current && (current.startOffset !== seg.startOffset || current.endOffset !== seg.endOffset)) {
      anyChanged = true;
      return { ...seg, startOffset: current.startOffset, endOffset: current.endOffset };
    }
    return seg;
  });

  if (!anyChanged) return block;

  const freshBlock = { ...block, segments: refreshed };
  console.log(`[Pass1Service] Refreshed block offsets: [${block.segments[0].startOffset},${block.segments[block.segments.length-1].endOffset}] → [${refreshed[0].startOffset},${refreshed[refreshed.length-1].endOffset}]`);
  return freshBlock;
}

// --- API call ---

async function callPass1API(chunkText, precedingText, followingText, meta) {
  const startTime = performance.now();

  const response = await fetch('/api/dictation/pass1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunkText,
      precedingText,
      followingText,
      sessionId: SESSION_ID,
    }),
  });

  const latencyMs = Math.round(performance.now() - startTime);

  if (!response.ok) {
    throw new Error(`Pass 1 API returned ${response.status}`);
  }

  const data = await response.json();
  return { data, latencyMs, meta };
}

// --- Result application ---

/**
 * Apply Pass 1 result with sentence-level consolidation.
 *
 * TEXT CHANGED case:
 *   1. Split LLM output by newlines → array of sentences
 *   2. Compute the span (preceding seg + raw block + following seg)
 *   3. Delete ALL old segments in the span
 *   4. Create 1 sanitized segment per sentence
 *   5. Splice the joined text into the textarea
 *
 * "Ok" case:
 *   1. Split the raw chunkText into sentences (deterministic)
 *   2. Replace only the raw/dirty segments in the block
 *   3. Create 1 sanitized segment per sentence
 *   4. Don't touch preceding/following segments
 */
function applyPass1Result(targetId, block, data, meta) {
  const store = useReportStore.getState();

  if (data.noChange) {
    // --- "Ok" response: consolidate raw segments into sentence-level ---
    return consolidateOkSegments(targetId, block, meta);
  }

  // --- Text changed: split by newlines, create sentence segments ---
  const resultText = data.result || '';

  // Split LLM output into sentences (one per line)
  const sentences = resultText
    ? resultText.split('\n').map(s => s.trim()).filter(Boolean)
    : [];

  const isNullResponse = sentences.length === 0 || (sentences.length === 1 && sentences[0] === '<NULL_RESPONSE>');

  // If ALL text was non-clinical (LLM returned empty or our token), remove the raw
  // segments and their text from the dictation box entirely.
  if (isNullResponse) {
    const blockSegmentIds = block.segments.map(s => s.segmentId);
    const currentFullText = targetId === 'dictation-box'
      ? store.dictationText
      : (store.contentBoxStates[targetId]?.currentText || '');
    const blockStart = Math.min(...block.segments.map(s => s.startOffset));
    const blockEnd = Math.max(...block.segments.map(s => s.endOffset));
    const inputText = currentFullText.slice(blockStart, blockEnd);
    const cursorBefore = getCaretPosition(targetId);
    const newFullText = currentFullText.slice(0, blockStart) + currentFullText.slice(blockEnd);

    console.log('[Pass1Service] Empty result — removing non-clinical text from dictation box');
    store.replaceSegmentsWithSanitized(targetId, blockSegmentIds, [], newFullText);

    // Action Log: null response removal
    store.addActionLogEntry({
      type: 'pass1',
      subtype: 'null_response',
      targetId,
      inputText,
      outputText: '',
      outputSegmentTexts: [],
      outputSegmentIds: [],
      absorbedContext: { preceding: [], following: [] },
      cursorBefore,
      cursorAfter: blockStart,
    });

    return {
      segments: [],
      decisions: ['Non-clinical text removed'],
    };
  }

  const { precedingSegs, followingSeg } = meta;

  const currentFullText = targetId === 'dictation-box'
    ? store.dictationText
    : (store.contentBoxStates[targetId]?.currentText || '');

  // No staleness guard needed — Pass 1 blocks the queue, so no
  // concurrent text modifications can occur while the API is in flight.

  // Use the sorted segments from the meta snapshot (guaranteed fresh
  // since the queue blocks concurrent modifications)
  const sortedAll = meta.sortedAll;

  // Build the joined text from LLM output (may be modified by echo stripping)
  let joinedText = sentences.join(' ');

  // --- Echo vs Merge detection ---
  // The LLM receives [BEFORE], [REVIEW], and [AFTER] context sections.
  // When it MERGES text across boundaries, sentence boundaries change.
  // When it ECHOES context, the context sentences appear unchanged.
  //
  // Algorithm:
  //   1. Split preceding/following text into sentences
  //   2. Compare leading LLM sentences against preceding sentences
  //   3. If they match exactly → echo → strip them, don't extend span
  //   4. If they differ → merge → extend span, absorb preceding segment(s)
  //   5. Same from the back for following context

  const precedingText = meta.precedingText || '';
  const followingText = meta.followingText || '';
  const normalizeForCompare = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  // --- Preceding context: echo vs merge ---
  const precedingSentences = splitIntoSentences(precedingText);
  let precedingEchoCount = 0;
  let precedingMerged = false;

  if (precedingText && precedingSentences.length > 0 && sentences.length > 0) {
    // Walk from the front: check if leading LLM sentences match preceding sentences
    let allMatch = true;
    let punctuationModified = false;
    for (let i = 0; i < precedingSentences.length && i < sentences.length; i++) {
      const normPreceding = normalizeForCompare(precedingSentences[i]);
      const normLLM = normalizeForCompare(sentences[i]);

      if (normPreceding !== normLLM) {
        allMatch = false;
        break;
      }

      // Punctuation-aware check: if text matches after stripping punctuation
      // but differs with punctuation intact, the LLM modified punctuation on
      // [BEFORE] (e.g., added a terminal period). This is a merge, not an echo.
      const precTrimmed = precedingSentences[i].trim();
      const llmTrimmed = sentences[i].trim();
      if (precTrimmed !== llmTrimmed) {
        allMatch = false;
        punctuationModified = true;
        console.log(`[applyPass1Result] Punctuation change on preceding context: "${precTrimmed}" → "${llmTrimmed}"`);
        break;
      }

      precedingEchoCount = i + 1;
    }

    if (punctuationModified) {
      // LLM modified punctuation on [BEFORE] → treat as merge to absorb the change
      precedingMerged = true;
      precedingEchoCount = 0;
      console.log(`[applyPass1Result] Preceding punctuation modification detected → treating as MERGE`);
    } else if (allMatch && precedingEchoCount === precedingSentences.length) {
      // All preceding sentences echoed — but check if remaining text is a
      // grammatical continuation (starts lowercase). If so, the LLM was
      // showing a merge, not a true echo.
      const nextSentenceIdx = precedingEchoCount;
      const nextSentence = sentences[nextSentenceIdx];
      const startsLowercase = nextSentence && /^[a-z]/.test(nextSentence.trim());

      if (startsLowercase) {
        // Remaining text is a continuation → treat as merge, don't strip
        precedingMerged = true;
        precedingEchoCount = 0;
        console.log(`[applyPass1Result] Echo reclassified as MERGE: remaining text "${nextSentence.slice(0, 40)}" starts lowercase`);
      } else {
        // True echo — safe to strip
        console.log(`[applyPass1Result] Stripping ${precedingEchoCount} echoed preceding sentences`);
        sentences.splice(0, precedingEchoCount);
        joinedText = sentences.join(' ');
      }
    } else if (!allMatch) {
      // Preceding text was modified or merged → absorb preceding segments
      // Check if the LLM output starts with content from the preceding context
      // (full text match) OR ends of last preceding sentence (partial merge)
      const precedingNorm = normalizeForCompare(precedingText);
      const joinedNorm = normalizeForCompare(joinedText);

      // Check 1: LLM output starts with the full preceding text
      const fullStartMatch = precedingNorm.length > 0 &&
        joinedNorm.startsWith(precedingNorm.slice(0, 20));

      // Check 2: LLM output starts with the LAST sentence of preceding text
      // (handles partial merge where LLM only merged with the trailing sentence)
      const lastPrecSentence = precedingSentences[precedingSentences.length - 1];
      const lastPrecNorm = lastPrecSentence ? normalizeForCompare(lastPrecSentence) : '';
      const partialStartMatch = lastPrecNorm.length > 0 &&
        joinedNorm.startsWith(lastPrecNorm.slice(0, Math.min(20, lastPrecNorm.length)));

      if (fullStartMatch || partialStartMatch) {
        precedingMerged = true;
        console.log(`[applyPass1Result] Preceding merge detected (${fullStartMatch ? 'full' : 'partial'} match)`);
      }
      precedingEchoCount = 0; // no stripping
    }
  }

  // --- Following context: echo vs merge ---
  const followingSentences = splitIntoSentences(followingText);
  let followingEchoCount = 0;
  let followingMerged = false;

  if (followingText && followingSentences.length > 0 && sentences.length > 0) {
    // Walk from the back: check if trailing LLM sentences match following sentences
    let allMatch = true;
    for (let i = 0; i < followingSentences.length && i < sentences.length; i++) {
      const llmIdx = sentences.length - 1 - i;
      const followIdx = followingSentences.length - 1 - i;
      if (normalizeForCompare(followingSentences[followIdx]) !== normalizeForCompare(sentences[llmIdx])) {
        allMatch = false;
        break;
      }
      followingEchoCount = i + 1;
    }

    if (allMatch && followingEchoCount === followingSentences.length) {
      // All following sentences echoed identically → strip them
      console.log(`[applyPass1Result] Stripping ${followingEchoCount} echoed following sentences`);
      sentences.splice(sentences.length - followingEchoCount, followingEchoCount);
      joinedText = sentences.join(' ');
    } else {
      // Following text was modified or merged → absorb following segment
      const followingNorm = normalizeForCompare(followingText).slice(-20);
      if (followingNorm.length > 0 && normalizeForCompare(joinedText).endsWith(followingNorm)) {
        followingMerged = true;
      }
      followingEchoCount = 0; // no stripping
    }
  }

  // --- Handle edge case: all sentences stripped (LLM only echoed context) ---
  if (sentences.length === 0) {
    const blockSegmentIds = block.segments.map(s => s.segmentId);
    const blockStart = Math.min(...block.segments.map(s => s.startOffset));
    const blockEnd = Math.max(...block.segments.map(s => s.endOffset));
    const inputText = currentFullText.slice(blockStart, blockEnd);
    const cursorBefore = getCaretPosition(targetId);
    const newFullText = currentFullText.slice(0, blockStart) + currentFullText.slice(blockEnd);
    console.log('[applyPass1Result] All content was echoed context — removing block');
    store.replaceSegmentsWithSanitized(targetId, blockSegmentIds, [], newFullText);

    // Action Log: all content echoed — block removed
    store.addActionLogEntry({
      type: 'pass1',
      subtype: 'all_echo_removed',
      targetId,
      inputText,
      outputText: '',
      outputSegmentTexts: [],
      outputSegmentIds: [],
      absorbedContext: { preceding: [], following: [] },
      cursorBefore,
      cursorAfter: blockStart,
    });

    return {
      segments: [],
      decisions: ['All content was echoed context — block removed'],
    };
  }

  // --- Compute replacement span ---
  const spanStart = precedingMerged && precedingSegs?.length > 0
    ? Math.min(...precedingSegs.map(s => s.startOffset))
    : meta.blockStart;
  const spanEnd = followingMerged && followingSeg
    ? followingSeg.endOffset
    : meta.blockEnd;

  console.log('[applyPass1Result] span detection:', {
    precedingMerged,
    followingMerged,
    precedingEchoCount,
    followingEchoCount,
    spanStart,
    spanEnd,
    blockRange: `[${meta.blockStart},${meta.blockEnd}]`,
    sentenceCount: sentences.length,
    joinedTextPreview: joinedText.slice(0, 60),
  });

  // Collect ALL segment IDs within the replaced span
  const oldSegmentIds = [];
  for (const seg of sortedAll) {
    if (seg.startOffset >= spanStart && seg.endOffset <= spanEnd) {
      oldSegmentIds.push(seg.segmentId);
    }
  }
  // Ensure block segments are included
  for (const seg of block.segments) {
    if (!oldSegmentIds.includes(seg.segmentId)) {
      oldSegmentIds.push(seg.segmentId);
    }
  }

  // Build sentence segments with leading space on subsequent segments.
  // This ensures complete text coverage — no orphaned inter-sentence spaces.
  const newSegments = sentences.map((sentence, i) => ({
    text: i === 0 ? sentence : ' ' + sentence,
    segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'sanitized',
    sourceActionId: null,
  }));

  // Build the new full textarea text
  let before = currentFullText.slice(0, spanStart);
  let after = currentFullText.slice(spanEnd);

  // --- Deterministic boundary fixups ---

  // 0. Leading-space restoration: The LLM trims each sentence, stripping the
  //    leading space that was part of the raw segment (e.g., " Recommend" → "Recommend").
  //    If `before` ends without whitespace and `joinedText` starts with a word char,
  //    restore the space so "herniation.Recommend" becomes "herniation. Recommend".
  if (before.length > 0 && joinedText.length > 0) {
    const lastBeforeChar = before[before.length - 1];
    const firstJoinedChar = joinedText[0];
    if (!/\s/.test(lastBeforeChar) && /\S/.test(firstJoinedChar)) {
      joinedText = ' ' + joinedText;
      // Also prepend space to the first segment so offsets stay consistent
      if (newSegments.length > 0) {
        newSegments[0] = { ...newSegments[0], text: ' ' + newSegments[0].text };
      }
      console.log('[applyPass1Result] Restored leading space between before-text and joinedText');
    }
  }

  // 0b. Preceding continuation fixup: if `before` ends with terminal punctuation
  //     and `joinedText` starts with a lowercase letter, the new text is a
  //     grammatical continuation — strip the terminal punctuation so the
  //     sentences merge naturally (e.g., "sinuses. and" → "sinuses and").
  if (before.length > 0 && joinedText.length > 0 && !precedingMerged) {
    const trBefore = before.trimEnd();
    const trJoined = joinedText.trimStart();
    if (trBefore.length > 0 && trJoined.length > 0) {
      const lastChar = trBefore[trBefore.length - 1];
      if ('.!?'.includes(lastChar) && /^[a-z]/.test(trJoined)) {
        before = before.slice(0, before.lastIndexOf(lastChar)) + before.slice(before.lastIndexOf(lastChar) + 1);
        console.log('[applyPass1Result] Preceding continuation fixup: stripped terminal punctuation from before-text');
      }
    }
  }

  // 1. Double-period prevention: if joinedText ends with terminal punctuation
  //    and `after` starts with the same punctuation, strip only the duplicate.
  //    Preserve any space after it — it separates sentences.
  //    Example: joinedText="brain tumor." + after=". Left" → after=" Left"
  if (joinedText.length > 0 && after.length > 0) {
    const lastChar = joinedText[joinedText.length - 1];
    if ('.!?'.includes(lastChar) && after[0] === lastChar) {
      after = after.slice(1);
    }
  }

  // 2. Boundary capitalization: if joinedText ends mid-sentence (no terminal
  //    punctuation) and `after` starts with an uppercase letter, lowercase it.
  //    Example: "disease and" + "There is..." → "disease and" + "there is..."
  if (joinedText.length > 0 && after.length > 0) {
    const lastChar = joinedText[joinedText.length - 1];
    const endsWithTerminal = '.!?'.includes(lastChar);
    if (!endsWithTerminal && /^[A-Z]/.test(after)) {
      after = after[0].toLowerCase() + after.slice(1);
    }
  }

  const newFullText = before + joinedText + after;

  // --- Build "after" data for QA log ---
  const afterSegments = [];
  const decisions = [];

  // Track preceding decision
  if (precedingSegs?.length > 0) {
    if (precedingMerged) {
      decisions.push(`Preceding merge: absorbed ${precedingSegs.length} segment(s)`);
    } else if (precedingEchoCount > 0) {
      decisions.push(`Preceding echo: stripped ${precedingEchoCount} sentence(s)`);
    }
  }

  // Track following decision
  if (followingSeg) {
    if (followingMerged) {
      decisions.push('Following merge: absorbed 1 segment');
    } else if (followingEchoCount > 0) {
      decisions.push(`Following echo: stripped ${followingEchoCount} sentence(s)`);
    }
  }

  // Preceding context segments (if not absorbed by merge)
  if (!precedingMerged && precedingSegs?.length > 0) {
    for (const seg of [...precedingSegs].sort((a, b) => a.startOffset - b.startOffset)) {
      afterSegments.push({
        range: `[${seg.startOffset},${seg.endOffset}]`,
        status: seg.status,
        text: (seg.text || '').slice(0, 50) + ((seg.text || '').length > 50 ? '…' : ''),
        role: 'context',
      });
    }
  }

  // New segments from Pass 1
  let ofs = spanStart;
  for (const seg of newSegments) {
    afterSegments.push({
      range: `[${ofs},${ofs + seg.text.length}]`,
      status: seg.status || 'sanitized',
      text: seg.text.slice(0, 50) + (seg.text.length > 50 ? '…' : ''),
      role: 'new',
    });
    ofs += seg.text.length;
  }

  // Following context segment (if not absorbed by merge)
  if (!followingMerged && followingSeg) {
    const delta = newFullText.length - currentFullText.length;
    afterSegments.push({
      range: `[${followingSeg.startOffset + delta},${followingSeg.endOffset + delta}]`,
      status: followingSeg.status,
      text: (followingSeg.text || '').slice(0, 50) + ((followingSeg.text || '').length > 50 ? '…' : ''),
      role: 'context',
    });
  }

  // Phase 5: Check if any old segments were 'structured' and need rollback
  rollbackStructuredSegments(targetId, oldSegmentIds);

  const cursorBeforeApply = getCaretPosition(targetId);
  store.replaceSegmentsWithSanitized(targetId, oldSegmentIds, newSegments, newFullText);

  // --- Action Log: text changed ---
  // Capture absorbed context for undo (preceding/following segments that were merged)
  const absorbedPreceding = precedingMerged && precedingSegs?.length > 0
    ? precedingSegs.map(seg => ({
        segmentId: seg.segmentId,
        text: currentFullText.slice(seg.startOffset, seg.endOffset),
        status: seg.status,
      }))
    : [];
  const absorbedFollowing = followingMerged && followingSeg
    ? [{
        segmentId: followingSeg.segmentId,
        text: currentFullText.slice(followingSeg.startOffset, followingSeg.endOffset),
        status: followingSeg.status,
      }]
    : [];

  // Read the committed segment IDs (replaceSegmentsWithSanitized built them)
  const committedSegs = useReportStore.getState().segments[targetId] || [];
  const committedOutputIds = newSegments.map(ns => {
    const found = committedSegs.find(s => s.segmentId === ns.segmentId);
    return found ? found.segmentId : ns.segmentId;
  });

  // Determine if this Pass 1 produced a material text change.
  // Compare the FULL textarea text before vs after replacement. This is more
  // robust than comparing block-level chunkText vs joinedText because it
  // accounts for preceding/following context merges, boundary fixups, and
  // echo stripping — all of which can make a no-op look like a change if
  // only the block slice is compared.
  // When the overall text is unchanged (e.g., re-processing after a deletion),
  // the entry is recorded for QA but should NOT be undoable — the erasure
  // strategy would incorrectly remove text that was already present, and
  // pushing to the undoStack would clear the redoStack.
  const isNoOpReprocess = currentFullText.trim() === newFullText.trim();
  console.log(
    `[applyPass1Result] No-op check: isNoOp=${isNoOpReprocess} | ` +
    `beforeLen=${currentFullText.trim().length} afterLen=${newFullText.trim().length} | ` +
    `before="${currentFullText.trim().slice(0, 60)}${currentFullText.trim().length > 60 ? '…' : ''}" | ` +
    `after="${newFullText.trim().slice(0, 60)}${newFullText.trim().length > 60 ? '…' : ''}" | ` +
    `precMerged=${precedingMerged} folMerged=${followingMerged}`
  );

  store.addActionLogEntry({
    type: 'pass1',
    subtype: 'text_changed',
    targetId,
    inputText: meta.chunkText || '',
    outputText: joinedText,
    outputSegmentTexts: newSegments.map(s => s.text),
    outputSegmentIds: committedOutputIds,
    absorbedContext: {
      preceding: absorbedPreceding,
      following: absorbedFollowing,
    },
    cursorBefore: cursorBeforeApply,
    cursorAfter: getCaretPosition(targetId),
    undoable: !isNoOpReprocess,
  });

  return { segments: afterSegments, decisions };
}

/**
 * Handle "Ok" response: consolidate raw/dirty word-level segments
 * into sentence-level sanitized segments using deterministic splitting.
 * Does NOT touch preceding/following segments.
 */
function consolidateOkSegments(targetId, block, meta) {
  const store = useReportStore.getState();

  const currentFullText = targetId === 'dictation-box'
    ? store.dictationText
    : (store.contentBoxStates[targetId]?.currentText || '');

  // No staleness guard needed — Pass 1 blocks the queue.

  // Get the raw text for this block
  const blockStart = block.segments[0].startOffset;
  const blockEnd = block.segments[block.segments.length - 1].endOffset;
  const rawText = currentFullText.slice(blockStart, blockEnd);

  // Apply autocorrect — the pre-API autocorrect (line 372) only modified a
  // local chunkText variable sent to the LLM. This is where autocorrect
  // corrections are actually materialized into the stored segment text.
  const correctedText = autocorrectService.apply(rawText);

  // Split into sentences for segment boundary detection
  const sentences = splitIntoSentences(correctedText);
  if (sentences.length === 0) {
    // No sentences — just mark as sanitized
    const segIds = block.segments.map((seg) => seg.segmentId);
    store.markSegmentsSanitized(targetId, segIds);
    return {
      segments: block.segments.map(seg => ({
        range: `[${seg.startOffset},${seg.endOffset}]`,
        status: 'sanitized',
        text: (seg.text || '').slice(0, 50) + ((seg.text || '').length > 50 ? '…' : ''),
        role: 'marked',
      })),
      decisions: ['No change — marked sanitized'],
    };
  }

  // Collect old segment IDs (only the raw block, not neighbors)
  const oldSegmentIds = block.segments.map((seg) => seg.segmentId);

  // --- Build sentence segments that preserve the full correctedText length ---
  // Map each sentence back to its position in correctedText so that any
  // trailing whitespace between the last sentence and the block end is
  // preserved in the final segment (preventing delta shifts that cascade
  // to subsequent blocks).
  const newSegments = [];
  let searchFrom = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const posInCorrected = correctedText.indexOf(sentence, searchFrom);

    if (posInCorrected === -1) {
      // Fallback: if indexOf fails, use the trimmed sentence directly
      newSegments.push({
        text: i === 0 ? sentence : ' ' + sentence,
        segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'sanitized',
        sourceActionId: null,
      });
      searchFrom += sentence.length;
      continue;
    }

    // For the first sentence, include any text from block start to the sentence.
    // For subsequent sentences, include inter-sentence whitespace.
    const segStart = (i === 0) ? 0 : searchFrom;
    const isLastSentence = (i === sentences.length - 1);
    // Last sentence extends to end of correctedText to preserve trailing whitespace
    const segEnd = isLastSentence
      ? correctedText.length
      : posInCorrected + sentence.length;

    const segText = correctedText.slice(segStart, segEnd);

    newSegments.push({
      text: segText,
      segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'sanitized',
      sourceActionId: null,
    });

    searchFrom = segEnd;
  }

  // Use correctedText directly — preserves trailing whitespace that
  // sentences.join(' ') would lose. This prevents delta shifts when the
  // LLM said "Ok" and autocorrect made no length changes.
  const joinedText = correctedText;
  const before = currentFullText.slice(0, blockStart);
  const after = currentFullText.slice(blockEnd);

  // NOTE: Leading-space restoration and preceding-continuation fixups are
  // intentionally omitted from the Ok path. The LLM confirmed the text is
  // correct as-is. These boundary reconciliation heuristics remain in
  // applyPass1Result (text-changed path) where they serve their intended purpose.

  const newFullText = before + joinedText + after;

  // Build "after" data for QA log
  let ofs = blockStart;
  const afterSegments = newSegments.map(seg => {
    const entry = {
      range: `[${ofs},${ofs + seg.text.length}]`,
      status: 'sanitized',
      text: seg.text.slice(0, 50) + (seg.text.length > 50 ? '…' : ''),
      role: 'consolidated',
    };
    ofs += seg.text.length;
    return entry;
  });

  // Phase 5: Check if any old segments were 'structured' and need rollback
  rollbackStructuredSegments(targetId, oldSegmentIds);

  const cursorBeforeOk = getCaretPosition(targetId);
  store.replaceSegmentsWithSanitized(targetId, oldSegmentIds, newSegments, newFullText);

  // Action Log: Ok consolidation (text unchanged or autocorrect-only)
  const committedOkSegs = useReportStore.getState().segments[targetId] || [];
  const committedOkIds = newSegments.map(ns => {
    const found = committedOkSegs.find(s => s.segmentId === ns.segmentId);
    return found ? found.segmentId : ns.segmentId;
  });

  // Ok consolidation: check if the block segments are 'raw' (fresh dictation/typing).
  // Raw segments = fresh content the user just added → undoable (user may want to
  // "take back" what they dictated). Dirty segments = re-processing of existing text
  // (e.g., after a segment status change) → not undoable.
  // The full-text comparison doesn't work here because by the time Pass 1 runs,
  // the dictated text is already in the textarea — currentFullText === newFullText
  // even for fresh dictation.
  const isFromFreshContent = block.segments.every(s => s.status === 'raw');
  console.log(
    `[consolidateOkSegments] Undoable check: isFromFreshContent=${isFromFreshContent} | ` +
    `segStatuses=[${block.segments.map(s => s.status).join(', ')}]`
  );

  store.addActionLogEntry({
    type: 'pass1',
    subtype: 'ok_consolidation',
    targetId,
    inputText: rawText,
    outputText: joinedText,
    outputSegmentTexts: newSegments.map(s => s.text),
    outputSegmentIds: committedOkIds,
    absorbedContext: { preceding: [], following: [] },
    cursorBefore: cursorBeforeOk,
    cursorAfter: getCaretPosition(targetId),
    undoable: isFromFreshContent,
  });

  return {
    segments: afterSegments,
    decisions: ['No change — sentence consolidation'],
  };
}

// --- Deterministic Isolated Punctuation Merge ---

/**
 * Detect and deterministically merge isolated punctuation blocks.
 *
 * When the user types a punctuation character into existing text, it creates
 * an isolated raw/dirty segment containing only that character (e.g., ".").
 * Rather than sending this to the LLM (which produces orphaned punctuation
 * artifacts), we merge it directly into adjacent segments.
 *
 * Class A (. ! ?) → sentence boundary:
 *   - Attach punctuation to end of preceding segment
 *   - Capitalize first letter of following segment
 *   - Produce 2 sanitized segments (sentence split)
 *
 * Class B (, ; :) → intra-sentence:
 *   - Attach punctuation to end of preceding segment
 *   - Merge preceding + punctuation + following into 1 sanitized segment
 *   - No capitalization change
 *
 * @param {object} block - The contiguous block of raw/dirty segments
 * @param {Array} sortedAll - All segments for this textarea, sorted by offset
 * @param {string} targetId - Textarea identifier
 * @param {string} currentFullText - Current textarea content
 * @param {object} segmentSnapshot - Segment snapshot for QA logging
 * @param {Array} blockDetails - Block details for QA logging
 * @returns {boolean} true if the block was handled (skip LLM), false otherwise
 */
function tryMergeIsolatedPunctuation(block, sortedAll, targetId, currentFullText, segmentSnapshot, blockDetails) {
  const blockStart = block.segments[0].startOffset;
  const blockEnd = block.segments[block.segments.length - 1].endOffset;
  const blockText = currentFullText.slice(blockStart, blockEnd);

  // Only match pure punctuation (with optional surrounding whitespace)
  const trimmed = blockText.trim();
  if (!/^[.!?,;:]+$/.test(trimmed)) return false;

  // Find nearest preceding segment (any status), but not across a structural newline
  const nearestPrecNewline = sortedAll
    .filter(s => s.status === 'structural' && s.text === '\n' && s.endOffset <= blockStart)
    .sort((a, b) => b.endOffset - a.endOffset)[0];
  const precBarrier = nearestPrecNewline ? nearestPrecNewline.endOffset : -1;

  const precSeg = sortedAll.filter(s => s.endOffset <= blockStart && s.status !== 'structural' && s.startOffset >= precBarrier).pop();
  if (!precSeg) {
    console.log(`[Pass1Service] Isolated punctuation "${trimmed}" has no preceding segment (or blocked by newline) — falling through to LLM`);
    return false;
  }

  // Find nearest following segment (any status), but not across a structural newline
  const nearestFollowNewline = sortedAll.find(
    s => s.status === 'structural' && s.text === '\n' && s.startOffset >= blockEnd
  );
  const followBarrier = nearestFollowNewline ? nearestFollowNewline.startOffset : Infinity;
  const followSeg = sortedAll.find(s => s.startOffset >= blockEnd && s.status !== 'structural' && s.startOffset < followBarrier);

  const isSentenceBoundary = /^[.!?]+$/.test(trimmed);
  const precText = currentFullText.slice(precSeg.startOffset, precSeg.endOffset).trimEnd();

  console.log(`[Pass1Service] Isolated punctuation detected: "${trimmed}" (${isSentenceBoundary ? 'Class A: sentence boundary' : 'Class B: intra-sentence'})`);
  console.log(`  Preceding: [${precSeg.startOffset},${precSeg.endOffset}] "${precText.slice(-40)}"`);
  if (followSeg) {
    console.log(`  Following: [${followSeg.startOffset},${followSeg.endOffset}] "${currentFullText.slice(followSeg.startOffset, followSeg.endOffset).slice(0, 40)}"`);
  }

  // Collect old segment IDs — always includes preceding + punctuation block
  const oldSegmentIds = [
    precSeg.segmentId,
    ...block.segments.map(s => s.segmentId),
  ];

  let newSegments;
  let spanStart = precSeg.startOffset;
  let spanEnd = blockEnd;
  let followText = '';
  let decisions;

  if (isSentenceBoundary) {
    // --- Class A: Sentence boundary (. ! ?) ---
    // Attach punctuation to preceding text, capitalize following text.
    // Output: 2 segments (sentence split).
    const mergedPrecText = precText + trimmed;

    newSegments = [
      {
        text: mergedPrecText,
        segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'sanitized',
        sourceActionId: null,
      },
    ];

    if (followSeg) {
      followText = currentFullText.slice(followSeg.startOffset, followSeg.endOffset);
      // Capitalize first alphabetic character (preserve leading space)
      followText = followText.replace(/^(\s*)([a-z])/, (_, sp, ch) => sp + ch.toUpperCase());
      newSegments.push({
        text: followText,
        segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'sanitized',
        sourceActionId: null,
      });
      oldSegmentIds.push(followSeg.segmentId);
      spanEnd = followSeg.endOffset;
    }

    decisions = [`Deterministic merge: sentence-boundary punctuation (${trimmed})`];
    console.log(`[Pass1Service] Class A merge: "${mergedPrecText.slice(-30)}" + "${followText.slice(0, 30)}"`);

  } else {
    // --- Class B: Intra-sentence (, ; :) ---
    // Attach punctuation to preceding text, merge all three into one segment.
    // Output: 1 segment (no sentence split).
    let mergedText = precText + trimmed;

    if (followSeg) {
      followText = currentFullText.slice(followSeg.startOffset, followSeg.endOffset);
      // Ensure spacing: if following text doesn't start with a space, add one
      if (followText.length > 0 && !/^\s/.test(followText)) {
        mergedText += ' ';
      }
      mergedText += followText;
      oldSegmentIds.push(followSeg.segmentId);
      spanEnd = followSeg.endOffset;
    }

    newSegments = [
      {
        text: mergedText,
        segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'sanitized',
        sourceActionId: null,
      },
    ];

    decisions = [`Deterministic merge: intra-sentence punctuation (${trimmed})`];
    console.log(`[Pass1Service] Class B merge: "${mergedText.slice(0, 60)}"`);
  }

  // Build new full text
  const joinedNew = newSegments.map(s => s.text).join('');
  const newFullText = currentFullText.slice(0, spanStart) + joinedNew + currentFullText.slice(spanEnd);

  // Rollback any structured segments being replaced
  rollbackStructuredSegments(targetId, oldSegmentIds);

  // Apply the replacement atomically
  const cursorBeforeMerge = getCaretPosition(targetId);
  useReportStore.getState().replaceSegmentsWithSanitized(targetId, oldSegmentIds, newSegments, newFullText);

  // Build after data for QA log
  let ofs = spanStart;
  const afterSegments = newSegments.map(seg => {
    const entry = {
      range: `[${ofs},${ofs + seg.text.length}]`,
      status: 'sanitized',
      text: seg.text.slice(0, 50) + (seg.text.length > 50 ? '…' : ''),
      role: 'merged',
    };
    ofs += seg.text.length;
    return entry;
  });

  // Action Log: deterministic punctuation merge
  // Preceding segment was always absorbed; following was absorbed for class A + class B
  const absorbedPrecMerge = [{
    segmentId: precSeg.segmentId,
    text: currentFullText.slice(precSeg.startOffset, precSeg.endOffset),
    status: precSeg.status,
  }];
  const absorbedFollowMerge = followSeg ? [{
    segmentId: followSeg.segmentId,
    text: currentFullText.slice(followSeg.startOffset, followSeg.endOffset),
    status: followSeg.status,
  }] : [];

  const mergeStore = useReportStore.getState();
  const committedMergeSegs = mergeStore.segments[targetId] || [];
  const committedMergeIds = newSegments.map(ns => {
    const found = committedMergeSegs.find(s => s.segmentId === ns.segmentId);
    return found ? found.segmentId : ns.segmentId;
  });

  mergeStore.addActionLogEntry({
    type: 'pass1',
    subtype: 'deterministic_merge',
    targetId,
    inputText: trimmed,
    outputText: joinedNew,
    outputSegmentTexts: newSegments.map(s => s.text),
    outputSegmentIds: committedMergeIds,
    absorbedContext: {
      preceding: absorbedPrecMerge,
      following: absorbedFollowMerge,
    },
    cursorBefore: cursorBeforeMerge,
    cursorAfter: getCaretPosition(targetId),
  });

  // Log to QA
  logPass1ToQA(
    block,
    { result: joinedNew, noChange: false },
    0, // no LLM latency
    ['deterministic_punctuation_merge'],
    { precedingText: precText, chunkText: trimmed, followingText: followText, sortedAll },
    segmentSnapshot,
    blockDetails,
    { segments: afterSegments, decisions }
  );

  console.log(`[Pass1Service] Isolated punctuation merge complete — skipped LLM call`);
  return true;
}

// --- QA Logging ---

/**
 * Log a Pass 1 event to the QA log with full context and segment diagnostics.
 */
function logPass1ToQA(block, data, latencyMs, warnings, meta, segmentSnapshot, blockDetails, afterData) {
  const store = useReportStore.getState();
  const inputText = block.segments.map((seg) => seg.text).join(' ');

  // Parse sentence count from result
  const sentences = data?.result && !data?.noChange
    ? data.result.split('\n').filter(s => s.trim()).length
    : 0;

  store.addQaLogEntry({
    type: 'PASS1',
    raw: inputText,
    corrected: data?.noChange ? '(no change)' : (data?.result || null),
    autocorrected: data ? !data.noChange : false,
    latencyMs,
    completedSentences: data?.noChange ? [] : [data?.result || ''],
    openFragment: '',
    warnings: warnings || [],
    targetId: block.segments[0]?.textareaTarget || 'unknown',
    // Full context sent to the LLM
    precedingText: meta?.precedingText || '',
    chunkText: meta?.chunkText || inputText,
    followingText: meta?.followingText || '',
    sentenceCount: sentences,
    // Segment diagnostics
    segmentSnapshot: segmentSnapshot || null,
    blockDetails: blockDetails || null,
    // After data: resulting segments + echo/merge decisions
    afterData: afterData || null,
    // Token usage
    inputTokens: data?.inputTokens ?? null,
    outputTokens: data?.outputTokens ?? null,
  });

  // Accumulate token usage for session totals
  if (data?.inputTokens || data?.outputTokens) {
    store.addTokenUsage('pass1', data.inputTokens || 0, data.outputTokens || 0);
  }
}

// --- Structured rollback helper ---

/**
 * Check if any of the segments being replaced were 'structured'
 * (already placed by Pass 2) and trigger rollback for those.
 * This handles:
 *   - Pass 1 absorbing/joining a structured segment with new text
 *   - A structured segment going from 'structured' back to 'sanitized'
 */
function rollbackStructuredSegments(targetId, oldSegmentIds) {
  const store = useReportStore.getState();
  const segs = store.segments[targetId] || [];

  for (const segId of oldSegmentIds) {
    const seg = segs.find((s) => s.segmentId === segId);
    if (seg && seg.status === 'structured') {
      console.log(`[Pass1Service] Structured segment ${segId} being replaced — triggering rollback with co-participant replay`);
      store.rollbackWithCoParticipantReplay(segId);
    }
  }
}

export default {
  startDebounce,
  cancelDebounce,
  resetPass1,
};
