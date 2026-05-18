/**
 * userProfileService.js — User Profile Data Access Layer
 *
 * Central abstraction for all user profile data access.
 * All profile reads/writes go through this service.
 *
 * Storage: File-based (config/profiles/{userId}/)
 *   - profile.json      → identity (displayName, initials, role)
 *   - preferences.json   → user preferences (impression settings, etc.)
 *   - avatar.jpg          → profile photo (optional)
 *
 * Design:
 *   - resolveUserId() is the SINGLE POINT to replace with auth middleware later.
 *   - Atomic writes: temp file → rename to prevent partial writes.
 *   - Missing files are handled gracefully with sensible defaults.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.resolve(__dirname, '..', '..', 'config', 'profiles');
const CONFIG_DIR = path.resolve(__dirname, '..', '..', 'config');

// ─── Default User ID (development only) ─────────────────────────────
// This is the SINGLE POINT to replace with auth context extraction.
// Future: read from JWT, SSO session, or request auth header.
const DEFAULT_USER_ID = '12345';

// ─── Default Preferences ─────────────────────────────────────────────
const DEFAULT_PREFERENCES = {
  impressionSettings: {
    structure: 'numbered',
    verbosity: 'medium',
    hedging: 'medium',
    normalFindings: 'exclude',
    acronymExpansion: false,
    guidelines: true,
    recommendations: 'imaging_clinical',
  },
  priorImpressionSamples: [],
  dictationPanel: {
    collapsed: false,
  },
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Resolve the active user ID.
 * During development, returns a hardcoded default.
 * Replace this with auth middleware extraction in production.
 *
 * @param {object} [req] - Express request object (unused during dev)
 * @returns {string} User ID
 */
export function resolveUserId(req) {
  // Future: return req?.user?.id || req?.headers?.['x-user-id'] || DEFAULT_USER_ID;
  return DEFAULT_USER_ID;
}

/**
 * Load a user's identity profile.
 *
 * @param {string} userId
 * @returns {object|null} Profile data or null if not found
 */
export function loadProfile(userId) {
  const profilePath = path.join(PROFILES_DIR, userId, 'profile.json');

  try {
    const data = fs.readFileSync(profilePath, 'utf8');
    const profile = JSON.parse(data);
    console.log(`[UserProfile] Loaded profile for user: ${userId} (${profile.displayName})`);
    return profile;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn(`[UserProfile] No profile found for user: ${userId}`);
      return null;
    }
    console.error(`[UserProfile] Error reading profile for user ${userId}:`, e.message);
    return null;
  }
}

/**
 * Load a user's preferences.
 * If the file doesn't exist, creates it with defaults and returns those.
 *
 * @param {string} userId
 * @returns {object} Preferences data (always returns a valid object)
 */
export function loadPreferences(userId) {
  const prefsPath = path.join(PROFILES_DIR, userId, 'preferences.json');

  try {
    const data = fs.readFileSync(prefsPath, 'utf8');
    const prefs = JSON.parse(data);
    console.log(`[UserProfile] Loaded preferences for user: ${userId}`);
    return prefs;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log(`[UserProfile] No preferences file for user ${userId} — creating defaults`);
      // Ensure the directory exists
      const userDir = path.join(PROFILES_DIR, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      // Write defaults
      fs.writeFileSync(prefsPath, JSON.stringify(DEFAULT_PREFERENCES, null, 2), 'utf8');
      return { ...DEFAULT_PREFERENCES };
    }
    console.error(`[UserProfile] Error reading preferences for user ${userId}:`, e.message);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Save a user's preferences (atomic write).
 * Writes to a temp file first, then renames to prevent partial writes.
 *
 * @param {string} userId
 * @param {object} preferences - Full preferences object to save
 * @returns {boolean} True if saved successfully
 */
export function savePreferences(userId, preferences) {
  const userDir = path.join(PROFILES_DIR, userId);
  const prefsPath = path.join(userDir, 'preferences.json');
  const tempPath = path.join(userDir, `preferences.tmp.${Date.now()}.json`);

  try {
    // Ensure directory exists
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Write to temp file, then rename (atomic on most filesystems)
    fs.writeFileSync(tempPath, JSON.stringify(preferences, null, 2), 'utf8');
    fs.renameSync(tempPath, prefsPath);

    console.log(`[UserProfile] Saved preferences for user: ${userId}`);
    return true;
  } catch (e) {
    console.error(`[UserProfile] Error saving preferences for user ${userId}:`, e.message);
    // Clean up temp file if it exists
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return false;
  }
}

// ─── Default Autocorrect Data ────────────────────────────────────────
const DEFAULT_AUTOCORRECT = {
  entries: [],
};

/**
 * Load a user's autocorrect entries.
 * If the file doesn't exist, creates it with an empty entries array.
 *
 * @param {string} userId
 * @returns {object} Autocorrect data (always returns a valid object)
 */
export function loadAutocorrect(userId) {
  const acPath = path.join(PROFILES_DIR, userId, 'autocorrect.json');

  try {
    const data = fs.readFileSync(acPath, 'utf8');
    const ac = JSON.parse(data);
    console.log(`[UserProfile] Loaded ${ac.entries?.length || 0} autocorrect entries for user: ${userId}`);
    return ac;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log(`[UserProfile] No autocorrect file for user ${userId} — creating defaults`);
      const userDir = path.join(PROFILES_DIR, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      fs.writeFileSync(acPath, JSON.stringify(DEFAULT_AUTOCORRECT, null, 2), 'utf8');
      return { ...DEFAULT_AUTOCORRECT, entries: [] };
    }
    console.error(`[UserProfile] Error reading autocorrect for user ${userId}:`, e.message);
    return { ...DEFAULT_AUTOCORRECT, entries: [] };
  }
}

/**
 * Save a user's autocorrect entries (atomic write).
 *
 * @param {string} userId
 * @param {object} data - Full autocorrect data object { entries: [...] }
 * @returns {boolean} True if saved successfully
 */
export function saveAutocorrect(userId, data) {
  const userDir = path.join(PROFILES_DIR, userId);
  const acPath = path.join(userDir, 'autocorrect.json');
  const tempPath = path.join(userDir, `autocorrect.tmp.${Date.now()}.json`);

  try {
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, acPath);

    console.log(`[UserProfile] Saved ${data.entries?.length || 0} autocorrect entries for user: ${userId}`);
    return true;
  } catch (e) {
    console.error(`[UserProfile] Error saving autocorrect for user ${userId}:`, e.message);
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return false;
  }
}

// ─── Default Macros Data ─────────────────────────────────────────────
const DEFAULT_MACROS = {
  macros: [],
};

/**
 * Load a user's macro definitions.
 * If the file doesn't exist, creates it with an empty macros array.
 *
 * @param {string} userId
 * @returns {object} Macros data (always returns a valid object)
 */
export function loadMacros(userId) {
  const macrosPath = path.join(PROFILES_DIR, userId, 'macros.json');

  try {
    const data = fs.readFileSync(macrosPath, 'utf8');
    const macros = JSON.parse(data);
    console.log(`[UserProfile] Loaded ${macros.macros?.length || 0} macros for user: ${userId}`);
    return macros;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log(`[UserProfile] No macros file for user ${userId} — creating defaults`);
      const userDir = path.join(PROFILES_DIR, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      fs.writeFileSync(macrosPath, JSON.stringify(DEFAULT_MACROS, null, 2), 'utf8');
      return { ...DEFAULT_MACROS, macros: [] };
    }
    console.error(`[UserProfile] Error reading macros for user ${userId}:`, e.message);
    return { ...DEFAULT_MACROS, macros: [] };
  }
}

/**
 * Load system-wide default macros from config/macros_default.json.
 * These are available to all users and tagged with isSystem: true.
 *
 * @returns {Array} Array of system macro objects (empty array on error)
 */
export function loadSystemMacros() {
  const macrosPath = path.join(CONFIG_DIR, 'macros_default.json');
  try {
    const data = fs.readFileSync(macrosPath, 'utf8');
    const parsed = JSON.parse(data);
    const macros = (parsed.macros || []).map(m => ({ ...m, isSystem: true }));
    console.log(`[UserProfile] Loaded ${macros.length} system-default macros`);
    return macros;
  } catch (e) {
    console.warn(`[UserProfile] Could not load system macros: ${e.message}`);
    return [];
  }
}

/**
 * Save a user's macro definitions (atomic write).
 *
 * @param {string} userId
 * @param {object} data - Full macros data object { macros: [...] }
 * @returns {boolean} True if saved successfully
 */
export function saveMacros(userId, data) {
  const userDir = path.join(PROFILES_DIR, userId);
  const macrosPath = path.join(userDir, 'macros.json');
  const tempPath = path.join(userDir, `macros.tmp.${Date.now()}.json`);

  try {
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, macrosPath);

    console.log(`[UserProfile] Saved ${data.macros?.length || 0} macros for user: ${userId}`);
    return true;
  } catch (e) {
    console.error(`[UserProfile] Error saving macros for user ${userId}:`, e.message);
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Get the filesystem path to a user's avatar image.
 *
 * @param {string} userId
 * @returns {string|null} Absolute path to avatar file, or null if not found
 */
export function getAvatarPath(userId) {
  // Check common image extensions
  const extensions = ['jpg', 'jpeg', 'png', 'webp'];
  for (const ext of extensions) {
    const avatarPath = path.join(PROFILES_DIR, userId, `avatar.${ext}`);
    if (fs.existsSync(avatarPath)) {
      return avatarPath;
    }
  }
  return null;
}

export default {
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
};
