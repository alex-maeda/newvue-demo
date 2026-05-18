/**
 * profileRouter.js — User Profile API Endpoints
 *
 * Express router for serving and updating user profile data.
 *
 * Endpoints:
 *   GET  /api/user/profile       → User identity (displayName, initials, role)
 *   GET  /api/user/preferences   → User preferences (impression settings, etc.)
 *   PUT  /api/user/preferences   → Save updated preferences
 *   GET  /api/user/avatar        → User avatar image file
 *   GET  /api/user/autocorrect   → User autocorrect entries
 *   PUT  /api/user/autocorrect   → Save all autocorrect entries (full replacement)
 *   POST /api/user/autocorrect/entry → Add a single autocorrect entry
 *
 * The active user is determined by userProfileService.resolveUserId(),
 * which is a hardcoded default during development and will be replaced
 * by auth middleware in production.
 */

import { Router } from 'express';
import {
  resolveUserId,
  loadProfile,
  loadPreferences,
  savePreferences,
  loadAutocorrect,
  saveAutocorrect,
  loadMacros,
  saveMacros,
  loadSystemMacros,
  getAvatarPath,
} from './userProfileService.js';

const router = Router();

// ─── GET /api/user/profile ───────────────────────────────────────────
// Returns the active user's identity profile.
router.get('/api/user/profile', (req, res) => {
  const userId = resolveUserId(req);
  const profile = loadProfile(userId);

  if (!profile) {
    return res.status(404).json({ error: `Profile not found for user: ${userId}` });
  }

  res.json(profile);
});

// ─── GET /api/user/preferences ───────────────────────────────────────
// Returns the active user's preferences (impression settings, samples, etc.)
router.get('/api/user/preferences', (req, res) => {
  const userId = resolveUserId(req);
  const preferences = loadPreferences(userId);
  res.json(preferences);
});

// ─── PUT /api/user/preferences ───────────────────────────────────────
// Saves the active user's preferences (full replacement).
router.put('/api/user/preferences', (req, res) => {
  const userId = resolveUserId(req);
  const preferences = req.body;

  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ error: 'Invalid preferences payload' });
  }

  const success = savePreferences(userId, preferences);

  if (success) {
    res.json({ status: 'saved', userId });
  } else {
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// ─── GET /api/user/avatar ────────────────────────────────────────────
// Serves the active user's avatar image, or 404 if not found.
router.get('/api/user/avatar', (req, res) => {
  const userId = resolveUserId(req);
  const avatarPath = getAvatarPath(userId);

  if (!avatarPath) {
    return res.status(404).json({ error: 'No avatar found' });
  }

  res.sendFile(avatarPath);
});

// ─── GET /api/user/autocorrect ───────────────────────────────────────
// Returns the active user's autocorrect entries.
router.get('/api/user/autocorrect', (req, res) => {
  const userId = resolveUserId(req);
  const data = loadAutocorrect(userId);
  res.json(data);
});

// ─── PUT /api/user/autocorrect ───────────────────────────────────────
// Full replacement save of the user's autocorrect data.
// Used by debounce saves and save-on-close.
router.put('/api/user/autocorrect', (req, res) => {
  const userId = resolveUserId(req);
  const data = req.body;

  if (!data || !Array.isArray(data.entries)) {
    return res.status(400).json({ error: 'Invalid autocorrect payload — expected { entries: [...] }' });
  }

  const success = saveAutocorrect(userId, data);

  if (success) {
    res.json({ status: 'saved', userId, count: data.entries.length });
  } else {
    res.status(500).json({ error: 'Failed to save autocorrect entries' });
  }
});

// ─── POST /api/user/autocorrect/entry ────────────────────────────────
// Add a single new autocorrect entry. Checks for duplicate input/output
// pairs (case-insensitive).
router.post('/api/user/autocorrect/entry', (req, res) => {
  const userId = resolveUserId(req);
  const { input, output, nickname } = req.body;

  if (!input || !output) {
    return res.status(400).json({ error: 'Both input and output are required' });
  }

  const data = loadAutocorrect(userId);
  const inputLower = input.trim().toLowerCase();
  const outputLower = output.trim().toLowerCase();

  // Check for duplicate (case-insensitive match on both input and output)
  const duplicate = data.entries.find(
    (e) => e.input.trim().toLowerCase() === inputLower &&
           e.output.trim().toLowerCase() === outputLower
  );

  if (duplicate) {
    return res.json({ status: 'duplicate', existingEntry: duplicate });
  }

  const newEntry = {
    id: `ac_${Date.now()}`,
    input: input.trim(),
    output: output.trim(),
    nickname: (nickname || '').trim(),
  };

  data.entries.push(newEntry);
  const success = saveAutocorrect(userId, data);

  if (success) {
    res.json({ status: 'created', entry: newEntry });
  } else {
    res.status(500).json({ error: 'Failed to save new autocorrect entry' });
  }
});

// ─── GET /api/user/macros ────────────────────────────────────────────
// Returns the active user's macros merged with system defaults.
// User macros override system macros on case-insensitive name collision.
router.get('/api/user/macros', (req, res) => {
  const userId = resolveUserId(req);
  const userData = loadMacros(userId);
  const systemMacros = loadSystemMacros();

  // Build set of user macro names (lowercase) for collision detection
  const userNames = new Set(
    (userData.macros || []).map(m => m.name.trim().toLowerCase())
  );

  // Filter out system macros that collide with user macros
  const filteredSystem = systemMacros.filter(
    m => !userNames.has(m.name.trim().toLowerCase())
  );

  // Tag user macros with isSystem: false for client-side distinction
  const taggedUser = (userData.macros || []).map(m => ({ ...m, isSystem: false }));

  res.json({
    macros: [...taggedUser, ...filteredSystem],
  });
});

// ─── PUT /api/user/macros ────────────────────────────────────────────
// Full replacement save of the user's macro data.
router.put('/api/user/macros', (req, res) => {
  const userId = resolveUserId(req);
  const data = req.body;

  if (!data || !Array.isArray(data.macros)) {
    return res.status(400).json({ error: 'Invalid macros payload — expected { macros: [...] }' });
  }

  const success = saveMacros(userId, data);

  if (success) {
    res.json({ status: 'saved', userId, count: data.macros.length });
  } else {
    res.status(500).json({ error: 'Failed to save macros' });
  }
});

// ─── POST /api/user/macros/entry ─────────────────────────────────────
// Add a single new macro. Checks for duplicate names (case-insensitive).
router.post('/api/user/macros/entry', (req, res) => {
  const userId = resolveUserId(req);
  const { name, actions } = req.body;

  if (!name || !Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'Name and at least one action are required' });
  }

  const data = loadMacros(userId);
  const nameLower = name.trim().toLowerCase();

  // Check for duplicate name
  const duplicate = data.macros.find(
    (m) => m.name.trim().toLowerCase() === nameLower
  );

  if (duplicate) {
    return res.json({ status: 'duplicate', existingMacro: duplicate });
  }

  const newMacro = {
    id: `macro_${Date.now()}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    actions: actions.map((a, i) => ({ ...a, order: i })),
  };

  data.macros.push(newMacro);
  const success = saveMacros(userId, data);

  if (success) {
    res.json({ status: 'created', macro: newMacro });
  } else {
    res.status(500).json({ error: 'Failed to save new macro' });
  }
});

// ─── DELETE /api/user/macros/:id ─────────────────────────────────────
// Delete a specific macro by its ID.
router.delete('/api/user/macros/:id', (req, res) => {
  const userId = resolveUserId(req);
  const macroId = req.params.id;

  const data = loadMacros(userId);
  const idx = data.macros.findIndex((m) => m.id === macroId);

  if (idx < 0) {
    return res.status(404).json({ error: `Macro not found: ${macroId}` });
  }

  data.macros.splice(idx, 1);
  const success = saveMacros(userId, data);

  if (success) {
    res.json({ status: 'deleted', macroId });
  } else {
    res.status(500).json({ error: 'Failed to delete macro' });
  }
});

export default router;
