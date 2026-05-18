/**
 * Voice Command Registry — Phase 4
 *
 * Registers all voice commands with their aliases and handlers.
 * Called once at app startup (from App.jsx) to populate the
 * Voice Command Engine's command library.
 *
 * Phase 4 additions:
 *   - "Go to dictation" / "dictation box" — return to dictation panel
 *   - "Go to [section]" — navigate to a named section of the report
 *     (dynamically generated from the loaded template)
 *
 * Each command entry specifies:
 *   - id: Unique identifier for the command
 *   - type: 'self_contained' | 'close_ended' | 'open_ended'
 *   - triggerSequences: Array of word-sequence aliases (case-insensitive)
 *   - handler: Function to execute when the command is recognized
 *   - description: Human-readable description (shown in UI)
 */

import { registerCommand } from './voiceCommandEngine';
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
  highlightInitPayload,
  highlightOnPayloadToken,
  highlightOnPayloadTimeout,
  replaceText,
  replaceInitPayload,
  replaceOnPayloadToken,
  replaceOnPayloadTimeout,
  undoAction,
  redoAction,
  micOff,
  askErik,
} from './voiceCommandHandlers';
import useReportStore from '../stores/useReportStore';

/**
 * Register all static voice commands with the Voice Command Engine.
 * Safe to call multiple times — re-registration replaces existing entries.
 */
export function registerAllCommands() {
  // ── Navigation: Next Field ────────────────────────────────────────
  registerCommand({
    id: 'next_field',
    type: 'self_contained',
    triggerSequences: [
      ['next', 'field'],
      ['go', 'to', 'next', 'field'],
      ['go', 'next'],
      ['advance', 'field'],
      ['skip', 'field'],
      ['next', 'box'],
      ['next', 'text', 'box'],
      ['next', 'textbox'],
    ],
    handler: navigateToNextField,
    description: 'Navigate to the next content field',
  });

  // ── Navigation: Previous Field ────────────────────────────────────
  registerCommand({
    id: 'previous_field',
    type: 'self_contained',
    triggerSequences: [
      ['previous', 'field'],
      ['go', 'to', 'previous', 'field'],
      ['go', 'to', 'prior', 'field'],
      ['go', 'back'],
      ['last', 'field'],
      ['back', 'field'],
      ['prior', 'field'],
    ],
    handler: navigateToPreviousField,
    description: 'Navigate to the previous content field',
  });

  // ── Navigation: Go to Dictation ───────────────────────────────────
  registerCommand({
    id: 'go_to_dictation',
    type: 'self_contained',
    triggerSequences: [
      ['go', 'to', 'dictation'],
      ['dictation', 'box'],
      ['go', 'to', 'dictation', 'box'],
      ['go', 'to', 'dictation', 'area'],
      ['go', 'to', 'dictation', 'panel'],
      ['go', 'to', 'dictation', 'window'],
    ],
    handler: navigateToDictation,
    description: 'Navigate to the dictation box',
  });

  // ── Line Break: New Line ──────────────────────────────────────────
  registerCommand({
    id: 'new_line',
    type: 'self_contained',
    triggerSequences: [
      ['new', 'line'],
      ['insert', 'line'],
      ['insert', 'new', 'line'],
      ['add', 'line'],
      ['add', 'new', 'line'],
      ['line', 'break'],
    ],
    handler: insertNewLine,
    description: 'Insert a new line',
  });

  // ── Line Break: New Paragraph ─────────────────────────────────────
  registerCommand({
    id: 'new_paragraph',
    type: 'self_contained',
    triggerSequences: [
      ['new', 'paragraph'],
      ['insert', 'paragraph'],
      ['insert', 'new', 'paragraph'],
      ['add', 'paragraph'],
      ['add', 'new', 'paragraph'],
    ],
    handler: insertNewParagraph,
    description: 'Insert a new paragraph',
  });

  // ── Cursor: Go to Start ─────────────────────────────────────────
  registerCommand({
    id: 'go_to_start',
    type: 'self_contained',
    triggerSequences: [
      ['go', 'to', 'start'],
      ['go', 'start'],
      ['go', 'to', 'home'],
      ['go', 'to', 'start', 'of', 'text'],
      ['go', 'to', 'text', 'start'],
      ['go', 'text', 'start'],
      ['move', 'to', 'start'],
      ['move', 'to', 'start', 'of', 'text'],
      ['move', 'start'],
      ['move', 'start', 'of', 'text'],
      ['cursor', 'start'],
      ['cursor', 'to', 'start'],
      ['cursor', 'to', 'start', 'of', 'text'],
      ['carriage', 'return'],
    ],
    handler: goToStart,
    description: 'Move cursor to start of text',
  });

  // ── Cursor: Go to End ───────────────────────────────────────────
  registerCommand({
    id: 'go_to_end',
    type: 'self_contained',
    triggerSequences: [
      ['go', 'to', 'end'],
      ['go', 'end'],
      ['go', 'to', 'end', 'of', 'text'],
      ['go', 'to', 'text', 'end'],
      ['go', 'text', 'end'],
      ['move', 'to', 'end'],
      ['move', 'to', 'end', 'of', 'text'],
      ['move', 'end'],
      ['move', 'end', 'of', 'text'],
      ['cursor', 'end'],
      ['cursor', 'to', 'end'],
      ['cursor', 'to', 'end', 'of', 'text'],
    ],
    handler: goToEnd,
    description: 'Move cursor to end of text',
  });

  // ── Deletion: Delete Text ────────────────────────────────────────
  registerCommand({
    id: 'delete_text',
    type: 'self_contained',
    triggerSequences: [
      ['delete', 'text'],
      ['delete', 'content'],
      ['delete', 'all'],
      ['delete', 'selection'],
      ['delete', 'selected'],
      ['delete', 'highlight'],
      ['delete', 'highlighted'],
      ['clear', 'text'],
      ['clear', 'content'],
      ['clear', 'all'],
      ['clear', 'selection'],
      ['clear', 'selected'],
      ['clear', 'highlight'],
      ['clear', 'highlighted'],
      ['remove', 'text'],
      ['remove', 'content'],
      ['remove', 'all'],
      ['remove', 'selection'],
      ['remove', 'selected'],
      ['remove', 'highlight'],
      ['remove', 'highlighted'],
      ['erase', 'text'],
      ['erase', 'content'],
      ['erase', 'all'],
      ['erase', 'selection'],
      ['erase', 'selected'],
      ['erase', 'highlight'],
      ['erase', 'highlighted'],
    ],
    handler: deleteText,
    description: 'Delete text (selection or all)',
  });

  // ── Selection: Highlight Text ────────────────────────────────────
  registerCommand({
    id: 'highlight_text',
    type: 'close_ended',
    triggerSequences: [
      ['highlight'],
      ['select'],
      ['highlighted'],
      ['selected'],
      ['highlights'],
      ['selects'],
    ],
    handler: highlightText,
    initPayloadState: highlightInitPayload,
    onPayloadToken: highlightOnPayloadToken,
    onPayloadTimeout: highlightOnPayloadTimeout,
    description: 'Highlight text in the active textarea',
  });

  // ── Text Replacement ────────────────────────────────────────────────
  registerCommand({
    id: 'replace_text',
    type: 'close_ended',
    triggerSequences: [
      ['replace'],
      ['exchange'],
      ['change'],
      ['convert'],
    ],
    handler: replaceText,
    initPayloadState: replaceInitPayload,
    onPayloadToken: replaceOnPayloadToken,
    onPayloadTimeout: replaceOnPayloadTimeout,
    description: 'Replace text in the active textarea',
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  registerCommand({
    id: 'undo',
    type: 'self_contained',
    triggerSequences: [
      ['undo'],
      ['undue'],
      ['undo', 'that'],
      ['undue', 'that'],
      ['undo', 'last'],
      ['undue', 'last'],
      ['undo', 'change'],
      ['undue', 'change'],
      ['undo', 'last', 'change'],
      ['undue', 'last', 'change'],
      ['take', 'back'],
      ['take', 'that', 'back'],
      ['take', 'it', 'back'],
      ['revert'],
      ['revert', 'that'],
      ['revert', 'last'],
      ['revert', 'change'],
      ['revert', 'last', 'change'],
      ['scratch', 'that'],
      ['erase', 'that'],
      ['scratch', 'last'],
      ['erase', 'last'],
      ['scratch', 'change'],
      ['erase', 'change'],
      ['scratch', 'last', 'change'],
      ['erase', 'last', 'change'],
      ['roll', 'back'],
      ['roll', 'that', 'back'],
      ['roll', 'last', 'back'],
      ['roll', 'change', 'back'],
      ['roll', 'last', 'change', 'back'],
    ],
    handler: undoAction,
    description: 'Undo the last action',
  });

  // ── Redo ───────────────────────────────────────────────────────────────────
  registerCommand({
    id: 'redo',
    type: 'self_contained',
    triggerSequences: [
      ['redo'],
      ['redo', 'that'],
      ['redo', 'last'],
      ['redo', 'text'],
      ['redo', 'change'],
      ['redo', 'last', 'change'],
      ['put', 'back'],
      ['put', 'that', 'back'],
      ['put', 'it', 'back'],
      ['bring', 'back'],
      ['bring', 'that', 'back'],
      ['bring', 'it', 'back'],
      ['never', 'mind'],
      ['restore', 'that'],
      ['restore', 'last'],
      ['restore', 'change'],
      ['restore', 'last', 'change'],
      ['reapply', 'that'],
      ['reapply', 'last'],
      ['reapply', 'change'],
      ['reapply', 'last', 'change'],
    ],
    handler: redoAction,
    description: 'Redo the last undone action',
  });

  // ── Mic Off ─────────────────────────────────────────────────────────
  registerCommand({
    id: 'mic_off',
    type: 'self_contained',
    triggerSequences: [
      ['mic', 'off'],
      ['microphone', 'off'],
      ['mike', 'off'],
      ['mike', 'of'],
      ['my', 'cough'],
      ['Mike', 'Hoff'],
      ['bake', 'off'],
      ['mike', 'sleep'],
      ['mic', 'sleep'],
      ['make', 'sleep'],
      ['go', 'to', 'sleep'],
      ['make', 'off'],
      ['make', 'of'],
      ['off', 'mic'],
      ['off', 'mike'],
      ['turn', 'off'],
      ['turn', 'mic', 'off'],
      ['turn', 'mike', 'off'],
      ['turn', 'microphone', 'off'],
      ['shut', 'off'],
      ['switch', 'off'],
      ['stop', 'dictation'],
      ['stop', 'dictating'],
      ['dictation', 'stop'],
      ['end', 'dictation'],
      ['dictation', 'end'],
      ['stop', 'dictating'],
    ],
    handler: micOff,
    description: 'Turn off the microphone',
  });

  // ── ERIK: Ask ERIK ───────────────────────────────────────────────
  registerCommand({
    id: 'ask_erik',
    type: 'open_ended',
    triggerSequences: [
      ['erik'],
      ['eric'],
      ['air', 'ick'],
      ['a', 'rick'],
      ['ear', 'ick'],
      ['are', 'ick'],
      ['aric'],
      ['arik'],
      ['erick'],
    ],
    handler: askErik,
    description: 'Ask ERIK a question through dictation',
  });

  console.log('[VoiceCommandRegistry] Static commands registered');
}

/**
 * Register dynamic "go to [section]" commands from the currently loaded template.
 *
 * Reads section/subsection/headline labels from the store's nodeTextStates
 * and nodeMap, then registers a self_contained command for each section
 * with trigger sequences like ['go', 'to', 'findings'].
 *
 * Should be called AFTER the template has been loaded into the store.
 * Safe to call multiple times (re-registers with updated labels).
 */
export function registerSectionCommands() {
  const store = useReportStore.getState();
  const { nodeMap, nodeTextStates, templateNodes } = store;

  if (!templateNodes || templateNodes.length === 0) {
    console.warn('[VoiceCommandRegistry] No template loaded — skipping section commands');
    return;
  }

  let sectionCount = 0;

  // Walk the template tree and find all non-content nodes that have
  // at least one content-box descendant
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'content') {
        // Get the current display label (user-edited takes priority)
        const ntState = nodeTextStates?.[node.id];
        const label = ntState?.text || node.label || node.text || '';

        if (label && hasContentDescendant(node)) {
          const words = label.toLowerCase().split(/\s+/).filter(Boolean);
          if (words.length === 0) return;

          // Create a handler closure that passes the section name as clarifier
          const sectionHandler = (context) => {
            navigateToSection({ ...context, clarifierWords: words });
          };

          // Build trigger sequences:
          //   ['go', 'to', ...words]
          // All section navigation requires the explicit "go to" prefix.
          // Bare section names are NOT registered as shortcuts because
          // multi-word section names (e.g., "brain parenchyma", "left breast")
          // are common radiology phrases that would be intercepted during
          // normal dictation, causing unintended navigation.
          const triggerSequences = [
            ['go', 'to', ...words],
          ];

          registerCommand({
            id: `go_to_section_${node.id}`,
            type: 'self_contained',
            triggerSequences,
            handler: sectionHandler,
            description: `Navigate to ${label}`,
          });

          sectionCount++;
        }
      }
      if (node.children?.length) walk(node.children);
    }
  }

  /**
   * Check if a node has at least one non-deleted content-box descendant.
   */
  function hasContentDescendant(node) {
    if (!node.children?.length) return false;
    for (const child of node.children) {
      if (child.type === 'content') {
        const box = store.contentBoxStates[child.id];
        if (!box?.deleted) return true;
      }
      if (hasContentDescendant(child)) return true;
    }
    return false;
  }

  walk(templateNodes);
  console.log(`[VoiceCommandRegistry] ${sectionCount} section commands registered`);
}

/**
 * Register voice commands for all available macros.
 *
 * For each macro, registers a self_contained command with multiple trigger
 * sequences so users can invoke macros by saying:
 *   - "macro [name]"
 *   - "mack row [name]"  (common ASR mishearing of "macro")
 *   - "dot [name]"
 *   - "insert [name]"
 *
 * The engine's existing greedy-hold mechanism handles prefix ambiguity
 * between "insert [macro name]" and "insert line"/"insert paragraph".
 *
 * @param {Array} macros - Array of macro objects with { id, name, actions }
 */
export function registerMacroCommands(macros) {
  if (!macros || macros.length === 0) {
    console.log('[VoiceCommandRegistry] No macros to register');
    return;
  }

  let count = 0;

  for (const macro of macros) {
    if (!macro.name || !macro.id) continue;

    const nameWords = macro.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (nameWords.length === 0) continue;

    // Build trigger sequences
    const triggerSequences = [
      ['macro', ...nameWords],
      ['mack', 'row', ...nameWords],
      ['dot', ...nameWords],
      ['insert', ...nameWords],
    ];

    // Dynamic import to get executeMacro at call time (avoids circular dependency)
    const macroId = macro.id;
    const handler = async () => {
      try {
        const { executeMacro } = await import('./macroService');
        await executeMacro(macroId);
      } catch (err) {
        console.error(`[MacroVoiceCommand] Failed to execute macro "${macro.name}" (${macroId}):`, err);
      }
    };

    registerCommand({
      id: `macro_${macro.id}`,
      type: 'self_contained',
      triggerSequences,
      handler,
      description: `Run macro: ${macro.name}`,
    });

    count++;
  }

  console.log(`[VoiceCommandRegistry] ${count} macro commands registered`);
}

export default { registerAllCommands, registerSectionCommands, registerMacroCommands };
