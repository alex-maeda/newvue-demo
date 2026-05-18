/**
 * reporting-main.tsx — React entry point for the Reporting iFrame.
 *
 * This is the second Vite entry point (loaded by reporting.html).
 * It mounts the standalone Reporting App into an isolated browsing
 * context. Unlike the cockpit's main.tsx, this does NOT import
 * cockpit CSS or the CockpitProvider — the reporting app manages
 * its own styles and state independently.
 *
 * CSS load order:
 *   1. reporting-iframe.css — base resets, :root tokens, app-shell layout
 *   2. reporting.css — all component styles (scoped under .reporting-scope)
 *
 * The #root element receives the 'reporting-scope' class so that
 * reporting.css selectors (which are nested under .reporting-scope)
 * apply correctly.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReportingApp from './reporting/App';
import './reporting/reporting-iframe.css';
import './reporting/reporting.css';

// Add the reporting-scope class to #root so scoped CSS selectors work
const rootEl = document.getElementById('root')!;
rootEl.classList.add('reporting-scope');

createRoot(rootEl).render(
  <StrictMode>
    <ReportingApp />
  </StrictMode>,
);
