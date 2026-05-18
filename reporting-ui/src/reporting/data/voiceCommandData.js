/**
 * Voice Command Data — Presentation metadata for the Voice Commands window.
 *
 * This file defines the command groups, names, descriptions, and aliases
 * displayed in the Voice Commands reference window. It is intentionally
 * separate from voiceCommandRegistry.js (which handles runtime matching)
 * to keep presentation concerns decoupled from execution logic.
 *
 * For "Go to [section name]", aliases are loaded dynamically from the
 * current template at window-open time via getSectionAliases().
 */

import useReportStore from '../stores/useReportStore';

/**
 * Build a human-readable alias list for "Go to [section name]" by
 * reading the currently loaded template's section/subsection labels.
 *
 * Called each time the Voice Commands window opens so it always
 * reflects the active template.
 *
 * @returns {string[]} e.g. ['go to findings', 'go to history', ...]
 */
export function getSectionAliases() {
  const { nodeMap, nodeTextStates, templateNodes, contentBoxStates } = useReportStore.getState();

  if (!templateNodes || templateNodes.length === 0) return [];

  const aliases = [];

  function hasContentDescendant(node) {
    if (!node.children?.length) return false;
    for (const child of node.children) {
      if (child.type === 'content') {
        const box = contentBoxStates[child.id];
        if (!box?.deleted) return true;
      }
      if (hasContentDescendant(child)) return true;
    }
    return false;
  }

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'content') {
        const ntState = nodeTextStates?.[node.id];
        const label = ntState?.text || node.label || node.text || '';
        if (label && hasContentDescendant(node)) {
          aliases.push(`go to ${label.toLowerCase()}`);
        }
      }
      if (node.children?.length) walk(node.children);
    }
  }

  walk(templateNodes);
  return aliases;
}

/**
 * Voice command groups for the reference window.
 *
 * Each group has:
 *   - category: Group heading label
 *   - commands: Array of command entries
 *
 * Each command has:
 *   - name: Display name (title of the expandable card)
 *   - description: Explanation of functionality
 *   - aliases: Array of trigger phrase strings (or a function returning them)
 *   - notImplemented: (optional) true if the command is planned but not yet built
 */
export const VOICE_COMMAND_GROUPS = [
  {
    category: 'Microphone',
    commands: [
      {
        name: 'Mic on',
        description:
          'Activates the microphone using ambient wake-word detection. The system listens passively in the background for activation phrases. Requires the user to enable their browser\'s microphone services (permissions) in order to function.',
        aliases: [
          'wake',
          'wake up',
          'mic on',
          'microphone on',
          'start dictation',
          'engage',
        ],
      },
      {
        name: 'Mic off',
        description: 'Deactivates the microphone and stops active dictation.',
        aliases: [
          'mic off',
          'microphone off',
          'turn mic off',
          'turn off mic',
          'turn off microphone',
          'turn microphone off',
          'stop dictation',
          'end dictation',
          'stop dictating',
          'mic sleep',
        ],
      },
    ],
  },
  {
    category: 'Navigation',
    commands: [
      {
        name: 'Next field',
        description: 'Moves the cursor to the next content field in the report.',
        aliases: [
          'next field',
          'go to next field',
          'go next',
          'advance field',
          'skip field',
          'next box',
          'next text box',
          'next textbox',
        ],
      },
      {
        name: 'Previous field',
        description: 'Moves the cursor to the previous content field in the report.',
        aliases: [
          'previous field',
          'go to previous field',
          'go to prior field',
          'go back',
          'last field',
          'back field',
          'prior field',
        ],
      },
      {
        name: 'Go to dictation',
        description: 'Returns the cursor focus to the dictation text box.',
        aliases: [
          'go to dictation',
          'dictation box',
          'go to dictation box',
          'go to dictation area',
          'go to dictation panel',
          'go to dictation window',
        ],
      },
      {
        name: 'Go to [section name]',
        description:
          'Navigates to a named section of the report template and places the cursor in its first content field. Section names are determined by the currently loaded template.',
        // Aliases are loaded dynamically — see getSectionAliases()
        aliases: null,
        dynamicAliases: true,
      },
      {
        name: 'Go to start',
        description: 'Moves the cursor to the beginning of the current text field.',
        aliases: [
          'go to start',
          'go start',
          'go to home',
          'move to start',
          'cursor start',
          'carriage return',
        ],
      },
      {
        name: 'Go to end',
        description: 'Moves the cursor to the end of the current text field.',
        aliases: [
          'go to end',
          'go end',
          'move to end',
          'cursor end',
        ],
      },
    ],
  },
  {
    category: 'Text',
    commands: [
      {
        name: 'New line',
        description: 'Inserts a line break at the current cursor position.',
        aliases: [
          'new line',
          'insert line',
          'add line',
          'line break',
        ],
      },
      {
        name: 'New paragraph',
        description: 'Inserts a paragraph break (double line break) at the current cursor position.',
        aliases: [
          'new paragraph',
          'insert paragraph',
          'add paragraph',
        ],
      },
      {
        name: 'Delete text',
        description: 'Deletes the currently selected/highlighted text, or all text in the active field if nothing is selected.',
        aliases: [
          'delete text',
          'delete all',
          'delete selection',
          'clear text',
          'clear all',
          'remove text',
          'erase text',
        ],
      },
      {
        name: 'Highlight [text]',
        description: 'Selects (highlights) the specified text within the active text field. The system searches for a matching string and visually selects it.',
        aliases: [
          'highlight [text]',
          'select [text]',
        ],
      },
      {
        name: 'Replace [text A] with [text B]',
        description: 'Finds and selects [text A] in the active text field, then replaces it with [text B]. Use "with" or "to" as the separator between the old and new text.',
        aliases: [
          'replace [text A] with [text B]',
          'change [text A] to [text B]',
          'exchange [text A] with [text B]',
        ],
      },
    ],
  },
  {
    category: 'Operations',
    commands: [
      {
        name: 'Macro [name]',
        description: 'Inserts pre-specified text and executes pre-specified commands',
        aliases: [
          'macro [name]',
          'dot [name]',
          'insert [name]',
        ],
      },
      {
        name: 'Undo',
        description: 'Reverts most recent action',
        aliases: [
          'undo',
          'revert',
          'scratch that',
          'roll back',
          'erase that',
          'take that back',
        ],
      },
      {
        name: 'Redo',
        description: 'Restores most recent action',
        aliases: [
          'redo',
          'restore that',
          'reapply that',
          'put that back',
          'bring that back',
          'never mind',
        ],
      },
    ],
  },
];
