import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { computeWordDiff } from '../../utils/wordDiff';

/**
 * AiEditBadge — Renders a [✎ AI] amber pill on AI-edited normal content boxes.
 *
 * Hover the pill to see a transient diff overlay above the textbox.
 * Click the pill to pin/unpin the overlay (text becomes selectable for copy-paste).
 *
 * @param {object} props
 * @param {string} props.originalText - Baseline text before AI edit
 * @param {string} props.currentText  - Current text after AI edit
 * @param {function} props.onOverlayVisibleChange - Callback with (boolean) when overlay visibility changes
 */
export default function AiEditBadge({ originalText, currentText, onOverlayVisibleChange }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const overlayRef = useRef(null);
  const badgeRef = useRef(null);

  const isVisible = isHovered || isPinned;

  // Notify parent of overlay visibility changes (for amber border)
  useEffect(() => {
    onOverlayVisibleChange?.(isVisible);
  }, [isVisible, onOverlayVisibleChange]);

  // Compute word diff (memoized — only recomputes when texts change)
  const diffTokens = useMemo(
    () => computeWordDiff(originalText, currentText),
    [originalText, currentText]
  );

  // Close on Escape key
  useEffect(() => {
    if (!isPinned) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsPinned(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPinned]);

  // Close on click outside when pinned
  useEffect(() => {
    if (!isPinned) return;

    const handleClickOutside = (e) => {
      if (
        overlayRef.current && !overlayRef.current.contains(e.target) &&
        badgeRef.current && !badgeRef.current.contains(e.target)
      ) {
        setIsPinned(false);
      }
    };

    // Use setTimeout so the current click event doesn't immediately trigger this
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPinned]);

  const handleBadgeClick = useCallback((e) => {
    e.stopPropagation();
    setIsPinned((prev) => !prev);
  }, []);

  const handleBadgeMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleBadgeMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleOverlayMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleOverlayMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleCloseClick = useCallback((e) => {
    e.stopPropagation();
    setIsPinned(false);
    setIsHovered(false);
  }, []);

  // Check if there are any actual changes to display
  const hasChanges = diffTokens.some((t) => t.type !== 'equal');
  if (!hasChanges) return null;

  return (
    <>
      {/* Badge pill */}
      <span
        ref={badgeRef}
        className={`ai-edit-badge${isPinned ? ' ai-edit-badge--pinned' : ''}`}
        title="AI edited this finding — hover or click to see changes"
        onClick={handleBadgeClick}
        onMouseEnter={handleBadgeMouseEnter}
        onMouseLeave={handleBadgeMouseLeave}
      >
        {/* Pencil icon */}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
        AI
      </span>

      {/* Diff overlay */}
      {isVisible && (
        <div
          ref={overlayRef}
          className={`ai-edit-overlay${isPinned ? ' ai-edit-overlay--pinned' : ''}`}
          onMouseEnter={handleOverlayMouseEnter}
          onMouseLeave={handleOverlayMouseLeave}
        >
          {/* Close button (pinned mode only) */}
          {isPinned && (
            <button
              className="ai-edit-overlay__close"
              onClick={handleCloseClick}
              title="Close"
              aria-label="Close diff overlay"
            >
              ×
            </button>
          )}

          {/* Diff content */}
          <div className="ai-edit-overlay__diff">
            {diffTokens.map((token, idx) => {
              if (token.type === 'equal') {
                return <span key={idx}>{token.text} </span>;
              }
              if (token.type === 'delete') {
                return (
                  <span key={idx} className="diff-delete">{token.text}</span>
                );
              }
              if (token.type === 'insert') {
                return (
                  <span key={idx} className="diff-insert">{token.text}</span>
                );
              }
              return null;
            })}
          </div>
        </div>
      )}
    </>
  );
}
