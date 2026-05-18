/**
 * Impression Service — Phase 6
 *
 * Client-side orchestrator for impression generation.
 *
 * Lifecycle:
 *   Pass 2 completes (or Pass 1 for report-side) →
 *   readinessCheck() → all conditions met →
 *   1200ms debounce → fireImpression()
 *
 * Readiness conditions (ALL must be true):
 *   1. All dictation-box segments are 'structured' (no raw/dirty/sanitized)
 *   2. All modified report content boxes have completed Pass 1
 *      (no segments in raw/dirty status)
 *   3. Pass 1 idle
 *   4. Pass 2 idle
 *   5. Impression not already in-flight
 *
 * Smart auto-regeneration (Option C):
 *   - Auto-regenerate only if the user is NOT focused on the impression section
 *   - If focused on impression, mark as stale instead
 *
 * Cancellation:
 *   - New ASR entry → cancel debounce
 *   - New typing in any textarea → cancel debounce
 *   - Pass 1 or Pass 2 fires → cancel debounce
 */

import useReportStore from '../stores/useReportStore';
import useUserStore from '../stores/useUserStore';
import {
  isDescendantOfLabel,
  buildSectionPath,
} from '../utils/templateAdapter';
import { saveAfterImpression } from './sessionService';

const DEBOUNCE_MS = 1200;

let debounceTimer = null;
let impressionRunCounter = 0;
let isManualTrigger = false;   // Flag to distinguish auto vs manual for smart auto-regen
let pendingRerun = false;      // Flag: a rerun was requested while impression was in-flight

// --- Public API ---

/**
 * Start the impression generation debounce timer.
 * Called after Pass 2 completes or Pass 1 completes for report-side content.
 */
export function startImpressionDebounce() {
  const store = useReportStore.getState();

  console.log('[ImpressionService] startImpressionDebounce called, current status:', store.impressionStatus);

  // If impression is already in-flight, mark for rerun after completion
  if (store.impressionStatus === 'in_flight') {
    pendingRerun = true;
    console.log('[ImpressionService] Impression in-flight — marked for rerun after completion');
    return;
  }

  // Check readiness
  if (!isReady()) {
    console.log('[ImpressionService] Not ready — debounce not started');
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);

  isManualTrigger = false;
  store.setImpressionStatus('debouncing');
  console.log('[ImpressionService] Debounce started (1200ms)');
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    // Re-check readiness after debounce
    if (!isReady()) {
      console.log('[ImpressionService] Re-check failed after debounce — aborting');
      useReportStore.getState().setImpressionStatus('idle');
      return;
    }
    console.log('[ImpressionService] Debounce elapsed — firing impression');
    fireImpression();
  }, DEBOUNCE_MS);
}

/**
 * Manually fire impression generation (bypasses debounce).
 * Called by the "Re-Generate Impression" button.
 * Still checks readiness conditions.
 */
export function fireImpressionManual() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (!isReady()) {
    console.log('[ImpressionService] Not ready for manual impression generation');
    return;
  }

  isManualTrigger = true;
  fireImpression();
}

/**
 * Cancel the impression debounce timer.
 */
export function cancelImpressionDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingRerun = false;
  const store = useReportStore.getState();
  if (store.impressionStatus === 'debouncing') {
    store.setImpressionStatus('idle');
  }
}

/**
 * Reset impression state (called on session reset).
 */
export function resetImpression() {
  cancelImpressionDebounce();
  pendingRerun = false;
  useReportStore.getState().setImpressionStatus('idle');
}

/**
 * Check if all readiness conditions are met for impression generation.
 * Exported for the Re-Generate button disabled state.
 */
export function isReady() {
  const store = useReportStore.getState();

  // 1. Pass 1 must be idle
  if (store.pass1Status !== 'idle') {
    console.log('[ImpressionService] Not ready: Pass 1 status =', store.pass1Status);
    return false;
  }

  // 2. Pass 2 must be idle
  if (store.pass2Status !== 'idle') {
    console.log('[ImpressionService] Not ready: Pass 2 status =', store.pass2Status);
    return false;
  }

  // 3. Impression must not be in-flight
  if (store.impressionStatus === 'in_flight') {
    console.log('[ImpressionService] Not ready: impression already in-flight');
    return false;
  }

  // 4. All dictation-box segments must be 'structured'
  //    (or there are no segments, which is fine)
  const dictSegments = store.segments['dictation-box'] || [];
  if (dictSegments.length > 0) {
    const hasUnfinished = dictSegments.some(
      (s) => s.status === 'raw' || s.status === 'dirty' || s.status === 'sanitized'
    );
    if (hasUnfinished) {
      const statusCounts = {};
      for (const s of dictSegments) {
        statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
      }
      console.log('[ImpressionService] Not ready: dictation-box segments not all structured:', statusCounts);
      return false;
    }
  }

  // 5. All modified report content boxes must have completed Pass 1
  //    (no segments in raw/dirty status for any content box)
  for (const [targetId, segments] of Object.entries(store.segments)) {
    if (targetId === 'dictation-box') continue;

    // Only check content boxes that have been modified
    const box = store.contentBoxStates[targetId];
    if (!box) continue;

    // Skip unmodified template defaults
    if (!box.manuallyEdited && !box.pass2Inserted) continue;

    // Skip dropdown selections that didn't create segments
    // (dropdown option text is predefined, no Pass 1 needed)
    if (box.inputType === 'select' && segments.length === 0) continue;

    const hasRawDirty = segments.some(
      (seg) => seg.status === 'raw' || seg.status === 'dirty'
    );
    if (hasRawDirty) {
      console.log('[ImpressionService] Not ready: content box', targetId, 'has raw/dirty segments');
      return false;
    }
  }

  // 6. Action queue must be drained
  if (!store.isQueueDrained()) {
    console.log('[ImpressionService] Not ready: action queue not drained');
    return false;
  }

  return true;
}

// --- Core Logic ---

async function fireImpression() {
  const store = useReportStore.getState();

  // Final readiness check
  if (!isReady()) {
    store.setImpressionStatus('idle');
    return;
  }

  // Smart auto-regeneration (Option C):
  // If user is focused on the impression section, mark stale instead
  const activeTextarea = store.activeTextareaId;
  const isImpressionFocused = activeTextarea &&
    isImpressionContentBox(activeTextarea, store.templateNodes, store.nodeMap);

  // Only suppress auto-regen if this is not a manual trigger
  if (isImpressionFocused && !isManualTrigger) {
    console.log('[ImpressionService] User focused on impression — marking stale');
    store.setImpressionStatus('stale');
    return;
  }

  impressionRunCounter++;
  const runId = `IG_${impressionRunCounter}_${Date.now()}`;

  // Aggregate report content
  const allReportContent = aggregateReportContent(
    store.templateNodes,
    store.contentBoxStates,
    store.nodeMap
  );

  if (allReportContent.length === 0) {
    console.log('[ImpressionService] No report content to synthesize');
    store.setImpressionStatus('idle');
    return;
  }

  // Build short ID → full contentBoxId mapping for provenance tracing
  // Each content box gets a compact label (C1, C2, ...) to minimize LLM tokens
  const contentBoxMap = {};
  for (let i = 0; i < allReportContent.length; i++) {
    const shortId = `C${i + 1}`;
    contentBoxMap[shortId] = allReportContent[i].contentBoxId;
    allReportContent[i].shortId = shortId;
  }

  // Get preferences and prior samples from user profile store
  const userPrefs = useUserStore.getState().preferences;
  const preferences = userPrefs.impressionSettings;
  const priorImpressionSamples = userPrefs.priorImpressionSamples || [];

  // When normalFindings is 'exclude', strip default (unchanged template)
  // content boxes from the payload so the LLM never sees them.
  // Also compute whether ALL findings are normal (to generate
  // "Normal examination." when nothing abnormal was found).
  const nonDefaultContent = allReportContent.filter(
    (item) => item.importance !== 'default'
  );
  const allFindingsNormal = nonDefaultContent.length === 0;
  const reportContent = preferences.normalFindings === 'exclude'
    ? nonDefaultContent
    : allReportContent;

  // If excluding normals and all findings are normal, we still need to
  // fire the API so it can produce "Normal examination." — send empty
  // reportContent with the allFindingsNormal flag.

  // Collect locked impression items (user-edited impression content boxes)
  const lockedImpressionItems = collectLockedImpressionItems(
    store.templateNodes,
    store.contentBoxStates,
    store.nodeMap
  );

  // Get history text for clinical context
  const historyText = getHistoryText(store.contentBoxStates, store.nodeMap);

  // Get study title
  const studyTitle = store.templateData?.title || '';

  store.setImpressionStatus('in_flight');

  try {
    const startTime = performance.now();

    const response = await fetch('/api/report/impression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportContent,
        allFindingsNormal,
        preferences,
        priorImpressionSamples,
        lockedImpressionItems,
        studyTitle,
        historyText,
        runId,
        contentBoxMap,
      }),
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      throw new Error(`Impression API returned ${response.status}`);
    }

    const data = await response.json();

    // Apply results
    if (data.impressionItems?.length > 0) {
      useReportStore.getState().applyImpressionResults(
        data.impressionItems,
        runId
      );
    }

    // Log to QA
    logImpressionToQA(runId, reportContent, data, latencyMs, preferences);

    useReportStore.getState().setImpressionStatus('idle');

    // Check if a rerun was requested while we were in-flight
    if (pendingRerun) {
      pendingRerun = false;
      console.log('[ImpressionService] Pending rerun detected — restarting debounce');
      startImpressionDebounce();
    }

    // Phase 4: Auto-save session after successful impression generation
    saveAfterImpression();

  } catch (e) {
    console.error('[ImpressionService] Impression generation failed:', e.message || e);
    useReportStore.getState().setImpressionStatus('error');

    logImpressionToQA(runId, reportContent, null, 0, preferences, ['impression_call_failed']);

    // On error, also check for pending rerun after the error clears
    const hadPendingRerun = pendingRerun;
    pendingRerun = false;
    setTimeout(() => {
      const s = useReportStore.getState();
      if (s.impressionStatus === 'error') {
        s.setImpressionStatus('idle');
        if (hadPendingRerun) {
          console.log('[ImpressionService] Pending rerun after error — restarting debounce');
          startImpressionDebounce();
        }
      }
    }, 5000);
  }
}

// --- Data Aggregation ---

/**
 * Collect all non-deleted, non-impression content box text with importance flags
 * and section paths. Uses nodeMap for flat iteration and parent-chain walks.
 */
function aggregateReportContent(templateNodes, contentBoxStates, nodeMap) {
  const results = [];

  // Use nodeMap if available for flat iteration
  if (nodeMap) {
    for (const node of Object.values(nodeMap)) {
      if (node.type !== 'content') continue;

      // Skip impression content — impression is generated FROM report content
      if (isDescendantOfLabel(node.id, 'impression', nodeMap)) continue;

      const box = contentBoxStates[node.id];
      if (!box || box.deleted) continue;
      if (!box.currentText?.trim()) continue;

      const importance = classifyContentBox(box);
      const isFinding = isDescendantOfLabel(node.id, 'findings', nodeMap);
      const sectionPath = buildSectionPath(node.id, nodeMap);

      results.push({
        sectionPath: sectionPath.join(' > '),
        contentBoxId: node.id,
        text: box.currentText.trim(),
        importance,
        isFinding,
      });
    }
    return results;
  }

  // Fallback: recursive tree walk (for backward compat)
  function walk(nodes, pathParts = []) {
    for (const node of nodes) {
      const currentPath = (node.type === 'section' || node.type === 'subsection' || node.type === 'headline')
        ? [...pathParts, node.label || node.id]
        : pathParts;

      if (node.type === 'headline' && (node.label || '').toLowerCase() === 'impression') {
        continue;
      }

      if (node.type === 'content') {
        const box = contentBoxStates[node.id];
        if (!box || box.deleted) {
          // Skip deleted
        } else if (box.currentText?.trim()) {
          const importance = classifyContentBox(box);
          results.push({
            sectionPath: currentPath.join(' > '),
            contentBoxId: node.id,
            text: box.currentText.trim(),
            importance,
            isFinding: false, // fallback doesn't compute this
          });
        }
      }

      if (node.children?.length) {
        walk(node.children, currentPath);
      }
    }
  }

  walk(templateNodes);
  return results;
}

/**
 * Classify a content box by importance level.
 */
function classifyContentBox(box) {
  if (box.pass2Inserted && box.manuallyEdited) return 'userModifiedAI';
  if (box.pass2Inserted) return 'aiInserted';
  if (box.manuallyEdited) return 'userModified';
  return 'default';
}

/**
 * Check if a content box ID is within the Impression section.
 * Uses nodeMap parent-chain walk when available.
 */
function isImpressionContentBox(contentBoxId, templateNodes, nodeMap) {
  if (nodeMap) {
    return isDescendantOfLabel(contentBoxId, 'impression', nodeMap);
  }
  // Fallback: recursive search
  function search(nodes, inImpression = false) {
    for (const node of nodes) {
      const nowInImpression = inImpression ||
        (node.type === 'headline' && (node.label || '').toLowerCase() === 'impression');
      if (node.id === contentBoxId && nowInImpression) return true;
      if (node.children?.length) {
        const result = search(node.children, nowInImpression);
        if (result) return result;
      }
    }
    return false;
  }
  return search(templateNodes);
}

/**
 * Collect user-edited impression content boxes to send as locked items.
 * Uses nodeMap for flat iteration when available.
 * Excludes synthetic recommendation/guideline content boxes — those are
 * a separate concern and should not be sent as locked impression items.
 */
function collectLockedImpressionItems(templateNodes, contentBoxStates, nodeMap) {
  const locked = [];

  if (nodeMap) {
    for (const node of Object.values(nodeMap)) {
      if (node.type !== 'content') continue;
      if (!isDescendantOfLabel(node.id, 'impression', nodeMap)) continue;

      const box = contentBoxStates[node.id];
      // Skip synthetic recommendation/guideline content boxes
      if (box?.syntheticContent) continue;
      if (box && box.manuallyEdited && box.currentText?.trim()) {
        locked.push({
          contentBoxId: node.id,
          text: box.currentText.trim(),
        });
      }
    }
    return locked;
  }

  // Fallback: recursive tree walk
  function walk(nodes, inImpression = false) {
    for (const node of nodes) {
      const nowInImpression = inImpression ||
        (node.type === 'headline' && (node.label || '').toLowerCase() === 'impression');
      if (node.type === 'content' && nowInImpression) {
        const box = contentBoxStates[node.id];
        // Skip synthetic recommendation/guideline content boxes
        if (box?.syntheticContent) continue;
        if (box && box.manuallyEdited && box.currentText?.trim()) {
          locked.push({
            contentBoxId: node.id,
            text: box.currentText.trim(),
          });
        }
      }
      if (node.children?.length) {
        walk(node.children, nowInImpression);
      }
    }
  }

  walk(templateNodes);
  return locked;
}

/**
 * Get the History section text for clinical context.
 * Uses nodeMap typeAttribute when available, falls back to ID substring match.
 */
function getHistoryText(contentBoxStates, nodeMap) {
  if (nodeMap) {
    for (const node of Object.values(nodeMap)) {
      if (node.type !== 'content') continue;
      // Prefer typeAttribute (new format)
      if (node.typeAttribute?.includes('history')) {
        const box = contentBoxStates[node.id];
        if (box?.currentText?.trim()) return box.currentText.trim();
      }
    }
  }
  // Fallback: ID substring match
  for (const [id, box] of Object.entries(contentBoxStates)) {
    if (id.includes('history') && box.currentText?.trim()) {
      return box.currentText.trim();
    }
  }
  return '';
}

// --- QA Logging ---

function logImpressionToQA(runId, reportContent, data, latencyMs, preferences, warnings) {
  const store = useReportStore.getState();

  store.addQaLogEntry({
    type: 'IMPRESSION',
    runId,
    contentBoxCount: reportContent.length,
    impressionItemCount: data?.impressionItems?.length || 0,
    latencyMs,
    warnings: warnings || data?.warnings || [],
    preferences,
    rawResponse: data?.rawResponse || null,
    impressionItems: data?.impressionItems || [],
    // Token usage
    inputTokens: data?.inputTokens ?? null,
    outputTokens: data?.outputTokens ?? null,
  });

  // Accumulate token usage for session totals
  if (data?.inputTokens || data?.outputTokens) {
    store.addTokenUsage('impression', data.inputTokens || 0, data.outputTokens || 0);
  }
}

export default {
  startImpressionDebounce,
  cancelImpressionDebounce,
  fireImpressionManual,
  resetImpression,
  isReady,
};
