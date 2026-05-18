/**
 * Date formatting utilities for HL7 and ISO 8601 date strings.
 *
 * HL7 dates arrive as YYYYMMDDHHMMSS strings. FHIR dates use ISO 8601
 * (e.g., "2025-09-19T11:48:00-07:00"). These helpers handle both formats.
 */

/**
 * Parse an HL7 datetime string (YYYYMMDDHHMMSS) or ISO 8601 string into a JS Date.
 * Tolerates partial HL7 strings (YYYYMMDD, YYYYMMDDHHMM, etc.)
 */
export function parseHL7Date(dateString: string): Date | null {
  if (!dateString || dateString.length < 4) return null;

  // Detect ISO 8601 format (contains hyphens or T)
  if (dateString.includes('-') || dateString.includes('T')) {
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  }

  // HL7 format: YYYYMMDDHHMMSS
  if (dateString.length < 8) return null;

  const year = parseInt(dateString.slice(0, 4), 10);
  const month = parseInt(dateString.slice(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(dateString.slice(6, 8), 10);
  const hour = dateString.length >= 10 ? parseInt(dateString.slice(8, 10), 10) : 0;
  const minute = dateString.length >= 12 ? parseInt(dateString.slice(10, 12), 10) : 0;
  const second = dateString.length >= 14 ? parseInt(dateString.slice(12, 14), 10) : 0;

  const date = new Date(year, month, day, hour, minute, second);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Format an HL7 date to "MMM DD, YYYY" (e.g., "Jun 24, 2025").
 */
export function formatDisplayDate(hl7DateTime: string): string {
  const date = parseHL7Date(hl7DateTime);
  if (!date) return hl7DateTime;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format an HL7 date to "MM/DD/YYYY".
 */
export function formatShortDate(hl7DateTime: string): string {
  if (!hl7DateTime || hl7DateTime.length < 8) return hl7DateTime;
  const year = hl7DateTime.slice(0, 4);
  const month = hl7DateTime.slice(4, 6);
  const day = hl7DateTime.slice(6, 8);
  return `${month}/${day}/${year}`;
}

/**
 * Format the time portion of an HL7 datetime to 12-hour format.
 * Example: "20250920140000" → "2:00 PM"
 */
export function formatTime12h(hl7DateTime: string): string {
  const date = parseHL7Date(hl7DateTime);
  if (!date) return '';

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Extract the 4-digit year from an HL7 or ISO date string.
 */
export function extractYear(dateString: string): string {
  if (!dateString || dateString.length < 4) return 'Unknown';
  return dateString.slice(0, 4);
}

/**
 * Compute a relative age string between a study date and a reference date.
 *
 * @param studyHL7 - HL7 datetime of the prior study
 * @param referenceHL7 - HL7 datetime of the current/reference study
 * @returns Relative age string (e.g., "3d ago", "2w ago", "4mo ago", "1y ago")
 */
export function relativeAge(studyHL7: string, referenceHL7: string): string {
  const studyDate = parseHL7Date(studyHL7);
  const refDate = parseHL7Date(referenceHL7);

  if (!studyDate || !refDate) return '';

  const diffMs = refDate.getTime() - studyDate.getTime();
  if (diffMs < 0) return 'future';

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;

  const diffMonths = Math.floor(diffDays / 30.44);
  if (diffMonths < 12) return `${diffMonths}mo ago`;

  const diffYears = Math.floor(diffDays / 365.25);
  if (diffYears === 1) return '1y ago';
  return `${diffYears}y ago`;
}
