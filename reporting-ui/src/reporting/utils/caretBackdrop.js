/**
 * Caret Backdrop Utility
 *
 * Builds safe HTML for a "mirror div" that sits behind a textarea and
 * renders a visible virtual caret (<span>) at a given character offset.
 * The surrounding text is invisible — only the caret line shows through.
 */

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build HTML for a virtual caret backdrop.
 * Renders the full text as invisible HTML with a visible <span> at the caret offset.
 *
 * @param {string} text - Full textarea value
 * @param {number} caretOffset - Character index where the caret sits
 * @returns {string} Safe HTML string
 */
export function buildCaretBackdropHTML(text, caretOffset) {
  const raw = text || '';
  const pos = Math.max(0, Math.min(caretOffset, raw.length));
  const before = escapeHTML(raw.slice(0, pos));
  const after = escapeHTML(raw.slice(pos));
  // Trailing newline ensures the backdrop has the same scrollable height
  // as the textarea (textareas add an implicit trailing line).
  return before + '<span class="virtual-caret"></span>' + after + '\n';
}
