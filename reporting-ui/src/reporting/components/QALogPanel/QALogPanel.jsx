import { useState, useRef, useEffect } from 'react';
import useReportStore from '../../stores/useReportStore';

const FILTER_TYPES = ['ASR', 'Pass 1', 'Pass 2', 'Impression'];

// Map filter chip labels to entry type values
const FILTER_MAP = {
  'ASR': ['ASR', 'ASR_ERROR'],
  'Pass 1': ['PASS1'],
  'Pass 2': ['PASS2A', 'PASS2B'],
  'Impression': ['IMPRESSION'],
};

function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function TypeBadge({ type }) {
  let className = 'qa-badge';
  if (type === 'ASR') className += ' qa-badge--asr';
  else if (type === 'ASR_ERROR') className += ' qa-badge--error';
  else if (type === 'PASS1') className += ' qa-badge--pass1';
  else if (type === 'PASS2A') className += ' qa-badge--pass2a';
  else if (type === 'PASS2B') className += ' qa-badge--pass2b';
  else if (type === 'IMPRESSION') className += ' qa-badge--impression';

  const label = type === 'ASR_ERROR' ? 'ERR'
    : type === 'PASS2A' ? 'P2A'
    : type === 'PASS2B' ? 'P2B'
    : type;
  return <span className={className}>{label}</span>;
}

function LatencyBadge({ ms }) {
  if (ms == null) return null;
  return <span className="qa-log-entry__latency">{ms}ms</span>;
}

function TokenBadge({ inputTokens, outputTokens }) {
  if (inputTokens == null && outputTokens == null) return null;
  return (
    <span className="qa-log-entry__tokens">
      → {(inputTokens ?? 0).toLocaleString()} in · ← {(outputTokens ?? 0).toLocaleString()} out
    </span>
  );
}

/**
 * Collapsible segment diagnostics for PASS1 entries.
 * Shows segment map, gaps, and block grouping.
 */
function SegmentDiagnostics({ snapshot, blockDetails, afterData }) {
  const [expanded, setExpanded] = useState(false);

  if (!snapshot && !blockDetails && !afterData) return null;

  const hasGaps = snapshot?.gaps?.length > 0;
  const hasUncovered = snapshot && snapshot.coverageEnd < snapshot.textLen;

  return (
    <div className="qa-seg-diag">
      <button
        className={`qa-seg-diag__toggle ${hasGaps || hasUncovered ? 'qa-seg-diag__toggle--warn' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="qa-seg-diag__icon">{expanded ? '▾' : '▸'}</span>
        Segments
        {snapshot && (
          <span className="qa-seg-diag__count">
            {snapshot.segments.length}
            {hasGaps && <span className="qa-seg-diag__gap-badge">⚠ {snapshot.gaps.length} gap{snapshot.gaps.length > 1 ? 's' : ''}</span>}
          </span>
        )}
      </button>
      {expanded && (
        <div className="qa-seg-diag__body">
          {/* ── Before ── */}
          <div className="qa-seg-diag__section-label">Before</div>

          {/* Segment map */}
          {snapshot?.segments?.length > 0 && (
            <div className="qa-seg-diag__map">
              <div className="qa-seg-diag__header-row">
                <span className="qa-seg-diag__col-range">Range</span>
                <span className="qa-seg-diag__col-status">Status</span>
                <span className="qa-seg-diag__col-text">Text</span>
              </div>
              {snapshot.segments.map((seg, i) => (
                <div
                  key={i}
                  className={`qa-seg-diag__row qa-seg-diag__row--${seg.status} ${!seg.textMatch ? 'qa-seg-diag__row--mismatch' : ''}`}
                >
                  <span className="qa-seg-diag__col-range">{seg.range}</span>
                  <span className={`qa-seg-diag__status qa-seg-diag__status--${seg.status}`}>
                    {seg.status}
                  </span>
                  <span className="qa-seg-diag__col-text" title={seg.preview}>
                    {!seg.textMatch && <span className="qa-seg-diag__mismatch-icon" title="Text does not match slice">✗ </span>}
                    {seg.preview}
                  </span>
                </div>
              ))}
              {/* Coverage summary */}
              <div className="qa-seg-diag__coverage">
                Coverage: [0,{snapshot.coverageEnd}] of {snapshot.textLen}
                {hasUncovered && (
                  <span className="qa-seg-diag__uncovered">
                    {' '}⚠ {snapshot.textLen - snapshot.coverageEnd} uncovered chars
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gaps */}
          {snapshot?.gaps?.length > 0 && (
            <div className="qa-seg-diag__gaps">
              <div className="qa-seg-diag__gaps-title">⚠ Gaps Detected:</div>
              {snapshot.gaps.map((gap, i) => (
                <div key={i} className="qa-seg-diag__gap-row">
                  {gap.range} ({gap.chars} char{gap.chars > 1 ? 's' : ''}): {gap.text}
                </div>
              ))}
            </div>
          )}

          {/* Block grouping */}
          {blockDetails?.length > 0 && (
            <div className="qa-seg-diag__blocks">
              <div className="qa-seg-diag__blocks-title">Blocks → API:</div>
              {blockDetails.map((bd, i) => (
                <div key={i} className="qa-seg-diag__block-row">
                  Block {bd.index}: {bd.range} ({bd.segCount} seg{bd.segCount > 1 ? 's' : ''})
                  <span className="qa-seg-diag__block-preview"> "{bd.preview}"</span>
                </div>
              ))}
            </div>
          )}

          {/* ── After ── */}
          {afterData && (
            <>
              <div className="qa-seg-diag__section-label qa-seg-diag__section-label--after">After</div>

              {/* Decisions */}
              {afterData.decisions?.length > 0 && (
                <div className="qa-seg-diag__decisions">
                  {afterData.decisions.map((d, i) => (
                    <span key={i} className="qa-seg-diag__decision">{d}</span>
                  ))}
                </div>
              )}

              {/* After segment map */}
              {afterData.segments?.length > 0 && (
                <div className="qa-seg-diag__map">
                  <div className="qa-seg-diag__header-row">
                    <span className="qa-seg-diag__col-range">Range</span>
                    <span className="qa-seg-diag__col-status">Status</span>
                    <span className="qa-seg-diag__col-text">Text</span>
                  </div>
                  {afterData.segments.map((seg, i) => (
                    <div key={i} className={`qa-seg-diag__row qa-seg-diag__row--${seg.status}`}>
                      <span className="qa-seg-diag__col-range">{seg.range}</span>
                      <span className={`qa-seg-diag__status qa-seg-diag__status--${seg.status}`}>
                        {seg.status}
                      </span>
                      <span className="qa-seg-diag__col-text" title={seg.text}>
                        {seg.text}
                        {seg.role && (
                          <span className={`qa-seg-diag__role qa-seg-diag__role--${seg.role}`}>
                            {seg.role}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {afterData.segments?.length === 0 && (
                <div className="qa-seg-diag__after-empty">∅ No segments (content removed)</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible details panel for PASS2A entries.
 * Shows raw JSONL response, segment/section ID mappings.
 */
function Pass2ADetails({ rawResponse, segmentMap, sectionMap }) {
  const [expanded, setExpanded] = useState(false);

  if (!rawResponse && !segmentMap && !sectionMap) return null;

  return (
    <div className="qa-seg-diag">
      <button
        className="qa-seg-diag__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="qa-seg-diag__icon">{expanded ? '▾' : '▸'}</span>
        2A Details
      </button>
      {expanded && (
        <div className="qa-seg-diag__body">
          {/* ID Mappings */}
          {(segmentMap || sectionMap) && (
            <>
              <div className="qa-seg-diag__section-label">ID Mappings</div>
              <div className="qa-seg-diag__map" style={{ fontSize: 10 }}>
                {segmentMap && Object.entries(segmentMap).map(([shortId, fullId]) => (
                  <div key={shortId} className="qa-seg-diag__row" style={{ padding: '1px 4px' }}>
                    <span className="qa-seg-diag__col-range" style={{ minWidth: 28 }}>{shortId}</span>
                    <span className="qa-seg-diag__status qa-seg-diag__status--sanitized" style={{ minWidth: 32 }}>seg</span>
                    <span className="qa-seg-diag__col-text" title={fullId}>…{fullId.slice(-12)}</span>
                  </div>
                ))}
                {sectionMap && Object.entries(sectionMap).map(([shortId, fullId]) => (
                  <div key={shortId} className="qa-seg-diag__row" style={{ padding: '1px 4px' }}>
                    <span className="qa-seg-diag__col-range" style={{ minWidth: 28 }}>{shortId}</span>
                    <span className="qa-seg-diag__status qa-seg-diag__status--structured" style={{ minWidth: 32 }}>sec</span>
                    <span className="qa-seg-diag__col-text" title={fullId}>…{fullId.slice(-16)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Raw JSONL response */}
          {rawResponse && (
            <>
              <div className="qa-seg-diag__section-label qa-seg-diag__section-label--after">Raw JSONL</div>
              <pre className="qa-pass2-raw">{rawResponse}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible details panel for PASS2B entries.
 * Shows normal decisions, ID mappings, and raw JSONL response.
 */
function Pass2BDetails({ rawResponse, normalMap, findingMap, normalDecisions }) {
  const [expanded, setExpanded] = useState(false);

  if (!rawResponse && !normalDecisions?.length) return null;

  const hasEdits = normalDecisions?.some(d => d.action === 'E');

  return (
    <div className="qa-seg-diag">
      <button
        className={`qa-seg-diag__toggle ${hasEdits ? 'qa-seg-diag__toggle--info' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="qa-seg-diag__icon">{expanded ? '▾' : '▸'}</span>
        2B Details
        {hasEdits && (
          <span className="qa-seg-diag__count">
            <span style={{ color: 'var(--accent)', fontSize: 10 }}>✎ has edits</span>
          </span>
        )}
      </button>
      {expanded && (
        <div className="qa-seg-diag__body">
          {/* ID Mappings */}
          {(normalMap || findingMap) && (
            <>
              <div className="qa-seg-diag__section-label">ID Mappings</div>
              <div className="qa-seg-diag__map" style={{ fontSize: 10 }}>
                {findingMap && Object.entries(findingMap).map(([shortId, info]) => (
                  <div key={shortId} className="qa-seg-diag__row" style={{ padding: '1px 4px' }}>
                    <span className="qa-seg-diag__col-range" style={{ minWidth: 28 }}>{shortId}</span>
                    <span className="qa-seg-diag__status qa-seg-diag__status--sanitized" style={{ minWidth: 32 }}>fnd</span>
                    <span className="qa-seg-diag__col-text">← {info.segmentShortId}</span>
                  </div>
                ))}
                {normalMap && Object.entries(normalMap).map(([shortId, fullId]) => (
                  <div key={shortId} className="qa-seg-diag__row" style={{ padding: '1px 4px' }}>
                    <span className="qa-seg-diag__col-range" style={{ minWidth: 28 }}>{shortId}</span>
                    <span className="qa-seg-diag__status" style={{ minWidth: 32, color: 'var(--warn)' }}>nrm</span>
                    <span className="qa-seg-diag__col-text" title={fullId}>…{fullId.slice(-16)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Normal Decisions */}
          {normalDecisions?.length > 0 && (
            <>
              <div className="qa-seg-diag__section-label qa-seg-diag__section-label--after">Decisions</div>
              <div className="qa-seg-diag__map" style={{ fontSize: 10 }}>
                {normalDecisions.map((d, i) => {
                  const actionLabel = d.action === 'K' ? '✓ keep'
                    : d.action === 'S' ? '⊘ suppress'
                    : '✎ edit';
                  const actionColor = d.action === 'K' ? 'var(--muted)'
                    : d.action === 'S' ? 'var(--warn)'
                    : 'var(--accent)';
                  return (
                    <div key={i} className="qa-seg-diag__row" style={{ padding: '2px 4px', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                      <span>
                        <span style={{ color: actionColor, fontWeight: 500 }}>{actionLabel}</span>
                        <span style={{ marginLeft: 6, color: 'var(--text)' }}>{d.normalShortId}</span>
                      </span>
                      {d.action === 'E' && d.replacementText && (
                        <span className="qa-seg-diag__col-text" style={{ paddingLeft: 12, whiteSpace: 'pre-wrap', color: 'var(--accent)' }}>
                          → "{d.replacementText}"
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Raw JSONL response */}
          {rawResponse && (
            <>
              <div className="qa-seg-diag__section-label qa-seg-diag__section-label--after">Raw JSONL</div>
              <pre className="qa-pass2-raw">{rawResponse}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible details panel for IMPRESSION entries.
 * Shows impression items (with critical/guideline/recommendation/locked badges),
 * active preferences snapshot, and raw Claude JSON response.
 */
function ImpressionDetails({ impressionItems, preferences, rawResponse }) {
  const [expanded, setExpanded] = useState(false);

  if (!impressionItems?.length && !rawResponse) return null;

  const hasCritical = impressionItems?.some(item => item.isCritical);
  const hasGuidelines = impressionItems?.some(item => item.guideline);
  const hasRecommendations = impressionItems?.some(item => item.recommendation);
  const hasLocked = impressionItems?.some(item => item.isLocked);

  // Compact preference label map
  const prefLabels = {
    structure: { bulleted: 'Bulleted', numbered: 'Numbered', paragraph: 'Paragraph' },
    verbosity: { low: 'Low', medium: 'Medium', high: 'High' },
    hedging: { low: 'Low', medium: 'Medium', high: 'High' },
    normalFindings: { include: 'Include', exclude: 'Exclude' },
    recommendations: { imaging: 'Imaging', clinical: 'Clinical', imaging_clinical: 'Both', none: 'Off' },
  };

  return (
    <div className="qa-seg-diag">
      <button
        className={`qa-seg-diag__toggle ${hasCritical ? 'qa-seg-diag__toggle--warn' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="qa-seg-diag__icon">{expanded ? '▾' : '▸'}</span>
        IG Details
        <span className="qa-seg-diag__count">
          {impressionItems?.length || 0} item{(impressionItems?.length || 0) !== 1 ? 's' : ''}
          {hasCritical && <span className="qa-ig-detail__critical-flag">🔴 critical</span>}
          {hasLocked && <span className="qa-ig-detail__locked-flag">🔒</span>}
        </span>
      </button>
      {expanded && (
        <div className="qa-seg-diag__body">
          {/* ── Impression Items ── */}
          <div className="qa-seg-diag__section-label">Impression Items</div>

          {impressionItems?.length > 0 && (
            <div className="qa-ig-items">
              {impressionItems.map((item, i) => (
                <div key={i} className={`qa-ig-item ${item.isCritical ? 'qa-ig-item--critical' : ''}`}>
                  {/* Item text */}
                  <div className="qa-ig-item__text">
                    {item.text}
                  </div>

                  {/* Badges row */}
                  <div className="qa-ig-item__badges">
                    {item.isCritical && (
                      <span className="qa-ig-badge qa-ig-badge--critical">🔴 Critical</span>
                    )}
                    {item.isLocked && (
                      <span className="qa-ig-badge qa-ig-badge--locked">🔒 Locked</span>
                    )}
                    {item.guideline && (
                      <span className="qa-ig-badge qa-ig-badge--guideline" title={item.guideline}>
                        📋 {item.guideline.length > 60 ? item.guideline.slice(0, 57) + '…' : item.guideline}
                      </span>
                    )}
                    {item.recommendation && (
                      <span className="qa-ig-badge qa-ig-badge--recommendation" title={item.recommendation}>
                        📌 {item.recommendation.length > 60 ? item.recommendation.slice(0, 57) + '…' : item.recommendation}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Preferences Snapshot ── */}
          {preferences && (
            <>
              <div className="qa-seg-diag__section-label qa-seg-diag__section-label--after">Preferences</div>
              <div className="qa-ig-prefs">
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Structure</span>
                  <span className="qa-ig-pref__value">{prefLabels.structure[preferences.structure] || preferences.structure}</span>
                </span>
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Verbosity</span>
                  <span className="qa-ig-pref__value">{prefLabels.verbosity[preferences.verbosity] || preferences.verbosity}</span>
                </span>
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Hedging</span>
                  <span className="qa-ig-pref__value">{prefLabels.hedging[preferences.hedging] || preferences.hedging}</span>
                </span>
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Normals</span>
                  <span className="qa-ig-pref__value">{prefLabels.normalFindings[preferences.normalFindings] || preferences.normalFindings}</span>
                </span>
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Acronyms</span>
                  <span className="qa-ig-pref__value">{preferences.acronymExpansion ? 'Expand' : 'As-is'}</span>
                </span>
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Guidelines</span>
                  <span className="qa-ig-pref__value">{preferences.guidelines ? 'On' : 'Off'}</span>
                </span>
                <span className="qa-ig-pref">
                  <span className="qa-ig-pref__label">Recs</span>
                  <span className="qa-ig-pref__value">{prefLabels.recommendations[preferences.recommendations] || preferences.recommendations}</span>
                </span>
              </div>
            </>
          )}

          {/* ── Raw Response ── */}
          {rawResponse && (
            <>
              <div className="qa-seg-diag__section-label qa-seg-diag__section-label--after">Raw Response</div>
              <pre className="qa-pass2-raw">{rawResponse}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function QALogPanel() {
  const qaLog = useReportStore((s) => s.qaLog);
  const qaLogCollapsed = useReportStore((s) => s.qaLogCollapsed);
  const toggleQALog = useReportStore((s) => s.toggleQALog);
  const tokenUsage = useReportStore((s) => s.tokenUsage);
  const [activeFilters, setActiveFilters] = useState(new Set(FILTER_TYPES));
  const [tokenFooterCollapsed, setTokenFooterCollapsed] = useState(false);
  const bodyRef = useRef(null);

  // Auto-scroll to newest entry
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [qaLog]);

  const toggleFilter = (filter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  // Compute which entry types pass the active filters
  const allowedTypes = new Set();
  for (const filter of activeFilters) {
    for (const type of (FILTER_MAP[filter] || [])) {
      allowedTypes.add(type);
    }
  }

  const filteredLog = qaLog.filter((entry) => allowedTypes.has(entry.type));

  return (
    <div
      className={`qa-panel ${qaLogCollapsed ? 'qa-panel--collapsed' : ''}`}
      id="qa-log-panel"
    >
      {/* Header / Toggle */}
      <div className="qa-panel__header" onClick={toggleQALog}>
        <div className="qa-panel__title">
          {qaLogCollapsed ? 'QA' : 'QA Log'}
          {qaLog.length > 0 && (
            <span className="qa-panel__count">{qaLog.length}</span>
          )}
        </div>
        <div className="qa-panel__toggle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={qaLogCollapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
          </svg>
        </div>
      </div>

      {/* Filter chips + Log body (visible when expanded) */}
      {!qaLogCollapsed && (
        <>
          <div className="qa-panel__filters">
            {FILTER_TYPES.map((type) => (
              <span
                key={type}
                className={`qa-panel__filter-chip ${activeFilters.has(type) ? 'qa-panel__filter-chip--active' : ''}`}
                onClick={() => toggleFilter(type)}
              >
                {type}
              </span>
            ))}
          </div>

          {/* Log body */}
          <div className="qa-panel__body" ref={bodyRef}>
            {filteredLog.length === 0 ? (
              <div className="qa-panel__empty">
                <div className="qa-panel__empty-icon">📋</div>
                <div>Events will appear here<br />during dictation</div>
              </div>
            ) : (
              filteredLog.map((entry) => (
                <div key={entry.id} className={`qa-log-entry ${entry.type === 'ASR_ERROR' ? 'qa-log-entry--error' : ''}`}>
                  <div className="qa-log-entry__header">
                    <TypeBadge type={entry.type} />
                    <span className="qa-log-entry__time">{formatTime(entry.timestamp)}</span>
                    {(entry.type === 'PASS1' || entry.type === 'PASS2A' || entry.type === 'PASS2B' || entry.type === 'IMPRESSION') && <LatencyBadge ms={entry.latencyMs} />}
                    {(entry.type === 'PASS1' || entry.type === 'PASS2A' || entry.type === 'PASS2B' || entry.type === 'IMPRESSION') && (
                      <TokenBadge inputTokens={entry.inputTokens} outputTokens={entry.outputTokens} />
                    )}
                  </div>
                  <div className="qa-log-entry__body">
                    {/* ASR entries: raw → corrected */}
                    {(entry.type === 'ASR' || entry.type === 'ASR_ERROR') && entry.raw && (
                      <div className="qa-log-entry__text">
                        {entry.autocorrected && entry.corrected ? (
                          <>
                            <span className="qa-log-entry__raw">{entry.raw}</span>
                            <span className="qa-log-entry__arrow">→</span>
                            <span className="qa-log-entry__corrected">{entry.corrected}</span>
                          </>
                        ) : (
                          <span>{entry.raw}</span>
                        )}
                      </div>
                    )}

                    {/* PASS1 entries: show full context window + result */}
                    {entry.type === 'PASS1' && (
                      <div className="qa-log-entry__pass1">
                        {/* Context window: preceding | chunk | following */}
                        <div className="qa-log-entry__context">
                          {entry.precedingText && (
                            <span className="qa-log-entry__ctx-dim">{entry.precedingText} </span>
                          )}
                          <span className="qa-log-entry__ctx-highlight">{entry.chunkText || entry.raw}</span>
                          {entry.followingText && (
                            <span className="qa-log-entry__ctx-dim"> {entry.followingText}</span>
                          )}
                        </div>
                        {/* Result */}
                        {entry.corrected && entry.corrected !== '(no change)' && (
                          <div className="qa-log-entry__sentences">
                            <span className="qa-log-entry__arrow">→</span>
                            <span className="qa-log-entry__corrected">{entry.corrected}</span>
                          </div>
                        )}
                        {entry.corrected === '(no change)' && (
                          <div className="qa-log-entry__no-change">
                            <span className="qa-log-entry__label">✓ No change</span>
                          </div>
                        )}
                        {entry.warnings?.length > 0 && (
                          <div className="qa-log-entry__warnings">
                            {entry.warnings.map((w, i) => (
                              <span key={i} className="qa-log-entry__warning">{w}</span>
                            ))}
                          </div>
                        )}
                        <SegmentDiagnostics
                          snapshot={entry.segmentSnapshot}
                          blockDetails={entry.blockDetails}
                          afterData={entry.afterData}
                        />
                      </div>
                    )}

                    {/* PASS2A entries: finding placement summary */}
                    {entry.type === 'PASS2A' && (
                      <div className="qa-log-entry__pass1">
                        <div className="qa-log-entry__text">
                          <span className="qa-log-entry__label">
                            {entry.segmentCount} segment{entry.segmentCount !== 1 ? 's' : ''} →{' '}
                            {entry.operationCount} placement{entry.operationCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {entry.operations?.length > 0 && (
                          <div className="qa-log-entry__sentences">
                            {entry.operations.slice(0, 5).map((op, i) => {
                              const isNA = op.isNA || op.targetSectionShortId === 'NA';
                              return (
                                <span
                                  key={i}
                                  className={`qa-log-entry__corrected ${isNA ? 'qa-log-entry__na-op' : ''}`}
                                  style={{ fontSize: 11 }}
                                >
                                  {op.sourceSegmentShortId} → {op.targetSectionShortId}
                                  {isNA && (
                                    <span className="qa-log-entry__na-label">(Segment discarded)</span>
                                  )}
                                </span>
                              );
                            })}
                            {entry.operations.length > 5 && (
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                                +{entry.operations.length - 5} more…
                              </span>
                            )}
                          </div>
                        )}
                        {entry.warnings?.length > 0 && (
                          <div className="qa-log-entry__warnings">
                            {entry.warnings.map((w, i) => (
                              <span key={i} className="qa-log-entry__warning">{w}</span>
                            ))}
                          </div>
                        )}
                        <Pass2ADetails
                          rawResponse={entry.rawResponse}
                          segmentMap={entry.segmentMap}
                          sectionMap={entry.sectionMap}
                        />
                      </div>
                    )}

                    {/* PASS2B entries: normal processing summary */}
                    {entry.type === 'PASS2B' && (
                      <div className="qa-log-entry__pass1">
                        <div className="qa-log-entry__text">
                          <span className="qa-log-entry__label">
                            {entry.normalCount} normal{entry.normalCount !== 1 ? 's' : ''} →{' '}
                            <span style={{ color: 'var(--muted)' }}>{entry.keepCount}K</span>{' '}
                            <span style={{ color: 'var(--warn)' }}>{entry.suppressCount}S</span>{' '}
                            <span style={{ color: 'var(--accent)' }}>{entry.editCount}E</span>
                          </span>
                        </div>
                        {entry.warnings?.length > 0 && (
                          <div className="qa-log-entry__warnings">
                            {entry.warnings.map((w, i) => (
                              <span key={i} className="qa-log-entry__warning">{w}</span>
                            ))}
                          </div>
                        )}
                        <Pass2BDetails
                          rawResponse={entry.rawResponse}
                          normalMap={entry.normalMap}
                          findingMap={entry.findingMap}
                          normalDecisions={entry.normalDecisions}
                        />
                      </div>
                    )}

                    {/* IMPRESSION entries: summary + expandable details */}
                    {entry.type === 'IMPRESSION' && (
                      <div className="qa-log-entry__pass1">
                        <div className="qa-log-entry__text">
                          <span className="qa-log-entry__label">
                            {entry.contentBoxCount} content box{entry.contentBoxCount !== 1 ? 'es' : ''} →{' '}
                            {entry.impressionItemCount} impression item{entry.impressionItemCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {entry.warnings?.length > 0 && (
                          <div className="qa-log-entry__warnings">
                            {entry.warnings.map((w, i) => (
                              <span key={i} className="qa-log-entry__warning">{w}</span>
                            ))}
                          </div>
                        )}
                        <ImpressionDetails
                          impressionItems={entry.impressionItems}
                          preferences={entry.preferences}
                          rawResponse={entry.rawResponse}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Token Usage Totals Footer */}
          {(() => {
            const totalInput = (tokenUsage.pass1.inputTokens + tokenUsage.pass2a.inputTokens + tokenUsage.pass2b.inputTokens + tokenUsage.impression.inputTokens);
            const totalOutput = (tokenUsage.pass1.outputTokens + tokenUsage.pass2a.outputTokens + tokenUsage.pass2b.outputTokens + tokenUsage.impression.outputTokens);
            if (totalInput === 0 && totalOutput === 0) return null;
            return (
              <div className={`qa-token-footer ${tokenFooterCollapsed ? 'qa-token-footer--collapsed' : ''}`}>
                <div
                  className="qa-token-footer__header"
                  onClick={() => setTokenFooterCollapsed(!tokenFooterCollapsed)}
                >
                  <span className="qa-token-footer__icon">{tokenFooterCollapsed ? '▸' : '▾'}</span>
                  <span className="qa-token-footer__title">Token Totals</span>
                  <span className="qa-token-footer__grand-total">
                    {totalInput.toLocaleString()} in · {totalOutput.toLocaleString()} out
                  </span>
                </div>
                {!tokenFooterCollapsed && (
                  <table className="qa-token-footer__table">
                    <thead>
                      <tr>
                        <th>Operation</th>
                        <th>Input</th>
                        <th>Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Pass 1</td>
                        <td>{tokenUsage.pass1.inputTokens.toLocaleString()}</td>
                        <td>{tokenUsage.pass1.outputTokens.toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td>Pass 2A</td>
                        <td>{tokenUsage.pass2a.inputTokens.toLocaleString()}</td>
                        <td>{tokenUsage.pass2a.outputTokens.toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td>Pass 2B</td>
                        <td>{tokenUsage.pass2b.inputTokens.toLocaleString()}</td>
                        <td>{tokenUsage.pass2b.outputTokens.toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td>Impression</td>
                        <td>{tokenUsage.impression.inputTokens.toLocaleString()}</td>
                        <td>{tokenUsage.impression.outputTokens.toLocaleString()}</td>
                      </tr>
                      <tr className="qa-token-footer__total-row">
                        <td>Total</td>
                        <td>{totalInput.toLocaleString()}</td>
                        <td>{totalOutput.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

