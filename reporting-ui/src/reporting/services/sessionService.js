/**
 * sessionService.js — Client-Side Session Persistence Orchestrator
 *
 * Coordinates saving/loading report sessions with the server API.
 * Provides auto-save, manual save, and session restoration.
 *
 * Save triggers:
 *   1. Manual — user clicks the Save button
 *   2. Post-impression — after impression generation completes
 *   3. Auto-save — 90-second idle timer after last content change
 *   4. Tab close — beforeunload handler (synchronous via sendBeacon)
 *
 * @module sessionService
 */

import useReportStore from '../stores/useReportStore';

// ─── Constants ───────────────────────────────────────────────────────
const AUTO_SAVE_DELAY_MS = 90_000; // 90 seconds of idle after last change
const API_BASE = '/api/session';

// ─── Internal State ──────────────────────────────────────────────────
let autoSaveTimerId = null;
let isSaving = false;
let isBeforeUnloadRegistered = false;

// ─── Save Session ────────────────────────────────────────────────────

/**
 * Save the current session to the server.
 * Builds the Active Report Document on demand and POSTs it.
 *
 * @param {object} [options]
 * @param {boolean} [options.silent=false] - If true, suppress console logs
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function saveSession({ silent = false } = {}) {
  const store = useReportStore.getState();

  if (!store.sessionId || !store.templateData) {
    return { success: false, error: 'No active session to save' };
  }

  if (isSaving) {
    if (!silent) console.log('[SessionService] Save already in progress — skipping');
    return { success: false, error: 'Save already in progress' };
  }

  isSaving = true;
  try {
    const report = store.getActiveReport();

    const response = await fetch(`${API_BASE}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: store.sessionId,
        data: report,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    store.markSaved(result.savedAt);

    if (!silent) {
      console.log(`[SessionService] Session saved: ${store.sessionId} at ${result.savedAt}`);
    }

    return { success: true };
  } catch (e) {
    console.error('[SessionService] Save failed:', e.message);
    return { success: false, error: e.message };
  } finally {
    isSaving = false;
  }
}

/**
 * Save session synchronously via sendBeacon (for beforeunload).
 * This is fire-and-forget — no response is available.
 */
function saveSessionBeacon() {
  const store = useReportStore.getState();
  if (!store.sessionId || !store.templateData || !store.hasUnsavedChanges) return;

  try {
    const report = store.getActiveReport();
    const blob = new Blob([JSON.stringify({
      sessionId: store.sessionId,
      data: report,
    })], { type: 'application/json' });

    navigator.sendBeacon(`${API_BASE}/save`, blob);
    console.log('[SessionService] Beacon save sent for session:', store.sessionId);
  } catch (e) {
    console.error('[SessionService] Beacon save failed:', e.message);
  }
}

// ─── Load Session ────────────────────────────────────────────────────

/**
 * Load a saved session from the server and restore it into the store.
 *
 * @param {string} sessionId - Session to load
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function loadSavedSession(sessionId) {
  try {
    const response = await fetch(`${API_BASE}/${sessionId}`);

    if (response.status === 404) {
      return { success: false, error: 'Session not found' };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.data) {
      return { success: false, error: 'No data in response' };
    }

    // Restore into the store
    useReportStore.getState().loadSession(result.data);
    console.log(`[SessionService] Session restored: ${sessionId}`);

    return { success: true };
  } catch (e) {
    console.error('[SessionService] Load failed:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Check if a specific session exists on the server.
 *
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function checkSessionExists(sessionId) {
  try {
    const response = await fetch(`${API_BASE}/${sessionId}`, { method: 'HEAD' });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * List all saved sessions from the server.
 *
 * @returns {Promise<Array>} Array of session summaries
 */
export async function listSessions() {
  try {
    const response = await fetch(`${API_BASE}/list`);
    if (!response.ok) return [];
    const result = await response.json();
    return result.sessions || [];
  } catch {
    return [];
  }
}

/**
 * Delete a saved session from the server.
 *
 * @param {string} sessionId
 * @returns {Promise<{ success: boolean }>}
 */
export async function deleteSession(sessionId) {
  try {
    const response = await fetch(`${API_BASE}/${sessionId}`, { method: 'DELETE' });
    return { success: response.ok };
  } catch {
    return { success: false };
  }
}

// ─── Auto-Save Timer ─────────────────────────────────────────────────

/**
 * Start (or restart) the auto-save idle timer.
 * When the timer fires, it saves only if there are unsaved changes.
 */
export function startAutoSaveTimer() {
  clearAutoSaveTimer();
  autoSaveTimerId = setTimeout(async () => {
    const store = useReportStore.getState();
    if (store.hasUnsavedChanges && store.sessionId) {
      console.log('[SessionService] Auto-save triggered');
      await saveSession({ silent: true });
    }
  }, AUTO_SAVE_DELAY_MS);
}

/**
 * Clear the auto-save timer without triggering a save.
 */
export function clearAutoSaveTimer() {
  if (autoSaveTimerId) {
    clearTimeout(autoSaveTimerId);
    autoSaveTimerId = null;
  }
}

// ─── beforeunload Handler ────────────────────────────────────────────

/**
 * Register the beforeunload handler for tab-close/navigate-away saves.
 * Safe to call multiple times — only registers once.
 */
export function registerBeforeUnload() {
  if (isBeforeUnloadRegistered) return;

  window.addEventListener('beforeunload', handleBeforeUnload);
  isBeforeUnloadRegistered = true;
  console.log('[SessionService] beforeunload handler registered');
}

/**
 * Unregister the beforeunload handler.
 */
export function unregisterBeforeUnload() {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  isBeforeUnloadRegistered = false;
}

function handleBeforeUnload(e) {
  const store = useReportStore.getState();
  if (store.hasUnsavedChanges && store.sessionId) {
    saveSessionBeacon();
    // Show browser's "changes may not be saved" dialog
    e.preventDefault();
    e.returnValue = '';
  }
}

// ─── Convenience: Save after Impression ──────────────────────────────

/**
 * Called by impressionService after impression generation completes.
 * Saves the session in the background.
 */
export function saveAfterImpression() {
  const store = useReportStore.getState();
  if (store.sessionId && store.templateData) {
    saveSession({ silent: true }).catch(() => {
      // Silently ignore — the session will be saved by auto-save or tab close
    });
  }
}

// ─── Status Getter ───────────────────────────────────────────────────

/**
 * Check if a save is currently in progress.
 * @returns {boolean}
 */
export function isSaveInProgress() {
  return isSaving;
}
