/**
 * recommendation-tracker.ts — Deterministic recommendation fulfillment engine.
 *
 * Compares follow-up recommendations from prior report findings against
 * the patient's full study timeline to determine fulfillment status.
 * This is 100% deterministic — no LLM involved.
 *
 * Fulfillment logic:
 *   1. Extract recommendations from all Tier 1 analyses
 *   2. For each recommendation, search the patient's study timeline for
 *      a matching follow-up study performed AFTER the recommendation date
 *   3. Classify as: fulfilled, overdue, or pending
 *
 * Matching uses modality + body region overlap (not exact string match)
 * to accommodate the natural variation in how follow-ups are ordered
 * (e.g., "Follow-up CT" can be fulfilled by "CT Chest with Contrast").
 */

import type { Study, PatientRecord } from '../models/types';
import type {
  PriorReportAnalysis,
  OpenRecommendation,
} from '../models/summarization-types';

// ── Configuration ─────────────────────────────────────────────────────────

/**
 * Timeframe strings and their approximate day equivalents.
 * Used to compute due dates from recommendation timeframes.
 */
const TIMEFRAME_DAYS: Record<string, number> = {
  'immediate': 0,
  'stat': 0,
  'urgent': 1,
  '1 week': 7,
  '2 weeks': 14,
  '1 month': 30,
  '2 months': 60,
  '3 months': 90,
  '4 months': 120,
  '6 months': 180,
  '1 year': 365,
  '12 months': 365,
  '2 years': 730,
  'short-term': 30,       // conservative estimate
  'short term': 30,
};

/**
 * Modality keywords that map recommendation text to canonical modalities.
 */
const MODALITY_KEYWORDS: Record<string, string[]> = {
  'CT': ['ct', 'computed tomography', 'cat scan'],
  'MR': ['mr', 'mri', 'magnetic resonance'],
  'US': ['us', 'ultrasound', 'sonography', 'doppler'],
  'XR': ['xr', 'x-ray', 'radiograph', 'chest x-ray', 'cxr'],
  'NM': ['nm', 'nuclear', 'pet', 'bone scan', 'scintigraphy'],
  'MG': ['mammogram', 'mammography'],
  'FL': ['fluoroscopy'],
};

/**
 * Body region keywords for matching recommendations to studies.
 */
const REGION_KEYWORDS: Record<string, string[]> = {
  'Head': ['head', 'brain', 'cranial', 'intracranial'],
  'Neck': ['neck', 'cervical', 'thyroid', 'carotid'],
  'Chest': ['chest', 'thorax', 'thoracic', 'lung', 'pulmonary', 'cardiac'],
  'Abdomen': ['abdomen', 'abdominal', 'liver', 'hepatic', 'renal', 'kidney'],
  'Pelvis': ['pelvis', 'pelvic', 'bladder', 'prostate', 'uterine'],
  'Spine': ['spine', 'spinal', 'vertebral'],
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Track recommendation fulfillment across the patient's study timeline.
 *
 * @param analyses - Tier 1 individual report analyses containing recommendations
 * @param patientRecord - Full patient record with complete study timeline
 * @param currentStudyDate - Date of the current exam (YYYYMMDDHHMMSS)
 * @returns Array of open recommendations with fulfillment status
 */
export function trackRecommendations(
  analyses: PriorReportAnalysis[],
  patientRecord: PatientRecord,
  currentStudyDate: string,
): OpenRecommendation[] {
  const recommendations: OpenRecommendation[] = [];

  for (const analysis of analyses) {
    for (const finding of analysis.findings) {
      if (!finding.recommendation) continue;

      const rec = finding.recommendation;
      const sourceDate = analysis.studyDate;

      // Compute due date from timeframe
      const dueDate = computeDueDate(sourceDate, rec.timeframe);

      // Search for a fulfilling study
      const fulfillment = findFulfillingStudy(
        rec.action,
        sourceDate,
        patientRecord.studies,
      );

      // Determine status
      let status: 'fulfilled' | 'overdue' | 'pending';
      if (fulfillment) {
        status = 'fulfilled';
      } else if (dueDate && compareDates(currentStudyDate, dueDate) > 0) {
        status = 'overdue';
      } else {
        status = 'pending';
      }

      recommendations.push({
        action: rec.action,
        sourceStudyName: analysis.studyName,
        sourceStudyDate: analysis.studyDate,
        sourceAccession: analysis.accessionNumber,
        timeframe: rec.timeframe,
        dueDate,
        findingContext: finding.name,
        status,
        fulfilledBy: fulfillment
          ? `${fulfillment.studyDescription} (${formatDate(fulfillment.studyDateTime)})`
          : null,
      });
    }
  }

  return recommendations;
}

// ── Internal: Fulfillment Search ──────────────────────────────────────────

/**
 * Search the patient's study timeline for a study that fulfills
 * a given recommendation.
 *
 * A study is considered fulfilling if:
 *   1. It was performed AFTER the recommendation's source study date
 *   2. Its modality matches the recommended modality (if identifiable)
 *   3. Its body region overlaps with the recommended region (if identifiable)
 */
function findFulfillingStudy(
  recommendationAction: string,
  sourceStudyDate: string,
  allStudies: Study[],
): Study | null {
  const actionLower = recommendationAction.toLowerCase();

  // Extract modality and region from the recommendation text
  const recModality = extractModality(actionLower);
  const recRegion = extractRegion(actionLower);

  // Search through studies performed after the source date
  for (const study of allStudies) {
    // Must be after the source study
    if (compareDates(study.studyDateTime, sourceStudyDate) <= 0) continue;

    // Check modality match
    if (recModality && study.labels) {
      if (study.labels.modality !== recModality && !study.labels.allModalities.includes(recModality)) {
        continue;
      }
    }

    // Check region match (if we could identify a region in the recommendation)
    if (recRegion && study.labels) {
      const studyRegions = study.labels.bodyRegions.map((r) => r.toLowerCase());
      if (!studyRegions.some((r) => r === recRegion.toLowerCase())) {
        continue;
      }
    }

    // If we couldn't identify modality or region, we can't confidently match
    if (!recModality && !recRegion) continue;

    // This study fulfills the recommendation
    return study;
  }

  return null;
}

// ── Internal: Text Analysis ───────────────────────────────────────────────

/**
 * Extract a canonical modality from recommendation text.
 */
function extractModality(text: string): string | null {
  for (const [modality, keywords] of Object.entries(MODALITY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) return modality;
    }
  }
  return null;
}

/**
 * Extract a body region from recommendation text.
 */
function extractRegion(text: string): string | null {
  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) return region;
    }
  }
  return null;
}

// ── Internal: Date Arithmetic ─────────────────────────────────────────────

/**
 * Compute a due date by adding a timeframe to a source date.
 * Returns null if the timeframe is not parseable.
 *
 * @param sourceDate - YYYYMMDDHHMMSS format
 * @param timeframe - Human-readable timeframe (e.g., "3 months", "short-term")
 * @returns Due date in YYYYMMDD format, or null
 */
function computeDueDate(sourceDate: string, timeframe: string | null): string | null {
  if (!timeframe || !sourceDate || sourceDate.length < 8) return null;

  const tf = timeframe.toLowerCase().trim();

  // Direct lookup
  let days = TIMEFRAME_DAYS[tf];

  // Pattern matching: "N months", "N weeks", "N years"
  if (days === undefined) {
    const match = tf.match(/(\d+)\s*(month|week|year|day)s?/i);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      if (unit === 'month') days = n * 30;
      else if (unit === 'week') days = n * 7;
      else if (unit === 'year') days = n * 365;
      else if (unit === 'day') days = n;
    }
  }

  if (days === undefined) return null;

  // Parse source date
  const year = parseInt(sourceDate.substring(0, 4), 10);
  const month = parseInt(sourceDate.substring(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(sourceDate.substring(6, 8), 10);

  const date = new Date(year, month, day);
  date.setDate(date.getDate() + days);

  // Format as YYYYMMDD
  const y = date.getFullYear().toString();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Compare two date strings in YYYYMMDD or YYYYMMDDHHMMSS format.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareDates(a: string, b: string): number {
  // Compare by the first 8 characters (YYYYMMDD) for date-level precision
  const aDate = a.substring(0, 8);
  const bDate = b.substring(0, 8);
  return aDate.localeCompare(bDate);
}

/**
 * Format a YYYYMMDDHHMMSS date string to MM/DD/YYYY.
 */
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || 'Unknown';
  return `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}/${dateStr.substring(0, 4)}`;
}
