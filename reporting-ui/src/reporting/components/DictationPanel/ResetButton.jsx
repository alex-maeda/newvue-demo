import { useState } from 'react';
import useReportStore from '../../stores/useReportStore';
import asrService from '../../services/asrService';
import { deleteSession, clearAutoSaveTimer } from '../../services/sessionService';

export default function ResetButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const resetSession = useReportStore((s) => s.resetSession);
  const sessionId = useReportStore((s) => s.sessionId);
  const asrStatus = useReportStore((s) => s.asrStatus);

  const handleReset = async () => {
    // Stop ASR if recording
    if (asrStatus !== 'idle') {
      asrService.stop();
    }

    // Delete saved session from server (fire-and-forget)
    if (sessionId) {
      clearAutoSaveTimer();
      deleteSession(sessionId).catch(() => {});
    }

    resetSession();
    setShowConfirm(false);
  };

  return (
    <>
      <button
        className="reset-btn"
        onClick={() => setShowConfirm(true)}
        title="Reset session"
        aria-label="Reset session"
        id="reset-session-btn"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>

      {showConfirm && (
        <div className="confirm-overlay" onClick={() => setShowConfirm(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog__title">Reset Session</div>
            <div className="confirm-dialog__message">
              This will stop dictation, clear all text, and reset the report template to its defaults. Any saved progress will also be cleared. This action cannot be undone.
            </div>
            <div className="confirm-dialog__buttons">
              <button
                className="confirm-dialog__btn"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="confirm-dialog__btn confirm-dialog__btn--danger"
                onClick={handleReset}
                id="reset-confirm-btn"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
