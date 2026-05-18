import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ImpressionSettingsModal from './ImpressionSettingsModal';
import SettingsModal from '../SettingsModal';
import VoiceCommandsWindow from './VoiceCommandsWindow';
import AutocorrectWindow from './AutocorrectWindow';
import MacroEditorWindow, { MacroIcon } from './MacroEditorWindow';

/**
 * Copy all stylesheets and font links from the main document into a
 * pop-out window so that every CSS rule and web-font is available.
 */
function copyStyles(sourceDoc, targetDoc) {
  const styleNodes = sourceDoc.querySelectorAll('style, link[rel="stylesheet"]');
  styleNodes.forEach((node) => targetDoc.head.appendChild(node.cloneNode(true)));

  const fontNodes = sourceDoc.querySelectorAll('link[rel="preconnect"], link[rel="preload"]');
  fontNodes.forEach((node) => targetDoc.head.appendChild(node.cloneNode(true)));
}

// ─── Module-level Voice Commands window state ───────────────────────
// These live outside React so they survive HamburgerMenu unmount/remount
// cycles that occur when the dictation window pops out or docks back.
let _vcWindow = null;
let _vcContainer = null;
let _acWindow = null;
let _acContainer = null;
let _meWindow = null;
let _meContainer = null;

/**
 * HamburgerMenu — Phase 6 + Voice Commands
 *
 * Three-line menu button in the dictation toolbar that houses:
 *   1. Voice Commands — opens a pop-out reference window
 *   2. Impression Settings — opens the impression config modal
 */
export default function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [reportingSettingsOpen, setReportingSettingsOpen] = useState(false);
  const menuRef = useRef(null);

  // Render-trigger: incremented to force a re-render when the module-level
  // window/container references change. The actual data is in _vcWindow/_vcContainer.
  const [vcTick, setVcTick] = useState(0);
  const [acTick, setAcTick] = useState(0);
  const [meTick, setMeTick] = useState(0);

  // Close dropdown on outside click
  const handleOutsideClick = useCallback((e) => {
    if (menuRef.current && !menuRef.current.contains(e.target)) {
      setMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    if (menuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpen, handleOutsideClick]);

  const handleSettingsClick = () => {
    setMenuOpen(false);
    setModalOpen(true);
  };

  const handleReportingSettingsClick = () => {
    setMenuOpen(false);
    setReportingSettingsOpen(true);
  };

  // --- Voice Commands pop-out ---

  const closeVcWindow = useCallback(() => {
    if (_vcWindow && !_vcWindow.closed) {
      _vcWindow.close();
    }
    _vcWindow = null;
    _vcContainer = null;
    setVcTick((n) => n + 1);
  }, []);

  const closeAcWindow = useCallback(() => {
    if (_acWindow && !_acWindow.closed) {
      _acWindow.close();
    }
    _acWindow = null;
    _acContainer = null;
    setAcTick((n) => n + 1);
  }, []);

  const closeMeWindow = useCallback(() => {
    if (_meWindow && !_meWindow.closed) {
      _meWindow.close();
    }
    _meWindow = null;
    _meContainer = null;
    setMeTick((n) => n + 1);
  }, []);

  // On mount, re-attach to an existing VC window that survived an
  // unmount/remount cycle (e.g. dictation pop-out/dock).
  useEffect(() => {
    if (_vcWindow && !_vcWindow.closed && _vcContainer) {
      setVcTick((n) => n + 1); // trigger render so portal re-attaches
    }
    if (_acWindow && !_acWindow.closed && _acContainer) {
      setAcTick((n) => n + 1);
    }
    if (_meWindow && !_meWindow.closed && _meContainer) {
      setMeTick((n) => n + 1);
    }
  }, []);

  // Monitor for native window closure (OS × button) for VC
  useEffect(() => {
    if (!_vcWindow) return;

    const checkInterval = setInterval(() => {
      if (!_vcWindow || _vcWindow.closed) {
        clearInterval(checkInterval);
        closeVcWindow();
      }
    }, 500);

    return () => {
      clearInterval(checkInterval);
    };
  }, [vcTick, closeVcWindow]);

  // Monitor for native window closure (OS × button) for AC
  useEffect(() => {
    if (!_acWindow) return;

    const checkInterval = setInterval(() => {
      if (!_acWindow || _acWindow.closed) {
        clearInterval(checkInterval);
        closeAcWindow();
      }
    }, 500);

    return () => {
      clearInterval(checkInterval);
    };
  }, [acTick, closeAcWindow]);

  // Monitor for native window closure (OS × button) for ME
  useEffect(() => {
    if (!_meWindow) return;

    const checkInterval = setInterval(() => {
      if (!_meWindow || _meWindow.closed) {
        clearInterval(checkInterval);
        closeMeWindow();
      }
    }, 500);

    return () => {
      clearInterval(checkInterval);
    };
  }, [meTick, closeMeWindow]);

  function handleVoiceCommandsClick() {
    setMenuOpen(false);

    // If already open, bring to front
    if (_vcWindow && !_vcWindow.closed) {
      _vcWindow.focus();
      return;
    }

    try {
      // Open about:blank — NOT the app URL — so the entire SPA doesn't
      // mount in the pop-out (which would start a second ambient listener,
      // a second profile fetch, etc., fighting the main window for the mic).
      const newWindow = window.open('about:blank', 'voice-commands', 'width=380,height=520,popup=true');
      if (!newWindow) {
        console.error('[VoiceCommands] Popup blocked by browser');
        return;
      }

      // Write our own minimal shell immediately
      newWindow.document.open();
      newWindow.document.write(
        '<!DOCTYPE html><html><head><title>Voice Commands</title></head><body></body></html>'
      );
      newWindow.document.close();

      // Inject parent styles
      copyStyles(document, newWindow.document);

      // Reset body
      newWindow.document.body.style.margin = '0';
      newWindow.document.body.style.padding = '0';
      newWindow.document.body.style.overflow = 'hidden';
      newWindow.document.body.style.background = 'var(--surface, #1D2025)';
      newWindow.document.title = 'Voice Commands';

      // Create portal container
      const containerEl = document.createElement('div');
      containerEl.className = 'reporting-scope vc-popout-container';
      containerEl.style.height = '100vh';
      containerEl.style.width = '100vw';
      containerEl.style.overflow = 'hidden';
      newWindow.document.body.appendChild(containerEl);

      _vcWindow = newWindow;
      _vcContainer = containerEl;
      setVcTick((n) => n + 1);
    } catch (err) {
      console.error('[VoiceCommands] Error opening window:', err);
    }
  }

  function handleAutocorrectClick() {
    setMenuOpen(false);

    // If already open, bring to front
    if (_acWindow && !_acWindow.closed) {
      _acWindow.focus();
      return;
    }

    try {
      // Open about:blank — NOT the app URL — to prevent the full SPA from
      // loading in the pop-out window (which would start a competing
      // ambient listener and duplicate profile fetches).
      const newWindow = window.open('about:blank', 'autocorrect', 'width=860,height=560,popup=true');
      if (!newWindow) {
        console.error('[AutocorrectWindow] Popup blocked by browser');
        return;
      }

      // Write our own minimal shell immediately
      newWindow.document.open();
      newWindow.document.write(
        '<!DOCTYPE html><html><head><title>Autocorrect Text</title></head><body></body></html>'
      );
      newWindow.document.close();

      // Inject parent styles
      copyStyles(document, newWindow.document);

      // Reset body
      newWindow.document.body.style.margin = '0';
      newWindow.document.body.style.padding = '0';
      newWindow.document.body.style.overflow = 'hidden';
      newWindow.document.body.style.background = 'var(--surface, #1D2025)';
      newWindow.document.title = 'Autocorrect Text';

      // Create portal container
      const containerEl = document.createElement('div');
      containerEl.className = 'reporting-scope ac-popout-container';
      containerEl.style.height = '100vh';
      containerEl.style.width = '100vw';
      containerEl.style.overflow = 'auto';
      newWindow.document.body.appendChild(containerEl);

      _acWindow = newWindow;
      _acContainer = containerEl;
      setAcTick((n) => n + 1);
    } catch (err) {
      console.error('[AutocorrectWindow] Error opening window:', err);
    }
  }

  function handleMacroEditorClick() {
    setMenuOpen(false);

    // If already open, bring to front
    if (_meWindow && !_meWindow.closed) {
      _meWindow.focus();
      return;
    }

    try {
      const newWindow = window.open('about:blank', 'macro-editor', 'width=920,height=640,popup=true');
      if (!newWindow) {
        console.error('[MacroEditor] Popup blocked by browser');
        return;
      }

      newWindow.document.open();
      newWindow.document.write(
        '<!DOCTYPE html><html><head><title>Macro Editor</title></head><body></body></html>'
      );
      newWindow.document.close();

      copyStyles(document, newWindow.document);

      newWindow.document.body.style.margin = '0';
      newWindow.document.body.style.padding = '0';
      newWindow.document.body.style.overflow = 'hidden';
      newWindow.document.body.style.background = 'var(--surface, #1D2025)';
      newWindow.document.title = 'Macro Editor';

      const containerEl = document.createElement('div');
      containerEl.className = 'reporting-scope me-popout-container';
      containerEl.style.height = '100vh';
      containerEl.style.width = '100vw';
      containerEl.style.overflow = 'auto';
      newWindow.document.body.appendChild(containerEl);

      _meWindow = newWindow;
      _meContainer = containerEl;
      setMeTick((n) => n + 1);
    } catch (err) {
      console.error('[MacroEditor] Error opening window:', err);
    }
  }

  // Determine if we should render the portal
  const shouldRenderVcPortal = _vcWindow && !_vcWindow.closed && _vcContainer;
  const shouldRenderAcPortal = _acWindow && !_acWindow.closed && _acContainer;
  const shouldRenderMePortal = _meWindow && !_meWindow.closed && _meContainer;

  return (
    <div className="hamburger-menu" ref={menuRef}>
      <button
        className={`hamburger-menu__btn ${menuOpen ? 'hamburger-menu__btn--open' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
        title="Menu"
        aria-label="Open menu"
        aria-expanded={menuOpen}
        id="hamburger-menu-btn"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>

      {menuOpen && (
        <div className="hamburger-menu__dropdown" role="menu">
          {/* Voice Commands entry */}
          <button
            className="hamburger-menu__item"
            onClick={handleVoiceCommandsClick}
            role="menuitem"
            id="voice-commands-menu-item"
          >
            {/* Speech/megaphone icon — mouth with sound waves */}
            <svg className="hamburger-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9h4l5-4v14l-5-4H3V9z" />
              <path d="M15.5 8.5c.8.8 1.3 2 1.3 3.5s-.5 2.7-1.3 3.5" />
              <path d="M18.5 5.5c1.7 1.7 2.8 4 2.8 6.5s-1.1 4.8-2.8 6.5" />
            </svg>
            <span>Voice Commands</span>
          </button>

          {/* Autocorrect Text entry */}
          <button
            className="hamburger-menu__item"
            onClick={handleAutocorrectClick}
            role="menuitem"
            id="autocorrect-menu-item"
          >
            {/* Clipboard with checkmark icon */}
            <svg className="hamburger-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              <path d="M9 14l2 2 4-4"></path>
            </svg>
            <span>Autocorrect Text</span>
          </button>

          {/* Macro Editor entry */}
          <button
            className="hamburger-menu__item"
            onClick={handleMacroEditorClick}
            role="menuitem"
            id="macro-editor-menu-item"
          >
            <MacroIcon className="hamburger-menu__item-icon" />
            <span>Macro Editor</span>
          </button>

          {/* Impression Settings entry */}
          <button
            className="hamburger-menu__item"
            onClick={handleSettingsClick}
            role="menuitem"
            id="impression-settings-menu-item"
          >
            {/* Lightbulb icon */}
            <svg className="hamburger-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="10" y1="11" x2="14" y2="11" />
            </svg>
            <span>Impression Settings</span>
          </button>

          {/* Reporting Settings entry */}
          <button
            className="hamburger-menu__item"
            onClick={handleReportingSettingsClick}
            role="menuitem"
            id="reporting-settings-menu-item"
          >
            {/* Purple gear icon */}
            <svg className="hamburger-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--purple)' }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Reporting Settings</span>
          </button>
        </div>
      )}

      {modalOpen && (
        <ImpressionSettingsModal onClose={() => setModalOpen(false)} />
      )}

      {reportingSettingsOpen && (
        <SettingsModal onClose={() => setReportingSettingsOpen(false)} />
      )}

      {/* Portal voice commands content into the pop-out window */}
      {shouldRenderVcPortal && createPortal(
        <VoiceCommandsWindow onClose={closeVcWindow} />,
        _vcContainer
      )}

      {/* Portal autocorrect content into the pop-out window */}
      {shouldRenderAcPortal && createPortal(
        <AutocorrectWindow onClose={closeAcWindow} />,
        _acContainer
      )}

      {/* Portal macro editor content into the pop-out window */}
      {shouldRenderMePortal && createPortal(
        <MacroEditorWindow onClose={closeMeWindow} />,
        _meContainer
      )}
    </div>
  );
}
