/**
 * sessionRouter.js — Report Session API Endpoints
 *
 * Express router for saving, loading, listing, and deleting report sessions.
 *
 * Endpoints:
 *   POST   /api/session/save         → Save a report session snapshot
 *   GET    /api/session/list          → List all saved sessions for the user
 *   GET    /api/session/:sessionId    → Load a specific session snapshot
 *   DELETE /api/session/:sessionId    → Delete a saved session
 *   HEAD   /api/session/:sessionId    → Check if a session exists
 *
 * The active user is determined by userProfileService.resolveUserId(),
 * matching the auth pattern used by profileRouter.js.
 *
 * @module sessionRouter
 */

import { Router } from 'express';
import { resolveUserId } from './userProfileService.js';
import {
  saveSession,
  loadSession,
  deleteSession,
  listSessions,
  sessionExists,
} from './sessionStorageService.js';

const router = Router();

// ─── POST /api/session/save ──────────────────────────────────────────
// Save or update a report session snapshot.
// Body: { sessionId: string, data: ActiveReportDocument }
router.post('/api/session/save', (req, res) => {
  const userId = resolveUserId(req);
  const { sessionId, data } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing required field: sessionId' });
  }
  if (!data) {
    return res.status(400).json({ error: 'Missing required field: data' });
  }

  const result = saveSession(userId, sessionId, data);

  if (result.success) {
    return res.json({
      success: true,
      sessionId,
      savedAt: new Date().toISOString(),
    });
  }

  return res.status(500).json({
    error: 'Failed to save session',
    detail: result.error,
  });
});

// ─── GET /api/session/list ───────────────────────────────────────────
// List all saved sessions for the current user.
// Returns metadata only (not full report data).
router.get('/api/session/list', (req, res) => {
  const userId = resolveUserId(req);
  const result = listSessions(userId);

  if (result.success) {
    return res.json({
      success: true,
      sessions: result.sessions,
    });
  }

  return res.status(500).json({
    error: 'Failed to list sessions',
    detail: result.error,
  });
});

// ─── GET /api/session/:sessionId ─────────────────────────────────────
// Load a specific saved session snapshot.
router.get('/api/session/:sessionId', (req, res) => {
  const userId = resolveUserId(req);
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId parameter' });
  }

  const result = loadSession(userId, sessionId);

  if (result.success) {
    return res.json({
      success: true,
      data: result.data,
    });
  }

  // Distinguish between "not found" and "server error"
  if (result.error?.includes('not found')) {
    return res.status(404).json({
      error: 'Session not found',
      sessionId,
    });
  }

  return res.status(500).json({
    error: 'Failed to load session',
    detail: result.error,
  });
});

// ─── HEAD /api/session/:sessionId ────────────────────────────────────
// Check if a session exists (lightweight: no body returned).
router.head('/api/session/:sessionId', (req, res) => {
  const userId = resolveUserId(req);
  const { sessionId } = req.params;

  if (sessionExists(userId, sessionId)) {
    return res.status(200).end();
  }

  return res.status(404).end();
});

// ─── DELETE /api/session/:sessionId ──────────────────────────────────
// Delete a saved session and all its data.
router.delete('/api/session/:sessionId', (req, res) => {
  const userId = resolveUserId(req);
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId parameter' });
  }

  const result = deleteSession(userId, sessionId);

  if (result.success) {
    return res.json({
      success: true,
      sessionId,
      deletedAt: new Date().toISOString(),
    });
  }

  return res.status(500).json({
    error: 'Failed to delete session',
    detail: result.error,
  });
});

export default router;
