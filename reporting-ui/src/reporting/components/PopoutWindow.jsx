import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useReportStore from '../stores/useReportStore';

/**
 * PopoutWindow — React Portal wrapper for an ALREADY-OPEN browser window.
 *
 * This component does NOT open any window. The window must be opened
 * synchronously inside a click handler (to satisfy user-activation gates)
 * and passed here via the `windowRef` prop.
 *
 * Responsibilities:
 *  1. Create a container <div> in the pop-out window's body
 *  2. Portal React children into that container
 *  3. Detect when the user closes the window natively (OS × button)
 */
export default function PopoutWindow({ children, windowRef }) {
  const [container, setContainer] = useState(null);
  const closeDictationPopout = useReportStore((s) => s.closeDictationPopout);

  useEffect(() => {
    if (!windowRef || windowRef.closed) {
      return;
    }

    // Create the portal mount-point inside the pop-out window
    const containerEl = document.createElement('div');
    containerEl.className = 'popout-container reporting-scope';
    containerEl.style.height = '100vh';
    containerEl.style.width = '100vw';
    containerEl.style.overflow = 'hidden';
    containerEl.style.display = 'flex';
    containerEl.style.flexDirection = 'column';

    // Inject the cockpit's :root CSS custom properties so design tokens resolve
    const rootStyles = getComputedStyle(document.documentElement);
    const tokenStyle = document.createElement('style');
    const tokens = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === ':root') {
            tokens.push(rule.cssText);
          }
        }
      } catch (_) { /* cross-origin sheets — skip */ }
    }
    if (tokens.length > 0) {
      tokenStyle.textContent = tokens.join('\n');
      windowRef.document.head.appendChild(tokenStyle);
    }

    windowRef.document.body.appendChild(containerEl);
    setContainer(containerEl);

    // --- Detect native window closure ---
    const isPiP = 'documentPictureInPicture' in window;
    let checkInterval = null;

    if (isPiP) {
      // PiP windows fire pagehide when closed
      windowRef.addEventListener('pagehide', closeDictationPopout);
    } else {
      // Standard popups: poll for closure (avoids beforeunload false positives)
      checkInterval = setInterval(() => {
        if (windowRef.closed) {
          clearInterval(checkInterval);
          closeDictationPopout();
        }
      }, 500);
    }

    return () => {
      // Remove the container from the pop-out window's DOM (critical for StrictMode double-mount)
      try { containerEl.remove(); } catch (_) {}
      if (isPiP) {
        try { windowRef.removeEventListener('pagehide', closeDictationPopout); } catch (_) {}
      }
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  }, [windowRef, closeDictationPopout]);

  if (!container) {
    return null;
  }

  return createPortal(children, container);
}
