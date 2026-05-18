/**
 * relevance-scorer.ts — Multi-factor relevance scoring engine.
 *
 * Computes a 0–100% relevance score for each prior study relative to
 * a current exam by evaluating five independent scoring dimensions:
 *   1. Modality match (0–3 pts)
 *   2. Body region overlap (0–5 pts, averaged across current regions)
 *   3. Recency / temporal proximity (0–4 pts, linearly tapered)
 *   4. Angiographic status match (+3 match, -2 mismatch)
 *   5. Laterality match (+2 exact, +1 bilateral partial, -2 mismatch)
 *
 * The relevance percentage is totalScore / maxPossible, where maxPossible
 * is determined solely by the current study's label profile. A study
 * scoring ≥60% is classified as "relevant" to the current exam.
 *
 * Body region scoring uses a four-tier hierarchy:
 *   Tier 1: Exact raw term match (5 pts) — e.g., "head"↔"head"
 *   Tier 2: Same canonical region (4 pts) — e.g., "head"↔"brain" both → "Head"
 *   Tier 3: Close anatomical adjacency (2 pts) — defined pairs
 *   Tier 4: Weak anatomical adjacency (1 pt) — defined pairs
 *
 * For multi-region current studies, each current body region is scored
 * independently against ALL prior body regions (without consumption),
 * and the AVERAGE of the per-region best scores is the body region score.
 */

import type {
  StudyLabels,
  CurrentStudy,
  Study,
  RelevanceResult,
  RelevanceBreakdown,
} from '../models/types';
import { loadCanonicalRegionMap } from './study-labeler';

// ── Modality Constants ────────────────────────────────────────────────────

/**
 * Modalities that are generally "useful" for review even when they don't
 * match the current study's modality. CT and MR almost always convey
 * rich diagnostic information regardless of what is being compared.
 */
const USEFUL_MODALITIES = new Set(['CT', 'MR']);

/**
 * Modalities that form a "related family" — FL (fluoroscopy) and IR
 * (interventional radiology) overlap significantly in clinical context.
 */
const RELATED_MODALITY_FAMILY = new Set(['FL', 'IR']);

// ── Recency Breakpoints (in days) ─────────────────────────────────────────

const RECENCY_WEEK = 7;
const RECENCY_MONTH = 30.44;        // 365.25 / 12
const RECENCY_SIX_MONTHS = 182.625; // 365.25 / 2
const RECENCY_YEAR = 365.25;
const RECENCY_TWO_YEARS = 730.5;    // 365.25 * 2

// ── Oncology Context Detection ────────────────────────────────────────────

/**
 * Keywords that, when present in the clinical indication / reason for study,
 * signal an oncology context. When detected, "Whole Body" prior studies
 * are upgraded from weak adjacency (1 pt) to canonical-equivalent (4 pts)
 * because whole-body staging scans are highly relevant for cancer patients.
 *
 * All comparisons are case-insensitive.
 */
const ONCOLOGY_KEYWORDS: string[] = [
  'cancer', 'carcinoma', 'tumor', 'tumour', 'neoplasm', 'neoplastic',
  'malignancy', 'malignant', 'metastasis', 'metastases', 'metastatic',
  'oncology', 'lymphoma', 'leukemia', 'leukaemia', 'sarcoma',
  'staging', 'restaging', 'recurrence',
];

/** Pre-compiled regex for efficient oncology keyword detection */
const ONCOLOGY_REGEX = new RegExp(
  `\\b(?:${ONCOLOGY_KEYWORDS.join('|')})\\b`,
  'i',
);

// ── Close Adjacency ───────────────────────────────────────────────────────
// Symmetric pairs of canonical body regions that are anatomically close
// enough that imaging overlap is substantial. Award: 2 pts.

const CLOSE_ADJACENCY_PAIRS: [string, string][] = [
  ['Head', 'Face'],
  ['Neck', 'Cervical'],
  ['Chest', 'Breast'],
  ['Chest', 'Thoracic'],
  ['Chest', 'Arm'],
  ['Abdomen', 'Thoracic'],
  ['Abdomen', 'Pelvis'],
  ['Pelvis', 'Lumbar'],
  ['Pelvis', 'Leg'],
  ['Forearm', 'Hand'],
  ['Calf', 'Foot'],
  ['Spine', 'Cervical'],
  ['Spine', 'Thoracic'],
  ['Spine', 'Lumbar'],
  // Added during design review: spine sub-region junctions
  ['Cervical', 'Thoracic'],
  ['Thoracic', 'Lumbar'],
];

/** Precomputed close adjacency lookup: region → Set of close neighbors */
const CLOSE_ADJACENCY = new Map<string, Set<string>>();
for (const [a, b] of CLOSE_ADJACENCY_PAIRS) {
  if (!CLOSE_ADJACENCY.has(a)) CLOSE_ADJACENCY.set(a, new Set());
  if (!CLOSE_ADJACENCY.has(b)) CLOSE_ADJACENCY.set(b, new Set());
  CLOSE_ADJACENCY.get(a)!.add(b);
  CLOSE_ADJACENCY.get(b)!.add(a);
}

// ── Weak Adjacency ────────────────────────────────────────────────────────
// Regions with minimal but nonzero imaging overlap. Award: 1 pt.
// Note: "Whole" is weakly adjacent to ALL other regions.

const WEAK_ADJACENCY_RAW: Record<string, string[]> = {
  Head:      ['Neck', 'Cervical', 'Whole'],
  Face:      ['Neck', 'Cervical', 'Whole'],
  Neck:      ['Head', 'Face', 'Spine', 'Chest', 'Whole'],
  Cervical:  ['Head', 'Face', 'Chest', 'Whole'],
  Thoracic:  ['Pelvis', 'Whole'],
  Lumbar:    ['Abdomen', 'Whole'],
  Spine:     ['Neck', 'Chest', 'Abdomen', 'Pelvis', 'Whole'],
  Chest:     ['Neck', 'Cervical', 'Spine', 'Abdomen', 'Whole'],
  // "arm" intentionally omitted — Chest↔Arm is close adjacency
  Breast:    ['Arm', 'Whole'],
  Abdomen:   ['Lumbar', 'Spine', 'Chest', 'Whole'],
  Pelvis:    ['Thoracic', 'Spine', 'Whole'],
  Arm:       ['Breast', 'Forearm', 'Hand', 'Whole'],
  Forearm:   ['Arm', 'Whole'],
  Hand:      ['Arm', 'Whole'],
  Leg:       ['Calf', 'Foot', 'Whole'],
  Calf:      ['Leg', 'Whole'],
  Foot:      ['Leg', 'Whole'],
  Mass:      ['Whole'],
  Soft:      ['Whole'],
  Bone:      ['Whole'],
  Joint:     ['Whole'],
  // Whole is weakly adjacent to everything — handled specially in lookup
};

/** Precomputed weak adjacency lookup: region → Set of weak neighbors */
const WEAK_ADJACENCY = new Map<string, Set<string>>();
for (const [region, neighbors] of Object.entries(WEAK_ADJACENCY_RAW)) {
  WEAK_ADJACENCY.set(region, new Set(neighbors));
}

/** All known canonical region names (for the Whole↔everything rule) */
const ALL_CANONICAL_REGIONS = new Set([
  'Head', 'Face', 'Neck', 'Cervical', 'Thoracic', 'Lumbar', 'Spine',
  'Chest', 'Breast', 'Abdomen', 'Pelvis', 'Arm', 'Forearm', 'Hand',
  'Leg', 'Calf', 'Foot', 'Mass', 'Soft', 'Bone', 'Joint', 'Whole',
]);

// ── Scoring Functions ─────────────────────────────────────────────────────

/**
 * Score modality match between current and prior study.
 * Uses allModalities for best-match comparison.
 *
 * Scoring: 3 (exact match), 2 (useful CT/MR or FL/IR family), 0 (other)
 */
function scoreModality(currentLabels: StudyLabels, priorLabels: StudyLabels): number {
  const currentMods = new Set(currentLabels.allModalities);
  const priorMods = priorLabels.allModalities;

  // Check for any exact modality match between the two sets
  for (const pm of priorMods) {
    if (currentMods.has(pm)) return 3;
  }

  // No exact match — check if prior has a "useful" modality (CT or MR)
  for (const pm of priorMods) {
    if (USEFUL_MODALITIES.has(pm)) return 2;
  }

  // Check FL/IR related family match
  const currentHasFamily = currentLabels.allModalities.some(m => RELATED_MODALITY_FAMILY.has(m));
  const priorHasFamily = priorMods.some(m => RELATED_MODALITY_FAMILY.has(m));
  if (currentHasFamily && priorHasFamily) return 2;

  return 0;
}

/**
 * Score body region overlap between current and prior study.
 *
 * For each body region in the current study, finds the best-scoring match
 * against all body regions in the prior study, using a four-tier hierarchy.
 * Returns the AVERAGE of per-region best scores.
 *
 * Prior study regions are NOT consumed — a single prior region can
 * match multiple current regions.
 *
 * @param oncologyContext — When true, upgrades "Whole" body weak
 *   adjacency matches from 1 pt to 4 pts (canonical-equivalent),
 *   reflecting the high relevance of whole-body staging scans in
 *   cancer patients.
 */
function scoreBodyRegion(
  currentLabels: StudyLabels,
  priorLabels: StudyLabels,
  oncologyContext: boolean = false,
): number {
  const canonMap = loadCanonicalRegionMap();

  const currentRaw = currentLabels.rawBodyRegions;
  const priorRaw = priorLabels.rawBodyRegions;

  // Edge case: no body regions on the current study
  if (currentRaw.length === 0) return 0;

  // Precompute prior canonical regions for tier 2–4 comparisons
  const priorCanonicals = priorRaw.map(r => canonMap.get(r.toLowerCase()) ?? titleCase(r));

  let totalScore = 0;

  for (const currentRawTerm of currentRaw) {
    const currentLower = currentRawTerm.toLowerCase();
    const currentCanonical = canonMap.get(currentLower) ?? titleCase(currentRawTerm);

    let bestScore = 0;

    for (let j = 0; j < priorRaw.length; j++) {
      const priorLower = priorRaw[j].toLowerCase();
      const priorCanonical = priorCanonicals[j];

      // Tier 1: Exact raw term match (5 pts)
      if (currentLower === priorLower) {
        bestScore = 5;
        break; // Can't do better than 5
      }

      // Tier 2: Same canonical region (4 pts)
      if (currentCanonical === priorCanonical && bestScore < 4) {
        bestScore = 4;
        continue; // Keep checking for possible raw match
      }

      // Tier 3: Close adjacency (2 pts)
      if (bestScore < 2) {
        const closeNeighbors = CLOSE_ADJACENCY.get(currentCanonical);
        if (closeNeighbors?.has(priorCanonical)) {
          bestScore = 2;
        }
      }

      // Tier 4: Weak adjacency (1 pt) — or 4 pts for Whole under oncology
      if (bestScore < (oncologyContext ? 4 : 1)) {
        if (isWeaklyAdjacent(currentCanonical, priorCanonical)) {
          // Oncology upgrade: "Whole" + oncology context → 4 pts
          if (oncologyContext && (priorCanonical === 'Whole' || currentCanonical === 'Whole')) {
            bestScore = 4;
          } else if (bestScore < 1) {
            bestScore = 1;
          }
        }
      }
    }

    totalScore += bestScore;
  }

  // Return average score across all current body regions
  return totalScore / currentRaw.length;
}

/**
 * Check weak adjacency, including the special "Whole" rule.
 * Whole is weakly adjacent to ALL canonical regions.
 */
function isWeaklyAdjacent(regionA: string, regionB: string): boolean {
  // Whole ↔ any canonical region
  if (regionA === 'Whole' && ALL_CANONICAL_REGIONS.has(regionB)) return true;
  if (regionB === 'Whole' && ALL_CANONICAL_REGIONS.has(regionA)) return true;

  // Standard weak adjacency lookup
  const neighbors = WEAK_ADJACENCY.get(regionA);
  return neighbors?.has(regionB) ?? false;
}

/** Title-case a raw term for fallback canonical name */
function titleCase(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

/**
 * Score recency using linear interpolation between breakpoints.
 *
 * The score tapers linearly between defined breakpoints:
 *   ≤7 days:      4.00
 *   7–30.44 days:  taper 4→3
 *   30.44–182.63:  taper 3→2
 *   182.63–365.25: taper 2→1
 *   365.25–730.5:  taper 1→0
 *   >730.5 days:   0.00
 */
function scoreRecency(currentDateTime: string, priorDateTime: string): number {
  const elapsedDays = computeElapsedDays(currentDateTime, priorDateTime);

  // Prior study is in the future relative to current — shouldn't happen,
  // but handle gracefully by awarding max recency
  if (elapsedDays <= 0) return 4;

  if (elapsedDays <= RECENCY_WEEK) return 4;
  if (elapsedDays <= RECENCY_MONTH) return linearTaper(elapsedDays, RECENCY_WEEK, RECENCY_MONTH, 4, 3);
  if (elapsedDays <= RECENCY_SIX_MONTHS) return linearTaper(elapsedDays, RECENCY_MONTH, RECENCY_SIX_MONTHS, 3, 2);
  if (elapsedDays <= RECENCY_YEAR) return linearTaper(elapsedDays, RECENCY_SIX_MONTHS, RECENCY_YEAR, 2, 1);
  if (elapsedDays <= RECENCY_TWO_YEARS) return linearTaper(elapsedDays, RECENCY_YEAR, RECENCY_TWO_YEARS, 1, 0);

  return 0;
}

/**
 * Linear interpolation between two breakpoints.
 * Returns a value between endScore and startScore based on position
 * of elapsed days between startDays and endDays.
 */
function linearTaper(
  elapsed: number,
  startDays: number,
  endDays: number,
  startScore: number,
  endScore: number,
): number {
  const fraction = (elapsed - startDays) / (endDays - startDays);
  return startScore + fraction * (endScore - startScore);
}

/**
 * Compute elapsed days between two HL7 datetime strings (YYYYMMDDHHMMSS).
 * Returns the number of fractional days the prior study precedes the current.
 */
function computeElapsedDays(currentDateTime: string, priorDateTime: string): number {
  const currentMs = parseHL7DateTime(currentDateTime);
  const priorMs = parseHL7DateTime(priorDateTime);
  const MS_PER_DAY = 86_400_000;
  return (currentMs - priorMs) / MS_PER_DAY;
}

/**
 * Parse an HL7 datetime string (YYYYMMDDHHMMSS or YYYYMMDD) to epoch ms.
 * Handles variable-length HL7 timestamps gracefully.
 */
function parseHL7DateTime(dt: string): number {
  const year = parseInt(dt.substring(0, 4), 10);
  const month = parseInt(dt.substring(4, 6), 10) - 1; // JS months are 0-based
  const day = parseInt(dt.substring(6, 8), 10);
  const hour = dt.length >= 10 ? parseInt(dt.substring(8, 10), 10) : 0;
  const min = dt.length >= 12 ? parseInt(dt.substring(10, 12), 10) : 0;
  const sec = dt.length >= 14 ? parseInt(dt.substring(12, 14), 10) : 0;
  return new Date(year, month, day, hour, min, sec).getTime();
}

/**
 * Score angiographic status match.
 *
 * +3 when both studies are angiographic (strong relevance signal).
 * -2 when there is a mismatch (penalty for differing study intent).
 *  0 when neither study is angiographic (no effect on scoring).
 */
function scoreAngiography(currentLabels: StudyLabels, priorLabels: StudyLabels): number {
  const curAngio = currentLabels.isAngiographic;
  const priorAngio = priorLabels.isAngiographic;

  if (curAngio && priorAngio) return 3;
  if (curAngio !== priorAngio) return -2;
  return 0; // neither is angiographic
}

/**
 * Score laterality match.
 *
 * Rules (applied in priority order):
 *   - Either study has null laterality → 0 (laterality not applicable)
 *   - Exact match (L-L, R-R, B-B) → +2
 *   - Current is L or R, prior is Bilateral → +1 (partial relevance)
 *   - Current is Bilateral → 0 (prior laterality inconsequential)
 *   - Explicit L↔R mismatch → -2 (wrong side penalty)
 */
function scoreLaterality(currentLabels: StudyLabels, priorLabels: StudyLabels): number {
  const curLat = currentLabels.laterality;
  const priorLat = priorLabels.laterality;

  // No laterality on either side → no effect
  if (!curLat || !priorLat) return 0;

  // Exact match
  if (curLat === priorLat) return 2;

  // Current is L or R, prior is Bilateral → partial credit
  if ((curLat === 'left' || curLat === 'right') && priorLat === 'bilateral') return 1;

  // Current is Bilateral → prior laterality inconsequential
  if (curLat === 'bilateral') return 0;

  // Explicit Left↔Right mismatch
  if (
    (curLat === 'left' && priorLat === 'right') ||
    (curLat === 'right' && priorLat === 'left')
  ) {
    return -2;
  }

  return 0;
}

/**
 * Compute the maximum possible points for a given current study's labels.
 *
 * Base: 3 (modality) + 5 (body region) + 4 (recency) = 12
 * + 3 if current study is angiographic
 * + 2 if current study has non-null laterality
 */
function computeMaxPossible(currentLabels: StudyLabels): number {
  let max = 3 + 5 + 4; // modality + body region + recency = 12

  if (currentLabels.isAngiographic) max += 3;
  if (currentLabels.laterality) max += 2;

  return max;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compute the full relevance score for one prior study relative to
 * one current exam.
 *
 * @param currentStudy - The current exam being reported
 * @param priorStudy - A prior study from the patient's history
 * @returns Complete RelevanceResult with breakdown and percentage
 */
export function scoreRelevance(
  currentStudy: CurrentStudy,
  priorStudy: Study,
): RelevanceResult {
  const currentLabels = currentStudy.labels;
  const priorLabels = priorStudy.labels;

  // If the prior study has no labels (labeling failed), return zero score
  if (!priorLabels) {
    const maxPossible = computeMaxPossible(currentLabels);
    return {
      totalScore: 0,
      maxPossible,
      percentage: 0,
      isRelevant: false,
      breakdown: { modality: 0, bodyRegion: 0, recency: 0, angiography: 0, laterality: 0 },
    };
  }

  const breakdown: RelevanceBreakdown = {
    modality: scoreModality(currentLabels, priorLabels),
    bodyRegion: scoreBodyRegion(
      currentLabels,
      priorLabels,
      detectOncologyContext(currentStudy.clinicalIndication),
    ),
    recency: scoreRecency(currentStudy.studyDateTime, priorStudy.studyDateTime),
    angiography: scoreAngiography(currentLabels, priorLabels),
    laterality: scoreLaterality(currentLabels, priorLabels),
  };

  const totalScore =
    breakdown.modality +
    breakdown.bodyRegion +
    breakdown.recency +
    breakdown.angiography +
    breakdown.laterality;

  const maxPossible = computeMaxPossible(currentLabels);

  // Percentage stored to 2 decimal precision
  const rawPercentage = maxPossible > 0 ? totalScore / maxPossible : 0;
  const percentage = Math.round(rawPercentage * 10000) / 10000;

  return {
    totalScore,
    maxPossible,
    percentage,
    isRelevant: percentage >= 0.60,
    breakdown,
  };
}

/**
 * Pre-compute relevance scores for all current study × prior study pairs.
 *
 * @param currentStudies - All current exams for this encounter
 * @param priorStudies - All prior studies from the HL7 feed
 * @returns Nested map: currentStudyId → priorSequence → RelevanceResult
 */
export function computeAllRelevanceScores(
  currentStudies: CurrentStudy[],
  priorStudies: Study[],
): Record<string, Record<number, RelevanceResult>> {
  const result: Record<string, Record<number, RelevanceResult>> = {};

  for (const current of currentStudies) {
    const priorScores: Record<number, RelevanceResult> = {};

    for (const prior of priorStudies) {
      priorScores[prior.sequence] = scoreRelevance(current, prior);
    }

    result[current.currentStudyId] = priorScores;
  }

  return result;
}

// ── Oncology Context ──────────────────────────────────────────────────────

/**
 * Detect whether a clinical indication contains oncology-related keywords
 * that signal a cancer workup. When detected, the scoring engine upgrades
 * "Whole Body" prior study matches from weak adjacency (1 pt) to
 * canonical-equivalent (4 pts).
 *
 * @param clinicalIndication - The reason-for-study text from the current exam
 * @returns True if any oncology keyword is found
 */
export function detectOncologyContext(clinicalIndication: string | undefined | null): boolean {
  if (!clinicalIndication) return false;
  return ONCOLOGY_REGEX.test(clinicalIndication);
}
