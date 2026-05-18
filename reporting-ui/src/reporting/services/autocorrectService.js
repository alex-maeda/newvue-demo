/**
 * Autocorrect Service
 *
 * Loads the autocorrection lexicon from the server and applies
 * four tiers of corrections to ASR output for instant visual feedback:
 *
 * Tier 0 — User-specific rules (personal autocorrect list)
 *   Loaded from the user's profile, applied FIRST with placeholder
 *   protection so that corrected regions cannot be re-processed by
 *   system rules. User rules always win conflicts.
 *
 * Tier 1 — Deterministic formatting fixes (punctuation, spacing)
 *   Applied as literal string replacements BEFORE word-boundary rules.
 *   These handle ASR formatting quirks that can't be caught by \b regex.
 *
 * Tier 2 — Word-boundary lexicon rules (medical terms, numbers)
 *   Longest-match-first, case-insensitive, whole-word replacements
 *   loaded from autocorrect.json per design doc §6.1.
 *
 * Tier 3 — Punctuation spacing cleanup
 *   Removes orphaned spaces before closing/terminal punctuation
 *   (e.g., "stroke ." → "stroke.") left behind by Tier 2 replacements.
 */

// ---- Tier 1: Deterministic formatting fixes ----
// These are applied as literal replacements (order matters: longer first).
const FORMATTING_FIXES = [
  // ASR sometimes places a space before a period — " ." → "."
  { find: ' .', replace: '.' },
  // ASR spurious sentence split — "concerning. For" → "concerning for"
  { find: 'concerning. For', replace: 'concerning for' },
];

// ---- Tier 2: Word-boundary lexicon (system rules) ----
let rules = null;
let sortedKeys = [];
let loaded = false;
let loading = null; // Promise for deduplication

// ---- Tier 0: User-specific rules ----
let userRules = null;       // { input: output } map
let userSortedKeys = [];    // length-descending sorted keys

/**
 * Load autocorrect rules from the server.
 * Both system and user rules are cached after first load.
 * User rules are refreshed via reloadUserRules() when the
 * Autocorrect window saves/closes.
 *
 * Returns a promise that resolves when rules are loaded.
 * Deduplicates concurrent calls.
 */
export async function load() {
  if (loaded) return;
  if (loading) return loading;

  loading = (async () => {
    try {
      // --- System rules ---
      const res = await fetch('/api/config/autocorrect');
      if (!res.ok) {
        console.warn('[Autocorrect] Failed to load system rules:', res.status);
      } else {
        rules = await res.json();
        sortedKeys = Object.keys(rules).sort((a, b) => b.length - a.length);
        console.log(`[Autocorrect] Loaded ${sortedKeys.length} system rules + ${FORMATTING_FIXES.length} formatting fixes`);
      }

      // --- User rules (first load) ---
      await loadUserRules();

      loaded = true;
    } catch (err) {
      console.warn('[Autocorrect] Error loading rules:', err);
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * Synchronously update the in-memory user rules from an entries array.
 * Called by AutocorrectWindow after save/delete — no async fetch needed
 * because the UI already has the authoritative entries data.
 *
 * This avoids async fetches that can race with the ambient listener's
 * mic acquisition lifecycle.
 *
 * @param {Array} entries - Array of { input, output, nickname } objects
 */
export function updateUserRules(entries) {
  if (!entries || entries.length === 0) {
    userRules = null;
    userSortedKeys = [];
    console.log('[Autocorrect] User rules cleared (0 entries)');
    return;
  }

  userRules = {};
  for (const entry of entries) {
    const key = entry.input.toLowerCase();
    userRules[key] = entry.output;
  }

  userSortedKeys = Object.keys(userRules).sort((a, b) => b.length - a.length);
  console.log(`[Autocorrect] Updated ${userSortedKeys.length} user-specific rules (in-memory)`);
}

/**
 * Internal: fetch user autocorrect entries from the server and build
 * the lookup map + sorted keys array.
 */
async function loadUserRules() {
  try {
    const res = await fetch('/api/user/autocorrect');
    if (!res.ok) {
      console.warn('[Autocorrect] Failed to load user rules:', res.status);
      userRules = null;
      userSortedKeys = [];
      return;
    }
    const data = await res.json();
    const entries = data.entries || [];

    if (entries.length === 0) {
      userRules = null;
      userSortedKeys = [];
      console.log('[Autocorrect] No user-specific autocorrect rules');
      return;
    }

    // Build lookup map { lowercaseInput: output }
    // If multiple entries have the same input (case-insensitive), last one wins
    userRules = {};
    for (const entry of entries) {
      const key = entry.input.toLowerCase();
      userRules[key] = entry.output;
    }

    userSortedKeys = Object.keys(userRules).sort((a, b) => b.length - a.length);
    console.log(`[Autocorrect] Loaded ${userSortedKeys.length} user-specific rules`);
  } catch (err) {
    console.warn('[Autocorrect] Error loading user rules:', err);
    userRules = null;
    userSortedKeys = [];
  }
}

/**
 * Apply all autocorrect rules to text.
 *
 * 0. Tier 0: User-specific rules (placeholder-protected, longest-match-first)
 * 1. Tier 1: Deterministic formatting fixes (literal string replacements)
 * 2. Tier 2: System word-boundary lexicon rules (placeholder-protected)
 * 3. Tier 3: Punctuation spacing cleanup
 * 4. Final: Swap all placeholders back to values
 *
 * @param {string} text - Raw ASR text
 * @returns {string} - Corrected text
 */
export function apply(text) {
  if (!text) return '';

  let result = text;

  // Master placeholder array — shared across Tier 0 and Tier 2
  const placeholders = [];

  // --- Tier 0: User-specific rules (placeholder-protected) ---
  if (userRules && userSortedKeys.length > 0) {
    for (const key of userSortedKeys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'gi');

      result = result.replace(re, () => {
        const idx = placeholders.length;
        const token = `__AC_USER_${idx}__`;
        placeholders.push({ token, value: userRules[key] });
        return token;
      });
    }
    if (result !== text) console.log('[Autocorrect] After Tier 0 (user rules):', JSON.stringify(result));
  }
  const afterTier0 = result;

  // --- Tier 1: Formatting fixes (literal replacements, case-sensitive) ---
  for (const fix of FORMATTING_FIXES) {
    while (result.includes(fix.find)) {
      result = result.split(fix.find).join(fix.replace);
    }
  }
  if (result !== afterTier0) console.log('[Autocorrect] After Tier 1:', JSON.stringify(result));

  // --- Tier 2: System word-boundary lexicon rules (placeholder-protected) ---
  // System regex cannot match inside __AC_USER_n__ placeholder tokens,
  // so user-corrected text is inherently protected.
  const afterTier1 = result;
  if (rules) {
    for (const key of sortedKeys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'gi');

      result = result.replace(re, () => {
        const idx = placeholders.length;
        const token = `__AC_${idx}__`;
        placeholders.push({ token, value: rules[key] });
        return token;
      });
    }
  }
  if (result !== afterTier1) console.log('[Autocorrect] After Tier 2:', JSON.stringify(result));

  // --- Swap ALL placeholders back to their intended values ---
  for (const { token, value } of placeholders) {
    result = result.split(token).join(value);
  }

  // --- Tier 3: Punctuation spacing cleanup ---
  const beforeTier3 = result;
  result = result.replace(/ ([.,;)\]}])/g, '$1');

  // Collapse double periods
  result = result.replace(/\.{2,}/g, '.');
  if (result !== beforeTier3) console.log('[Autocorrect] After Tier 3:', JSON.stringify(result));

  console.log('[Autocorrect] Final result:', JSON.stringify(result));

  return result;
}

/**
 * Check if system rules are loaded.
 */
export function isLoaded() {
  return loaded;
}

export default { load, apply, isLoaded, updateUserRules };
