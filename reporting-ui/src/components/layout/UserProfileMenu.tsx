/**
 * UserProfileMenu — Cockpit-native user profile dropdown.
 *
 * Fetches user identity directly from /api/user/profile and renders
 * a trigger button (name + avatar) in the cockpit header with a
 * dropdown menu. This replaces the ReportingUserProfile bridge
 * component that previously wrapped the Reporting subsystem's
 * UserProfileMenu inside a ReportingScope.
 *
 * Menu items:
 *   - User ID (display only)
 *   - Settings (disabled — reporting settings now live in the iFrame's hamburger menu)
 *   - Help (disabled placeholder)
 *   - Log Out (disabled placeholder)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import './UserProfileMenu.css';

interface UserProfile {
  userId: string;
  displayName: string;
  initials: string;
  role: string;
}

export function UserProfileMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch user profile on mount
  useEffect(() => {
    fetch('/api/user/profile')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setProfile({
          userId: data.userId,
          displayName: data.displayName || '',
          initials: data.initials || '',
          role: data.role || '',
        });
      })
      .catch((err) => {
        console.warn('[UserProfileMenu] Failed to load profile:', err.message);
      });
  }, []);

  // Close dropdown on outside click
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  // Don't render until profile loads
  if (!profile) return null;

  const showAvatar = !avatarError;

  return (
    <div className="user-profile-menu" ref={menuRef}>
      {/* Clickable trigger: name + avatar */}
      <button
        className={`user-profile-menu__trigger ${menuOpen ? 'user-profile-menu__trigger--open' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="User menu"
        aria-expanded={menuOpen}
        id="user-profile-trigger"
      >
        <span className="user-profile-menu__name">{profile.displayName}</span>
        {showAvatar ? (
          <img
            className="user-profile-menu__avatar"
            src="/api/user/avatar"
            alt={profile.displayName}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <div className="user-profile-menu__initials">{profile.initials}</div>
        )}
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="user-profile-menu__dropdown" role="menu">
          {/* User ID header */}
          <div className="user-profile-menu__user-id">User ID: {profile.userId}</div>
          <div className="user-profile-menu__divider" />

          {/* Settings — disabled (settings now in iFrame hamburger menu) */}
          <button
            className="user-profile-menu__item user-profile-menu__item--disabled"
            role="menuitem"
            id="cockpit-settings-menu-item"
            disabled
          >
            <svg className="user-profile-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>

          {/* Help — placeholder */}
          <button
            className="user-profile-menu__item user-profile-menu__item--disabled"
            role="menuitem"
            id="cockpit-help-menu-item"
            disabled
          >
            <svg className="user-profile-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Help</span>
          </button>

          <div className="user-profile-menu__divider" />

          {/* Log Out — placeholder */}
          <button
            className="user-profile-menu__item user-profile-menu__item--disabled"
            role="menuitem"
            id="cockpit-logout-menu-item"
            disabled
          >
            <svg className="user-profile-menu__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Log Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
