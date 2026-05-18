import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import autocorrectService from '../../services/autocorrectService';

/**
 * AutocorrectWindow — Standalone UI for managing user autocorrection terms.
 * Rendered in a pop-out browser window via portal from HamburgerMenu.
 *
 * Features:
 *   - Add new entries with duplicate detection (toast notification)
 *   - Inline editing of all fields with 500ms debounce save
 *   - Delete with confirmation dialogue
 *   - Sortable columns with per-column direction tracking
 *   - Search with weighted scoring (nickname > input > output)
 *   - Save-on-close via beforeunload
 */
export default function AutocorrectWindow({ onClose }) {
  // ── Core State ──
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSort, setActiveSort] = useState('nickname');
  const [sortDirections, setSortDirections] = useState({
    nickname: 'asc',
    replaceText: 'asc',
    withText: 'asc',
  });
  const [isAdding, setIsAdding] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const selectedEntryRef = useRef(null); // ref tracks focused entry for delete (always current)
  const [confirmingDelete, setConfirmingDelete] = useState(false); // inline delete confirmation
  const [helpPinned, setHelpPinned] = useState(false); // help overlay pinned open
  const helpRef = useRef(null); // ref for click-outside detection

  // ── Toast State ──
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);

  // ── Form State ──
  const [formReplace, setFormReplace] = useState('');
  const [formWith, setFormWith] = useState('');
  const [formNickname, setFormNickname] = useState('');

  // ── Debounce State ──
  const debounceTimerRef = useRef(null);
  const pendingSaveRef = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // ── Toast Helper ──
  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  // ── Persist Helper (full replacement save) ──
  const saveEntriesToServer = useCallback(async (entriesToSave) => {
    try {
      const res = await fetch('/api/user/autocorrect', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToSave }),
      });
      if (!res.ok) {
        console.error('[AutocorrectWindow] Failed to save entries:', res.status);
      } else {
        pendingSaveRef.current = false;
        // Synchronously update in-memory rules (no async fetch)
        autocorrectService.updateUserRules(entriesToSave);
      }
    } catch (err) {
      console.error('[AutocorrectWindow] Error saving entries:', err);
    }
  }, []);

  // ── Debounced Save ──
  const scheduleSave = useCallback((updatedEntries) => {
    pendingSaveRef.current = true;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      saveEntriesToServer(updatedEntries);
    }, 500);
  }, [saveEntriesToServer]);

  // ── Flush pending saves immediately ──
  const flushSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingSaveRef.current) {
      saveEntriesToServer(entriesRef.current);
    }
  }, [saveEntriesToServer]);

  // ── Load entries on mount ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/user/autocorrect');
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries || []);
        }
      } catch (err) {
        console.error('[AutocorrectWindow] Failed to load entries:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── Save on window close ──
  useEffect(() => {
    const ownerWindow = document.defaultView || window;
    const handleBeforeUnload = () => {
      if (pendingSaveRef.current) {
        // Use sendBeacon for reliable fire-and-forget save
        const payload = JSON.stringify({ entries: entriesRef.current });
        navigator.sendBeacon('/api/user/autocorrect', new Blob([payload], { type: 'application/json' }));
      }
    };
    ownerWindow.addEventListener('beforeunload', handleBeforeUnload);
    return () => ownerWindow.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── Sync user rules on unmount (window close) ──
  // Synchronously pushes the latest entries into the autocorrect engine.
  // No async fetches — avoids racing with ambient listener mic lifecycle.
  useEffect(() => {
    return () => {
      // Flush any pending debounced saves
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (pendingSaveRef.current) {
        const payload = JSON.stringify({ entries: entriesRef.current });
        navigator.sendBeacon('/api/user/autocorrect', new Blob([payload], { type: 'application/json' }));
        pendingSaveRef.current = false;
      }
      // Synchronously update in-memory engine rules
      autocorrectService.updateUserRules(entriesRef.current);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close help overlay on click outside
  useEffect(() => {
    if (!helpPinned) return;
    const handleClickOutside = (e) => {
      if (helpRef.current && !helpRef.current.contains(e.target)) {
        setHelpPinned(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [helpPinned]);

  // ── Sorting Logic ──
  // Per-column direction tracking with inversion on re-click.
  // Uses separate setState calls (React batches them in event handlers).
  const handleSort = useCallback((columnKey) => {
    setSortDirections((prev) => ({
      ...prev,
      [columnKey]: prev[columnKey] === 'asc' ? 'desc' : 'asc',
    }));
    setActiveSort(columnKey);
  }, []);

  // ── Focus-based selection (for Delete) ──
  // Track which entry has focus so Delete works even though
  // clicks are captured by the inline input fields.
  const handleInlineFocus = useCallback((id) => {
    selectedEntryRef.current = id;
    setSelectedEntryId(id);
  }, []);

  // ── Search highlight helper ──
  // Wraps matched substrings in <mark> tags for visual feedback.
  const highlightMatch = useCallback((text, term) => {
    if (!term || !text) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="ac-search-mark">{text.slice(idx, idx + term.length)}</mark>
        {text.slice(idx + term.length)}
      </>
    );
  }, []);

  // ── Derived filtered, scored, & sorted entries ──
  const displayedEntries = useMemo(() => {
    let filtered = entries;

    // Search filtering with scoring
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = entries
        .map((e) => {
          let score = 0;
          if ((e.nickname || '').toLowerCase().includes(lower)) score += 3;
          if ((e.input || '').toLowerCase().includes(lower)) score += 2;
          if ((e.output || '').toLowerCase().includes(lower)) score += 1;
          return { ...e, _searchScore: score };
        })
        .filter((e) => e._searchScore > 0)
        .sort((a, b) => b._searchScore - a._searchScore);
    }

    // Sorting
    const dir = sortDirections[activeSort] || 'asc';
    // Map column keys to entry fields
    const fieldMap = { nickname: 'nickname', replaceText: 'input', withText: 'output' };
    const field = fieldMap[activeSort] || 'nickname';

    if (!searchTerm) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = (a[field] || '').toLowerCase();
        const bVal = (b[field] || '').toLowerCase();

        // Nickname column: blank nicknames always sort to bottom
        if (field === 'nickname') {
          const aBlank = !aVal;
          const bBlank = !bVal;
          if (aBlank && !bBlank) return 1;
          if (!aBlank && bBlank) return -1;
        }

        if (aVal < bVal) return dir === 'asc' ? -1 : 1;
        if (aVal > bVal) return dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [entries, searchTerm, activeSort, sortDirections]);

  // ── Add New Entry ──
  const handleSaveNew = useCallback(async () => {
    if (!formReplace.trim() || !formWith.trim()) return;

    try {
      const res = await fetch('/api/user/autocorrect/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: formReplace.trim(),
          output: formWith.trim(),
          nickname: formNickname.trim(),
        }),
      });

      if (!res.ok) {
        showToast('Failed to save entry. Please try again.');
        return;
      }

      const data = await res.json();

      if (data.status === 'duplicate') {
        showToast('This autocorrect entry already exists.');
        setFormReplace('');
        setFormWith('');
        setFormNickname('');
        setIsAdding(false);
        return;
      }

      if (data.status === 'created' && data.entry) {
        setEntries((prev) => {
          const updated = [...prev, data.entry];
          // Synchronously update in-memory rules with new list
          autocorrectService.updateUserRules(updated);
          return updated;
        });
        setFormReplace('');
        setFormWith('');
        setFormNickname('');
        setIsAdding(false);
      }
    } catch (err) {
      console.error('[AutocorrectWindow] Error adding entry:', err);
      showToast('Network error. Please try again.');
    }
  }, [formReplace, formWith, formNickname, showToast]);

  const handleCancelNew = useCallback(() => {
    setFormReplace('');
    setFormWith('');
    setFormNickname('');
    setIsAdding(false);
  }, []);

  // ── Delete Entry (two-click: first click shows confirm, second deletes) ──
  const handleDeleteClick = useCallback((e) => {
    e.preventDefault(); // prevent blur from stealing focus
    const idToDelete = selectedEntryRef.current;
    if (!idToDelete) {
      showToast('Click on an entry first to select it.');
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    // Second click: actually delete
    setConfirmingDelete(false);
    setEntries((prev) => {
      const updated = prev.filter((entry) => entry.id !== idToDelete);
      saveEntriesToServer(updated);
      return updated;
    });
    selectedEntryRef.current = null;
    setSelectedEntryId(null);
  }, [confirmingDelete, saveEntriesToServer, showToast]);

  // ── Inline Edit ──
  const handleInlineEdit = useCallback((id, field, value) => {
    setEntries((prev) => {
      const updated = prev.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      );
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  // ── Inline blur: flush immediately ──
  const handleInlineBlur = useCallback(() => {
    flushSave();
  }, [flushSave]);

  const isSaveDisabled = !formReplace.trim() || !formWith.trim();

  const getSortIndicator = (columnKey) => {
    if (activeSort !== columnKey) return null;
    return sortDirections[columnKey] === 'asc' ? '↑' : '↓';
  };

  if (isLoading) {
    return (
      <div className="ac-window" id="autocorrect-window">
        <div className="ac-window__header">
          <div className="ac-window__title">
            <svg className="ac-window__title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              <path d="M9 14l2 2 4-4"></path>
            </svg>
            Autocorrect Text
          </div>
        </div>
        <div className="ac-window__body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--muted)' }}>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ac-window" id="autocorrect-window">
      {/* Header */}
      <div className="ac-window__header">
        <div className="ac-window__title">
          <svg className="ac-window__title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            <path d="M9 14l2 2 4-4"></path>
          </svg>
          Autocorrect Text

          {/* Help Button — in title bar, hover-to-show + click-to-pin */}
          <div className="ac-help-wrapper" ref={helpRef}>
            <button
              className={`ac-help-btn${helpPinned ? ' ac-help-btn--active' : ''}`}
              onClick={() => setHelpPinned((p) => !p)}
              title="Help"
            >
              ?
            </button>
            <div className={`ac-help-overlay${helpPinned ? ' ac-help-overlay--pinned' : ''}`}>
              {helpPinned && (
                <button className="ac-help-overlay__close" onClick={() => setHelpPinned(false)} title="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              )}
              <div className="ac-help-overlay__header">
                Autocorrection is text replacement
              </div>
              <p className="ac-help-overlay__body">
                When the system detects a specific word or phrase that you specify, that
                <span className="me-highlight-text"> &ldquo;Input&rdquo;</span> will be automatically replaced with your corrected
                <span className="me-highlight-text"> &ldquo;Output&rdquo;</span> word or phrase. This provides customization and improves
                speech recognition accuracy.
              </p>
              <p className="ac-help-overlay__note">
                Note that &ldquo;Inputs&rdquo; are <strong>case-insensitive</strong> and will
                recognize any mix of capitalization and lower-case characters.
                &ldquo;Outputs&rdquo; are <strong>case-sensitive</strong> and will appear with
                the exact capitalization that you define.
              </p>
              <div className="ac-help-overlay__section-title">Common uses:</div>
              <ul className="ac-help-overlay__list">
                <li>
                  <span className="ac-help-overlay__use-label">Correcting speech detection errors</span>
                  <span className="ac-help-overlay__example">
                    e.g. &ldquo;my cough&rdquo; &rarr; &ldquo;mic off&rdquo;
                  </span>
                </li>
                <li>
                  <span className="ac-help-overlay__use-label">Acronym correction &amp; capitalization</span>
                  <span className="ac-help-overlay__example">
                    e.g. &ldquo;flare&rdquo; &rarr; &ldquo;FLAIR&rdquo;
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Toolbar container */}
      <div className="ac-toolbar-container">
        {/* Toast notification */}
        {toastVisible && (
          <div className="ac-toast">
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="ac-toolbar">
          <div className="ac-toolbar__left">
            <button
              className={`ac-btn ${isAdding ? 'ac-btn--cancel' : 'ac-btn--add'}`}
              onClick={() => isAdding ? handleCancelNew() : setIsAdding(true)}
              title={isAdding ? 'Cancel' : 'Add New Entry'}
            >
              {isAdding ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  Cancel
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add New Entry
                </>
              )}
            </button>

            <button
              className={`ac-btn ac-btn--delete${confirmingDelete ? ' ac-btn--confirming' : ''}`}
              onMouseDown={handleDeleteClick}
              title={confirmingDelete ? 'Click again to confirm deletion' : 'Delete Selected Entry'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              {confirmingDelete ? 'Confirm Delete?' : 'Delete Entry'}
            </button>
          </div>

          <div className="ac-toolbar__right">
            <div className="ac-search">
              <svg className="ac-search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input
                type="text"
                className="ac-search__input"
                placeholder="Search entries..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Expandable Add Form */}
        <div className={`ac-add-form ${isAdding ? 'ac-add-form--expanded' : ''}`}>
          <div className="ac-add-form__content">
            <div className="ac-add-form__row">
              <div className="ac-input-group">
                <label>Input:</label>
                <input
                  type="text"
                  placeholder="Replace this exact word or phrase..."
                  value={formReplace}
                  onChange={(e) => setFormReplace(e.target.value)}
                />
              </div>
              <div className="ac-input-group">
                <label>Output:</label>
                <input
                  type="text"
                  placeholder="With this correction..."
                  value={formWith}
                  onChange={(e) => setFormWith(e.target.value)}
                />
              </div>
              <div className="ac-input-group">
                <label>Nickname:</label>
                <input
                  type="text"
                  placeholder="(Optional) To find it later"
                  value={formNickname}
                  onChange={(e) => setFormNickname(e.target.value)}
                />
              </div>
            </div>
            <div className="ac-add-form__actions">
              <button
                className="ac-btn ac-btn--save"
                onClick={handleSaveNew}
                disabled={isSaveDisabled}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body — List / Table */}
      <div className="ac-window__body">
        <table className="ac-table">
          <thead>
            <tr>
              <th className="ac-table__th-nick" onClick={() => handleSort('nickname')}>
                <div className="ac-th-content">
                  Nickname {getSortIndicator('nickname') && <span className="ac-sort-indicator">{getSortIndicator('nickname')}</span>}
                </div>
              </th>
              <th className="ac-table__th-input" onClick={() => handleSort('replaceText')}>
                <div className="ac-th-content">
                  Input {getSortIndicator('replaceText') && <span className="ac-sort-indicator">{getSortIndicator('replaceText')}</span>}
                </div>
              </th>
              <th className="ac-table__th-output" onClick={() => handleSort('withText')}>
                <div className="ac-th-content">
                  Output {getSortIndicator('withText') && <span className="ac-sort-indicator">{getSortIndicator('withText')}</span>}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !searchTerm && (
              <tr>
                <td colSpan="3" className="ac-table__empty-state">
                  <div className="ac-empty-message">
                    <p>No personal autocorrections yet.</p>
                    <p>Click <span className="ac-highlight-text">"Add New Entry"</span> to start!</p>
                  </div>
                </td>
              </tr>
            )}
            {entries.length > 0 && displayedEntries.length === 0 && searchTerm && (
              <tr>
                <td colSpan="3" className="ac-table__empty-state">
                  <div className="ac-empty-message">
                    <p>No results found for "{searchTerm}"</p>
                  </div>
                </td>
              </tr>
            )}
            {displayedEntries.map((entry) => (
              <tr
                key={entry.id}
                className={selectedEntryId === entry.id ? 'ac-row--selected' : ''}
              >
                <td>
                  <div className="ac-table__cell-wrapper">
                    {searchTerm && <div className="ac-table__highlight-layer">{highlightMatch(entry.nickname || '', searchTerm)}</div>}
                    <input
                      type="text"
                      className={`ac-table__inline-input${searchTerm ? ' ac-table__inline-input--search' : ''}`}
                      value={entry.nickname}
                      onChange={(e) => handleInlineEdit(entry.id, 'nickname', e.target.value)}
                      onFocus={() => handleInlineFocus(entry.id)}
                      onBlur={handleInlineBlur}
                      placeholder="-"
                    />
                  </div>
                </td>
                <td>
                  <div className="ac-table__cell-wrapper">
                    {searchTerm && <div className="ac-table__highlight-layer">{highlightMatch(entry.input || '', searchTerm)}</div>}
                    <input
                      type="text"
                      className={`ac-table__inline-input${searchTerm ? ' ac-table__inline-input--search' : ''}`}
                      value={entry.input}
                      onChange={(e) => handleInlineEdit(entry.id, 'input', e.target.value)}
                      onFocus={() => handleInlineFocus(entry.id)}
                      onBlur={handleInlineBlur}
                      placeholder="Search string"
                    />
                  </div>
                </td>
                <td>
                  <div className="ac-table__cell-wrapper">
                    {searchTerm && <div className="ac-table__highlight-layer">{highlightMatch(entry.output || '', searchTerm)}</div>}
                    <input
                      type="text"
                      className={`ac-table__inline-input${searchTerm ? ' ac-table__inline-input--search' : ''}`}
                      value={entry.output}
                      onChange={(e) => handleInlineEdit(entry.id, 'output', e.target.value)}
                      onFocus={() => handleInlineFocus(entry.id)}
                      onBlur={handleInlineBlur}
                      placeholder="Replacement string"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
