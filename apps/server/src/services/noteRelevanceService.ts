/**
 * Note Relevance Service
 *
 * Deterministic scoring engine that identifies the top-5 most relevant
 * clinical notes for the current radiology study. Implements:
 *
 *   1. Section extraction (CC, HPI, PEX, AP, COURSE)
 *   2. Physician-note filter (≥2 canonical sections)
 *   3. Category pre-filter (exclude non-physician note types)
 *   4. Composite scoring (encounter + note type + specialty-region + recency + section quality)
 *   5. Top-5 selection with 2-per-author cap
 *   6. Ordering provider force-inclusion
 *   7. Score normalization (relative to top scorer, rounded to 5%)
 */

import fs from 'fs';
import path from 'path';
import type { EhrNote } from './fhirDataService';
import type {
  NoteSections,
  NoteSection,
  NoteRelevanceBreakdown,
  NoteRelevanceResult,
} from '../models/types';

// ── Config Loading ────────────────────────────────────────────────────────

const CONFIG_DIR = path.resolve(__dirname, '../../config');

interface SectionTermsConfig {
  SECTION_HEADERS: Record<string, string[]>;
  STOP_HEADERS: Record<string, string[]>;
  AMBIGUOUS_STRICT: string[];
  NOTE_CATEGORY_EXCLUDE: string[];
}

interface NoteTypeTier {
  name: string;
  points: number;
  synonyms: string[];
}

interface NoteTypeScoringConfig {
  tiers: NoteTypeTier[];
  default_points: number;
}

interface SpecialtyGroupingConfig {
  generalist: string[];
  whole_body: string[];
  region: Record<string, string[]>;
}

/** ServiceRequest metadata needed for ordering-provider matching */
export interface ServiceRequestMeta {
  requesterRef: string;
  requesterDisplay: string;
  encounterId: string;
  authoredOn: string;
}

// Lazy-loaded config singletons
let _sectionTerms: SectionTermsConfig | null = null;
let _noteTypeScoring: NoteTypeScoringConfig | null = null;
let _specialtyGrouping: SpecialtyGroupingConfig | null = null;

function loadJSON<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, filename), 'utf8'));
}

function getSectionTerms(): SectionTermsConfig {
  if (!_sectionTerms) _sectionTerms = loadJSON<SectionTermsConfig>('note_section_terms.json');
  return _sectionTerms;
}

function getNoteTypeScoring(): NoteTypeScoringConfig {
  if (!_noteTypeScoring) _noteTypeScoring = loadJSON<NoteTypeScoringConfig>('note_type_scoring.json');
  return _noteTypeScoring;
}

function getSpecialtyGrouping(): SpecialtyGroupingConfig {
  if (!_specialtyGrouping) {
    const configPath = path.join(CONFIG_DIR, 'specialty_grouping.json');
    const filePath = configPath;
    _specialtyGrouping = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return _specialtyGrouping!;
}

// ── Constants ─────────────────────────────────────────────────────────────

const HEADER_MAX_LENGTH = 65;
const MAX_SCAN_NOTES = 100;
const MAX_SECTION_EXTRACT = 50;
const TOP_N = 5;
const MAX_PER_AUTHOR = 2;

// ── Function 1: Extract Note Sections ─────────────────────────────────────

/**
 * Deterministically extract canonical clinical sections from note text.
 *
 * Ported from legacy findSectionRanges() with the addition of the
 * COURSE section (hospital course, clinical course, etc.).
 *
 * Supports two header formats:
 *   1. Standalone: "Chief Complaint:" on its own line
 *   2. Inline:     "Chief Complaint: Resolving encephalopathy..."
 *      where header and content share the same line
 */
export function extractNoteSections(text: string): NoteSections {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');

  const cfg = getSectionTerms();
  const SECTION_HEADERS = cfg.SECTION_HEADERS;
  const STOP_HEADERS = cfg.STOP_HEADERS;
  const ambiguousSet = new Set((cfg.AMBIGUOUS_STRICT || []).map(s => s.toLowerCase()));

  const DESIRED_KEYS: NoteSection[] = ['CC', 'HPI', 'PEX', 'AP', 'COURSE'];

  // Header shape regex: short line, possibly prefixed with formatting chars
  const headerShapeRx = /^[\s>*#\-]{0,3}[A-Za-z].{0,58}:?$/;

  function isHeaderLikeLine(line: string): boolean {
    return line.length <= HEADER_MAX_LENGTH && headerShapeRx.test(line);
  }

  /**
   * Try to match a line against a header token.  Returns an object with
   * `matched` (did it match?) and optional `inlineContent` (text after
   * the colon when the header and body share the same line).
   *
   * Two detection paths:
   *   Path 1 — Standalone header: short line that IS the header
   *   Path 2 — Inline header: line STARTS with "Token:" followed by content
   */
  function tryMatchToken(
    line: string,
    token: string,
  ): { matched: boolean; inlineContent?: string } {
    const lRaw = String(line || '').trim();
    const l = lRaw.toLowerCase();
    const t = String(token || '').trim().toLowerCase();
    const isAmbiguous = ambiguousSet.has(t);

    // ── Path 1: Standalone header line (short line, header only) ──
    if (isHeaderLikeLine(lRaw)) {
      const hasTrailingColon = /:\s*$/.test(l);
      const base = l.replace(/:\s*$/, '');

      if (isAmbiguous) {
        if ((base === t) && (hasTrailingColon || base === t)) {
          return { matched: true };
        }
      } else {
        if (base === t || base.startsWith(t + ' ')) {
          return { matched: true };
        }
      }
    }

    // ── Path 2: Inline header — "Token: content..." on the same line ──
    // Find the first colon; the text before it must be short enough to be
    // a header label and must match the token exactly.
    const colonIdx = lRaw.indexOf(':');
    if (colonIdx > 0 && colonIdx <= HEADER_MAX_LENGTH) {
      const prefix = lRaw.substring(0, colonIdx).trim().toLowerCase();
      const suffix = lRaw.substring(colonIdx + 1).trim();

      if (prefix === t) {
        return { matched: true, inlineContent: suffix || undefined };
      }
    }

    return { matched: false };
  }

  // Signature detector (acts as a STOP mark)
  const RX_SIGNATURE = /\b(md|m\.d\.|do|d\.o\.|physician)\s*$/i;

  // Collect all marks
  interface Mark { kind: 'start' | 'stop'; key: string; idx: number; inlineContent?: string; }
  const marks: Mark[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || '').trim();

    // Check desired section headers
    for (const [key, variants] of Object.entries(SECTION_HEADERS)) {
      let found = false;
      for (const token of variants) {
        const result = tryMatchToken(line, token);
        if (result.matched) {
          marks.push({ kind: 'start', key, idx: i, inlineContent: result.inlineContent });
          found = true;
          break;
        }
      }
      if (found) break;
    }

    // Check stop headers
    for (const variants of Object.values(STOP_HEADERS)) {
      let found = false;
      for (const token of variants) {
        const result = tryMatchToken(line, token);
        if (result.matched) {
          marks.push({ kind: 'stop', key: 'STOP', idx: i });
          found = true;
          break;
        }
      }
      if (found) break;
    }

    // Signature line
    if (RX_SIGNATURE.test(line)) {
      marks.push({ kind: 'stop', key: 'SIGNATURE', idx: i });
    }
  }

  // Find first occurrence of each desired section (store mark for inline content)
  const out: NoteSections = { CC: '', HPI: '', PEX: '', AP: '', COURSE: '' };
  const posMap: Record<string, Mark | null> = {};
  for (const k of DESIRED_KEYS) posMap[k] = null;

  for (const m of marks) {
    if (m.kind === 'start' && DESIRED_KEYS.includes(m.key as NoteSection) && posMap[m.key] == null) {
      posMap[m.key] = m;
    }
  }

  // Order sections by their position in the text
  const starts = DESIRED_KEYS
    .map(k => {
      const m = posMap[k];
      return { k, i: m ? m.idx : Infinity, inlineContent: m?.inlineContent };
    })
    .filter(x => x.i !== Infinity)
    .sort((a, b) => a.i - b.i);

  if (!starts.length) return out;

  // Sort all marks by index for boundary detection
  const sortedMarks = [...marks].sort((a, b) => a.idx - b.idx);

  for (const { k, i: startIdx, inlineContent } of starts) {
    // Find the next mark strictly after this start, skipping marks
    // that belong to the SAME section key (prevents back-to-back
    // headers like "Objective:" / "Physical Exam" from creating a
    // 0-line extraction window)
    let endIdx = lines.length;
    for (const m of sortedMarks) {
      if (m.idx > startIdx && !(m.kind === 'start' && m.key === k)) {
        endIdx = m.idx;
        break;
      }
    }

    // Build section text: prepend any inline content from the header line
    const bodyLines = lines.slice(startIdx + 1, endIdx).join('\n').trim();
    if (inlineContent) {
      out[k as NoteSection] = (inlineContent + '\n' + bodyLines).trim();
    } else {
      out[k as NoteSection] = bodyLines;
    }
  }

  return out;
}

// ── Function 2: Physician Filter ──────────────────────────────────────────

/**
 * Returns true if ≥2 of the 5 canonical sections have non-empty content.
 */
export function passesPhysicianFilter(sections: NoteSections): boolean {
  const keys: NoteSection[] = ['CC', 'HPI', 'PEX', 'AP', 'COURSE'];
  const count = keys.filter(k => sections[k].length > 0).length;
  return count >= 2;
}

// ── Function 3: Category Pre-Filter ───────────────────────────────────────

/**
 * Returns true if the note should be excluded based on its type text
 * matching known non-physician note categories.
 */
export function shouldExcludeByCategory(typeText: string): boolean {
  const cfg = getSectionTerms();
  const excludeList = cfg.NOTE_CATEGORY_EXCLUDE || [];
  const lower = (typeText || '').toLowerCase();
  if (!lower) return false;
  return excludeList.some(keyword => lower.includes(keyword));
}

// ── Function 4: Note Type Scorer ──────────────────────────────────────────

/**
 * Score based on note type (discharge summary, consult, H&P, etc.).
 * Checks tiers in order; first synonym match wins.
 */
export function scoreNoteType(typeText: string): number {
  const cfg = getNoteTypeScoring();
  const lower = (typeText || '').toLowerCase();
  if (!lower) return cfg.default_points;

  for (const tier of cfg.tiers) {
    for (const synonym of tier.synonyms) {
      if (lower.includes(synonym)) {
        return tier.points;
      }
    }
  }
  return cfg.default_points;
}

// ── Function 5: Specialty-Region Scorer ───────────────────────────────────

/**
 * Score based on whether the note's specialty matches the current
 * study's body regions.
 *
 * +3 for a region-specialist match, +1 for whole_body, 0 otherwise.
 */
export function scoreSpecialtyRegion(
  noteSpecialty: string,
  studyBodyRegions: string[],
): number {
  if (!noteSpecialty || !studyBodyRegions.length) return 0;

  const cfg = getSpecialtyGrouping();
  const lower = noteSpecialty.toLowerCase();

  // Check region match: does this specialty appear in ANY of the study's body regions?
  for (const region of studyBodyRegions) {
    const regionLower = region.toLowerCase();
    const regionSpecialties = cfg.region[regionLower];
    if (regionSpecialties && regionSpecialties.includes(lower)) {
      return 3;
    }
  }

  // Check whole_body
  if (cfg.whole_body.includes(lower)) return 1;

  return 0;
}

// ── Function 6: Recency Scorer ────────────────────────────────────────────

/**
 * Normalize a date string that may be in HL7 v2 format (yyyyMMddHHmmss)
 * into an ISO-parseable string. Already-ISO strings pass through unchanged.
 */
function normalizeDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);

  // HL7 v2 format: all digits, 8-14 chars (yyyyMMdd[HHmmss])
  const hl7Rx = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/;
  const m = hl7Rx.exec(dateStr);
  if (m) {
    const [, yr, mo, dy, hh, mm, ss] = m;
    return new Date(
      parseInt(yr), parseInt(mo) - 1, parseInt(dy),
      parseInt(hh || '0'), parseInt(mm || '0'), parseInt(ss || '0'),
    );
  }

  // Already ISO or other parseable format
  return new Date(dateStr);
}

/**
 * Piecewise linear recency decay:
 *   ≤1 month:   3 (flat)
 *   1–3 months: linear 3→2
 *   3–6 months: linear 2→1
 *   6–12 months: linear 1→0
 *   >12 months: 0
 */
export function scoreRecency(noteDateISO: string, studyDateISO: string): number {
  const noteDate = normalizeDate(noteDateISO);
  const studyDate = normalizeDate(studyDateISO);

  if (isNaN(noteDate.getTime()) || isNaN(studyDate.getTime())) return 0;

  const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
  const months = Math.max(0, (studyDate.getTime() - noteDate.getTime()) / msPerMonth);

  if (months <= 1) return 3;
  if (months <= 3) return 3 - (months - 1) * (1 / 2);      // 3→2 over 2 months
  if (months <= 6) return 2 - (months - 3) * (1 / 3);      // 2→1 over 3 months
  if (months <= 12) return 1 - (months - 6) * (1 / 6);     // 1→0 over 6 months
  return 0;
}

// ── Function 7: Section Quality Bonus ─────────────────────────────────────

/**
 * +1.0 if both HPI and AP found, +0.5 if either (not both), 0 otherwise.
 * COURSE does not contribute to this bonus.
 */
export function scoreSectionQuality(sections: NoteSections): number {
  const hasHPI = sections.HPI.length > 0;
  const hasAP = sections.AP.length > 0;
  if (hasHPI && hasAP) return 1.0;
  if (hasHPI || hasAP) return 0.5;
  return 0;
}

// ── Internal: Scored Note ─────────────────────────────────────────────────

interface ScoredNote {
  note: EhrNote;
  sections: NoteSections;
  breakdown: NoteRelevanceBreakdown;
  totalScore: number;
  passedFilter: boolean;
}

// ── Function 8: Full Pipeline ─────────────────────────────────────────────

/**
 * Run the complete note relevance scoring pipeline.
 *
 * @param notes          All clinical notes (already sorted date DESC by fhirDataService)
 * @param studyEncounterId  The encounter ID of the current imaging study
 * @param studyBodyRegions  Body region labels for the current study (e.g., ["Head"])
 * @param studyDateISO      Date/time of the current study
 * @param srMeta            ServiceRequest metadata for ordering-provider matching
 * @param readNoteText      Function to read note text from a file path
 * @returns                 NoteRelevanceResult[] for ALL notes (isRelevant=true for top 5)
 */
export function computeNoteRelevance(
  notes: EhrNote[],
  studyEncounterId: string,
  studyBodyRegions: string[],
  studyDateISO: string,
  srMeta: ServiceRequestMeta | null,
  readNoteText: (filePath: string) => string,
): NoteRelevanceResult[] {
  // ── Step 1: Category pre-filter + limit to 100 ──────────────────────
  const categoryPassing: EhrNote[] = [];
  for (const note of notes) {
    if (categoryPassing.length >= MAX_SCAN_NOTES) break;
    if (!shouldExcludeByCategory(note.type)) {
      categoryPassing.push(note);
    }
  }

  // ── Step 2: Section extraction on up to 50 notes ────────────────────
  const scored: ScoredNote[] = [];
  let extractionCount = 0;

  for (const note of categoryPassing) {
    if (extractionCount >= MAX_SECTION_EXTRACT) break;
    if (!note.textFilePath) continue;

    let text: string;
    try {
      text = readNoteText(note.textFilePath);
    } catch {
      continue;
    }
    extractionCount++;

    const sections = extractNoteSections(text);
    const passedFilter = passesPhysicianFilter(sections);

    // ── Step 3: Score the note ──────────────────────────────────────
    const sameEncounter = (note.encounterId && note.encounterId === studyEncounterId) ? 3 : 0;
    const noteType = scoreNoteType(note.type);
    const specialtyRegion = scoreSpecialtyRegion(note.specialty, studyBodyRegions);
    const recency = scoreRecency(note.date, studyDateISO);
    const sectionQuality = scoreSectionQuality(sections);

    const breakdown: NoteRelevanceBreakdown = {
      sameEncounter,
      noteType,
      specialtyRegion,
      recency: Math.round(recency * 100) / 100,
      sectionQuality,
    };

    const totalScore = sameEncounter + noteType + specialtyRegion + recency + sectionQuality;

    scored.push({
      note,
      sections,
      breakdown,
      totalScore: Math.round(totalScore * 100) / 100,
      passedFilter,
    });
  }

  // ── Step 4: Select top 5 from filter-passing notes ──────────────────
  const passing = scored
    .filter(s => s.passedFilter)
    .sort((a, b) => b.totalScore - a.totalScore || (b.note.date || '').localeCompare(a.note.date || ''));

  const selected: ScoredNote[] = [];
  const authorCounts = new Map<string, number>();

  function authorKey(note: EhrNote): string {
    return (note.authorRef || note.author || '').toLowerCase();
  }

  for (const s of passing) {
    if (selected.length >= TOP_N) break;
    const key = authorKey(s.note);
    const count = authorCounts.get(key) || 0;
    if (count >= MAX_PER_AUTHOR) continue;
    selected.push(s);
    authorCounts.set(key, count + 1);
  }

  // ── Step 5: Force-include ordering provider's note ──────────────────
  const selectedIds = new Set(selected.map(s => s.note.id));
  let orderingProviderNoteId: string | null = null;

  if (srMeta) {
    // Find the best ordering provider note: match authorRef + encounterId
    const opCandidates = scored
      .filter(s => {
        const refMatch = srMeta.requesterRef &&
          s.note.authorRef.toLowerCase() === srMeta.requesterRef.toLowerCase();
        const encMatch = srMeta.encounterId &&
          s.note.encounterId === srMeta.encounterId;
        return refMatch && encMatch;
      })
      .sort((a, b) => b.totalScore - a.totalScore || (b.note.date || '').localeCompare(a.note.date || ''));

    // If no exact ref+encounter match, try display name + encounter
    let opNote = opCandidates[0] || null;
    if (!opNote && srMeta.requesterDisplay) {
      const displayLower = srMeta.requesterDisplay.toLowerCase();
      const displayCandidates = scored
        .filter(s => {
          const nameMatch = s.note.author.toLowerCase() === displayLower;
          const encMatch = srMeta.encounterId &&
            s.note.encounterId === srMeta.encounterId;
          return nameMatch && encMatch;
        })
        .sort((a, b) => b.totalScore - a.totalScore);
      opNote = displayCandidates[0] || null;
    }

    if (opNote) {
      orderingProviderNoteId = opNote.note.id;
      if (!selectedIds.has(opNote.note.id)) {
        // Force-insert: bump the lowest-scoring selected note
        if (selected.length >= TOP_N) {
          // Remove the lowest-scoring note (last in sorted order)
          const bumped = selected.pop()!;
          selectedIds.delete(bumped.note.id);
          // Adjust author count for bumped note
          const bumpedKey = authorKey(bumped.note);
          const bumpedCount = authorCounts.get(bumpedKey) || 1;
          authorCounts.set(bumpedKey, bumpedCount - 1);
        }
        selected.push(opNote);
        selectedIds.add(opNote.note.id);
        const opKey = authorKey(opNote.note);
        authorCounts.set(opKey, (authorCounts.get(opKey) || 0) + 1);
      }
    }
  }

  // ── Step 6: Normalize scores ────────────────────────────────────────
  const selectedSet = new Set(selected.map(s => s.note.id));
  const topScore = selected.length > 0
    ? Math.max(...selected.map(s => s.totalScore))
    : 1;

  function roundTo5(pct: number): number {
    return Math.round(pct / 5) * 5;
  }

  // ── Step 7: Build results for ALL scored notes ──────────────────────
  const sectionKeys: NoteSection[] = ['CC', 'HPI', 'PEX', 'AP', 'COURSE'];

  const results: NoteRelevanceResult[] = scored.map(s => {
    const isRelevant = selectedSet.has(s.note.id);
    const isOP = s.note.id === orderingProviderNoteId;

    const rawPct = topScore > 0 ? (s.totalScore / topScore) * 100 : 0;
    const normalizedPercent = isRelevant ? roundTo5(rawPct) : 0;

    const sectionsFound: Record<NoteSection, boolean> = {} as Record<NoteSection, boolean>;
    for (const k of sectionKeys) {
      sectionsFound[k] = s.sections[k].length > 0;
    }

    return {
      noteId: s.note.id,
      totalScore: s.totalScore,
      normalizedPercent,
      isRelevant,
      isOrderingProvider: isOP,
      breakdown: s.breakdown,
      sectionsFound,
    };
  });

  // Also add results for notes that were not scored (excluded by category or over limit)
  const scoredIds = new Set(scored.map(s => s.note.id));
  for (const note of notes) {
    if (!scoredIds.has(note.id)) {
      results.push({
        noteId: note.id,
        totalScore: 0,
        normalizedPercent: 0,
        isRelevant: false,
        isOrderingProvider: false,
        breakdown: { sameEncounter: 0, noteType: 0, specialtyRegion: 0, recency: 0, sectionQuality: 0 },
        sectionsFound: { CC: false, HPI: false, PEX: false, AP: false, COURSE: false },
      });
    }
  }

  return results;
}

// ── ServiceRequest Loader ─────────────────────────────────────────────────

/**
 * Load ServiceRequest metadata for a given current study.
 * Scans the ServiceRequest directory for files matching the study description.
 */
export function loadServiceRequestMeta(
  fhirDir: string,
  studyDescription: string,
  studyEncounterId: string,
): ServiceRequestMeta | null {
  const srDir = path.join(fhirDir, 'ServiceRequest');
  if (!fs.existsSync(srDir)) return null;

  const files = fs.readdirSync(srDir).filter(f => f.endsWith('.json'));
  let bestMatch: ServiceRequestMeta | null = null;

  for (const f of files) {
    try {
      const sr = JSON.parse(fs.readFileSync(path.join(srDir, f), 'utf8'));

      // Only consider active/draft orders (not completed prior orders)
      if (sr.status === 'completed') continue;

      const codeText = (sr.code?.text || '').toLowerCase();
      const descLower = studyDescription.toLowerCase();
      const encRef = (sr.encounter?.reference || '').replace('Encounter/', '');

      // Match by code text similarity OR encounter match
      const codeMatch = codeText && descLower && (
        codeText.includes(descLower) || descLower.includes(codeText)
      );
      const encMatch = encRef === studyEncounterId;

      if (codeMatch || encMatch) {
        bestMatch = {
          requesterRef: sr.requester?.reference || '',
          requesterDisplay: sr.requester?.display || '',
          encounterId: encRef,
          authoredOn: sr.authoredOn || '',
        };
        // Prefer code match over encounter-only match
        if (codeMatch) break;
      }
    } catch { /* skip bad file */ }
  }

  return bestMatch;
}
