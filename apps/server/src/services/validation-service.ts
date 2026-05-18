/**
 * validation-service.ts — Post-extraction source attribution validation.
 *
 * After the LLM extracts findings from a prior report, this service
 * verifies that each finding is traceable to the source report text.
 * This is the primary hallucination prevention mechanism.
 *
 * Validation checks:
 *   1. finding_traceable — does the finding name/description appear in the source?
 *   2. measurement_verbatim — does each measurement appear verbatim in the source?
 *   3. reference_present — does each referenced prior study appear in the source?
 *
 * Results are tiered:
 *   - pass ✅ — exact or strong fuzzy match found
 *   - warning ⚠️ — partial match (name present, description deviates)
 *   - fail ❌ — not traceable (possible hallucination)
 *
 * Failed findings are NOT suppressed from the output (that's a UI decision),
 * but their validation status is available in the QA log for review.
 */

import type { PriorReportAnalysis, ValidationResult, ValidationCheck } from '../models/summarization-types';
import type { ReportSections } from '../models/types';

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Validate all extracted findings against the source report text.
 *
 * @param analysis - The structured extraction from the LLM
 * @param sourceReport - The original report sections
 * @returns Validation result with individual check details
 */
export function validateExtraction(
  analysis: PriorReportAnalysis,
  sourceReport: ReportSections,
): ValidationResult {
  const checks: ValidationCheck[] = [];

  // Build a normalized version of the full report text for searching
  const fullText = buildSearchableText(sourceReport);

  for (const finding of analysis.findings) {
    // ── Check 1: Finding traceability ──
    checks.push(checkFindingTraceable(finding.name, finding.sourceExcerpt, fullText));

    // ── Check 2: Measurement verbatim match ──
    for (const measurement of finding.measurements) {
      checks.push(checkMeasurementVerbatim(finding.name, measurement.dimension, fullText));
    }
  }

  // ── Check 3: Referenced prior studies ──
  for (const ref of analysis.referencedPriorStudies) {
    checks.push(checkReferencePresent(ref.studyType, ref.studyDate, fullText));
  }

  const passed = checks.every((c) => c.status !== 'fail');

  return { passed, checks };
}

// ── Internal: Check Implementations ───────────────────────────────────────

/**
 * Check whether a finding is traceable to the source text.
 *
 * Strategy:
 *   1. If sourceExcerpt appears in the text → pass
 *   2. If key nouns from the finding name appear in the text → pass/warning
 *   3. Otherwise → fail
 */
function checkFindingTraceable(
  findingName: string,
  sourceExcerpt: string,
  fullText: string,
): ValidationCheck {
  // Direct excerpt match (most reliable)
  if (sourceExcerpt && fuzzyContains(fullText, sourceExcerpt)) {
    return {
      type: 'finding_traceable',
      findingName,
      status: 'pass',
      detail: 'Source excerpt found in report text.',
    };
  }

  // Extract key clinical terms from the finding name and check presence
  const keyTerms = extractKeyTerms(findingName);
  const matchedTerms = keyTerms.filter((term) => fuzzyContains(fullText, term));
  const matchRatio = keyTerms.length > 0 ? matchedTerms.length / keyTerms.length : 0;

  if (matchRatio >= 0.75) {
    return {
      type: 'finding_traceable',
      findingName,
      status: 'pass',
      detail: `Key terms found: ${matchedTerms.join(', ')}`,
    };
  }

  if (matchRatio >= 0.5) {
    return {
      type: 'finding_traceable',
      findingName,
      status: 'warning',
      detail: `Partial match (${matchedTerms.length}/${keyTerms.length} terms): ${matchedTerms.join(', ')}. Missing: ${keyTerms.filter((t) => !matchedTerms.includes(t)).join(', ')}`,
    };
  }

  return {
    type: 'finding_traceable',
    findingName,
    status: 'fail',
    detail: `Finding name "${findingName}" not traceable to source text. Possible hallucination.`,
  };
}

/**
 * Check whether a measurement appears verbatim in the source text.
 * Measurements are expected to be exact copies from the report.
 */
function checkMeasurementVerbatim(
  findingName: string,
  measurement: string,
  fullText: string,
): ValidationCheck {
  if (!measurement) {
    return {
      type: 'measurement_verbatim',
      findingName,
      status: 'warning',
      detail: 'Empty measurement value.',
    };
  }

  // Normalize whitespace and check for presence
  const normalizedMeasurement = normalizeText(measurement);

  if (fullText.includes(normalizedMeasurement)) {
    return {
      type: 'measurement_verbatim',
      findingName,
      status: 'pass',
      detail: `Measurement "${measurement}" found verbatim.`,
    };
  }

  // Try with flexible whitespace (some reports have extra spaces around "x")
  const flexiblePattern = normalizedMeasurement
    .replace(/\s*x\s*/gi, '\\s*x\\s*')
    .replace(/\s*×\s*/gi, '\\s*[x×]\\s*');

  try {
    const regex = new RegExp(flexiblePattern, 'i');
    if (regex.test(fullText)) {
      return {
        type: 'measurement_verbatim',
        findingName,
        status: 'pass',
        detail: `Measurement "${measurement}" found with flexible whitespace.`,
      };
    }
  } catch {
    // Regex construction failed — fall through to numeric check
  }

  // Last resort: check if the numeric values appear
  const numbers = measurement.match(/[\d.]+/g);
  if (numbers && numbers.every((n) => fullText.includes(n))) {
    return {
      type: 'measurement_verbatim',
      findingName,
      status: 'warning',
      detail: `Numeric values (${numbers.join(', ')}) found but exact format differs.`,
    };
  }

  return {
    type: 'measurement_verbatim',
    findingName,
    status: 'fail',
    detail: `Measurement "${measurement}" not found in report text.`,
  };
}

/**
 * Check whether a referenced prior study appears in the report text.
 */
function checkReferencePresent(
  studyType: string,
  studyDate: string,
  fullText: string,
): ValidationCheck {
  const findingName = `${studyType} ${studyDate}`;

  // Check if the date appears in the text
  const dateFound = fullText.includes(normalizeText(studyDate));

  // Check if the study type appears near the date
  const typeTerms = extractKeyTerms(studyType);
  const typeFound = typeTerms.some((term) => fuzzyContains(fullText, term));

  if (dateFound && typeFound) {
    return {
      type: 'reference_present',
      findingName,
      status: 'pass',
      detail: `Referenced study "${studyType} ${studyDate}" found in report.`,
    };
  }

  if (dateFound) {
    return {
      type: 'reference_present',
      findingName,
      status: 'warning',
      detail: `Date "${studyDate}" found but study type "${studyType}" not clearly matched.`,
    };
  }

  return {
    type: 'reference_present',
    findingName,
    status: 'fail',
    detail: `Referenced study "${studyType} ${studyDate}" not found in report text.`,
  };
}

// ── Internal: Text Processing Utilities ───────────────────────────────────

/**
 * Build a single searchable string from all report sections.
 * Normalized to lowercase with collapsed whitespace.
 */
function buildSearchableText(rs: ReportSections): string {
  const parts: string[] = [];

  if (rs.clinicalIndication) parts.push(rs.clinicalIndication);
  if (rs.technique) parts.push(rs.technique);
  if (rs.comparison) parts.push(rs.comparison);
  if (rs.findings) parts.push(rs.findings);
  if (rs.impression) parts.push(rs.impression);
  if (rs.rawText.length > 0) parts.push(rs.rawText.join(' '));

  return normalizeText(parts.join(' '));
}

/**
 * Normalize text for comparison: lowercase, collapse whitespace.
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Fuzzy contains check: normalizes both strings and checks for substring match.
 */
function fuzzyContains(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return haystack.includes(normalizedNeedle);
}

/**
 * Extract clinically meaningful terms from a finding name.
 * Filters out common words to focus on anatomical/pathological terms.
 */
function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
    'and', 'or', 'no', 'not', 'is', 'are', 'was', 'were', 'be', 'been',
    'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'vs', 'versus', 'from',
    'by', 'as', 'this', 'that', 'these', 'those', 'it', 'its',
    'likely', 'possible', 'probable', 'suspected', 'compatible',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove punctuation except hyphens
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopWords.has(word));
}
