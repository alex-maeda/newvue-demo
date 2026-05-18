import { useState, useEffect } from 'react';

export default function EhrToggleButton() {
  const [enabled, setEnabled] = useState(true);

  // Listen for EHR state from parent Cockpit via postMessage
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'COCKPIT:EHR_STATE') {
        setEnabled(event.data.payload.enabled);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const toggle = () => {
    const newState = !enabled;
    setEnabled(newState);
    window.parent.postMessage(
      { type: 'REPORTING:EHR_TOGGLE', payload: { enabled: newState } },
      window.location.origin,
    );
  };

  return (
    <div className="ehr-toggle">
      <span className="ehr-toggle-label">EHR Integration</span>
      <button
        className={`ehr-toggle-pill ${enabled ? 'ehr-toggle-pill--on' : ''}`}
        onClick={toggle}
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? 'Disable EHR Integration' : 'Enable EHR Integration'}
        title={enabled ? 'Disable EHR Integration' : 'Enable EHR Integration'}
      >
        <span className="ehr-toggle-knob" />
      </button>
    </div>
  );
}
