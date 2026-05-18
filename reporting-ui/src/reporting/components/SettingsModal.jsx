import { useCallback, useEffect } from 'react';
import useUserStore from '../stores/useUserStore';

/**
 * SettingsModal — User Settings
 *
 * Modal dialog for configuring application-wide user preferences.
 * Opened from the UserProfileMenu "Settings" item.
 *
 * Visual style matches ImpressionSettingsModal: dark panel, purple
 * accents, backdrop blur, close-on-Escape/backdrop.
 *
 * Settings are saved immediately on toggle (Zustand → debounced PUT).
 */
export default function SettingsModal({ onClose }) {
  const voiceWakeEnabled = useUserStore((s) => s.preferences.voiceWakeEnabled);
  const setVoiceWakeEnabled = useUserStore((s) => s.setVoiceWakeEnabled);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="settings-modal__backdrop" onClick={handleBackdropClick}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        id="settings-modal"
      >
        {/* Header */}
        <div className="settings-modal__header">
          <div className="settings-modal__title">
            {/* Purple gear icon */}
            <svg
              className="settings-modal__gear-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </div>
          <button
            className="settings-modal__close"
            onClick={onClose}
            title="Close settings"
            aria-label="Close settings"
            id="settings-modal-close-btn"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="settings-modal__body">
          {/* Voice Wake Toggle */}
          <div className="settings-modal__row">
            <div className="settings-modal__row-info">
              <div className="settings-modal__row-label">Turn Mic On by Voice</div>
              <div className="settings-modal__row-description">
                Listen for wake words like &ldquo;mic on&rdquo; or &ldquo;wake up&rdquo; to automatically activate the microphone without clicking.
              </div>
            </div>
            <button
              className={`toggle-switch ${voiceWakeEnabled ? 'toggle-switch--on' : ''}`}
              role="switch"
              aria-checked={voiceWakeEnabled}
              aria-label="Turn Mic On by Voice"
              id="voice-wake-toggle"
              onClick={() => setVoiceWakeEnabled(!voiceWakeEnabled)}
            >
              <span className="toggle-switch__thumb" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
