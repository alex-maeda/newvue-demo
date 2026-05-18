/**
 * Caret Tracker Service — Phase 3
 *
 * Tracks the last known caret position and selection range per textarea.
 * Components call updateCaretPosition() on onSelect/onClick/onKeyUp/onFocus.
 * The action queue reads from here when creating new entries.
 */

const caretPositions = new Map();
const selectionRanges = new Map();

/**
 * Update the tracked caret position for a textarea.
 * @param {string} textareaId - 'dictation-box' or a contentBoxId
 * @param {number} position - selectionStart value
 * @param {number|null} selectionEnd - selectionEnd value (null = collapsed caret)
 * @param {object} [options] - Additional options
 * @param {boolean} [options.preserveSelection] - If true, don't clear existing selection range
 */
export function updateCaretPosition(textareaId, position, selectionEnd = null, options = {}) {
  caretPositions.set(textareaId, position);

  if (selectionEnd !== null && selectionEnd !== position) {
    selectionRanges.set(textareaId, {
      start: Math.min(position, selectionEnd),
      end: Math.max(position, selectionEnd),
    });
  } else if (!options.preserveSelection) {
    selectionRanges.delete(textareaId);
  }
}

/**
 * Get the last known caret position for a textarea.
 * @param {string} textareaId
 * @returns {number} - caret position (defaults to 0)
 */
export function getCaretPosition(textareaId) {
  return caretPositions.get(textareaId) ?? 0;
}

/**
 * Get the current selection range for a textarea.
 * @param {string} textareaId
 * @returns {{ start: number, end: number } | null}
 */
export function getSelectionRange(textareaId) {
  return selectionRanges.get(textareaId) || null;
}

/**
 * Clear all tracked positions (called on session reset).
 */
export function clearAll() {
  caretPositions.clear();
  selectionRanges.clear();
}

export default { updateCaretPosition, getCaretPosition, getSelectionRange, clearAll };
