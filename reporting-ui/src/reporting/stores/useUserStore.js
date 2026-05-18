/**
 * useUserStore.js — User Profile & Preferences Store
 *
 * Dedicated Zustand store for user identity and preferences.
 * Separated from useReportStore (which holds session/report state).
 *
 * Responsibilities:
 *   - User identity (userId, displayName, initials, role, avatar)
 *   - User preferences (impression settings, prior impression samples)
 *   - Debounced auto-save to server on preference changes
 *
 * Data Flow:
 *   App startup → loadProfile() + loadPreferences() → fetches from server
 *   User changes pref → updateImpressionSettings() → Zustand updates → debounced PUT to server
 */

import { create } from 'zustand';

// ─── Default Impression Preferences ──────────────────────────────────
// Matches the server-side defaults in userProfileService.js.
// Used as fallback if preferences haven't loaded yet.
const DEFAULT_IMPRESSION_PREFS = {
  structure: 'numbered',
  verbosity: 'medium',
  hedging: 'medium',
  normalFindings: 'exclude',
  acronymExpansion: false,
  guidelines: true,
  recommendations: 'imaging_clinical',
};

// ─── Debounce Timer ──────────────────────────────────────────────────
let saveDebounceTimer = null;
const SAVE_DEBOUNCE_MS = 800;

function debouncedSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    const state = useUserStore.getState();
    state.savePreferences();
  }, SAVE_DEBOUNCE_MS);
}

// ─── Store Definition ────────────────────────────────────────────────
const useUserStore = create((set, get) => ({
  // --- Identity ---
  userId: null,
  displayName: '',
  initials: '',
  role: '',
  avatarUrl: null,

  // --- Preferences ---
  preferences: {
    impressionSettings: { ...DEFAULT_IMPRESSION_PREFS },
    priorImpressionSamples: [],
    dictationPanel: {
      collapsed: false,
    },
    voiceWakeEnabled: true,  // "Turn Mic On by Voice" — ambient wake-word listener
  },

  // --- Loading State ---
  profileLoaded: false,
  preferencesLoaded: false,

  // ─── Actions ───────────────────────────────────────────────────────

  /**
   * Load the active user's identity profile from the server.
   * Called once at app startup.
   */
  loadProfile: async () => {
    try {
      const res = await fetch('/api/user/profile');
      if (!res.ok) {
        console.warn('[UserStore] Failed to load profile:', res.status);
        set({ profileLoaded: true });
        return;
      }
      const profile = await res.json();
      console.log(`[UserStore] Profile loaded: ${profile.displayName}`);
      set({
        userId: profile.userId,
        displayName: profile.displayName || '',
        initials: profile.initials || '',
        role: profile.role || '',
        avatarUrl: '/api/user/avatar',
        profileLoaded: true,
      });
    } catch (e) {
      console.error('[UserStore] Error loading profile:', e.message);
      set({ profileLoaded: true });
    }
  },

  /**
   * Load the active user's preferences from the server.
   * Called once at app startup.
   */
  loadPreferences: async () => {
    try {
      const res = await fetch('/api/user/preferences');
      if (!res.ok) {
        console.warn('[UserStore] Failed to load preferences:', res.status);
        set({ preferencesLoaded: true });
        return;
      }
      const prefs = await res.json();
      console.log('[UserStore] Preferences loaded');

      // Merge with defaults to ensure all keys exist (handles partial prefs files)
      const impressionSettings = {
        ...DEFAULT_IMPRESSION_PREFS,
        ...(prefs.impressionSettings || {}),
      };
      const priorImpressionSamples = prefs.priorImpressionSamples || [];
      const dictationPanel = {
        collapsed: false,
        ...(prefs.dictationPanel || {}),
      };

      set({
        preferences: {
          impressionSettings,
          priorImpressionSamples,
          dictationPanel,
          voiceWakeEnabled: prefs.voiceWakeEnabled !== false, // default true
        },
        preferencesLoaded: true,
      });
    } catch (e) {
      console.error('[UserStore] Error loading preferences:', e.message);
      set({ preferencesLoaded: true });
    }
  },

  /**
   * Update impression settings (partial merge).
   * Triggers a debounced save to the server.
   *
   * @param {object} partialPrefs - Partial impression settings to merge
   */
  updateImpressionSettings: (partialPrefs) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        impressionSettings: {
          ...s.preferences.impressionSettings,
          ...partialPrefs,
        },
      },
    }));
    debouncedSave();
  },

  /**
   * Update prior impression samples.
   * Triggers a debounced save to the server.
   *
   * @param {Array} samples - Array of sample impression text strings
   */
  updatePriorImpressionSamples: (samples) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        priorImpressionSamples: samples,
      },
    }));
    debouncedSave();
  },

  // ── Dictation Panel Preferences ─────────────────────────────────────
  // To check collapse state, read `preferences.dictationPanel?.collapsed`
  // directly from the state. Zustand Object.assign evaluates JS getters
  // once — never use `get isDictationCollapsed()` in a Zustand store.

  /**
   * Set the dictation box collapsed state.
   * Updates the preference and triggers a debounced save to the server.
   *
   * @param {boolean} collapsed
   */
  setDictationCollapsed: (collapsed) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        dictationPanel: {
          ...(s.preferences.dictationPanel || {}),
          collapsed,
        },
      },
    }));
    debouncedSave();
  },

  /**
   * Set the "Turn Mic On by Voice" preference.
   * Controls whether the ambient wake-word listener is active.
   *
   * @param {boolean} enabled
   */
  setVoiceWakeEnabled: (enabled) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        voiceWakeEnabled: enabled,
      },
    }));
    debouncedSave();
  },

  /**
   * Save the full preferences object to the server.
   * Called by the debounce timer after preference changes.
   */
  savePreferences: async () => {
    const { preferences } = get();
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      if (res.ok) {
        console.log('[UserStore] Preferences saved to server');
      } else {
        console.warn('[UserStore] Failed to save preferences:', res.status);
      }
    } catch (e) {
      console.error('[UserStore] Error saving preferences:', e.message);
    }
  },
}));

export default useUserStore;
