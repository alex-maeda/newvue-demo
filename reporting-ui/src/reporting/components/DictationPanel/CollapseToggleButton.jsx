import useReportStore from '../../stores/useReportStore';
import useUserStore from '../../stores/useUserStore';
import { getOrderedContentBoxIds } from '../../services/voiceCommandHandlers';
import { updateCaretPosition } from '../../services/caretTracker';

/**
 * Focus a content box textarea and place the caret at the end of its text.
 * Replicates the focusAndPlaceCaretAtEnd pattern from voiceCommandHandlers.
 *
 * @param {string} boxId - Content box ID to focus
 */
function focusAndPlaceCaretAtEnd(boxId) {
  const el = boxId === 'dictation-box'
    ? document.getElementById('dictation-textarea')
    : document.getElementById(`textarea-${boxId}`);
  if (!el) return;

  const textLen = el.value.length;
  el.selectionStart = textLen;
  el.selectionEnd = textLen;
  el.focus();
  el.selectionStart = textLen;
  el.selectionEnd = textLen;
  updateCaretPosition(boxId, textLen);

  setTimeout(() => {
    const len = el.value.length;
    el.selectionStart = len;
    el.selectionEnd = len;
    updateCaretPosition(boxId, len);
    useReportStore.getState().bumpCaretVersion();
  }, 0);
}

/**
 * CollapseToggleButton — Toggles visibility of the dictation box textarea.
 *
 * Expanded state (default): Chevron points DOWN, dictation box visible.
 * Collapsed state: Chevron rotates UP, dictation box hidden.
 *
 * On collapse:
 *   - If cursor is in the dictation box, relocate it to the first content box
 *     (same behavior as navigateToNextField when cursor is outside ordered list)
 *   - Handles in-flight ASR entry finalization via setActiveTextarea() boundary logic
 *
 * On expand:
 *   - Makes dictation box visible again
 *   - Does NOT reposition cursor
 */
export default function CollapseToggleButton() {
  const isCollapsed = useUserStore(
    (s) => s.preferences.dictationPanel?.collapsed ?? false
  );
  const setDictationCollapsed = useUserStore((s) => s.setDictationCollapsed);
  const activeTextareaId = useReportStore((s) => s.activeTextareaId);

  const handleClick = () => {
    if (!isCollapsed) {
      // ── COLLAPSING ──
      // If cursor is currently in the dictation box (or null — the initial
      // default before the user explicitly clicks anywhere), relocate it.
      // When activeTextareaId is null, the dictation box is still the effective
      // target because MicButton's ensurePendingEntry falls back to 'dictation-box'.
      if (activeTextareaId === 'dictation-box' || activeTextareaId === null) {
        const orderedIds = getOrderedContentBoxIds();
        if (orderedIds.length > 0) {
          const targetId = orderedIds[0]; // First content box
          const store = useReportStore.getState();
          // setActiveTextarea handles ASR finalization boundary logic
          store.setActiveTextarea(targetId);
          focusAndPlaceCaretAtEnd(targetId);
        }
      }
      setDictationCollapsed(true);
    } else {
      // ── EXPANDING ──
      // Just make the dictation box visible; don't move cursor
      setDictationCollapsed(false);
    }
  };

  const title = isCollapsed ? 'Expand dictation box' : 'Collapse dictation box';
  const className = `collapse-toggle-btn${isCollapsed ? ' collapse-toggle-btn--collapsed' : ''}`;

  return (
    <button
      className={className}
      onClick={handleClick}
      title={title}
      aria-label={title}
      aria-expanded={!isCollapsed}
      id="collapse-dictation-btn"
    >
      {/* Chevron Down icon — CSS rotates 180° when collapsed */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
