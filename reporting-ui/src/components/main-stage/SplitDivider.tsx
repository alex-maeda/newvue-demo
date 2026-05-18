/**
 * SplitDivider — Draggable divider between compare panes.
 *
 * Enforces min 25% / max 75% for each pane.
 * Visual feedback: thin line that thickens and tints on hover/drag.
 */

import { useCallback, useRef } from 'react';
import './SplitDivider.css';

interface SplitDividerProps {
  /** Current split ratio (0.0–1.0, left pane fraction) */
  ratio: number;
  /** Callback when ratio changes */
  onRatioChange: (ratio: number) => void;
}

/** Min/max: each pane gets at least 25% and at most 75% of the stage */
const RATIO_MIN = 0.25;
const RATIO_MAX = 0.75;

export function SplitDivider({ ratio, onRatioChange }: SplitDividerProps) {
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;

      const parent = containerRef.current?.parentElement;
      if (!parent) return;

      const parentRect = parent.getBoundingClientRect();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      target.classList.add('dragging');

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const x = ev.clientX - parentRect.left;
        const raw = Math.max(RATIO_MIN, Math.min(RATIO_MAX, x / parentRect.width));
        onRatioChange(raw);
      };

      const onUp = () => {
        dragging.current = false;
        target.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [onRatioChange],
  );

  return (
    <div
      ref={containerRef}
      className="split-divider"
      onPointerDown={handlePointerDown}
      role="separator"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(RATIO_MIN * 100)}
      aria-valuemax={Math.round(RATIO_MAX * 100)}
      aria-label="Resize compare panels"
      tabIndex={0}
    >
      <div className="split-divider-line" />
      <div className="split-divider-grip">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
