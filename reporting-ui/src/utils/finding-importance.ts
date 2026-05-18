/**
 * finding-importance.ts — Scoring, ranking, and filtering utilities for
 * individual report findings displayed in the left-rail prior study cards.
 *
 * Scoring rules (finalized):
 *   Baseline:               +1
 *   severity = critical:    +5
 *   trend = progressing:    +3
 *   trend = new:            +2
 *   technique = true:       −2  (scan quality, not pathology)
 *   incidental = true:      −1
 *   trend = resolved:       −1
 *
 * Findings are sorted by score descending; ties preserve original order (stable sort).
 */

import type { ExtractedFinding } from '../types/api';

// ── Scoring ────────────────────────────────────────────────────────────────

/** Compute a numeric importance score for an individual finding. */
export function computeFindingScore(finding: ExtractedFinding): number {
  let score = 1; // baseline

  // Severity
  if (finding.severity === 'critical') score += 5;

  // Trend
  if (finding.trend === 'progressing') score += 3;
  else if (finding.trend === 'new') score += 2;
  else if (finding.trend === 'resolved') score -= 1;

  // Technique (scan quality, not pathology — ranked lower)
  if (finding.technique) score -= 2;

  // Incidental
  if (finding.incidental) score -= 1;

  return score;
}

// ── Ranking ────────────────────────────────────────────────────────────────

/** Sort findings by importance score descending. Stable sort — ties keep original order. */
export function rankFindings(findings: ExtractedFinding[]): ExtractedFinding[] {
  // Build indexed pairs to preserve original order for tie-breaking
  const indexed = findings.map((f, i) => ({ finding: f, index: i }));
  indexed.sort((a, b) => {
    const diff = computeFindingScore(b.finding) - computeFindingScore(a.finding);
    return diff !== 0 ? diff : a.index - b.index;
  });
  return indexed.map((item) => item.finding);
}

// ── Filtering for Card Summary ─────────────────────────────────────────────

/**
 * Apply the ≥5 threshold rule:
 * If total finding count is ≥ 5, hide incidental and resolved findings
 * from the quick summary list to reduce noise.
 */
export function filterForCardSummary(findings: ExtractedFinding[]): ExtractedFinding[] {
  if (findings.length < 5) return findings;
  return findings.filter((f) => !f.incidental && f.trend !== 'resolved');
}

// ── Chip Building ──────────────────────────────────────────────────────────

/**
 * Build display chip labels for a finding based on its LLM-assigned labels.
 * Chips are returned in score-impact order (highest-impact first) to match
 * the executive summary's CHIP_STYLES color map.
 *
 * "CRITICAL" is now derived from the relevancy score (SAF ≥ 4) rather
 * than the LLM severity label. "INCIDENTAL" chips are no longer generated.
 */
export function buildFindingChips(finding: ExtractedFinding): string[] {
  const chips: string[] = [];

  // Critical is now score-based: SAF ≥ 4 = Critical
  if ((finding as any).relevancyScore?.SAF >= 4) {
    chips.push('CRITICAL');
  } else if (finding.severity === 'critical') {
    // Fallback for findings without relevancy scores
    chips.push('CRITICAL');
  }

  // Trend chips — ordered by score impact
  switch (finding.trend) {
    case 'progressing': chips.push('PROGRESSING'); break;
    case 'new':         chips.push('NEW');         break;
    case 'stable':      chips.push('STABLE');      break;
    case 'improving':   chips.push('IMPROVING');   break;
    case 'resolved':    chips.push('RESOLVED');    break;
    // null → no chip
  }

  // INCIDENTAL chip removed — no longer displayed

  return chips;
}

// ── Chip-Based Scoring (for ExecutiveFinding) ──────────────────────────────

/**
 * Score weight lookup for pre-computed chip labels.
 * Uses the same point values as computeFindingScore above.
 */
const CHIP_SCORE_WEIGHTS: Record<string, number> = {
  CRITICAL:    +5,
  PROGRESSING: +3,
  NEW:         +2,
  INCIDENTAL:  -1,
  RESOLVED:    -1,
  // STABLE, IMPROVING — no modifier (0)
};

/**
 * Compute an importance score from a pre-computed chips array.
 * Used by the executive summary where findings already have chips[]
 * instead of typed severity/trend fields.
 */
export function computeChipScore(chips: string[]): number {
  let score = 1; // baseline
  for (const chip of chips) {
    score += CHIP_SCORE_WEIGHTS[chip] ?? 0;
  }
  return score;
}
