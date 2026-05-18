/**
 * Pass 2 Service — Phase 5 (2A/2B Architecture)
 *
 * Orchestrates two focused LLM calls:
 *   Pass 2A: Finding placement (parse segments → ideas → report sections)
 *   Pass 2B: Normal processing (for each normal: keep / suppress / edit)
 *
 * Lifecycle:
 *   Pass 1 completes → all dictation-box segments sanitized →
 *   900ms debounce → firePass2() → 2A → 2B → apply merged results
 *
 * Token-efficient design:
 *   - Short IDs (S1, R1, N1, F1) mapped to full IDs
 *   - JSONL output format with single-character keys
 *   - Pass 2A omits "t" for verbatim segments
 *   - Pass 2B uses single-char action codes (K/S/E)
 *
 * Concurrency:
 *   - Only one Pass 2 can be in-flight at a time (checked via action queue)
 *   - If a Pass 2 is in-flight when another tries to fire, discard and reset debounce
 *
 * Post-completion validation:
 *   - Before inserting each finding, verify the source segment is still "sanitized"
 *   - If the segment was edited (→ dirty) or deleted during Pass 2, skip insertion
 */

import useReportStore from '../stores/useReportStore';
import { startImpressionDebounce } from './impressionService';
import {
  isDescendantOfLabel,
  findNearestAncestor,
  getDescendants,
  SECTION_TYPES,
} from '../utils/templateAdapter';

const DEBOUNCE_MS = 900;

let debounceTimer = null;
let pass2RunCounter = 0; // For unique run IDs in QA logs

// --- Public API ---

export function startPass2Debounce() {
  const store = useReportStore.getState();

  // Don't start if Pass 2 is already in-flight
  if (store.pass2Status === 'in_flight') {
    console.log('[Pass2Service] Skipping debounce — Pass 2 already in-flight');
    return;
  }

  // Don't start if Pass 1 is still running
  if (store.pass1Status === 'in_flight' || store.pass1Status === 'debouncing') {
    return;
  }

  // Don't start if there are no sanitized segments in dictation-box
  const dictSegments = store.segments['dictation-box'] || [];
  const hasSanitized = dictSegments.some((s) => s.status === 'sanitized');
  if (!hasSanitized) return;

  if (debounceTimer) clearTimeout(debounceTimer);

  store.setPass2Status('debouncing');
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    firePass2();
  }, DEBOUNCE_MS);
}

export function cancelPass2Debounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const store = useReportStore.getState();
  if (store.pass2Status === 'debouncing') {
    store.setPass2Status('idle');
  }
}

export function resetPass2() {
  cancelPass2Debounce();
  useReportStore.getState().setPass2Status('idle');
}

// --- Map Building ---

/**
 * Build short ID maps for segments and sections only (no normals).
 * Normals are collected separately after Pass 2A returns.
 */
function buildPlacementMaps(sanitizedSegments, templateNodes, contentBoxStates, nodeMap) {
  let segCounter = 1;
  let secCounter = 1;

  const segmentMap = {};   // S1 → fullSegmentId
  const sectionMap = {};   // R1 → fullSectionId

  // Segments for the prompt
  const segments = sanitizedSegments.map((seg) => {
    const shortId = `S${segCounter++}`;
    segmentMap[shortId] = seg.segmentId;
    return { shortId, text: seg.text.trim(), fullId: seg.segmentId };
  });

  // Flat iteration over nodeMap to collect sections/subsections
  const sections = [];

  for (const node of Object.values(nodeMap)) {
    if (SECTION_TYPES.includes(node.type)) {
      const shortId = `R${secCounter++}`;
      sectionMap[shortId] = node.id;

      const isFindings = isDescendantOfLabel(node.id, 'findings', nodeMap) ||
        (node.label || node.text || '').toLowerCase() === 'findings';

      sections.push({
        shortId,
        fullId: node.id,
        label: node.label || node.text || node.id,
        isFindings,
      });
    }
  }

  return { segmentMap, sectionMap, segments, sections };
}

/**
 * Build the normals list from the current template state.
 * Called after Pass 2A returns, so we get the freshest normal state.
 */
function buildNormalsList(contentBoxStates, nodeMap) {
  let normCounter = 1;
  const normalMap = {};    // N1 → fullNormalId
  const normals = [];

  for (const node of Object.values(nodeMap)) {
    if (node.type === 'content' && node.normalIndex !== undefined) {
      const box = contentBoxStates[node.id];
      if (box && !box.manuallyEdited && !box.deleted && !box.pass2Inserted) {
        const shortId = `N${normCounter++}`;
        normalMap[shortId] = node.id;

        normals.push({
          shortId,
          fullId: node.id,
          text: box.currentText,
        });
      }
    }
  }

  return { normalMap, normals };
}

/**
 * Build the findings list for Pass 2B from Pass 2A operations.
 * Creates short finding IDs (F1, F2, ...) and maps them to source segment IDs.
 *
 * @param {Array} operations - Parsed Pass 2A operations
 * @param {Object} segmentMap - Short segment ID → full segment ID
 * @param {Object} originalSegmentTexts - Short segment ID → original text
 * @returns {{ findingMap, findings }}
 */
function buildFindingsList(operations, segmentMap, originalSegmentTexts) {
  let fCounter = 1;
  const findingMap = {};   // F1 → { segmentShortId, sourceSegmentId }
  const findings = [];

  for (const op of operations) {
    // Skip NA (meaningless) segments — they don't produce findings
    if (op.isNA) continue;

    const shortId = `F${fCounter++}`;
    const sourceSegmentId = segmentMap[op.sourceSegmentShortId];

    findingMap[shortId] = {
      segmentShortId: op.sourceSegmentShortId,
      sourceSegmentId,
    };

    // If "t" was omitted by the LLM (verbatim), use original segment text
    const text = op.adjustedText || originalSegmentTexts[op.sourceSegmentShortId] || '';

    findings.push({ shortId, text });
  }

  return { findingMap, findings };
}

// --- Core Logic ---

async function firePass2() {
  const store = useReportStore.getState();

  // Final checks before firing
  if (!store.isQueueDrained()) {
    store.setPass2Status('idle');
    return;
  }

  // Concurrency guard: check for in-flight Pass 2 in action queue
  const inFlightPass2 = store.actionQueue.find(
    (e) => e.actionType === 'pass2' && e.status === 'in_flight'
  );
  if (inFlightPass2) {
    console.log('[Pass2Service] Discarding — Pass 2 already in-flight');
    store.setPass2Status('idle');
    setTimeout(() => startPass2Debounce(), 500);
    return;
  }

  // Collect sanitized segments from dictation-box only
  const dictSegments = store.segments['dictation-box'] || [];
  const sanitizedSegments = dictSegments.filter((s) => s.status === 'sanitized');

  if (sanitizedSegments.length === 0) {
    store.setPass2Status('idle');
    return;
  }

  // Build placement maps (segments + sections only)
  const { segmentMap, sectionMap, segments, sections } =
    buildPlacementMaps(sanitizedSegments, store.templateNodes, store.contentBoxStates, store.nodeMap);

  if (sections.length === 0) {
    console.warn('[Pass2Service] No sections found in template — skipping Pass 2');
    store.setPass2Status('idle');
    return;
  }

  // Build original segment text lookup for verbatim fallback
  const originalSegmentTexts = {};
  for (const seg of segments) {
    originalSegmentTexts[seg.shortId] = seg.text;
  }

  // Create a unique run ID for QA logging
  pass2RunCounter++;
  const runId = `P2_${pass2RunCounter}_${Date.now()}`;

  // Record version stamps for target content boxes
  const snapshotVersions = {};
  for (const [, fullId] of Object.entries(sectionMap)) {
    walkContentBoxVersions(fullId, store.nodeMap, store.contentBoxStates, snapshotVersions);
  }

  // Create action queue entry for Pass 2
  const pass2Entry = {
    actionId: `aq_p2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    targetId: 'dictation-box',
    caretPosition: 0,
    selectionRange: null,
    actionType: 'pass2',
    asrBuffer: [],
    resolvedText: null,
    status: 'in_flight',
    // Pass 2-specific data
    segmentIds: sanitizedSegments.map((s) => s.segmentId),
    segmentMap,
    sectionMap,
    snapshotVersions,
    runId,
  };

  store.setPass2Status('in_flight');

  // Add to action queue
  useReportStore.setState((s) => ({
    actionQueue: [...s.actionQueue, pass2Entry],
  }));

  try {
    // ═══════════════════════════════════════════════════════════════
    // Pass 2A: Finding Placement
    // ═══════════════════════════════════════════════════════════════
    const startTime2A = performance.now();

    const response2A = await fetch('/api/dictation/pass2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, sections, runId }),
    });

    const latency2A = Math.round(performance.now() - startTime2A);

    if (!response2A.ok) {
      throw new Error(`Pass 2A API returned ${response2A.status}`);
    }

    const data2A = await response2A.json();
    const operations = data2A.operations || [];

    // Log Pass 2A to QA
    logPass2AToQA(pass2Entry, data2A, latency2A, segments, data2A.warnings || []);

    // ═══════════════════════════════════════════════════════════════
    // Build findings list from 2A output for 2B
    // ═══════════════════════════════════════════════════════════════
    const { findingMap, findings } = buildFindingsList(operations, segmentMap, originalSegmentTexts);

    // Build normals list (fresh from current store state)
    const freshStore = useReportStore.getState();
    const { normalMap, normals } = buildNormalsList(freshStore.contentBoxStates, freshStore.nodeMap);

    // Store normalMap on pass2Entry for use in application
    pass2Entry.normalMap = normalMap;
    pass2Entry.findingMap = findingMap;

    // ═══════════════════════════════════════════════════════════════
    // Pass 2B: Normal Processing
    // ═══════════════════════════════════════════════════════════════
    let data2B = null;
    let latency2B = 0;

    if (normals.length > 0) {
      const startTime2B = performance.now();

      const response2B = await fetch('/api/dictation/pass2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findings, normals, runId }),
      });

      latency2B = Math.round(performance.now() - startTime2B);

      if (response2B.ok) {
        data2B = await response2B.json();
      } else {
        console.warn(`[Pass2Service] Pass 2B returned ${response2B.status} — normals will remain unchanged`);
        data2B = { normalDecisions: [], warnings: ['pass2b_http_error'] };
      }
    } else {
      data2B = { normalDecisions: [], warnings: [] };
    }

    // Log Pass 2B to QA
    logPass2BToQA(pass2Entry, data2B, latency2B, normals, findings, data2B.warnings || []);

    // ═══════════════════════════════════════════════════════════════
    // Apply merged results
    // ═══════════════════════════════════════════════════════════════
    applyMergedResults(pass2Entry, operations, data2B.normalDecisions || [], originalSegmentTexts);

  } catch (e) {
    console.error('[Pass2Service] Pass 2 failed:', e.message || e);
    store.setPass2Status('error');

    logPass2AToQA(pass2Entry, null, 0, segments, ['pass2_call_failed']);

    resolvePass2Entry(pass2Entry.actionId);

    setTimeout(() => {
      const s = useReportStore.getState();
      if (s.pass2Status === 'error') s.setPass2Status('idle');
    }, 5000);
  }
}

/**
 * Snapshot content box versions under a section using getDescendants.
 */
function walkContentBoxVersions(sectionId, nodeMap, contentBoxStates, versions) {
  const descendants = getDescendants(sectionId, nodeMap);
  for (const node of descendants) {
    if (node.type === 'content') {
      const box = contentBoxStates[node.id];
      if (box) {
        versions[node.id] = box.version;
      }
    }
  }
}

// --- Result Application ---

function applyMergedResults(pass2Entry, operations, normalDecisions, originalSegmentTexts) {
  const store = useReportStore.getState();
  const { segmentMap, sectionMap, normalMap, snapshotVersions } = pass2Entry;

  // ══════════════════════════════════════════════════════════════════
  // Phase A: Apply finding placements from Pass 2A
  // ══════════════════════════════════════════════════════════════════

  if (operations.length === 0 && normalDecisions.length === 0) {
    console.log('[Pass2Service] No operations or normal decisions — nothing to apply');
    resolvePass2Entry(pass2Entry.actionId);
    store.setPass2Status('idle');
    return;
  }

  const processedSegmentIds = new Set();
  const skippedSegmentIds = new Set();
  const naSegmentIds = new Set();

  // --- Extract NA (meaningless) operations first ---
  const meaningfulOps = [];
  for (const op of operations) {
    if (op.isNA || op.targetSectionShortId === 'NA') {
      const sourceSegmentId = segmentMap[op.sourceSegmentShortId];
      if (sourceSegmentId) {
        const latestStore = useReportStore.getState();
        const dictSegs = latestStore.segments['dictation-box'] || [];
        const seg = dictSegs.find((s) => s.segmentId === sourceSegmentId);
        if (seg && seg.status === 'sanitized') {
          naSegmentIds.add(sourceSegmentId);
          processedSegmentIds.add(sourceSegmentId);
          console.log(`[Pass2Service] Segment ${op.sourceSegmentShortId} (${sourceSegmentId}) flagged as NA — meaningless, not inserting`);
        }
      }
      continue;
    }
    meaningfulOps.push(op);
  }

  // --- Group operations by (groupId, targetSection) ---
  let ungroupedCounter = 0;
  const groupMap = new Map();

  for (const op of meaningfulOps) {
    const groupKey = (op.groupId)
      ? `${op.groupId}__${op.targetSectionShortId}`
      : `standalone_${ungroupedCounter++}`;

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, []);
    }
    groupMap.get(groupKey).push(op);
  }

  // --- Process each group ---
  for (const [groupKey, groupOps] of groupMap) {
    groupOps.sort((a, b) => (a.position || 1) - (b.position || 1));

    const isGrouped = groupOps.length > 1;

    const resolvedOps = [];
    let groupValid = true;

    const latestStore = useReportStore.getState();
    const dictSegments = latestStore.segments['dictation-box'] || [];

    for (const op of groupOps) {
      const sourceSegmentId = segmentMap[op.sourceSegmentShortId];
      const targetSectionId = sectionMap[op.targetSectionShortId];

      if (!sourceSegmentId || !targetSectionId) {
        console.warn('[Pass2Service] Unresolvable short IDs:', op);
        groupValid = false;
        break;
      }

      const sourceSegment = dictSegments.find((s) => s.segmentId === sourceSegmentId);
      if (!sourceSegment || sourceSegment.status !== 'sanitized') {
        console.log(`[Pass2Service] Segment ${sourceSegmentId} no longer sanitized — skipping group ${groupKey}`);
        for (const gop of groupOps) {
          const sid = segmentMap[gop.sourceSegmentShortId];
          if (sid) skippedSegmentIds.add(sid);
        }
        groupValid = false;
        break;
      }

      // Use adjustedText if provided, otherwise original segment text (verbatim)
      const findingText = (op.adjustedText || originalSegmentTexts[op.sourceSegmentShortId] || sourceSegment.text).trim();

      resolvedOps.push({
        sourceSegmentId,
        targetSectionId,
        findingText,
      });
    }

    if (!groupValid || resolvedOps.length === 0) continue;

    // --- Merge texts for grouped operations ---
    const targetSectionId = resolvedOps[0].targetSectionId;
    const mergedText = resolvedOps.map((r) => r.findingText).join(' ');
    const allSourceSegmentIds = resolvedOps.map((r) => r.sourceSegmentId);
    const uniqueSourceSegmentIds = [...new Set(allSourceSegmentIds)];

    if (isGrouped) {
      console.log(`[Pass2Service] Grouping ${resolvedOps.length} ops → "${mergedText.slice(0, 80)}..."`);
    }

    // --- Insert single finding content box for the group ---
    latestStore.insertFindingContentBox(
      targetSectionId,
      uniqueSourceSegmentIds,
      mergedText,
      pass2Entry.runId
    );

    // Mark all source segments as processed
    for (const segId of uniqueSourceSegmentIds) {
      processedSegmentIds.add(segId);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase B: Apply normal decisions from Pass 2B
  // ══════════════════════════════════════════════════════════════════

  // Collect all segment IDs from this batch for normal tracking
  const allBatchSegmentIds = [...processedSegmentIds];
  const primarySegmentId = allBatchSegmentIds[0] || pass2Entry.segmentIds?.[0];

  for (const decision of normalDecisions) {
    const normalId = normalMap?.[decision.normalShortId];
    if (!normalId) {
      console.warn(`[Pass2Service] Unknown normal short ID from 2B: ${decision.normalShortId}`);
      continue;
    }

    // Skip "keep" decisions — no action needed
    if (decision.action === 'K') continue;

    const latestStore = useReportStore.getState();
    const normalBox = latestStore.contentBoxStates[normalId];
    if (!normalBox) continue;

    // Version check: skip if user edited this normal since Pass 2 started
    if (snapshotVersions[normalId] !== undefined &&
        normalBox.version !== snapshotVersions[normalId]) {
      console.log(`[Pass2Service] Normal ${normalId} version changed — skipping ${decision.action}`);
      continue;
    }

    // Skip if already manually edited
    if (normalBox.manuallyEdited) {
      console.log(`[Pass2Service] Normal ${normalId} manually edited — skipping ${decision.action}`);
      continue;
    }

    if (decision.action === 'S') {
      // Full suppression
      latestStore.softDeleteNormal(normalId, primarySegmentId);
      console.log(`[Pass2Service] Suppressed normal ${decision.normalShortId} (${normalId})`);
    } else if (decision.action === 'E' && decision.replacementText) {
      // Partial edit
      latestStore.editNormalText(normalId, decision.replacementText, primarySegmentId);
      console.log(`[Pass2Service] Edited normal ${decision.normalShortId}: "${decision.replacementText.slice(0, 60)}..."`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Finalize
  // ══════════════════════════════════════════════════════════════════

  // Mark successfully processed segments as "structured"
  const toStructure = [...processedSegmentIds].filter((id) => !skippedSegmentIds.has(id));
  if (toStructure.length > 0) {
    useReportStore.getState().markSegmentsStructured('dictation-box', toStructure);
  }

  // Mark NA segments with naFlagged for yellow highlight
  const naIds = [...naSegmentIds].filter((id) => !skippedSegmentIds.has(id));
  if (naIds.length > 0) {
    useReportStore.getState().markSegmentsNA('dictation-box', naIds);
    console.log(`[Pass2Service] Marked ${naIds.length} segment(s) as NA (meaningless)`);
  }

  // Resolve the action queue entry
  resolvePass2Entry(pass2Entry.actionId);

  useReportStore.getState().setPass2Status('idle');

  // Check if there are more sanitized segments that need processing
  setTimeout(() => {
    const s = useReportStore.getState();
    const remaining = (s.segments['dictation-box'] || []).some((seg) => seg.status === 'sanitized');
    if (remaining && s.pass2Status === 'idle') {
      startPass2Debounce();
    } else if (!remaining) {
      // All segments structured — trigger impression generation
      startImpressionDebounce();
    }
  }, 100);
}

/**
 * Resolve the Pass 2 action queue entry.
 */
function resolvePass2Entry(actionId) {
  useReportStore.setState((s) => ({
    actionQueue: s.actionQueue.map((e) =>
      e.actionId === actionId ? { ...e, status: 'resolved' } : e
    ),
  }));
}

// --- QA Logging ---

function logPass2AToQA(pass2Entry, data, latencyMs, segments, warnings) {
  const store = useReportStore.getState();

  store.addQaLogEntry({
    type: 'PASS2A',
    runId: pass2Entry.runId,
    segmentCount: segments?.length || 0,
    operationCount: data?.operations?.length || 0,
    latencyMs,
    warnings: warnings || [],
    // Include short ID maps for QA log disambiguation
    segmentMap: pass2Entry.segmentMap,
    sectionMap: pass2Entry.sectionMap,
    rawResponse: data?.rawResponse || null,
    operations: data?.operations || [],
    // Token usage
    inputTokens: data?.inputTokens ?? null,
    outputTokens: data?.outputTokens ?? null,
  });

  // Accumulate token usage for session totals
  if (data?.inputTokens || data?.outputTokens) {
    store.addTokenUsage('pass2a', data.inputTokens || 0, data.outputTokens || 0);
  }
}

function logPass2BToQA(pass2Entry, data, latencyMs, normals, findings, warnings) {
  const store = useReportStore.getState();

  // Summarize decisions by action
  const decisions = data?.normalDecisions || [];
  const keepCount = decisions.filter((d) => d.action === 'K').length;
  const suppressCount = decisions.filter((d) => d.action === 'S').length;
  const editCount = decisions.filter((d) => d.action === 'E').length;

  store.addQaLogEntry({
    type: 'PASS2B',
    runId: pass2Entry.runId,
    normalCount: normals?.length || 0,
    findingCount: findings?.length || 0,
    latencyMs,
    warnings: warnings || [],
    // Decision summary
    keepCount,
    suppressCount,
    editCount,
    // Detail data
    normalMap: pass2Entry.normalMap,
    findingMap: pass2Entry.findingMap,
    normalDecisions: decisions,
    rawResponse: data?.rawResponse || null,
    // Token usage
    inputTokens: data?.inputTokens ?? null,
    outputTokens: data?.outputTokens ?? null,
  });

  // Accumulate token usage for session totals
  if (data?.inputTokens || data?.outputTokens) {
    store.addTokenUsage('pass2b', data.inputTokens || 0, data.outputTokens || 0);
  }
}

// --- Phase 5.1: Co-participant rollback and replay ---

/**
 * Identify segments that co-edited the same normal textboxes as the given segment.
 * A "co-participant" is any OTHER segment that appears in `editedBySegmentIds` or
 * `suppressedBySegmentIds` of a content box where `segmentId` also appears.
 *
 * @param {string} segmentId - The segment being rolled back
 * @returns {Set<string>} Set of co-participant segment IDs (excludes the input segment)
 */
function getCoParticipantSegments(segmentId) {
  const store = useReportStore.getState();
  const coParticipants = new Set();

  for (const box of Object.values(store.contentBoxStates)) {
    const editors = box.editedBySegmentIds || [];
    const suppressors = box.suppressedBySegmentIds || [];
    const allRelated = [...editors, ...suppressors];

    if (allRelated.includes(segmentId)) {
      for (const other of allRelated) {
        if (other !== segmentId) {
          coParticipants.add(other);
        }
      }
    }
  }

  return coParticipants;
}

/**
 * Roll back a segment's findings AND any co-participants, then re-queue
 * co-participants for Pass 2 replay.
 *
 * This ensures that when a segment is removed/edited, any other segments
 * that co-edited the same normals are re-evaluated against the restored
 * (original) normal text.
 *
 * @param {string} segmentId - The segment being rolled back
 */
export function rollbackWithCoParticipantReplay(segmentId) {
  const store = useReportStore.getState();

  // 1. Find co-participants BEFORE rolling back (the tracking arrays are still intact)
  const coParticipants = getCoParticipantSegments(segmentId);

  // 2. Roll back the primary segment
  store.rollbackSegmentFindings(segmentId);

  // 3. Roll back all co-participants
  if (coParticipants.size > 0) {
    console.log(`[Pass2Service] Co-participant rollback: segment ${segmentId} has ${coParticipants.size} co-participant(s): [${[...coParticipants].join(', ')}]`);

    for (const coSegId of coParticipants) {
      store.rollbackSegmentFindings(coSegId);
    }

    // 4. Re-mark co-participant segments as 'sanitized' so they re-enter the Pass 2 pipeline
    //    (The primary segment is NOT re-queued — it's being deleted/replaced.)
    const dictSegments = store.segments['dictation-box'] || [];
    const toReSanitize = [];
    for (const coSegId of coParticipants) {
      const seg = dictSegments.find((s) => s.segmentId === coSegId);
      if (seg && seg.status === 'structured') {
        toReSanitize.push(coSegId);
      }
    }

    if (toReSanitize.length > 0) {
      useReportStore.setState((s) => ({
        segments: {
          ...s.segments,
          'dictation-box': (s.segments['dictation-box'] || []).map((seg) =>
            toReSanitize.includes(seg.segmentId)
              ? { ...seg, status: 'sanitized' }
              : seg
          ),
        },
      }));

      console.log(`[Pass2Service] Re-queued ${toReSanitize.length} co-participant segment(s) as 'sanitized' for replay`);

      // Trigger Pass 2 debounce to pick up the re-queued segments
      startPass2Debounce();
    }
  }
}

export default {
  startPass2Debounce,
  cancelPass2Debounce,
  resetPass2,
  rollbackWithCoParticipantReplay,
};
