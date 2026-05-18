import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { validateMacroName, refreshMacros } from '../../services/macroService';

/**
 * MacroEditorWindow — Standalone UI for creating and managing user macros.
 * Rendered in a pop-out browser window via portal from HamburgerMenu.
 *
 * Features:
 *   - Create macros with ordered sequences of Text and Command actions
 *   - Edit existing macros (double-click or select + Edit button)
 *   - Delete with two-click confirmation
 *   - Drag-and-drop reorder of actions within a macro
 *   - Sortable columns with per-column direction tracking
 *   - Search by macro name
 *   - Persistence via /api/user/macros endpoints
 */

// ── Available command definitions for the Command action type ──────────
const AVAILABLE_COMMANDS = [
  { id: 'next_field', label: 'Navigation: "Next Field"', description: 'Navigate to the next content field', params: [] },
  { id: 'previous_field', label: 'Navigation: "Previous Field"', description: 'Navigate to the previous content field', params: [] },
  { id: 'go_to_dictation', label: 'Navigation: "Go to Dictation"', description: 'Navigate to the dictation box', params: [] },
  { id: 'go_to_section', label: 'Navigation: "Go to [section name]"', description: 'Navigate to a named section of the report', params: [{ key: 'sectionName', placeholder: 'Section name…' }] },
  { id: 'go_to_start', label: 'Navigation: "Go to Start"', description: 'Move cursor to start of text', params: [] },
  { id: 'go_to_end', label: 'Navigation: "Go to End"', description: 'Move cursor to end of text', params: [] },
  { id: 'new_line', label: 'Text: "New Line"', description: 'Insert a new line at the cursor position', params: [] },
  { id: 'new_paragraph', label: 'Text: "New Paragraph"', description: 'Insert a new paragraph at the cursor position', params: [] },
  { id: 'delete_text', label: 'Text: "Delete Text"', description: 'Delete text (selection or all)', params: [] },
  { id: 'highlight_text', label: 'Text: "Highlight [text]"', description: 'Highlight text in the active textarea', params: [{ key: 'searchText', placeholder: 'Text to highlight…' }] },
  { id: 'replace_text', label: 'Text: "Replace [text A] with [text B]"', description: 'Replace text A with text B in the active textarea', params: [{ key: 'findText', placeholder: 'Text to replace…' }, { key: 'replaceWith', placeholder: 'Text to insert…' }] },
];

/**
 * Build a summary string for a single action (used in Action Records and table).
 */
function getActionSummary(action) {
  if (action.type === 'text') {
    const preview = (action.text || '').slice(0, 60);
    return preview + ((action.text || '').length > 60 ? '…' : '');
  }
  if (action.type === 'erik') {
    const preview = (action.text || '').slice(0, 60);
    return preview + ((action.text || '').length > 60 ? '…' : '');
  }
  if (action.type === 'command') {
    const cmd = AVAILABLE_COMMANDS.find(c => c.id === action.commandId);
    const label = cmd ? cmd.label : action.commandId;
    if (action.params?.sectionName) return `${label} → "${action.params.sectionName}"`;
    if (action.params?.searchText) return `${label} → "${action.params.searchText}"`;
    if (action.params?.findText) return `${label} → "${action.params.findText}" → "${action.params.replaceWith}"`;
    return label;
  }
  return '';
}

/**
 * Full-text version for expanded action preview (no truncation).
 */
function getActionFullText(action) {
  if (action.type === 'text' || action.type === 'erik') {
    return action.text || '';
  }
  // For commands, reuse the summary (it's already complete)
  return getActionSummary(action);
}

/**
 * Build the summary column text for the macro list table.
 */
function getMacroActionsSummary(macro) {
  if (!macro.actions || macro.actions.length === 0) return '';
  const sorted = [...macro.actions].sort((a, b) => a.order - b.order);
  return sorted.map((a, i) => `${i + 1}. ${getActionSummary(a)}`).join(' | ');
}

// ── SVG icon sub-components ──────────────────────────────────────────

function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PencilIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function TrashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SaveIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function CheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--purple-text)' }}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ── Grip handle (6 dots in 3 rows × 2 cols) ──
function GripHandle() {
  return (
    <div className="me-action-record__grip">
      {[0, 1, 2].map(r => (
        <div className="me-action-record__grip-row" key={r}>
          <div className="me-action-record__grip-dot" />
          <div className="me-action-record__grip-dot" />
        </div>
      ))}
    </div>
  );
}


export default function MacroEditorWindow({ onClose }) {
  // ── Core State ──
  const [macros, setMacros] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSort, setActiveSort] = useState('name');
  const [sortDirections, setSortDirections] = useState({ name: 'asc', actionCount: 'asc', source: 'asc' });
  const [selectedMacroId, setSelectedMacroId] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showSystemMacros, setShowSystemMacros] = useState(true);
  const [expandedMacroId, setExpandedMacroId] = useState(null);
  const [helpPinned, setHelpPinned] = useState(false);
  const helpRef = useRef(null);

  // ── Builder State ──
  const [builderMode, setBuilderMode] = useState(null); // null | 'create' | 'edit'
  const [builderName, setBuilderName] = useState('');
  const [builderActions, setBuilderActions] = useState([]); // { id, type, text?, commandId?, params?, order }
  const [editingMacroId, setEditingMacroId] = useState(null);

  // ── Action Form State (for adding/editing a single action) ──
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionFormMode, setActionFormMode] = useState('add'); // 'add' | 'edit'
  const [editingActionId, setEditingActionId] = useState(null);
  const [actionType, setActionType] = useState('text');
  const [actionText, setActionText] = useState('');
  const [actionCommandId, setActionCommandId] = useState('');
  const [actionParams, setActionParams] = useState({});

  // ── Drag State ──
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // ── Toast State ──
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  // ── Load macros + preferences on mount ──
  useEffect(() => {
    (async () => {
      try {
        // Load macros
        const macroRes = await fetch('/api/user/macros');
        if (macroRes.ok) {
          const data = await macroRes.json();
          setMacros(data.macros || []);
        }
        // Load user preference for showing system macros
        const prefRes = await fetch('/api/user/preferences');
        if (prefRes.ok) {
          const prefs = await prefRes.json();
          if (prefs.macroEditor?.showSystemMacros !== undefined) {
            setShowSystemMacros(prefs.macroEditor.showSystemMacros);
          }
        }
      } catch (err) {
        console.error('[MacroEditor] Failed to load macros:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── Toggle show system macros + persist ──
  const handleToggleSystemMacros = useCallback(async () => {
    const newVal = !showSystemMacros;
    setShowSystemMacros(newVal);
    try {
      const prefRes = await fetch('/api/user/preferences');
      if (prefRes.ok) {
        const prefs = await prefRes.json();
        prefs.macroEditor = { ...(prefs.macroEditor || {}), showSystemMacros: newVal };
        await fetch('/api/user/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
        });
      }
    } catch (err) {
      console.error('[MacroEditor] Failed to save system macro preference:', err);
    }
  }, [showSystemMacros]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showActionForm) {
          setShowActionForm(false);
        } else if (builderMode) {
          handleCancelBuilder();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, builderMode, showActionForm]);

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

  // ── Persist Helper ──
  // Only save user macros — system macros are merged in by the server at load time.
  const saveMacrosToServer = useCallback(async (macrosList) => {
    try {
      const userOnly = macrosList.filter(m => !m.isSystem);
      const res = await fetch('/api/user/macros', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macros: userOnly }),
      });
      if (!res.ok) {
        console.error('[MacroEditor] Failed to save macros:', res.status);
      }
    } catch (err) {
      console.error('[MacroEditor] Error saving macros:', err);
    }
  }, []);

  // ── Sorting Logic ──
  const handleSort = useCallback((columnKey) => {
    setSortDirections((prev) => ({
      ...prev,
      [columnKey]: prev[columnKey] === 'asc' ? 'desc' : 'asc',
    }));
    setActiveSort(columnKey);
  }, []);

  const getSortIndicator = (columnKey) => {
    if (activeSort !== columnKey) return null;
    return sortDirections[columnKey] === 'asc' ? '↑' : '↓';
  };

  // ── Filtered & Sorted Entries ──
  const displayedMacros = useMemo(() => {
    let filtered = macros;

    // Filter out system macros if checkbox is unchecked
    if (!showSystemMacros) {
      filtered = filtered.filter((m) => !m.isSystem);
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter((m) => m.name.toLowerCase().includes(lower));
    }

    const dir = sortDirections[activeSort] || 'asc';
    filtered = [...filtered].sort((a, b) => {
      if (activeSort === 'name') {
        const aVal = a.name.toLowerCase();
        const bVal = b.name.toLowerCase();
        if (aVal < bVal) return dir === 'asc' ? -1 : 1;
        if (aVal > bVal) return dir === 'asc' ? 1 : -1;
        return 0;
      }
      if (activeSort === 'source') {
        const aVal = a.isSystem ? 1 : 0;
        const bVal = b.isSystem ? 1 : 0;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (activeSort === 'actionCount') {
        const aVal = a.actions?.length || 0;
        const bVal = b.actions?.length || 0;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

    return filtered;
  }, [macros, searchTerm, activeSort, sortDirections, showSystemMacros]);

  // ── Builder: Open for Create ──
  const handleCreateClick = useCallback(() => {
    if (builderMode === 'create') {
      handleCancelBuilder();
      return;
    }
    setBuilderMode('create');
    setBuilderName('');
    setBuilderActions([]);
    setEditingMacroId(null);
    // Auto-open first action form
    setShowActionForm(true);
    setActionFormMode('add');
    resetActionForm();
  }, [builderMode]);

  // ── Builder: Open for Edit ──
  const openEditMode = useCallback((macro) => {
    setBuilderMode('edit');
    setEditingMacroId(macro.id);
    setBuilderName(macro.name);
    const sortedActions = [...(macro.actions || [])].sort((a, b) => a.order - b.order);
    setBuilderActions(sortedActions);
    setShowActionForm(false);
    setEditingActionId(null);
  }, []);

  const handleEditClick = useCallback(() => {
    if (!selectedMacroId) {
      showToast('Select a macro from the list first.');
      return;
    }
    const macro = macros.find(m => m.id === selectedMacroId);
    if (!macro) return;
    if (macro.isSystem) {
      showToast('System macros cannot be edited.');
      return;
    }
    openEditMode(macro);
  }, [selectedMacroId, macros, openEditMode, showToast]);

  // ── Builder: Cancel ──
  const handleCancelBuilder = useCallback(() => {
    setBuilderMode(null);
    setBuilderName('');
    setBuilderActions([]);
    setEditingMacroId(null);
    setShowActionForm(false);
    setEditingActionId(null);
    resetActionForm();
  }, []);

  // ── Builder: Save Macro ──
  const handleSaveMacro = useCallback(async () => {
    if (!builderName.trim()) {
      showToast('Please enter a macro name.');
      return;
    }
    if (builderActions.length === 0) {
      showToast('Add at least one action before saving.');
      return;
    }

    // Validate macro name against reserved voice command prefixes
    const validation = validateMacroName(builderName);
    if (!validation.valid) {
      showToast(validation.reason);
      return;
    }

    const orderedActions = builderActions.map((a, i) => ({ ...a, order: i }));

    if (builderMode === 'create') {
      try {
        const res = await fetch('/api/user/macros/entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: builderName.trim(), actions: orderedActions }),
        });
        const data = await res.json();
        if (data.status === 'duplicate') {
          showToast('A macro with this name already exists.');
          return;
        }
        if (data.status === 'created' && data.macro) {
          setMacros((prev) => [...prev, data.macro]);
          handleCancelBuilder();
          refreshMacros(); // Re-register voice commands
        }
      } catch (err) {
        console.error('[MacroEditor] Error creating macro:', err);
        showToast('Network error. Please try again.');
      }
    } else if (builderMode === 'edit' && editingMacroId) {
      setMacros((prev) => {
        const updated = prev.map((m) =>
          m.id === editingMacroId
            ? { ...m, name: builderName.trim(), actions: orderedActions, updatedAt: new Date().toISOString() }
            : m
        );
        saveMacrosToServer(updated);
        return updated;
      });
      handleCancelBuilder();
      refreshMacros(); // Re-register voice commands
    }
  }, [builderMode, builderName, builderActions, editingMacroId, handleCancelBuilder, saveMacrosToServer, showToast]);

  // ── Delete Macro ──
  const handleDeleteClick = useCallback(() => {
    if (!selectedMacroId) {
      showToast('Select a macro from the list first.');
      return;
    }
    const macro = macros.find(m => m.id === selectedMacroId);
    if (macro?.isSystem) {
      showToast('System macros cannot be deleted.');
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    // Second click: actually delete
    setConfirmingDelete(false);
    setMacros((prev) => {
      const updated = prev.filter((m) => m.id !== selectedMacroId);
      saveMacrosToServer(updated);
      return updated;
    });
    setSelectedMacroId(null);
    refreshMacros(); // Re-register voice commands
    // Close builder if editing the deleted macro
    if (editingMacroId === selectedMacroId) {
      handleCancelBuilder();
    }
  }, [selectedMacroId, confirmingDelete, editingMacroId, macros, handleCancelBuilder, saveMacrosToServer, showToast]);

  // ── Action Form Helpers ──
  function resetActionForm() {
    setActionType('text');
    setActionText('');
    setActionCommandId('');
    setActionParams({});
  }

  const handleAddActionClick = useCallback(() => {
    setShowActionForm(true);
    setActionFormMode('add');
    setEditingActionId(null);
    resetActionForm();
  }, []);

  const handleEditAction = useCallback((action) => {
    setShowActionForm(true);
    setActionFormMode('edit');
    setEditingActionId(action.id);
    setActionType(action.type);
    if (action.type === 'text' || action.type === 'erik') {
      setActionText(action.text || '');
      setActionCommandId('');
      setActionParams({});
    } else {
      setActionText('');
      setActionCommandId(action.commandId || '');
      setActionParams(action.params || {});
    }
  }, []);

  const handleDeleteAction = useCallback((actionId) => {
    setBuilderActions((prev) => prev.filter(a => a.id !== actionId));
    if (editingActionId === actionId) {
      setShowActionForm(false);
      setEditingActionId(null);
      resetActionForm();
    }
  }, [editingActionId]);

  const isActionFormValid = useCallback(() => {
    if (actionType === 'text') return actionText.trim().length > 0;
    if (actionType === 'erik') return actionText.trim().length > 0;
    if (actionType === 'command') {
      if (!actionCommandId) return false;
      const cmd = AVAILABLE_COMMANDS.find(c => c.id === actionCommandId);
      if (!cmd) return false;
      for (const p of cmd.params) {
        if (!(actionParams[p.key] || '').trim()) return false;
      }
      return true;
    }
    return false;
  }, [actionType, actionText, actionCommandId, actionParams]);

  const handleDoneAction = useCallback(() => {
    if (!isActionFormValid()) return;

    const newAction = {
      id: editingActionId || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: actionType,
      order: 0, // will be recalculated on save
    };

    if (actionType === 'text' || actionType === 'erik') {
      newAction.text = actionText;
    } else {
      newAction.commandId = actionCommandId;
      const cmd = AVAILABLE_COMMANDS.find(c => c.id === actionCommandId);
      if (cmd && cmd.params.length > 0) {
        newAction.params = {};
        for (const p of cmd.params) {
          newAction.params[p.key] = (actionParams[p.key] || '').trim();
        }
      } else {
        newAction.params = {};
      }
    }

    if (actionFormMode === 'edit' && editingActionId) {
      setBuilderActions((prev) => prev.map(a => a.id === editingActionId ? { ...newAction, order: a.order } : a));
    } else {
      setBuilderActions((prev) => [...prev, { ...newAction, order: prev.length }]);
    }

    setShowActionForm(false);
    setEditingActionId(null);
    resetActionForm();
  }, [actionType, actionText, actionCommandId, actionParams, actionFormMode, editingActionId, isActionFormValid]);

  // ── Drag and Drop ──
  const handleDragStart = useCallback((e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIdx !== null && idx !== dragIdx) {
      setDragOverIdx(idx);
    }
  }, [dragIdx]);

  const handleDrop = useCallback((e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setBuilderActions((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(dropIdx, 0, moved);
      return updated.map((a, i) => ({ ...a, order: i }));
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  // ── Double-click to edit (blocked for system macros) ──
  const handleRowDoubleClick = useCallback((macro) => {
    if (macro.isSystem) {
      showToast('System macros cannot be edited.');
      return;
    }
    openEditMode(macro);
  }, [openEditMode, showToast]);

  // ── Selected command description ──
  const selectedCmdDef = AVAILABLE_COMMANDS.find(c => c.id === actionCommandId);

  // ── Search highlight helper ──
  // Wraps matched substrings in <mark> tags for visual feedback.
  const highlightMatch = useCallback((text, term) => {
    if (!term || !text) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="me-search-mark">{text.slice(idx, idx + term.length)}</mark>
        {text.slice(idx + term.length)}
      </>
    );
  }, []);

  // ── Render ──
  if (isLoading) {
    return (
      <div className="me-window" id="macro-editor-window">
        <div className="me-window__header">
          <div className="me-window__title">
            <MacroIcon className="me-window__title-icon" />
            Macro Editor
          </div>
        </div>
        <div className="me-window__body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--muted)' }}>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="me-window" id="macro-editor-window">
      {/* Header */}
      <div className="me-window__header">
        <div className="me-window__title">
          <MacroIcon className="me-window__title-icon" />
          Macro Editor

          {/* Help Button — hover-to-show + click-to-pin */}
          <div className="me-help-wrapper" ref={helpRef}>
            <button
              className={`ac-help-btn${helpPinned ? ' ac-help-btn--active' : ''}`}
              onClick={() => setHelpPinned((p) => !p)}
              title="Help"
            >
              ?
            </button>
            <div className={`me-help-overlay${helpPinned ? ' me-help-overlay--pinned' : ''}`}>
              {helpPinned && (
                <button className="ac-help-overlay__close" onClick={() => setHelpPinned(false)} title="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              )}
              <div className="ac-help-overlay__header">
                Macros automatically perform actions
              </div>
              <p className="ac-help-overlay__body">
                An action can <span className="me-highlight-text">insert</span> <span className="me-highlight-text">text</span> at
                the cursor location, execute <span className="me-highlight-text">Voice Commands</span>,
                or deliver <span className="me-highlight-text">prompts to ERIK</span>.
                This interface allows you to define individual actions and combine them
                together to create powerful and highly customizable tools. Macros are most
                commonly used for text insertion alone, but you can create multiple actions
                and run them in sequence to <span className="me-highlight-text">complete
                  entire workflows with a single command</span>. You can also pre-define detailed
                prompts for ERIK to <span className="me-highlight-text">gather detailed clinical information</span> about
                your patients.
              </p>
              <div className="ac-help-overlay__section-title">Macros are run by entering any of the following voice commands:</div>
              <div className="me-help-overlay__commands">
                <span className="me-help-overlay__command-pill">&ldquo;macro [macro name]&rdquo;</span>
                <span className="me-help-overlay__command-pill">&ldquo;dot [macro name]&rdquo;</span>
                <span className="me-help-overlay__command-pill">&ldquo;insert [macro name]&rdquo;</span>
              </div>
              <p className="me-help-overlay__also">
                You can also type <span className="me-help-overlay__command-pill">.[macro name]</span> to run a macro.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Toolbar + Builder container */}
      <div className="me-toolbar-container">
        {/* Toast */}
        {toastVisible && <div className="me-toast"><span>{toastMessage}</span></div>}

        {/* Toolbar */}
        <div className="me-toolbar">
          <div className="me-toolbar__left">
            {/* Create / Cancel */}
            <button
              className={`me-btn ${builderMode === 'create' ? 'me-btn--cancel' : 'me-btn--add'}`}
              onClick={handleCreateClick}
              title={builderMode === 'create' ? 'Cancel' : 'Create Macro'}
            >
              {builderMode === 'create' ? <><XIcon /> Cancel</> : <><PlusIcon /> Create Macro</>}
            </button>

            {/* Edit */}
            <button
              className="me-btn me-btn--edit"
              onClick={handleEditClick}
              disabled={!selectedMacroId || builderMode === 'create'}
              title="Edit Selected Macro"
            >
              <PencilIcon /> Edit Macro
            </button>

            {/* Delete */}
            <button
              className={`me-btn me-btn--delete${confirmingDelete ? ' me-btn--confirming' : ''}`}
              onClick={handleDeleteClick}
              disabled={builderMode === 'create'}
              title={confirmingDelete ? 'Click again to confirm deletion' : 'Delete Selected Macro'}
            >
              <TrashIcon />
              {confirmingDelete ? 'Confirm Delete?' : 'Delete Macro'}
            </button>
          </div>

          <div className="me-toolbar__right">
            <label className="me-system-toggle" title="Show or hide system-default macros">
              <input
                type="checkbox"
                className="me-system-toggle__checkbox"
                checked={showSystemMacros}
                onChange={handleToggleSystemMacros}
              />
              <span className="me-system-toggle__label">Show System Macros</span>
            </label>
            <div className="me-search">
              <SearchIcon className="me-search__icon" />
              <input
                type="text"
                className="me-search__input"
                placeholder="Search macros..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ── Expandable Builder ── */}
        <div className={`me-builder ${builderMode ? 'me-builder--expanded' : ''}`}>
          <div className="me-builder__content">
            {/* Controls Row: Add Action + Name + Save */}
            <div className="me-builder__controls">
              <button
                className="me-btn me-btn--add"
                onClick={handleAddActionClick}
                disabled={showActionForm}
                title="Add Action"
              >
                <PlusIcon /> Add Action
              </button>

              <input
                type="text"
                className="me-builder__name-input"
                placeholder="Macro name…"
                value={builderName}
                onChange={(e) => setBuilderName(e.target.value)}
              />

              <button
                className="me-btn me-btn--save"
                onClick={handleSaveMacro}
                disabled={!builderName.trim() || builderActions.length === 0}
                title="Save Macro"
              >
                <SaveIcon /> Save
              </button>
            </div>

            {/* Action Records */}
            {builderActions.length > 0 && (
              <div className="me-action-list">
                {builderActions.length > 1 && (
                  <div className="me-action-list__reorder-hint">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="2" x2="12" y2="22" /><polyline points="5 9 12 2 19 9" /><polyline points="5 15 12 22 19 15" /></svg>
                    Drag to reorder
                  </div>
                )}
                {builderActions.map((action, idx) => (
                  <div
                    key={action.id}
                    className={`me-action-record${dragIdx === idx ? ' me-action-record--dragging' : ''}${dragOverIdx === idx && dragIdx !== idx ? ' me-action-record--drag-over' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                  >
                    <GripHandle />
                    <span className="me-action-record__number">{idx + 1}</span>
                    <span className={`me-action-record__type me-action-record__type--${action.type}`}>
                      {action.type}
                    </span>
                    <span className="me-action-record__summary">
                      {getActionSummary(action)}
                    </span>
                    <div className="me-action-record__actions">
                      <button
                        className="me-action-record__icon-btn"
                        onClick={() => handleEditAction(action)}
                        title="Edit action"
                      >
                        <PencilIcon size={14} />
                      </button>
                      <button
                        className="me-action-record__icon-btn me-action-record__icon-btn--delete"
                        onClick={() => handleDeleteAction(action.id)}
                        title="Remove action"
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Action Form */}
            {showActionForm && (
              <div className="me-action-form">
                {/* Row 1: Action Type + Description (inline) */}
                <div className="me-action-form__row me-action-form__row--inline">
                  <div className="me-action-form__group">
                    <span className="me-action-form__label">Action:</span>
                    <select
                      className="me-action-form__select"
                      value={actionType}
                      onChange={(e) => {
                        setActionType(e.target.value);
                        setActionCommandId('');
                        setActionParams({});
                        setActionText('');
                      }}
                    >
                      <option value="text">Text</option>
                      <option value="command">Command</option>
                      <option value="erik">ERIK</option>
                    </select>
                  </div>
                  <span className="me-action-form__description">
                    {actionType === 'text'
                      ? 'Inserts text at the current cursor location'
                      : actionType === 'erik'
                        ? 'Ask ERIK anything. Text here will be sent as a prompt to ERIK.'
                        : (selectedCmdDef ? selectedCmdDef.description : 'Executes a Voice Command. Effects depend on the command.')}
                  </span>
                </div>

                {/* Row 2: Conditional inputs */}
                {actionType === 'text' && (
                  <textarea
                    className="me-action-form__textarea"
                    placeholder="Text to insert…"
                    value={actionText}
                    onChange={(e) => setActionText(e.target.value)}
                    rows={4}
                  />
                )}

                {actionType === 'erik' && (
                  <textarea
                    className="me-action-form__textarea"
                    placeholder="Ask ERIK…"
                    value={actionText}
                    onChange={(e) => setActionText(e.target.value)}
                    rows={4}
                  />
                )}

                {actionType === 'command' && (
                  <>
                    <select
                      className="me-action-form__select me-action-form__select--wide"
                      value={actionCommandId}
                      onChange={(e) => {
                        setActionCommandId(e.target.value);
                        setActionParams({});
                      }}
                    >
                      <option value="">Select a command…</option>
                      {AVAILABLE_COMMANDS.map(cmd => (
                        <option key={cmd.id} value={cmd.id}>{cmd.label}</option>
                      ))}
                    </select>

                    {/* Parameter inputs for commands that need them */}
                    {selectedCmdDef && selectedCmdDef.params.length > 0 && (
                      <div className="me-action-form__param-row">
                        {selectedCmdDef.params.map(p => (
                          <input
                            key={p.key}
                            className="me-action-form__input"
                            type="text"
                            placeholder={p.placeholder}
                            value={actionParams[p.key] || ''}
                            onChange={(e) => setActionParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Done button */}
                <div className="me-action-form__footer">
                  <button
                    className="me-btn me-btn--done"
                    onClick={handleDoneAction}
                    disabled={!isActionFormValid()}
                    title="Done"
                  >
                    <CheckIcon /> Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Body: Macro List / Table ── */}
      <div className="me-window__body">
        <table className="me-table">
          <thead>
            <tr>
              <th className="me-table__th-name" onClick={() => handleSort('name')}>
                <div className="me-th-content">
                  Name {getSortIndicator('name') && <span className="me-sort-indicator">{getSortIndicator('name')}</span>}
                </div>
              </th>
              <th className="me-table__th-source" onClick={() => handleSort('source')}>
                <div className="me-th-content" style={{ justifyContent: 'center' }}>
                  Source {getSortIndicator('source') && <span className="me-sort-indicator">{getSortIndicator('source')}</span>}
                </div>
              </th>
              <th className="me-table__th-count" onClick={() => handleSort('actionCount')}>
                <div className="me-th-content" style={{ justifyContent: 'center' }}>
                  Action # {getSortIndicator('actionCount') && <span className="me-sort-indicator">{getSortIndicator('actionCount')}</span>}
                </div>
              </th>
              <th className="me-table__th-actions">
                <div className="me-th-content">Actions</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {macros.length === 0 && !searchTerm && (
              <tr>
                <td colSpan="4" className="me-table__empty-state">
                  <div className="me-empty-message">
                    <p>No macros yet.</p>
                    <p>Click <span className="me-highlight-text">"Create Macro"</span> to start!</p>
                  </div>
                </td>
              </tr>
            )}
            {macros.length > 0 && displayedMacros.length === 0 && searchTerm && (
              <tr>
                <td colSpan="4" className="me-table__empty-state">
                  <div className="me-empty-message">
                    <p>No results found for "{searchTerm}"</p>
                  </div>
                </td>
              </tr>
            )}
            {displayedMacros.map((macro) => {
              const isExpanded = expandedMacroId === macro.id;
              const isSelected = selectedMacroId === macro.id;
              return (
                <Fragment key={macro.id}>
                  <tr
                    className={`${isSelected ? 'me-row--selected' : ''}${macro.isSystem ? ' me-row--system' : ''}`}
                    onClick={() => {
                      setSelectedMacroId(macro.id);
                      setExpandedMacroId(isExpanded ? null : macro.id);
                    }}
                    onDoubleClick={() => handleRowDoubleClick(macro)}
                  >
                    <td>{searchTerm ? highlightMatch(macro.name, searchTerm) : macro.name}</td>
                    <td className="me-table__td-source">
                      <span className={`me-source-badge me-source-badge--${macro.isSystem ? 'system' : 'user'}`}>
                        {macro.isSystem ? 'System' : 'User'}
                      </span>
                    </td>
                    <td className="me-table__td-count">{macro.actions?.length || 0}</td>
                    <td>
                      <span className="me-table__actions-summary">{getMacroActionsSummary(macro)}</span>
                    </td>
                  </tr>
                  {isExpanded && macro.actions?.length > 0 && (
                    <tr className="me-row--expanded-detail">
                      <td colSpan="4">
                        <div className="me-expanded-actions">
                          <div className="me-expanded-actions__header">Actions</div>
                          {[...macro.actions].sort((a, b) => a.order - b.order).map((action, idx) => (
                            <div key={action.id} className="me-expanded-actions__item">
                              <span className="me-expanded-actions__num">{idx + 1}.</span>
                              <span className={`me-expanded-actions__type me-expanded-actions__type--${action.type}`}>
                                {action.type}
                              </span>
                              <span className="me-expanded-actions__text">{getActionFullText(action)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Macro icon: Play triangle.
 * Used in hamburger menu and window title bar.
 */
export function MacroIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6,3 6,21 20,12" />
    </svg>
  );
}
