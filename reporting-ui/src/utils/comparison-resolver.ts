/**
 * comparison-resolver.ts — Fuzzy-matches a finding's comparisonStudyReference
 * free text against the patient's study list to produce navigable links.
 *
 * Matching strategy (3-tier):
 *   1. Date extraction — parse date-like substrings, compare against studyDateTime
 *   2. Modality matching — check for modality keywords vs. study labels
 *   3. Body region matching — check for region keywords in studyDescription
 *
 * Confidence:
 *   high — date + modality/region match
 *   low  — single-dimension match only
 */

import type { Study } from '../types/api';

export interface ComparisonMatch {
  study: Study;
  confidence: 'high' | 'low';
}

// ── Date extraction patterns ───────────────────────────────────────────────

/** Common date formats found in radiology reports */
const DATE_PATTERNS = [
  // M/D/YYYY or MM/DD/YYYY
  /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
  // YYYY-MM-DD (ISO)
  /(\d{4})-(\d{2})-(\d{2})/,
  // Month YYYY or Month DD, YYYY
  /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:(\d{1,2}),?\s+)?(\d{4})/i,
  // M/YYYY or MM/YYYY (month/year only)
  /(\d{1,2})\/(\d{4})/,
];

const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

/**
 * Extract a {year, month, day?} from a reference string.
 * Returns null if no date-like substring is found.
 */
function extractDate(ref: string): { year: string; month: string; day?: string } | null {
  // M/D/YYYY
  let m = ref.match(DATE_PATTERNS[0]);
  if (m) {
    return { year: m[3], month: m[1].padStart(2, '0'), day: m[2].padStart(2, '0') };
  }

  // YYYY-MM-DD
  m = ref.match(DATE_PATTERNS[1]);
  if (m) {
    return { year: m[1], month: m[2], day: m[3] };
  }

  // Month [DD,] YYYY
  m = ref.match(DATE_PATTERNS[2]);
  if (m) {
    const monthNum = MONTH_NAMES[m[1].toLowerCase()];
    if (monthNum) {
      return {
        year: m[3],
        month: monthNum,
        day: m[2] ? m[2].padStart(2, '0') : undefined,
      };
    }
  }

  // M/YYYY (month/year only)
  m = ref.match(DATE_PATTERNS[3]);
  if (m) {
    return { year: m[2], month: m[1].padStart(2, '0') };
  }

  return null;
}

/** Check if a study's date matches the extracted date (year+month, optionally day) */
function dateMatches(
  studyDateTime: string,
  extracted: { year: string; month: string; day?: string },
): boolean {
  // studyDateTime is ISO-ish: "2025-07-09T..." or "2025-07-09"
  const yearMatch = studyDateTime.includes(extracted.year);
  const monthMatch = studyDateTime.includes(`${extracted.year}-${extracted.month}`);

  if (!yearMatch || !monthMatch) return false;

  if (extracted.day) {
    return studyDateTime.includes(`${extracted.year}-${extracted.month}-${extracted.day}`);
  }
  return true;
}

// ── Modality matching ──────────────────────────────────────────────────────

const MODALITY_KEYWORDS: Record<string, string[]> = {
  CT: ['ct', 'cat scan', 'computed tomography'],
  MR: ['mr', 'mri', 'magnetic resonance'],
  XR: ['x-ray', 'xr', 'radiograph', 'plain film'],
  US: ['us', 'ultrasound', 'sonography', 'sonogram'],
  FL: ['fluoro', 'fluoroscopy'],
  NM: ['nuclear', 'pet', 'pet/ct', 'pet-ct', 'spect', 'bone scan'],
  MG: ['mammo', 'mammography', 'mammogram'],
  IR: ['interventional'],
};

/** Check if the reference text contains a modality keyword matching the study */
function modalityMatches(ref: string, studyModality: string): boolean {
  const lower = ref.toLowerCase();
  const keywords = MODALITY_KEYWORDS[studyModality];
  if (!keywords) return false;
  return keywords.some((kw) => {
    // Word-boundary-aware match to avoid "ct" matching "duct"
    const idx = lower.indexOf(kw);
    if (idx === -1) return false;
    const before = idx === 0 || /\W/.test(lower[idx - 1]);
    const after = idx + kw.length >= lower.length || /\W/.test(lower[idx + kw.length]);
    return before && after;
  });
}

// ── Body region matching ───────────────────────────────────────────────────

const REGION_KEYWORDS = [
  'chest', 'thorax', 'lung', 'abdomen', 'abdominal', 'pelvis', 'pelvic',
  'head', 'brain', 'neck', 'cervical', 'spine', 'spinal', 'lumbar',
  'thoracic', 'extremity', 'shoulder', 'knee', 'hip', 'ankle', 'wrist',
  'cardiac', 'heart', 'renal', 'kidney', 'liver', 'hepatic',
];

/** Check if the reference mentions a body region keyword that also appears in the study description */
function regionMatches(ref: string, studyDescription: string): boolean {
  const refLower = ref.toLowerCase();
  const descLower = studyDescription.toLowerCase();
  return REGION_KEYWORDS.some((kw) => refLower.includes(kw) && descLower.includes(kw));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Attempt to resolve a comparisonStudyReference to a known patient study.
 *
 * @param reference — Free-text comparison reference from the LLM output
 * @param studies — All patient studies available for matching
 * @returns The best match with confidence, or null if no reasonable match
 */
export function resolveComparisonStudy(
  reference: string,
  studies: Study[],
): ComparisonMatch | null {
  if (!reference || studies.length === 0) return null;

  const extractedDate = extractDate(reference);

  let bestMatch: ComparisonMatch | null = null;
  let bestScore = 0;

  for (const study of studies) {
    let score = 0;
    const studyModality = study.labels?.modality ?? 'NA';

    // Date match (strongest signal)
    const hasDate = extractedDate && dateMatches(study.studyDateTime, extractedDate);
    if (hasDate) score += 3;

    // Modality match
    const hasModality = modalityMatches(reference, studyModality);
    if (hasModality) score += 2;

    // Region match
    const hasRegion = regionMatches(reference, study.studyDescription);
    if (hasRegion) score += 1;

    if (score > bestScore) {
      bestScore = score;
      const confidence: 'high' | 'low' =
        (hasDate && (hasModality || hasRegion)) ? 'high' : 'low';
      bestMatch = { study, confidence };
    }
  }

  // Require at least a single-dimension match (score >= 1)
  return bestScore >= 1 ? bestMatch : null;
}
