import { useState, useCallback, useEffect } from 'react';
import useReportStore from '../../stores/useReportStore';
import { startPass2Debounce } from '../../services/pass2Service';
import { startImpressionDebounce } from '../../services/impressionService';
import { saveSession, isSaveInProgress } from '../../services/sessionService';
import ReportNode from './ReportNode';

export default function ReportPanel() {
  const templateData = useReportStore((s) => s.templateData);
  const templateNodes = useReportStore((s) => s.templateNodes);
  const availableStudies = useReportStore((s) => s.availableStudies);
  const currentStudyId = useReportStore((s) => s.currentStudyId);
  const canUndo = useReportStore((s) => s.canUndo);
  const canRedo = useReportStore((s) => s.canRedo);
  const hasUnsavedChanges = useReportStore((s) => s.hasUnsavedChanges);
  const lastSavedAt = useReportStore((s) => s.lastSavedAt);

  const [saveFlash, setSaveFlash] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (saving || isSaveInProgress()) return;
    setSaving(true);
    const result = await saveSession();
    setSaving(false);
    if (result.success) {
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1200);
    }
  }, [saving]);

  // Ctrl+S shortcut for manual save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const handleUndo = () => {
    const store = useReportStore.getState();
    const result = store.performUndo();
    if (result) {
      if (result.type === 'pass1') {
        startPass2Debounce();
        startImpressionDebounce();
      } else if (result.type === 'deletion') {
        startPass2Debounce();
        startImpressionDebounce();
      }
    }
  };

  const handleRedo = () => {
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
  };

  // Format the last saved time for display
  const formatSavedTime = () => {
    if (!lastSavedAt) return null;
    try {
      const d = new Date(lastSavedAt);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return null; }
  };

  const savedTime = formatSavedTime();

  if (!templateData) {
    return (
      <div className="report-panel" id="report-panel">
        <div className="report-panel__header">
          <div className="report-panel__selector">
            <span>Loading template...</span>
          </div>
        </div>
        <div className="report-panel__body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="report-panel" id="report-panel">
      {/* Header with template selector + save + undo/redo */}
      <div className="report-panel__header">
        <div className="report-panel__selector" id="template-selector">
          {availableStudies.length > 0 ? (
            <select
              className="report-panel__study-select"
              value={currentStudyId || ''}
              onChange={(e) => {
                const selected = availableStudies.find(
                  (s) => s.currentStudyId === e.target.value,
                );
                if (selected) {
                  window.parent.postMessage(
                    { type: 'REPORTING:STUDY_CHANGE', payload: { study: selected } },
                    window.location.origin,
                  );
                }
              }}
            >
              {availableStudies.map((study) => (
                <option key={study.currentStudyId} value={study.currentStudyId}>
                  {study.studyDescription}
                </option>
              ))}
            </select>
          ) : (
            <span className="report-panel__selector-label">{templateData.title}</span>
          )}
        </div>

        <div className="report-panel__actions">
          {/* Save button */}
          <button
            className={[
              'report-panel__action-btn',
              'report-panel__save-btn',
              saveFlash ? 'report-panel__save-btn--flash' : '',
            ].filter(Boolean).join(' ')}
            id="save-btn"
            onClick={handleSave}
            disabled={!hasUnsavedChanges || saving}
            title={saving ? 'Saving…' : hasUnsavedChanges ? 'Save (Ctrl+S)' : savedTime ? `Saved at ${savedTime}` : 'No changes to save'}
          >
            {saving ? (
              /* Spinner icon while saving */
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="save-spinner">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              /* Floppy disk icon */
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            )}
          </button>

          {/* Separator between save and undo/redo */}
          <span className="report-panel__action-sep" />

          {/* Undo / Redo buttons */}
          <button
            className="report-panel__action-btn"
            id="undo-btn"
            onClick={handleUndo}
            disabled={!canUndo()}
            title="Undo (Ctrl+Z)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v1.5" />
            </svg>
          </button>
          <button
            className="report-panel__action-btn"
            id="redo-btn"
            onClick={handleRedo}
            disabled={!canRedo()}
            title="Redo (Ctrl+Y)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 14l5-5-5-5" />
              <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable template body */}
      <div className="report-panel__body" id="report-body">
        {templateNodes.map((node) => (
          <ReportNode key={node.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}
