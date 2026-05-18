import { useState, useRef, useCallback, useEffect } from 'react';
import useUserStore from '../../stores/useUserStore';

/**
 * ImpressionSettingsModal — Phase 6
 *
 * Full-screen modal for configuring impression generation preferences.
 * Preferences are saved immediately on click (Zustand state, no "save" button).
 * Also includes a text area for pasting prior impression samples.
 */

const PREF_GROUPS = [
  {
    key: 'structure',
    label: 'Structure',
    options: [
      { value: 'bulleted', label: 'Bulleted', tooltip: 'Impression is presented as a bulleted list of findings (most important first)' },
      { value: 'numbered', label: 'Numbered', tooltip: 'Impression is presented as a numbered list of findings (most important first)' },
      { value: 'paragraph', label: 'Paragraph', tooltip: 'Impression is presented in full sentences/paragraphs (most important details first)' },
    ],
  },
  {
    key: 'verbosity',
    label: 'Verbosity',
    options: [
      { value: 'low', label: 'Low', tooltip: 'Terse, to the point. Sentence fragments acceptable.' },
      { value: 'medium', label: 'Medium', tooltip: 'Concise but full sentences, no sentence fragments.' },
      { value: 'high', label: 'High', tooltip: 'Fully detailed sentences. Expands incomplete sentences but NEVER hallucinates.' },
    ],
  },
  {
    key: 'hedging',
    label: 'Hedging',
    options: [
      { value: 'low', label: 'Low', tooltip: 'Declarative statements unless explicitly hedged by the radiologist.' },
      { value: 'medium', label: 'Medium', tooltip: "Follows the radiologist's provided language without hedging bias." },
      { value: 'high', label: 'High', tooltip: 'Acknowledges uncertainty while never contradicting direct statements.' },
    ],
  },
  {
    key: 'normalFindings',
    label: 'Normal Findings',
    options: [
      { value: 'exclude', label: 'Exclude', tooltip: 'Normal/default findings are omitted from the impression (unless clinically relevant to the history). If all findings are normal, a single "Normal examination." statement is generated.' },
      { value: 'include', label: 'Include', tooltip: 'Normal/default findings are included in the impression — aggregated into a single statement or listed individually based on your writing style.' },
    ],
  },
  {
    key: 'acronymExpansion',
    label: 'Acronym Expansion',
    options: [
      { value: true, label: 'Yes', tooltip: 'Expands acronyms to full text (e.g. PE \u2192 pulmonary embolism)' },
      { value: false, label: 'No', tooltip: 'Leaves acronyms as written by the radiologist.' },
    ],
  },
  {
    key: 'guidelines',
    label: 'Guidelines',
    options: [
      { value: true, label: 'Yes', tooltip: 'Includes relevant clinical guidelines (BI-RADS, TI-RADS, Fleischner, etc.)' },
      { value: false, label: 'No', tooltip: 'Does not reference clinical guidelines.' },
    ],
  },
  {
    key: 'recommendations',
    label: 'Recommendations',
    options: [
      { value: 'imaging', label: 'Imaging', tooltip: 'Suggests type and timing of follow-up imaging.' },
      { value: 'clinical', label: 'Clinical', tooltip: 'Suggests specialty and timing of clinical follow-up.' },
      { value: 'imaging_clinical', label: 'Both', tooltip: 'Suggests both imaging and clinical follow-up.' },
      { value: 'none', label: 'None', tooltip: 'No follow-up recommendations.' },
    ],
  },
];

export default function ImpressionSettingsModal({ onClose }) {
  const impressionPrefs = useUserStore((s) => s.preferences.impressionSettings);
  const updateImpressionSettings = useUserStore((s) => s.updateImpressionSettings);
  const priorImpressionSamples = useUserStore((s) => s.preferences.priorImpressionSamples);
  const updatePriorImpressionSamples = useUserStore((s) => s.updatePriorImpressionSamples);

  // Local state for the sample textarea
  const [sampleText, setSampleText] = useState(
    (priorImpressionSamples || []).join('\n\n')
  );
  const sampleDebounceRef = useRef(null);

  // Parse sample text into array on change (debounced)
  const handleSampleChange = useCallback((e) => {
    const text = e.target.value;
    setSampleText(text);

    if (sampleDebounceRef.current) clearTimeout(sampleDebounceRef.current);
    sampleDebounceRef.current = setTimeout(() => {
      // Treat the entire pasted text as a single voice sample
      const trimmed = text.trim();
      if (trimmed) {
        updatePriorImpressionSamples([trimmed]);
      } else {
        updatePriorImpressionSamples([]);
      }
    }, 1000);
  }, [updatePriorImpressionSamples]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (sampleDebounceRef.current) clearTimeout(sampleDebounceRef.current);
    };
  }, []);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handlePrefChange = (key, value) => {
    updateImpressionSettings({ [key]: value });
  };

  // Compute sample count
  const sampleCount = (priorImpressionSamples || []).filter(s => s.trim()).length;

  return (
    <div className="impression-settings-modal__backdrop" onClick={handleBackdropClick}>
      <div className="impression-settings-modal" role="dialog" aria-modal="true" aria-label="Impression Settings" id="impression-settings-modal">
        {/* Header */}
        <div className="impression-settings-modal__header">
          <div className="impression-settings-modal__title">
            <svg className="impression-settings-modal__brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z" />
              <path d="M9 21h6" />
              <path d="M10 17v4" />
              <path d="M14 17v4" />
              <path d="M9 10h.01" />
              <path d="M15 10h.01" />
              <path d="M12 14a2 2 0 0 0 2-2" />
              <path d="M12 14a2 2 0 0 1-2-2" />
            </svg>
            Impression Settings
          </div>
          <button
            className="impression-settings-modal__close"
            onClick={onClose}
            title="Close settings"
            aria-label="Close settings"
            id="impression-settings-close-btn"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Preference Groups */}
        <div className="impression-settings-modal__body">
          <div className="impression-settings-modal__groups">
            {PREF_GROUPS.map((group) => (
              <div key={group.key} className="impression-settings-modal__group">
                <div className="impression-settings-modal__group-label">{group.label}</div>
                <div className="impression-settings-modal__options">
                  {group.options.map((option) => {
                    const isActive = impressionPrefs[group.key] === option.value;
                    return (
                      <button
                        key={String(option.value)}
                        className={`impression-settings-modal__option ${isActive ? 'impression-settings-modal__option--active' : ''}`}
                        onClick={() => handlePrefChange(group.key, option.value)}
                        title={option.tooltip}
                        aria-pressed={isActive}
                        id={`pref-${group.key}-${option.value}`}
                      >
                        {option.label}
                        {isActive && <span className="impression-settings-modal__check">✦</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Prior Impression Samples */}
          <div className="impression-settings-modal__samples">
            <div className="impression-settings-modal__samples-header">
              <div className="impression-settings-modal__samples-label">Prior Impression Samples</div>
              <div className="impression-settings-modal__samples-count">
                {sampleCount > 0 ? `${sampleCount} sample${sampleCount !== 1 ? 's' : ''} loaded` : 'No samples loaded'}
              </div>
            </div>
            <textarea
              className="impression-settings-modal__samples-textarea"
              value={sampleText}
              onChange={handleSampleChange}
              placeholder="Paste prior impression examples here to help the LLM match your writing style. The model will use this text as a reference for tone, structure, and vocabulary."
              rows={6}
              spellCheck={false}
              id="impression-samples-textarea"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
