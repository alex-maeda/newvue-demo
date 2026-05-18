/**
 * Interim modality parser — extracts a modality code from a study description.
 *
 * This is a temporary utility for Phase 1. The full labeling engine
 * (study name normalization system) will replace this in a later phase.
 */

/** Known modality patterns ordered by specificity */
const MODALITY_PATTERNS: readonly [RegExp, string][] = [
  [/\bPET[\s-]?CT\b/i, 'PT'],
  [/\bPET\b/i, 'PT'],
  [/\bCT\b/i, 'CT'],
  [/\bMRI?\b/i, 'MR'],
  [/\bX[\s-]?Ray\b/i, 'XR'],
  [/\bXR\b/i, 'XR'],
  [/\bUltrasound\b/i, 'US'],
  [/\bUS\b/i, 'US'],
  [/\bNuclear\b/i, 'NM'],
  [/\bNM\b/i, 'NM'],
  [/\bMammo(?:gram|graphy)?\b/i, 'MG'],
  [/\bMG\b/i, 'MG'],
  [/\bFluoro(?:scopy)?\b/i, 'FL'],
  [/\bFL\b/i, 'FL'],
  [/\bAngio(?:gram|graphy)?\b/i, 'FL'],
  [/\bDexa\b/i, 'XR'],
  [/\bBone\s+Density\b/i, 'XR'],
];

/**
 * Parse a modality code from a study description string.
 *
 * @param studyDescription - The human-readable study description (e.g., "CT Chest w/ Contrast")
 * @returns A 2-letter modality code (e.g., "CT", "MR", "XR") or "OT" if unrecognized
 */
export function parseModality(studyDescription: string): string {
  const desc = studyDescription.trim();
  for (const [pattern, code] of MODALITY_PATTERNS) {
    if (pattern.test(desc)) {
      return code;
    }
  }
  return 'OT';
}

/** Greyscale color map for modality pills (matches prototype MODS object) */
export const MODALITY_COLORS: Record<string, { gray: string; foreground: string }> = {
  CT: { gray: '#728490', foreground: '#CBD5DC' },
  MR: { gray: '#A0B2BC', foreground: '#111820' },
  XR: { gray: '#50616B', foreground: '#CBD5DC' },
  US: { gray: '#667880', foreground: '#CBD5DC' },
  NM: { gray: '#8A9CA4', foreground: '#111820' },
  PT: { gray: '#5C6E78', foreground: '#CBD5DC' },
  MG: { gray: '#7E909C', foreground: '#111820' },
  FL: { gray: '#4E5E68', foreground: '#CBD5DC' },
  IR: { gray: '#5A6A74', foreground: '#CBD5DC' },
  NA: { gray: '#3A4550', foreground: '#CBD5DC' },
  OT: { gray: '#3A4550', foreground: '#CBD5DC' },
};

/**
 * Get the greyscale pill style for a modality code.
 */
export function getModalityStyle(modality: string): { background: string; color: string } {
  const entry = MODALITY_COLORS[modality] ?? MODALITY_COLORS['OT'];
  return { background: entry.gray, color: entry.foreground };
}
