/**
 * Macro Service — Phase 2
 *
 * Central coordination layer for macro operations:
 *   - Load & cache macros (merged user + system) from the API
 *   - Filter macros by name prefix (for dot-phrase overlay)
 *   - Execute macros: sequential action runner with segment-aware text insertion
 *   - Re-register voice commands when macros change
 *
 * Macro Execution Architecture:
 *   1. Set typingLocked = true to block user input
 *   2. Iterate actions in order:
 *      - 'text' → insertTextAtPosition() at current caret, advance caret
 *      - 'command' → invoke voice command handler (navigateToNextField, etc.)
 *   3. Wait for DOM reconciliation (requestAnimationFrame) between actions
 *   4. Clear typingLocked, trigger Pass 1 debounce
 */

import useReportStore from '../stores/useReportStore';
import { updateCaretPosition, getCaretPosition } from './caretTracker';
import {
  navigateToNextField,
  navigateToPreviousField,
  navigateToSection,
  navigateToDictation,
  insertNewLine,
  insertNewParagraph,
  goToStart,
  goToEnd,
  deleteText,
  highlightText,
  replaceText,
} from './voiceCommandHandlers';

// ─── Command Handler Lookup ──────────────────────────────────────────
// Maps command IDs (from AVAILABLE_COMMANDS in MacroEditorWindow) to
// their handler functions from voiceCommandHandlers.

const COMMAND_HANDLERS = {
  next_field:      navigateToNextField,
  previous_field:  navigateToPreviousField,
  go_to_section:   navigateToSection,
  go_to_dictation: navigateToDictation,
  new_line:        insertNewLine,
  new_paragraph:   insertNewParagraph,
  go_to_start:     goToStart,
  go_to_end:       goToEnd,
  delete_text:     deleteText,
  highlight_text:  highlightText,
  replace_text:    replaceText,
};

// ─── Macro Cache ─────────────────────────────────────────────────────

let cachedMacros = [];
let isLoaded = false;

// ─── Names that cannot be used as macro name prefixes ────────────────
// These would collide with existing "insert [X]" voice commands.
const RESERVED_NAME_PREFIXES = ['line', 'paragraph', 'new'];

/**
 * Check if a macro name is valid (no collision with existing voice commands).
 *
 * @param {string} name - Macro name to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateMacroName(name) {
  if (!name || !name.trim()) {
    return { valid: false, reason: 'Macro name cannot be empty' };
  }

  const firstWord = name.trim().toLowerCase().split(/\s+/)[0];
  if (RESERVED_NAME_PREFIXES.includes(firstWord)) {
    return {
      valid: false,
      reason: `Macro names cannot begin with "${firstWord}" — this conflicts with the "insert ${firstWord}" voice command.`,
    };
  }

  return { valid: true };
}

/**
 * Load macros from the API and cache them.
 * Returns the merged list of user + system macros.
 *
 * @returns {Promise<Array>} Merged macro list
 */
export async function loadMacros() {
  try {
    const response = await fetch('/api/user/macros');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cachedMacros = data.macros || [];
    isLoaded = true;
    console.log(`[MacroService] Loaded ${cachedMacros.length} macros (${cachedMacros.filter(m => m.isSystem).length} system)`);
    return cachedMacros;
  } catch (err) {
    console.error('[MacroService] Failed to load macros:', err);
    cachedMacros = [];
    isLoaded = true;
    return [];
  }
}

/**
 * Get the cached macro list. If not loaded yet, returns empty array.
 * @returns {Array}
 */
export function getMacroList() {
  return cachedMacros;
}

/**
 * Find macros whose name starts with the given prefix (case-insensitive).
 * Returns sorted A-Z.
 *
 * @param {string} prefix - Search prefix
 * @returns {Array} Matching macros, sorted alphabetically
 */
export function findMatchingMacros(prefix) {
  if (!prefix) return [...cachedMacros].sort((a, b) => a.name.localeCompare(b.name));

  const lowerPrefix = prefix.toLowerCase();
  return cachedMacros
    .filter(m => m.name.toLowerCase().startsWith(lowerPrefix))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find a macro by its ID.
 *
 * @param {string} macroId - Macro ID
 * @returns {object|null}
 */
export function getMacroById(macroId) {
  return cachedMacros.find(m => m.id === macroId) || null;
}

/**
 * Find a macro by name (case-insensitive exact match).
 *
 * @param {string} name - Macro name
 * @returns {object|null}
 */
export function getMacroByName(name) {
  const lower = name.toLowerCase().trim();
  return cachedMacros.find(m => m.name.toLowerCase().trim() === lower) || null;
}

/**
 * Refresh the cached macro list from the API and re-register voice commands.
 * Called after the Macro Editor saves changes.
 */
export async function refreshMacros() {
  await loadMacros();
  // Dynamic import to avoid circular dependency
  const { registerMacroCommands } = await import('./voiceCommandRegistry');
  registerMacroCommands(cachedMacros);
}

// ─── Macro Execution Engine ──────────────────────────────────────────

/**
 * Wait for the next animation frame (DOM reconciliation).
 * @returns {Promise<void>}
 */
function waitForFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

/**
 * Wait long enough for focus changes and React reconciliation to settle.
 * Navigation commands (go_to_section, next_field, etc.) use
 * focusAndPlaceCaretAtEnd which schedules a setTimeout(0) after focus
 * for post-reconciliation caret placement.
 *
 * The full reconciliation chain after a navigation command is:
 *   1. Zustand setActiveTextarea() — synchronous store update
 *   2. focusAndPlaceCaretAtEnd() — DOM focus + selection + updateCaretPosition
 *   3. setTimeout(0) inside focusAndPlaceCaretAtEnd — re-asserts selection
 *      and calls bumpCaretVersion()
 *   4. bumpCaretVersion() triggers React re-render of content boxes
 *   5. React commits the re-render to the DOM
 *
 * A 50ms + single RAF was insufficient for the full chain (particularly
 * when navigating to the Impression section which may have dynamically
 * generated content boxes requiring heavier re-renders). We use 150ms
 * + double-RAF to ensure all timeouts, microtasks, and React renders
 * have settled before the next macro action reads store/DOM state.
 *
 * @returns {Promise<void>}
 */
function waitForFocusSettle() {
  return new Promise(resolve => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    }, 100);
  });
}

/**
 * Execute a macro by its ID.
 *
 * Runs all actions in sequence with proper segment tracking:
 *   1. Locks user input (typingLocked = true)
 *   2. For each action:
 *      - 'text': inserts text at current caret via insertTextAtPosition
 *      - 'command': invokes the corresponding voice command handler
 *      - Waits for DOM reconciliation between actions
 *   3. Unlocks user input and triggers Pass 1 debounce
 *
 * @param {string} macroId - The macro to execute
 * @returns {Promise<boolean>} True if execution succeeded
 */
export async function executeMacro(macroId) {
  const macro = getMacroById(macroId);
  if (!macro) {
    console.error(`[MacroService] Macro not found: ${macroId}`);
    return false;
  }

  if (!macro.actions || macro.actions.length === 0) {
    console.warn(`[MacroService] Macro "${macro.name}" has no actions — nothing to execute`);
    return true; // Not an error, just a no-op (e.g. system placeholder)
  }

  console.log(`[MacroService] ▶ Executing macro: "${macro.name}" (${macro.actions.length} actions)`);

  const store = useReportStore.getState();

  // Lock user input during execution
  useReportStore.setState({ typingLocked: true });

  try {
    for (let i = 0; i < macro.actions.length; i++) {
      const action = macro.actions[i];
      console.log(`[MacroService]   Step ${i + 1}/${macro.actions.length}: ${action.type}${action.type === 'command' ? ` (${action.commandId})` : ''}`);

      if (action.type === 'text') {
        await executeTextAction(action);
        // Simple DOM reconciliation after text insertion
        await waitForFrame();
      } else if (action.type === 'command') {
        await executeCommandAction(action);
        // Navigation commands change focus/activeTextareaId — need extra
        // settle time so the next action reads the correct target and caret
        await waitForFocusSettle();
      } else if (action.type === 'erik') {
        executeErikAction(action);
        // Fire-and-forget: ERIK queries stream asynchronously in the cockpit
        // and don't affect the reporting iframe's state
        await waitForFrame();
      } else {
        console.warn(`[MacroService] Unknown action type: ${action.type}`);
        await waitForFrame();
      }
    }

    console.log(`[MacroService] ✓ Macro "${macro.name}" completed successfully`);

    // Trigger Pass 1 debounce after macro completes
    try {
      const pass1Module = await import('./pass1Service.js');
      pass1Module.default.startDebounce();
    } catch (err) {
      console.warn('[MacroService] Could not start Pass 1 debounce:', err);
    }

    return true;
  } catch (err) {
    console.error(`[MacroService] Error executing macro "${macro.name}":`, err);
    return false;
  } finally {
    // Always unlock user input
    useReportStore.setState({ typingLocked: false });
  }
}

/**
 * Execute a 'text' action: insert text at the current caret position.
 *
 * Uses the store's insertTextAtPosition which handles:
 *   - Segment splitting at insertion point
 *   - Downstream segment offset shifting
 *   - New 'raw' segment creation for the inserted text
 *   - Splicing text into dictationText or contentBoxStates
 *
 * @param {object} action - The text action { type: 'text', text: string }
 */
async function executeTextAction(action) {
  const store = useReportStore.getState();
  const targetId = store.activeTextareaId || 'dictation-box';
  const caretPos = getCaretPosition(targetId);

  if (!action.text || action.text.length === 0) {
    console.warn('[MacroService] Text action has empty text — skipping');
    return;
  }

  // If the text contains newlines, split into text parts with structural
  // newline segments between them. This matches the Enter-key interception
  // pattern in ContentBox/DictationPanel handleInput, ensuring \n characters
  // are tracked as separate 1-char structural segments rather than being
  // embedded in raw text segments (which would corrupt segment tracking).
  if (action.text.includes('\n')) {
    const parts = action.text.split('\n');
    let currentOffset = caretPos;

    for (let i = 0; i < parts.length; i++) {
      const textPart = parts[i];

      // Insert non-newline text (if any)
      if (textPart.length > 0) {
        useReportStore.getState().insertTextAtPosition(targetId, currentOffset, textPart);
        currentOffset += textPart.length;
      }

      // Insert structural newline (except after the last part)
      if (i < parts.length - 1) {
        useReportStore.getState().insertStructuralNewline(targetId, currentOffset);
        currentOffset += 1; // \n occupies 1 character
      }
    }

    // Update caret position to after all inserted text
    updateCaretPosition(targetId, currentOffset);

    // Sync the DOM cursor position
    const el = targetId === 'dictation-box'
      ? document.getElementById('dictation-textarea')
      : document.getElementById(`textarea-${targetId}`);

    if (el) {
      el.selectionStart = currentOffset;
      el.selectionEnd = currentOffset;
    }

    useReportStore.getState().bumpCaretVersion();
    console.log(`[MacroService] Inserted "${action.text.slice(0, 50)}${action.text.length > 50 ? '...' : ''}" (with ${parts.length - 1} structural newlines) at position ${caretPos} in ${targetId}`);
    return;
  }

  // Simple case: no newlines — insert as a single text segment
  store.insertTextAtPosition(targetId, caretPos, action.text);

  // Update caret position to after the inserted text
  const newCaretPos = caretPos + action.text.length;
  updateCaretPosition(targetId, newCaretPos);

  // Sync the DOM cursor position
  const el = targetId === 'dictation-box'
    ? document.getElementById('dictation-textarea')
    : document.getElementById(`textarea-${targetId}`);

  if (el) {
    el.selectionStart = newCaretPos;
    el.selectionEnd = newCaretPos;
  }

  // Bump caret version so React components re-sync
  useReportStore.getState().bumpCaretVersion();

  console.log(`[MacroService] Inserted "${action.text.slice(0, 50)}${action.text.length > 50 ? '...' : ''}" at position ${caretPos} in ${targetId}`);
}

/**
 * Execute a 'command' action: invoke a voice command handler.
 *
 * @param {object} action - The command action { type: 'command', commandId: string, params?: object }
 */
async function executeCommandAction(action) {
  const handler = COMMAND_HANDLERS[action.commandId];
  if (!handler) {
    console.warn(`[MacroService] Unknown command: ${action.commandId} — skipping`);
    return;
  }

  // Build a minimal execution context (matching voice command handler interface)
  const context = {
    commandId: action.commandId,
    commandType: 'self_contained',
    consumedText: '',
    consumedTokens: [],
    params: action.params || {},
  };

  // Special handling for go_to_section: translate params.sectionName to
  // clarifierWords (the format navigateToSection expects from the voice
  // command registry — it was designed for spoken words, not param objects)
  if (action.commandId === 'go_to_section' && action.params?.sectionName) {
    context.clarifierWords = action.params.sectionName
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  // Special handling for highlight_text: build payloadState from params.searchText
  // The voice handler expects payloadState with candidates (text match positions)
  if (action.commandId === 'highlight_text' && action.params?.searchText) {
    const store = useReportStore.getState();
    const targetId = store.activeTextareaId || 'dictation-box';
    let fullText;
    if (targetId === 'dictation-box') {
      fullText = store.dictationText;
    } else {
      fullText = store.contentBoxStates[targetId]?.currentText || '';
    }
    const caretPos = getCaretPosition(targetId);
    const searchText = action.params.searchText.toLowerCase();
    const fullTextLower = fullText.toLowerCase();

    // Find all occurrences of the search text
    const candidates = [];
    let searchIdx = 0;
    while (searchIdx < fullTextLower.length) {
      const found = fullTextLower.indexOf(searchText, searchIdx);
      if (found === -1) break;
      candidates.push({ start: found, end: found + searchText.length });
      searchIdx = found + 1;
    }

    context.payloadState = {
      targetId,
      fullText,
      caretPos,
      payloadWords: searchText.split(/\s+/),
      candidates,
      selectAll: searchText === 'all',
    };
  }

  // Special handling for replace_text: build payloadState from params
  // The voice handler expects payloadState with candidates + replacementWords
  if (action.commandId === 'replace_text' && action.params?.findText && action.params?.replaceWith) {
    const store = useReportStore.getState();
    const targetId = store.activeTextareaId || 'dictation-box';
    let fullText;
    if (targetId === 'dictation-box') {
      fullText = store.dictationText;
    } else {
      fullText = store.contentBoxStates[targetId]?.currentText || '';
    }
    const caretPos = getCaretPosition(targetId);
    const searchText = action.params.findText.toLowerCase();
    const fullTextLower = fullText.toLowerCase();

    // Find all occurrences of the search text
    const candidates = [];
    let searchIdx = 0;
    while (searchIdx < fullTextLower.length) {
      const found = fullTextLower.indexOf(searchText, searchIdx);
      if (found === -1) break;
      candidates.push({ start: found, end: found + searchText.length });
      searchIdx = found + 1;
    }

    context.payloadState = {
      targetId,
      fullText,
      caretPos,
      payloadWords: searchText.split(/\s+/),
      candidates,
      replacementWords: action.params.replaceWith.split(/\s+/),
    };
  }

  try {
    handler(context);
  } catch (err) {
    console.error(`[MacroService] Command "${action.commandId}" failed:`, err);
  }
}

/**
 * Execute an 'erik' action: dispatch the prompt text to ERIK in the cockpit.
 *
 * Unlike the voice command askErik handler, no LLM sanitization is needed here
 * because the text was typed by the user (not dictated via ASR), so there are
 * no ASR transcription errors to clean up.
 *
 * Uses the same REPORTING:ERIK_QUERY postMessage contract as the voice command.
 *
 * @param {object} action - The ERIK action { type: 'erik', text: string }
 */
function executeErikAction(action) {
  if (!action.text || action.text.trim().length === 0) {
    console.warn('[MacroService] ERIK action has empty text — skipping');
    return;
  }

  const question = action.text.trim();
  console.log(`[MacroService] Dispatching ERIK query: "${question.slice(0, 80)}${question.length > 80 ? '...' : ''}"`);

  window.parent.postMessage(
    { type: 'REPORTING:ERIK_QUERY', payload: { question } },
    '*'
  );
}

// ─── Export ──────────────────────────────────────────────────────────

export default {
  validateMacroName,
  loadMacros,
  getMacroList,
  findMatchingMacros,
  getMacroById,
  getMacroByName,
  refreshMacros,
  executeMacro,
};
