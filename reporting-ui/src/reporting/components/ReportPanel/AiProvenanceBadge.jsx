import { useState, useCallback } from 'react';

/**
 * AiProvenanceBadge — Renders a purple [? AI] pill on synthetic recommendation/guideline
 * content boxes. Hovering the badge highlights the source impression content box.
 *
 * @param {object} props
 * @param {string} props.sourceImpressionBoxId - ID of the source impression content box
 * @param {string} props.syntheticType - 'recommendations' or 'guidelines'
 */
export default function AiProvenanceBadge({ sourceImpressionBoxId, syntheticType }) {
  const [isHovered, setIsHovered] = useState(false);

  const label = syntheticType === 'guidelines' ? 'Guideline' : 'Recommendation';

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (sourceImpressionBoxId) {
      const sourceEl = document.getElementById(`textarea-${sourceImpressionBoxId}`);
      const wrapper = sourceEl?.closest('.content-box__wrapper');
      if (wrapper) {
        wrapper.classList.add('content-box__wrapper--source-highlight');
      }
    }
  }, [sourceImpressionBoxId]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (sourceImpressionBoxId) {
      const sourceEl = document.getElementById(`textarea-${sourceImpressionBoxId}`);
      const wrapper = sourceEl?.closest('.content-box__wrapper');
      if (wrapper) {
        wrapper.classList.remove('content-box__wrapper--source-highlight');
      }
    }
  }, [sourceImpressionBoxId]);

  return (
    <span
      className={`ai-provenance-badge${isHovered ? ' ai-provenance-badge--hover' : ''}`}
      title={`AI-generated ${label.toLowerCase()} — hover to see source finding`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Circled question mark icon */}
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      AI
    </span>
  );
}
