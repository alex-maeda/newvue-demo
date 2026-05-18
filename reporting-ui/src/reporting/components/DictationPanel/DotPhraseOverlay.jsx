import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { findMatchingMacros, executeMacro, getMacroList } from '../../services/macroService';

/**
 * DotPhraseOverlay — EPIC-style autocomplete dropdown for macro invocation.
 *
 * Activated when user types "." in a textarea. Shows a filtered list of
 * matching macros as the user continues typing. Supports:
 *   - Arrow up/down to navigate the list
 *   - Enter to select the highlighted macro
 *   - Double-click or right-click to select
 *   - Scroll wheel to scroll through long lists
 *   - Escape to close without selecting
 *
 * The overlay does NOT steal focus from the textarea. All keyboard
 * interaction is handled by the parent component's keydown handler.
 *
 * Props:
 *   - isOpen: boolean — whether the overlay is visible
 *   - filterText: string — characters typed after "." (for filtering)
 *   - onSelect: (macro) => void — called when a macro is selected
 *   - onClose: () => void — called when the overlay should close
 *   - anchorRect: { top, left } — position to render the overlay
 */
export default function DotPhraseOverlay({ isOpen, filterText, onSelect, onClose, anchorRect }) {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const listRef = useRef(null);

  // Filter macros by the typed prefix
  const matchingMacros = useMemo(() => {
    if (!isOpen) return [];
    return findMatchingMacros(filterText);
  }, [isOpen, filterText]);

  // When filterText changes, reset selection to first item (if any matches)
  useEffect(() => {
    if (matchingMacros.length > 0 && filterText.length > 0) {
      setSelectedIndex(0);
    } else if (filterText.length === 0) {
      setSelectedIndex(-1); // No selection when no chars typed yet
    }
  }, [filterText, matchingMacros.length]);

  // Scroll the selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('.dp-overlay__item');
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  /**
   * Navigate the selection up by one item.
   * Called by parent component on ArrowUp keydown.
   */
  const navigateUp = useCallback(() => {
    setSelectedIndex((prev) => {
      if (matchingMacros.length === 0) return -1;
      if (prev <= 0) return matchingMacros.length - 1; // Wrap to bottom
      return prev - 1;
    });
  }, [matchingMacros.length]);

  /**
   * Navigate the selection down by one item.
   * Called by parent component on ArrowDown keydown.
   */
  const navigateDown = useCallback(() => {
    setSelectedIndex((prev) => {
      if (matchingMacros.length === 0) return -1;
      if (prev >= matchingMacros.length - 1) return 0; // Wrap to top
      return prev + 1;
    });
  }, [matchingMacros.length]);

  /**
   * Select the currently highlighted macro.
   * Called by parent component on Enter keydown.
   */
  const selectCurrent = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < matchingMacros.length) {
      onSelect(matchingMacros[selectedIndex]);
    }
  }, [selectedIndex, matchingMacros, onSelect]);

  // Expose navigation/selection methods via ref (for parent to call)
  // We use a pattern where the parent can call these via passing handlers down
  // Actually, since parent handles keydown, it manages the selectedIndex state indirectly.
  // Instead, expose methods through the component's return value or callback pattern.

  // Handle double-click on a macro item
  const handleItemDoubleClick = useCallback((macro) => {
    onSelect(macro);
  }, [onSelect]);

  // Handle right-click on a macro item (EPIC-style selection)
  const handleItemContextMenu = useCallback((e, macro) => {
    e.preventDefault();
    onSelect(macro);
  }, [onSelect]);

  if (!isOpen) return null;

  // If overlay has no matches and user has typed something, signal to close
  if (matchingMacros.length === 0 && filterText.length > 0) {
    // Parent will detect this and close the overlay
    return null;
  }

  return (
    <div
      className="dp-overlay"
      style={{
        top: anchorRect?.top ?? 0,
        left: anchorRect?.left ?? 0,
      }}
      onMouseDown={(e) => e.preventDefault()} // Prevent focus steal
    >
      <div className="dp-overlay__header">
        <span className="dp-overlay__dot">.</span>
        <span className="dp-overlay__filter">{filterText || '—'}</span>
      </div>
      <div className="dp-overlay__list" ref={listRef}>
        {matchingMacros.length === 0 ? (
          <div className="dp-overlay__empty">
            {getMacroList().length === 0 ? 'No macros defined' : 'Type to filter…'}
          </div>
        ) : (
          matchingMacros.map((macro, idx) => (
            <div
              key={macro.id}
              className={`dp-overlay__item ${idx === selectedIndex ? 'dp-overlay__item--selected' : ''} ${macro.isSystem ? 'dp-overlay__item--system' : ''}`}
              onDoubleClick={() => handleItemDoubleClick(macro)}
              onContextMenu={(e) => handleItemContextMenu(e, macro)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="dp-overlay__item-name">
                {highlightPrefix(macro.name, filterText)}
              </span>
              {macro.isSystem && (
                <span className="dp-overlay__item-badge">SYS</span>
              )}
              <span className="dp-overlay__item-count">
                {macro.actions?.length || 0} {macro.actions?.length === 1 ? 'action' : 'actions'}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="dp-overlay__footer">
        <span>↑↓ Navigate</span>
        <span>↵ Select</span>
        <span>Esc Close</span>
      </div>
    </div>
  );
}

/**
 * Highlight the matching prefix in the macro name.
 */
function highlightPrefix(name, prefix) {
  if (!prefix || !name) return name;
  const idx = name.toLowerCase().indexOf(prefix.toLowerCase());
  if (idx !== 0) return name;
  return (
    <>
      <mark className="dp-overlay__match">{name.slice(0, prefix.length)}</mark>
      {name.slice(prefix.length)}
    </>
  );
}

/**
 * Imperative handle for the DotPhraseOverlay.
 * Used by parent components to call navigateUp/Down/selectCurrent
 * without needing to re-render the parent.
 */
export function useDotPhraseController() {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [anchorRect, setAnchorRect] = useState(null);
  const selectedIndexRef = useRef(-1);
  const matchingMacrosRef = useRef([]);

  // Update matching macros whenever filter changes
  useEffect(() => {
    if (isOpen) {
      matchingMacrosRef.current = findMatchingMacros(filterText);
      if (matchingMacrosRef.current.length > 0 && filterText.length > 0) {
        selectedIndexRef.current = 0;
      } else if (filterText.length === 0) {
        selectedIndexRef.current = -1;
      }
    }
  }, [isOpen, filterText]);

  const open = useCallback((rect) => {
    setIsOpen(true);
    setFilterText('');
    setAnchorRect(rect);
    selectedIndexRef.current = -1;
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setFilterText('');
    setAnchorRect(null);
    selectedIndexRef.current = -1;
    matchingMacrosRef.current = [];
  }, []);

  const updateFilter = useCallback((text) => {
    setFilterText(text);
    // Check if filter produces no matches — signal close
    const matches = findMatchingMacros(text);
    matchingMacrosRef.current = matches;
    if (matches.length === 0 && text.length > 0) {
      return false; // No matches — caller should close
    }
    if (matches.length > 0 && text.length > 0) {
      selectedIndexRef.current = 0;
    }
    return true; // Has matches (or no filter text yet)
  }, []);

  return {
    isOpen,
    filterText,
    anchorRect,
    selectedIndexRef,
    matchingMacrosRef,
    open,
    close,
    updateFilter,
  };
}
