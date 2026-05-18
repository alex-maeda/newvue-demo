/**
 * Action Queue Service — Phase 3
 *
 * Manages safety timeouts for awaiting_final action queue entries.
 * Per design doc §5.2: if no is_final received within 1 second of
 * cursor move, auto-resolve with accumulated buffer text.
 *
 * Also provides queue drain callbacks for future LLM debounce triggers.
 */

const SAFETY_TIMEOUT_MS = 1000;

// Active timers keyed by actionId
const activeTimers = new Map();

// Drain callback (for future LLM debounce — noop in Phase 3)
let onQueueDrained = null;

// New-entry callback — cancels Pass 1 debounce when new dictation arrives
let onNewEntry = null;

// Content-deletion callback — marks report content dirty when deletion
// with segment rollback occurs (so Pass 1's empty-work branch knows
// whether to trigger impression regeneration).
let onContentDeletion = null;

/**
 * Start a safety timeout for an awaiting_final entry.
 * If no is_final arrives within 1 second, auto-resolve with buffer text.
 *
 * @param {string} actionId - The action queue entry ID
 * @param {Function} resolveAction - Store's resolveAction function
 * @param {Function} getEntry - Function that returns the entry by ID
 */
export function startSafetyTimeout(actionId, resolveAction, getEntry) {
  // Clear any existing timer for this action
  cancelSafetyTimeout(actionId);

  const timer = setTimeout(() => {
    activeTimers.delete(actionId);

    const entry = getEntry(actionId);
    if (!entry) return;

    // Only auto-resolve if still awaiting_final
    if (entry.status === 'awaiting_final') {
      const fallbackText = entry.asrBuffer.length > 0
        ? entry.asrBuffer[entry.asrBuffer.length - 1]  // Use last interim as fallback
        : '';

      console.log(`[ActionQueueService] Safety timeout for ${actionId}, resolving with: "${fallbackText}"`);
      resolveAction(actionId, fallbackText);
    }
  }, SAFETY_TIMEOUT_MS);

  activeTimers.set(actionId, timer);
}

/**
 * Cancel a safety timeout for an action (e.g., when is_final arrives in time).
 * @param {string} actionId
 */
export function cancelSafetyTimeout(actionId) {
  const timer = activeTimers.get(actionId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(actionId);
  }
}

/**
 * Cancel all active safety timers (called on session reset).
 */
export function cancelAllTimers() {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}

/**
 * Register a callback for when the queue is fully drained.
 * In Phase 3 this is informational. In Phase 4+ it triggers LLM debounce.
 * @param {Function|null} callback
 */
export function setOnQueueDrained(callback) {
  onQueueDrained = callback;
}

/**
 * Notify that the queue was just drained (called by the store after resolution).
 */
export function notifyQueueDrained() {
  if (typeof onQueueDrained === 'function') {
    try { onQueueDrained(); } catch (e) { console.warn('[ActionQueueService] Drain callback error:', e); }
  }
}

/**
 * Register a callback for when a new action queue entry is created.
 * Used to cancel the Pass 1 debounce timer during active dictation.
 * @param {Function|null} callback
 */
export function setOnNewEntry(callback) {
  onNewEntry = callback;
}

/**
 * Notify that a new action queue entry was created.
 * Called by enqueueAction in actionQueueSlice.
 */
export function notifyNewEntry() {
  if (typeof onNewEntry === 'function') {
    try { onNewEntry(); } catch (e) { console.warn('[ActionQueueService] New entry callback error:', e); }
  }
}

/**
 * Register a callback for when content is deleted with segment rollback.
 * Used to set the reportContentDirty flag in pass1Service so that the
 * impression generator fires only when report content actually changed.
 * @param {Function|null} callback
 */
export function setOnContentDeletion(callback) {
  onContentDeletion = callback;
}

/**
 * Notify that content was deleted with segment rollback.
 * Called by enqueueDeleteEntry / updateDeleteEntry / markSegmentsDirty
 * in actionQueueSlice when rollbackIds.length > 0.
 */
export function notifyContentDeletion() {
  if (typeof onContentDeletion === 'function') {
    try { onContentDeletion(); } catch (e) { console.warn('[ActionQueueService] Content deletion callback error:', e); }
  }
}

export default {
  startSafetyTimeout,
  cancelSafetyTimeout,
  cancelAllTimers,
  setOnQueueDrained,
  notifyQueueDrained,
  setOnNewEntry,
  notifyNewEntry,
  setOnContentDeletion,
  notifyContentDeletion,
};
