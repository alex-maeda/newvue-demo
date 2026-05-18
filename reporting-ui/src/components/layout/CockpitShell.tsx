/**
 * CockpitShell — Root layout component using CSS Grid.
 *
 * Grid areas: header | context + main + action | timeline | footer
 *
 * The left rail is resizable via drag and fully collapsible.
 * When collapsed, an expand chevron appears on the left viewport edge.
 */

import { useCallback, useRef } from 'react';
import './CockpitShell.css';
// Removed: ExamHeader and CockpitFooter — redundant with worklist shell
// import { ExamHeader } from './ExamHeader';
// import { CockpitFooter } from './CockpitFooter';
import { ContextRail } from '../left-rail/ContextRail';
import { MainStage } from '../main-stage/MainStage';
import { ActionPanel } from '../right-rail/ActionPanel';
import { useCockpit } from '../../context/CockpitContext';

/** Minimum rail width — enough for modality chip + date */
const RAIL_MIN_W = 180;
/** Rail max is dynamic — 50% of the viewport width */
function computeMaxRailW() {
  return Math.floor(window.innerWidth * 0.5);
}

export function CockpitShell() {
  const { state, setRailWidth, toggleRailCollapsed } = useCockpit();
  const dragging = useRef(false);

  /* Action panel no longer participates in grid — it's a fixed overlay */

  /* ── Rail drag-to-resize ──────────────────────────────────── */
  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (state.railCollapsed) return;
      e.preventDefault();
      dragging.current = true;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      target.classList.add('dragging');

      // Disable smooth grid transition during drag for real-time feel
      const body = target.closest('.cockpit-body') as HTMLElement | null;
      if (body) body.style.transition = 'none';

      const maxW = computeMaxRailW();

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const newW = Math.max(RAIL_MIN_W, Math.min(maxW, ev.clientX));
        setRailWidth(newW);
      };

      const onUp = () => {
        dragging.current = false;
        target.classList.remove('dragging');
        if (body) body.style.transition = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [state.railCollapsed, setRailWidth],
  );

  const effectiveRailW = state.railCollapsed ? 0 : state.railWidth;

  return (
    <div className="cockpit">
      <div
        className={`cockpit-body ${state.railCollapsed ? 'rail-collapsed' : ''}`}
        style={{
          '--zone-rail-w': `${effectiveRailW}px`,
        } as React.CSSProperties}
      >
        {/* Expand chip — visible when rail is collapsed */}
        {state.railCollapsed && (
          <button
            className="rail-expand-chip"
            onClick={toggleRailCollapsed}
            title="Expand prior studies panel"
            aria-label="Expand prior studies panel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* Rail — hidden via CSS when collapsed */}
        {!state.railCollapsed && <ContextRail />}

        {/* Divider / drag handle — hidden when collapsed */}
        {!state.railCollapsed && (
          <div
            className="panel-divider rail"
            onPointerDown={handleDividerPointerDown}
            role="separator"
            aria-valuenow={state.railWidth}
            aria-valuemin={RAIL_MIN_W}
            aria-label="Resize prior studies panel"
          >
            {/* Collapse chevron — sits at top of divider */}
            <button
              className="rail-collapse-chevron"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleRailCollapsed();
              }}
              title="Collapse prior studies panel"
              aria-label="Collapse prior studies panel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        )}

        <MainStage />
      </div>

      {/* QA panel — positioned as a fixed overlay, not in grid flow */}
      <ActionPanel />

      <div className="bottom-timeline-boundary" />
    </div>
  );
}
