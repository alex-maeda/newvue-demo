import { useEffect, useState, useCallback, useRef } from 'react';
import useReportStore from './stores/useReportStore';
import useUserStore from './stores/useUserStore';
import { loadTemplate } from './utils/templateLoader';
import { getTemplateIdForStudy as resolveTemplateId } from './utils/templateRegistry';
import { setOnQueueDrained, setOnNewEntry, setOnContentDeletion } from './services/actionQueueService';
import pass1Service, { cancelDebounce, markReportContentDirty } from './services/pass1Service';
import pass2Service, { cancelPass2Debounce, startPass2Debounce } from './services/pass2Service';
import { cancelImpressionDebounce, startImpressionDebounce } from './services/impressionService';
import { registerAllCommands, registerSectionCommands, registerMacroCommands } from './services/voiceCommandRegistry';
import { loadMacros } from './services/macroService';
import { navigateToNextField, navigateToPreviousField } from './services/voiceCommandHandlers';
import {
  registerBeforeUnload, unregisterBeforeUnload,
  startAutoSaveTimer, clearAutoSaveTimer,
  listSessions, loadSavedSession,
} from './services/sessionService';
import DictationPanel from './components/DictationPanel/DictationPanel';
import ReportPanel from './components/ReportPanel/ReportPanel';
import QALogPanel from './components/QALogPanel/QALogPanel';
import PopoutWindow from './components/PopoutWindow';

/**
 * App — Reporting Application Root
 *
 * When running inside an iFrame (hosted by the cockpit), this component:
 *   1. Listens for COCKPIT:STUDY_SELECTED postMessage events to load
 *      the appropriate template based on the selected exam.
 *   2. Posts REPORTING:READY to the parent window on mount so the
 *      cockpit knows the iFrame is ready to receive messages.
 *   3. Renders DictationPanel + ReportPanel as the main content.
 *   4. Renders QALogPanel as a slide-in overlay (toggled via edge chip).
 *
 * The header (logo + UserProfileMenu) is NOT rendered — the cockpit
 * provides the header with its own native UserProfileMenu.
 */
export default function App() {
  const storeLoadTemplate = useReportStore((s) => s.loadTemplate);
  const setAvailableStudies = useReportStore((s) => s.setAvailableStudies);
  const isDictationPoppedOut = useReportStore((s) => s.isDictationPoppedOut);
  const popoutWindowRef = useReportStore((s) => s.popoutWindowRef);
  const [error, setError] = useState(null);
  const [qaOverlayOpen, setQaOverlayOpen] = useState(false);
  const initDoneRef = useRef(false);

  // ── postMessage bridge: receive study selection from cockpit ─────
  useEffect(() => {
    function handleMessage(event) {
      // Security: only accept messages from our own origin
      if (event.origin !== window.location.origin) return;

      const { type, payload } = event.data || {};

      if (type === 'COCKPIT:STUDY_SELECTED') {
        const study = payload?.study;
        const studies = payload?.studies || [];
        if (!study) return;

        // Store available studies for the dropdown
        setAvailableStudies(studies, study.currentStudyId);

        console.log('[Reporting iFrame] Received study selection:', study.studyDescription);

        // Map the study description to a template ID via the registry
        const templateId = resolveTemplateId(study.studyDescription);
        loadTemplate(templateId)
          .then((data) => {
            storeLoadTemplate(data);
            registerSectionCommands();
            console.log(`[Reporting iFrame] Loaded template: ${templateId}`);
          })
          .catch((err) => {
            console.error('[Reporting iFrame] Failed to load template:', err);
            setError(err.message);
          });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [storeLoadTemplate]);

  // ── Notify parent that the iFrame is ready ──────────────────────
  useEffect(() => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: 'REPORTING:READY' },
        window.location.origin,
      );
      console.log('[Reporting iFrame] Posted REPORTING:READY to parent');
    }
  }, []);

  // Startup: check for saved session → restore, else load fresh template
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    async function initSession() {
      try {
        // Check for saved sessions
        const sessions = await listSessions();
        if (sessions.length > 0) {
          const latest = sessions[0]; // Already sorted by updatedAt desc
          console.log(`[App] Found saved session: ${latest.sessionId} (${latest.title})`);

          const result = await loadSavedSession(latest.sessionId);
          if (result.success) {
            console.log('[App] Session restored successfully');
            registerSectionCommands();
            return; // Done — session restored
          }
          console.warn('[App] Session restore failed, falling back to fresh template');
        }

        // No saved session (or restore failed) — load fresh template
        const data = await loadTemplate('MRI_brain_without_contrast');
        storeLoadTemplate(data);
        registerSectionCommands();
      } catch (err) {
        console.error('Failed to initialize session:', err);
        setError(err.message);
      }
    }

    initSession();
  }, [storeLoadTemplate]);

  // Phase 4 + 5: Wire Pass 1 debounce to queue drain callback
  // Cancel debounce whenever new dictation entries arrive
  // Voice Commands: Register all voice commands at startup
  useEffect(() => {
    setOnQueueDrained(() => pass1Service.startDebounce());
    setOnNewEntry(() => {
      cancelDebounce();
      cancelPass2Debounce();
      cancelImpressionDebounce();
    });
    setOnContentDeletion(() => markReportContentDirty());
    registerAllCommands();

    // Load macros and register macro voice commands
    loadMacros().then((macros) => {
      registerMacroCommands(macros);
    });
    return () => {
      setOnQueueDrained(null);
      setOnNewEntry(null);
      setOnContentDeletion(null);
    };
  }, []);

  // Load user profile at startup
  useEffect(() => {
    const { loadProfile, loadPreferences } = useUserStore.getState();
    loadProfile();
    loadPreferences();
  }, []);

  // Phase 2+4: Session persistence — beforeunload + auto-save
  useEffect(() => {
    registerBeforeUnload();

    // Subscribe to store and restart auto-save timer when unsaved changes appear
    let prevHasChanges = false;
    const unsub = useReportStore.subscribe((state) => {
      if (state.hasUnsavedChanges && !prevHasChanges) {
        startAutoSaveTimer();
      }
      prevHasChanges = state.hasUnsavedChanges;
    });

    return () => {
      unregisterBeforeUnload();
      clearAutoSaveTimer();
      unsub();
    };
  }, []);

  // Global hotkeys for field navigation and undo/redo
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        navigateToNextField({});
      } else if (e.key === 'F3') {
        e.preventDefault();
        navigateToPreviousField({});
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Z / Cmd+Z → Undo
        e.preventDefault();
        const store = useReportStore.getState();
        const result = store.performUndo();
        if (result) {
          if (result.type === 'pass1') {
            startPass2Debounce();
            startImpressionDebounce();
          } else if (result.type === 'deletion') {
            // Deletion undo restores segments as 'sanitized' (downgraded from
            // 'structured') so Pass 2 re-places findings into the report,
            // which then triggers impression regeneration.
            startPass2Debounce();
            startImpressionDebounce();
          }
        }
      } else if (
        (e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)
      ) {
        // Ctrl+Y / Cmd+Shift+Z → Redo
        e.preventDefault();
        const store = useReportStore.getState();
        const result = store.performRedo();
        if (result) {
          if (result.type === 'pass1') {
            startPass2Debounce();
            startImpressionDebounce();
          } else if (result.type === 'deletion') {
            startPass2Debounce();
            startImpressionDebounce();
          }
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Toggle QA overlay
  const toggleQaOverlay = useCallback(() => {
    setQaOverlayOpen((prev) => !prev);
  }, []);

  if (error) {
    return (
      <div className="app-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--danger)' }}>
          <h2>Failed to load template</h2>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Main Content — no header; cockpit provides the header */}
      <div className="app-main">
        {/* Left: Dictation + Report */}
        <div className="app-content">
          {!isDictationPoppedOut && <DictationPanel />}
          <ReportPanel />
        </div>

        {/* QA overlay edge chip */}
        <button
          className={`qa-overlay-chip ${qaOverlayOpen ? 'qa-overlay-chip--open' : ''}`}
          onClick={toggleQaOverlay}
          title={qaOverlayOpen ? 'Close Reporting QA' : 'Open Reporting QA'}
          aria-label={qaOverlayOpen ? 'Close Reporting QA' : 'Open Reporting QA'}
          id="reporting-qa-chip"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </button>

        {/* QA Log Panel — slide-in overlay */}
        <div className={`qa-panel--overlay ${qaOverlayOpen ? 'qa-panel--visible' : ''}`}>
          <QALogPanel />
        </div>
      </div>

      {isDictationPoppedOut && popoutWindowRef && (
        <PopoutWindow windowRef={popoutWindowRef}>
          <DictationPanel />
        </PopoutWindow>
      )}
    </div>
  );
}

// Template resolution is now handled by ./utils/templateRegistry.js
// via the `resolveTemplateId(studyDescription)` import above.
