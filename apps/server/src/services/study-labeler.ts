/**
 * study-labeler.ts — Normalization and labeling engine for prior study names.
 *
 * Adapted from the reference normalization pipeline (normalize.js + label.js).
 * For each prior study's `studyDescription`, this module:
 *   1. Cleans punctuation/whitespace
 *   2. Normalizes via two-phase lexicon replacement
 *   3. Labels tokens → modality[], bodyRegions[], isAngiographic, laterality
 *
 * The labeling result is a `StudyLabels` object that drives relevance
 * matching between current and prior examinations.
 *
 * Key differences from the reference pipeline:
 *   - No separate modality input column — modality is extracted from the
 *     study description itself via the labeling lexicon.
 *   - Only 4 label categories: modality, region, angiography, laterality
 *     (no contrast, RVU modifier, or qualifier).
 *   - Returns the compact StudyLabels interface rather than full slot fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StudyLabels, Modality, Laterality } from '../models/types';

// ── Lexicon Types ─────────────────────────────────────────────────────────

interface NormLexEntry {
  raw: string;
  normalized: string;
  operation?: 'delete' | 'end' | 'start' | 'replace';
  /** Pre-computed lowercase tokens of `raw` */
  rawTokens: string[];
  /** Pre-computed lowercase tokens of `normalized` */
  normalizedTokens: string[];
}

interface NormLexicon {
  phase1: NormLexEntry[];
  phase2: NormLexEntry[];
}

interface LabelLexEntry {
  term: string;
  element: 'modality' | 'region' | 'angiography' | 'laterality';
  termTokens: string[];
}

// ── Lexicon Loading (one-time at startup) ─────────────────────────────────

let normLexiconCache: NormLexicon | null = null;
let labelLexiconCache: LabelLexEntry[] | null = null;
/** Reverse lookup: lowercase body region term → Title-Case canonical name */
let canonicalRegionMap: Map<string, string> | null = null;

function loadNormLexicon(): NormLexicon {
  if (normLexiconCache) return normLexiconCache;

  const filePath = path.join(__dirname, '..', 'data', 'normalization-lexicon.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const phase1: NormLexEntry[] = [];
  const phase2: NormLexEntry[] = [];

  for (const entry of raw.entries) {
    const processed: NormLexEntry = {
      raw: entry.raw,
      normalized: entry.normalized,
      operation: entry.operation,
      rawTokens: entry.raw.toLowerCase().split(/\s+/).filter((t: string) => t !== ''),
      normalizedTokens: entry.normalized.toLowerCase().split(/\s+/).filter((t: string) => t !== ''),
    };

    if (entry.operation) {
      phase2.push(processed);
    } else {
      phase1.push(processed);
    }
  }

  normLexiconCache = { phase1, phase2 };
  return normLexiconCache;
}

function loadLabelLexicon(): LabelLexEntry[] {
  if (labelLexiconCache) return labelLexiconCache;

  const filePath = path.join(__dirname, '..', 'data', 'labeling-lexicon.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Entries are already sorted by descending token count in the JSON
  labelLexiconCache = raw.entries.map((e: { term: string; element: string; termTokens: string[] }) => ({
    term: e.term,
    element: e.element as LabelLexEntry['element'],
    termTokens: e.termTokens,
  }));

  return labelLexiconCache!;
}

/**
 * Load canonical region groupings and build a reverse lookup map.
 * E.g., "brain" → "Head", "foot" → "Foot", "liver" → "Abdomen".
 */
export function loadCanonicalRegionMap(): Map<string, string> {
  if (canonicalRegionMap) return canonicalRegionMap;

  const filePath = path.join(__dirname, '..', 'data', 'canonical-regions.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  canonicalRegionMap = new Map<string, string>();

  for (const [canonicalName, terms] of Object.entries(raw.regions)) {
    for (const term of terms as string[]) {
      // Map each term (lowercase) to its canonical display name
      canonicalRegionMap.set(term.toLowerCase(), canonicalName);
    }
  }

  return canonicalRegionMap;
}

/**
 * Resolve raw body region labels to canonical display names.
 * Deduplicates so that e.g. ["abdomen", "liver"] both mapping to
 * "Abdomen" results in just ["Abdomen"].
 *
 * Unresolvable terms are kept as Title Case to avoid data loss.
 */
function resolveCanonicalRegions(rawRegions: string[]): string[] {
  const regionMap = loadCanonicalRegionMap();
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawRegions) {
    const canonical = regionMap.get(raw.toLowerCase());
    const display = canonical ?? (raw.charAt(0).toUpperCase() + raw.slice(1));
    if (!seen.has(display)) {
      seen.add(display);
      result.push(display);
    }
  }

  return result;
}

// ── Text Cleaning ─────────────────────────────────────────────────────────

/**
 * Clean raw text: normalize punctuation, collapse whitespace, lowercase.
 * Mirrors the reference cleanText() utility.
 *
 * Hyphens are converted to spaces so compound tokens like "PET-CT" and
 * "US-Guided" split into separate tokens for normalization matching.
 */
function cleanText(raw: string): string {
  let text = raw;

  // Replace hyphens and common punctuation with spaces
  text = text.replace(/[-/\\()[\]{},;:!?#@$%^&*=~`"'<>|]/g, ' ');

  // Normalize underscores and dots to spaces
  text = text.replace(/[_.]/g, ' ');

  // Collapse multiple spaces
  text = text.replace(/\s+/g, ' ');

  // Trim
  text = text.trim();

  // Lowercase for case-insensitive matching
  text = text.toLowerCase();

  return text;
}

// ── Token Replacement Utilities ───────────────────────────────────────────
// Direct port from reference normalize.js

function replaceTokens(tokens: string[], src: string[], dst: string[]): string[] {
  if (!src.length) return tokens;

  const out: string[] = [];
  let i = 0;
  const n = tokens.length;
  const m = src.length;

  while (i <= n - m) {
    let match = true;
    for (let j = 0; j < m; j++) {
      if (tokens[i + j] !== src[j]) {
        match = false;
        break;
      }
    }

    if (match) {
      out.push(...dst);
      i += m;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }

  while (i < n) {
    out.push(tokens[i]);
    i++;
  }

  return out;
}

function replaceTokensAtEnd(tokens: string[], src: string[], dst: string[]): string[] {
  if (!src.length) return tokens;
  const m = src.length;
  if (tokens.length < m) return tokens;

  const startIdx = tokens.length - m;
  let match = true;
  for (let j = 0; j < m; j++) {
    if (tokens[startIdx + j] !== src[j]) {
      match = false;
      break;
    }
  }

  if (match) {
    return [...tokens.slice(0, startIdx), ...dst];
  }
  return tokens;
}

function replaceTokensAtStart(tokens: string[], src: string[], dst: string[]): string[] {
  if (!src.length) return tokens;
  const m = src.length;
  if (tokens.length < m) return tokens;

  let match = true;
  for (let j = 0; j < m; j++) {
    if (tokens[j] !== src[j]) {
      match = false;
      break;
    }
  }

  if (match) {
    return [...dst, ...tokens.slice(m)];
  }
  return tokens;
}

function deleteTokens(tokens: string[], src: string[]): string[] {
  if (!src.length) return tokens;

  const out: string[] = [];
  let i = 0;
  const n = tokens.length;
  const m = src.length;

  while (i <= n - m) {
    let match = true;
    for (let j = 0; j < m; j++) {
      if (tokens[i + j] !== src[j]) {
        match = false;
        break;
      }
    }

    if (match) {
      i += m;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }

  while (i < n) {
    out.push(tokens[i]);
    i++;
  }

  return out;
}

// ── Normalization Engine ──────────────────────────────────────────────────

/**
 * Apply two-phase lexicon-based normalization to a cleaned study name.
 */
function normalizeName(cleaned: string): string {
  const lex = loadNormLexicon();
  let tokens = cleaned.split(/\s+/).filter(t => t !== '');

  // Phase 1: standard replacements
  for (const entry of lex.phase1) {
    if (!tokens.length) break;
    tokens = replaceTokens(tokens, entry.rawTokens, entry.normalizedTokens);
  }

  // Phase 2 first pass: end, start, delete
  for (const entry of lex.phase2) {
    if (!tokens.length) break;
    if (entry.operation === 'end') {
      tokens = replaceTokensAtEnd(tokens, entry.rawTokens, entry.normalizedTokens);
    } else if (entry.operation === 'start') {
      tokens = replaceTokensAtStart(tokens, entry.rawTokens, entry.normalizedTokens);
    } else if (entry.operation === 'delete') {
      tokens = deleteTokens(tokens, entry.rawTokens);
    }
  }

  // Phase 2 second pass: replace operations
  for (const entry of lex.phase2) {
    if (!tokens.length) break;
    if (entry.operation === 'replace') {
      tokens = replaceTokens(tokens, entry.rawTokens, entry.normalizedTokens);
    }
  }

  return tokens.join(' ');
}

// ── Labeling Engine ───────────────────────────────────────────────────────

/** Canonical modality codes recognized by the labeling system */
const KNOWN_MODALITIES = new Set<string>([
  'CT', 'MR', 'XR', 'US', 'FL', 'MG', 'NM', 'IR',
]);

/** Canonical laterality terms */
const LATERALITY_MAP: Record<string, Laterality> = {
  left: 'left',
  right: 'right',
  bilateral: 'bilateral',
  // Truncated forms from the lexicon that normalize to these
  bila: 'bilateral',
  bilataral: 'bilateral',
  bilate: 'bilateral',
  bilater: 'bilateral',
  bilatera: 'bilateral',
  contralateral: 'bilateral',
  unilate: null,
  unilater: null,
  unilatera: null,
  unilateral: null,
  unilateralltd: null,
};

/**
 * Scan normalized tokens for label terms using longest-match-first strategy.
 * Each matched token sequence is consumed (removed from further scanning).
 */
function labelTokens(normalizedName: string): {
  modalities: string[];
  bodyRegions: string[];
  isAngiographic: boolean;
  laterality: Laterality;
} {
  const labelLex = loadLabelLexicon();
  let tokens = normalizedName.split(/\s+/).filter(t => t !== '');

  const modalities: string[] = [];
  const bodyRegions: string[] = [];
  let isAngiographic = false;
  let laterality: Laterality = null;

  for (const entry of labelLex) {
    if (!tokens.length) break;

    const src = entry.termTokens;
    const m = src.length;
    if (m === 0) continue;

    // Scan and consume matched tokens
    const out: string[] = [];
    let i = 0;
    const n = tokens.length;

    while (i <= n - m) {
      let match = true;
      for (let j = 0; j < m; j++) {
        if (tokens[i + j] !== src[j]) {
          match = false;
          break;
        }
      }

      if (match) {
        // Record the label
        const termStr = entry.term;

        switch (entry.element) {
          case 'modality': {
            const upper = termStr.toUpperCase();
            if (!modalities.includes(upper)) {
              modalities.push(upper);
            }
            break;
          }
          case 'region': {
            const lower = termStr.toLowerCase();
            if (!bodyRegions.includes(lower)) {
              bodyRegions.push(lower);
            }
            break;
          }
          case 'angiography':
            isAngiographic = true;
            break;
          case 'laterality': {
            const lower = termStr.toLowerCase();
            const mapped = LATERALITY_MAP[lower];
            // Only set if not already set (first laterality wins)
            if (mapped !== undefined && laterality === null) {
              laterality = mapped;
            }
            break;
          }
        }

        i += m; // consume matched tokens
      } else {
        out.push(tokens[i]);
        i += 1;
      }
    }

    // Trailing tokens
    while (i < n) {
      out.push(tokens[i]);
      i++;
    }

    tokens = out;
  }

  return { modalities, bodyRegions, isAngiographic, laterality };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Normalize and label a raw study description.
 *
 * @param rawDescription - The raw studyDescription from the HL7 feed
 * @returns StudyLabels with modality, bodyRegions, isAngiographic, laterality
 */
export function labelStudyDescription(rawDescription: string): StudyLabels {
  const cleaned = cleanText(rawDescription);
  const normalized = normalizeName(cleaned);
  const labels = labelTokens(normalized);

  // Map modalities to canonical codes; use first found or 'NA'
  const canonicalModalities = labels.modalities
    .map(m => m.toUpperCase())
    .filter(m => KNOWN_MODALITIES.has(m));

  const primaryModality: Modality | 'NA' =
    canonicalModalities.length > 0 ? (canonicalModalities[0] as Modality) : 'NA';

  // Resolve raw body regions to canonical display names (deduplicated)
  const canonicalBodyRegions = resolveCanonicalRegions(labels.bodyRegions);

  return {
    modality: primaryModality as Modality,
    bodyRegions: canonicalBodyRegions,
    rawBodyRegions: labels.bodyRegions,
    isAngiographic: labels.isAngiographic,
    laterality: labels.laterality,
    allModalities: canonicalModalities.length > 0 ? canonicalModalities : ['NA'],
  };
}

/**
 * Extended labeling result that includes the normalized study name.
 * Used when debugging/inspection detail is needed beyond base labels.
 */
export interface ExtendedStudyLabels extends StudyLabels {
  /** The normalized study name (for debugging/inspection) */
  normalizedName: string;
}

/**
 * Normalize and label with full detail, including all detected modalities.
 */
export function labelStudyDescriptionExtended(rawDescription: string): ExtendedStudyLabels {
  const cleaned = cleanText(rawDescription);
  const normalized = normalizeName(cleaned);
  const labels = labelTokens(normalized);

  const canonicalModalities = labels.modalities
    .map(m => m.toUpperCase())
    .filter(m => KNOWN_MODALITIES.has(m));

  const primaryModality: Modality | 'NA' =
    canonicalModalities.length > 0 ? (canonicalModalities[0] as Modality) : 'NA';

  // Resolve raw body regions to canonical display names (deduplicated)
  const canonicalBodyRegions = resolveCanonicalRegions(labels.bodyRegions);

  return {
    modality: primaryModality as Modality,
    bodyRegions: canonicalBodyRegions,
    rawBodyRegions: labels.bodyRegions,
    isAngiographic: labels.isAngiographic,
    laterality: labels.laterality,
    allModalities: canonicalModalities.length > 0 ? canonicalModalities : ['NA'],
    normalizedName: normalized,
  };
}
