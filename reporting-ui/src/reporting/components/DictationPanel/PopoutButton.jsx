import useReportStore from '../../stores/useReportStore';

/**
 * Copy all stylesheets and font links from the main document into the pop-out
 * window so that every CSS rule and web-font is available identically.
 */
function copyStyles(sourceDoc, targetDoc) {
  // Copy style and stylesheet link tags
  const styleNodes = sourceDoc.querySelectorAll('style, link[rel="stylesheet"]');
  styleNodes.forEach(node => {
    targetDoc.head.appendChild(node.cloneNode(true));
  });

  // Copy font preconnect / preload links
  const fontNodes = sourceDoc.querySelectorAll('link[rel="preconnect"], link[rel="preload"]');
  fontNodes.forEach(node => {
    targetDoc.head.appendChild(node.cloneNode(true));
  });
}

export default function PopoutButton() {
  const isPoppedOut = useReportStore((s) => s.isDictationPoppedOut);
  const openPopout = useReportStore((s) => s.openDictationPopout);
  const closePopout = useReportStore((s) => s.closeDictationPopout);

  const title = isPoppedOut ? "Dock window" : "Pop out dictation window";

  /**
   * The window MUST be opened inside this click handler (synchronous call stack)
   * because the Document PiP API requires "user activation" — a security gate
   * that expires after the click's call stack completes.
   */
  async function handleClick() {
    if (isPoppedOut) {
      closePopout();
      return;
    }

    try {
      let newWindow;

      // Document PiP is restricted to top-level browsing contexts and throws
      // NotAllowedError when called from within an iFrame. Only attempt PiP
      // when we are the top-level window.
      const isTopLevel = window.self === window.top;

      if (isTopLevel && 'documentPictureInPicture' in window) {
        // Document Picture-in-Picture (Chrome 116+, Edge 116+)
        // requestWindow() is async but the activation check happens at the call site,
        // so calling it here (in the click handler) satisfies the requirement.
        newWindow = await window.documentPictureInPicture.requestWindow({
          width: 420,
          height: 150,
        });
      } else {
        // Standard popup fallback (Firefox, Safari, older browsers)
        newWindow = window.open('', '', 'width=350,height=160,popup=true');
        if (!newWindow) {
          console.error('[Popout] Popup blocked by browser');
          return;
        }
        // Write a complete document to stabilize the window before DOM mutations
        newWindow.document.write(
          '<!DOCTYPE html><html><head><title>NewVue Reporting</title></head><body></body></html>'
        );
        newWindow.document.close();
      }

      // Inject parent document styles into the new window
      copyStyles(document, newWindow.document);

      // Reset body styles for clean rendering
      newWindow.document.body.style.margin = '0';
      newWindow.document.body.style.padding = '0';
      newWindow.document.body.style.overflow = 'hidden';
      newWindow.document.body.style.background = 'var(--surface, #1D2025)';
      newWindow.document.title = 'NewVue Reporting';

      // Store the window reference and flip the state — this triggers
      // App.jsx to mount <PopoutWindow> which portals into this window.
      openPopout(newWindow);
    } catch (err) {
      console.error('[Popout] Error opening popout window:', err);
    }
  }

  return (
    <button
      className="reset-btn popout-btn"
      onClick={handleClick}
      title={title}
      aria-label={title}
    >
      {isPoppedOut ? (
        // Dock Icon — Lucide "undo-2" (U-turn return arrow)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
        </svg>
      ) : (
        // Popout Icon (outward arrow)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
    </button>
  );
}
