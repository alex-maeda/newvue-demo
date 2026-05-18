/**
 * Client-side relevance utilities.
 *
 * Relevance scoring is computed SERVER-SIDE during patient load.
 * These functions provide convenient lookups into the pre-computed
 * relevance scores map delivered in the API response.
 *
 * For the scoring algorithm details, see:
 *   server/src/services/relevance-scorer.ts
 */

import type { RelevanceResult } from '../types/api';

// ── Pre-computed Score Lookups ─────────────────────────────────────────────

/**
 * Look up the pre-computed relevance result for a specific
 * current study × prior study pair.
 *
 * @param currentStudyId - The ID of the selected current exam
 * @param priorSequence - The OBR sequence number of the prior study
 * @param scores - The pre-computed relevance scores map from the API
 * @returns The RelevanceResult, or null if not found
 */
export function getRelevanceResult(
  currentStudyId: string | undefined,
  priorSequence: number,
  scores: Record<string, Record<number, RelevanceResult>> | undefined,
): RelevanceResult | null {
  if (!currentStudyId || !scores) return null;
  return scores[currentStudyId]?.[priorSequence] ?? null;
}

/**
 * Check whether a prior study is relevant to the selected current exam.
 *
 * This is the primary function used by ContextRail and PriorStudyCard
 * to determine whether to show the "Relevant" chip.
 *
 * @param currentStudyId - The ID of the selected current exam
 * @param priorSequence - The OBR sequence number of the prior study
 * @param scores - The pre-computed relevance scores map from the API
 * @returns true if the prior study scores ≥50% relevance
 */
export function isStudyRelevant(
  currentStudyId: string | undefined,
  priorSequence: number,
  scores: Record<string, Record<number, RelevanceResult>> | undefined,
): boolean {
  const result = getRelevanceResult(currentStudyId, priorSequence, scores);
  return result?.isRelevant ?? false;
}

/**
 * Get the display-ready relevance percentage for a prior study.
 * Returns the percentage as a whole number (0–100), or null if unavailable.
 *
 * @param currentStudyId - The ID of the selected current exam
 * @param priorSequence - The OBR sequence number of the prior study
 * @param scores - The pre-computed relevance scores map from the API
 * @returns Rounded percentage (e.g., 83), or null
 */
export function getRelevancePercentage(
  currentStudyId: string | undefined,
  priorSequence: number,
  scores: Record<string, Record<number, RelevanceResult>> | undefined,
): number | null {
  const result = getRelevanceResult(currentStudyId, priorSequence, scores);
  if (!result) return null;
  return Math.round(result.percentage * 100);
}

/**
 * Collect the top-N relevant prior studies, ranked by relevance score.
 * Ties are broken by recency (earlier studyDateTime = more recent = higher priority).
 *
 * @param currentStudyId - The ID of the selected current exam
 * @param scores - The pre-computed relevance scores map from the API
 * @param n - Maximum number of results to return (default: 5)
 * @returns Array of [priorSequence, RelevanceResult] sorted by score descending
 */
export function getTopRelevantStudies(
  currentStudyId: string | undefined,
  scores: Record<string, Record<number, RelevanceResult>> | undefined,
  n: number = 5,
): [number, RelevanceResult][] {
  if (!currentStudyId || !scores) return [];

  const priorScores = scores[currentStudyId];
  if (!priorScores) return [];

  return Object.entries(priorScores)
    .filter(([, result]) => result.isRelevant)
    .map(([seq, result]) => [parseInt(seq, 10), result] as [number, RelevanceResult])
    .sort((a, b) => {
      // Primary sort: relevance score descending
      const scoreDiff = b[1].percentage - a[1].percentage;
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
      // Tiebreaker: recency (handled by prior study order — lower sequence = older)
      // We want more recent studies first, so higher sequence wins
      return b[0] - a[0];
    })
    .slice(0, n);
}
