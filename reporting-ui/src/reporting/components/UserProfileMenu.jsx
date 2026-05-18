import { useState, useRef, useEffect, useCallback } from 'react';
import useUserStore from '../stores/useUserStore';
import SettingsModal from './SettingsModal';

/**
 * UserProfileMenu — Header Profile Component
 *
 * Displays the user's avatar and display name in the app header.
 * Clicking opens a dropdown menu with user ID, settings, help, and log out.
 *
 * Menu styling follows the same visual language as HamburgerMenu:
 * dark panel, purple hover highlights, icon + label rows.
 */
export default function UserProfileMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef(null);

  // User identity from store
  const displayName = useUserStore((s) => s.displayName);
  const initials = useUserStore((s) => s.initials);
  const avatarUrl = useUserStore((s) => s.avatarUrl);
  const userId = useUserStore((s) => s.userId);
  const profileLoaded = useUserStore((s) => s.profileLoaded);

  // Track avatar load errors to fall back to initials
  const [avatarError, setAvatarError] = useState(false);

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

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  // Don't render until profile is loaded
  if (!profileLoaded || !userId) return null;

  const showAvatar = avatarUrl && !avatarError;

  return (
    <div className="user-profile" ref={menuRef}>
      {/* Clickable trigger: name + avatar */}
      <button
        className={`user-profile__trigger ${menuOpen ? 'user-profile__trigger--open' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="User menu"
        aria-expanded={menuOpen}
        id="user-profile-trigger"
      >
        <span className="user-profile__name">{displayName}</span>
        {showAvatar ? (
          <img
            className="user-profile__avatar"
            src={avatarUrl}
            alt={displayName}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <div className="user-profile__initials">{initials}</div>
        )}
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="user-profile__dropdown" role="menu">
          {/* User ID header */}
          <div className="user-profile__user-id">User ID: {userId}</div>
          <div className="user-profile__divider" />

          {/* Settings */}
          <button
            className="user-profile__item"
            role="menuitem"
            id="user-settings-menu-item"
            onClick={() => {
              setMenuOpen(false);
              setSettingsOpen(true);
            }}
          >
            {/* Gear icon */}
            <svg className="user-profile__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>

          {/* Help — placeholder */}
          <button
            className="user-profile__item user-profile__item--disabled"
            role="menuitem"
            id="user-help-menu-item"
            disabled
          >
            {/* Question mark circle icon */}
            <svg className="user-profile__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Help</span>
          </button>

          <div className="user-profile__divider" />

          {/* Log Out — placeholder */}
          <button
            className="user-profile__item user-profile__item--disabled"
            role="menuitem"
            id="user-logout-menu-item"
            disabled
          >
            {/* Log out icon (door with arrow) */}
            <svg className="user-profile__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Log Out</span>
          </button>
        </div>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
