import useReportStore from '../../stores/useReportStore';

/**
 * ReGenerateButton — Phase 6
 *
 * Manual impression re-generation trigger.
 * - Bypasses the 1200ms debounce but still checks readiness
 * - Shows specific blocking reason when disabled
 * - Spinning animation during in_flight
 * - Pulsing glow when impression is stale
 */
export default function ReGenerateButton() {
  const impressionStatus = useReportStore((s) => s.impressionStatus);
  const pass1Status = useReportStore((s) => s.pass1Status);
  const pass2Status = useReportStore((s) => s.pass2Status);

  const isLoading = impressionStatus === 'in_flight';
  const isStale = impressionStatus === 'stale';

  // Determine blocking reason (if any)
  let blockReason = null;
  if (isLoading) {
    blockReason = 'Generating impression\u2026';
  } else if (pass1Status === 'in_flight' || pass1Status === 'debouncing') {
    blockReason = 'Waiting for Pass 1 to complete\u2026';
  } else if (pass2Status === 'in_flight' || pass2Status === 'debouncing') {
    blockReason = 'Waiting for Pass 2 to complete\u2026';
  }

  const isDisabled = !!blockReason;

  const handleClick = async () => {
    if (isDisabled) return;
    // Dynamic import to avoid circular deps
    const { fireImpressionManual } = await import('../../services/impressionService.js');
    fireImpressionManual();
  };

  // Build class list
  const classes = [
    'regenerate-btn',
    isLoading ? 'regenerate-btn--loading' : '',
    isStale ? 'regenerate-btn--stale' : '',
    isDisabled ? 'regenerate-btn--disabled' : '',
  ].filter(Boolean).join(' ');

  const title = blockReason || (isStale ? 'Impression may be outdated \u2014 click to regenerate' : 'Re-generate impression');

  return (
    <button
      className={classes}
      onClick={handleClick}
      disabled={isDisabled}
      title={title}
      aria-label={title}
      id="regenerate-impression-btn"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Brain/sparkle refresh icon */}
        <path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z" />
        <path d="M9 21h6" />
        {/* Sparkle icon overlays for "generate" meaning */}
        <path d="M20 4l-1 2-2 1 2 1 1 2 1-2 2-1-2-1z" strokeWidth="1.5" />
      </svg>
    </button>
  );
}
