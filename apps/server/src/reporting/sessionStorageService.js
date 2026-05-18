/**
 * sessionStorageService.js — Report Session Persistence Layer
 *
 * Server-side service for reading/writing report session snapshots.
 * Sessions are stored as JSON files under the user's profile directory.
 *
 * Storage layout:
 *   config/profiles/{userId}/sessions/{sessionId}/report.json
 *
 * Design:
 *   - Atomic writes: temp file → rename to prevent partial writes
 *   - Directory auto-creation: session directories are created on first save
 *   - Follows the same patterns as userProfileService.js
 *   - Session data is the Active Report Document (from activeReportDocument.js)
 *
 * @module sessionStorageService
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.resolve(__dirname, '..', '..', 'config', 'profiles');

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Save a report session snapshot to disk (atomic write).
 *
 * @param {string} userId - User ID
 * @param {string} sessionId - Session identifier (used as directory name)
 * @param {object} sessionData - The Active Report Document to persist
 * @returns {{ success: boolean, error?: string, path?: string }}
 */
export function saveSession(userId, sessionId, sessionData) {
  if (!userId || !sessionId || !sessionData) {
    return { success: false, error: 'Missing required parameters (userId, sessionId, sessionData)' };
  }

  const sessionDir = path.join(PROFILES_DIR, userId, 'sessions', sessionId);
  const reportPath = path.join(sessionDir, 'report.json');
  const tempPath = path.join(sessionDir, `report.tmp.${Date.now()}.json`);

  try {
    // Ensure session directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Atomic write: temp file → rename
    const json = JSON.stringify(sessionData, null, 2);
    fs.writeFileSync(tempPath, json, 'utf8');
    fs.renameSync(tempPath, reportPath);

    const sizeMB = (Buffer.byteLength(json, 'utf8') / (1024 * 1024)).toFixed(2);
    console.log(`[SessionStorage] Saved session ${sessionId} for user ${userId} (${sizeMB} MB)`);

    return { success: true, path: reportPath };
  } catch (e) {
    console.error(`[SessionStorage] Error saving session ${sessionId} for user ${userId}:`, e.message);
    // Clean up temp file if it exists
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return { success: false, error: e.message };
  }
}

/**
 * Load a report session snapshot from disk.
 *
 * @param {string} userId - User ID
 * @param {string} sessionId - Session identifier
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
export function loadSession(userId, sessionId) {
  if (!userId || !sessionId) {
    return { success: false, error: 'Missing required parameters (userId, sessionId)' };
  }

  const reportPath = path.join(PROFILES_DIR, userId, 'sessions', sessionId, 'report.json');

  try {
    const data = fs.readFileSync(reportPath, 'utf8');
    const session = JSON.parse(data);
    console.log(`[SessionStorage] Loaded session ${sessionId} for user ${userId}`);
    return { success: true, data: session };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { success: false, error: `Session not found: ${sessionId}` };
    }
    console.error(`[SessionStorage] Error loading session ${sessionId} for user ${userId}:`, e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Delete a report session from disk.
 * Removes the entire session directory and its contents.
 *
 * @param {string} userId - User ID
 * @param {string} sessionId - Session identifier
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteSession(userId, sessionId) {
  if (!userId || !sessionId) {
    return { success: false, error: 'Missing required parameters (userId, sessionId)' };
  }

  const sessionDir = path.join(PROFILES_DIR, userId, 'sessions', sessionId);

  try {
    if (!fs.existsSync(sessionDir)) {
      // Already gone — consider success
      return { success: true };
    }

    fs.rmSync(sessionDir, { recursive: true, force: true });
    console.log(`[SessionStorage] Deleted session ${sessionId} for user ${userId}`);
    return { success: true };
  } catch (e) {
    console.error(`[SessionStorage] Error deleting session ${sessionId} for user ${userId}:`, e.message);
    return { success: false, error: e.message };
  }
}

/**
 * List all saved sessions for a user.
 * Returns an array of session summaries (metadata only, not full report data).
 *
 * @param {string} userId - User ID
 * @returns {{ success: boolean, sessions?: Array, error?: string }}
 */
export function listSessions(userId) {
  if (!userId) {
    return { success: false, error: 'Missing required parameter: userId' };
  }

  const sessionsDir = path.join(PROFILES_DIR, userId, 'sessions');

  try {
    if (!fs.existsSync(sessionsDir)) {
      return { success: true, sessions: [] };
    }

    const sessionDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const sessions = [];
    for (const dirName of sessionDirs) {
      const reportPath = path.join(sessionsDir, dirName, 'report.json');
      try {
        const data = fs.readFileSync(reportPath, 'utf8');
        const doc = JSON.parse(data);
        sessions.push({
          sessionId: dirName,
          reportId: doc.reportId ?? dirName,
          title: doc.title ?? '',
          modality: doc.modality ?? '',
          bodyRegion: doc.bodyRegion ?? '',
          status: doc.status ?? 'in-progress',
          templateId: doc.templateId ?? '',
          fileTemplateId: doc.fileTemplateId ?? '',
          createdAt: doc.createdAt ?? null,
          updatedAt: doc.updatedAt ?? null,
          patient: doc.patient ?? null,
          study: doc.study ?? null,
        });
      } catch {
        // Skip unreadable sessions
        console.warn(`[SessionStorage] Could not read session: ${dirName}`);
      }
    }

    // Sort by updatedAt descending (most recent first)
    sessions.sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });

    console.log(`[SessionStorage] Listed ${sessions.length} sessions for user ${userId}`);
    return { success: true, sessions };
  } catch (e) {
    console.error(`[SessionStorage] Error listing sessions for user ${userId}:`, e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Check if a session exists for a user.
 *
 * @param {string} userId - User ID
 * @param {string} sessionId - Session identifier
 * @returns {boolean}
 */
export function sessionExists(userId, sessionId) {
  if (!userId || !sessionId) return false;
  const reportPath = path.join(PROFILES_DIR, userId, 'sessions', sessionId, 'report.json');
  return fs.existsSync(reportPath);
}
