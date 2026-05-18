/**
 * note-snippet-highlighter.ts — Text matching and segment building for inline
 * clinical note highlighting.
 *
 * Adapts the radiology report snippet-highlighter pattern for clinical notes.
 * Instead of matching within structured report sections (FINDINGS, IMPRESSION),
 * this utility matches sentence snippets against the full raw note text.
 *
 * Data sources combined into a single reverse map:
 *   1. EHR problems — via NoteTriageResult.problemSentenceMap
 *   2. Extracted problems — via ExtractedProblem.sourceSentenceIds
 *   3. Reason-for-study context queries — via NoteTriageResult.contextSentenceMap
 *
 * The matching algorithm reuses the same cursor-advancing indexOf() approach
 * from snippet-highlighter.ts for disambiguation of duplicate text.
 */

import type {
  NoteTriageResult,
  ExtractedProblem,
  SentenceSnippetIndex,
  ExpandedReasonForStudy,
} from '../types/api';
import type { EhrProblem } from '../types/ehrTypes';
import type { HighlightSegment, SnippetFindingMap } from './snippet-highlighter';

// Re-export types that consumers need
export type { HighlightSegment, SnippetFindingMap };

// ── Public Types ──────────────────────────────────────────────────────────

/**
 * A problem whose source text could not be located in the note.
 * Displayed in the warning footer (context query items are excluded).
 */
export interface UnmatchedProblem {
  name: string;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Quick predicate: does this note appear in the triage sentence index?
 * Returns true if the note was part of the analyzed batch.
 */
export function isNoteAnalyzed(
  noteId: string,
  noteTriage: NoteTriageResult | null | undefined,
): boolean {
  if (!noteTriage?.sentenceIndex || noteTriage.sentenceIndex.length === 0) return false;
  return noteTriage.sentenceIndex.some((entry) => entry.noteId === noteId);
}

/**
 * Build a reverse map: sentenceId → display names.
 *
 * Merges three data sources:
 *   1. EHR problems: problemSentenceMap keys are ehrProblemIds → resolve to EhrProblem.text
 *   2. Extracted problems: each has sourceSentenceIds → display the .name field
 *   3. Context queries: contextSentenceMap keys are short codes like "DX-PRES"
 *      → resolve to the full displayLabel from ExpandedReasonForStudy entries
 *
 * The resulting map is keyed by sentence ID and values are alphabetically sorted
 * display names, compatible with the SnippetFindingMap interface.
 */
export function buildNoteSnippetMap(
  noteTriage: NoteTriageResult,
  ehrProblems: EhrProblem[],
  expandedReason: ExpandedReasonForStudy | null | undefined,
): SnippetFindingMap {
  const map: SnippetFindingMap = {};

  // Helper to add a name to a sentence ID
  function addEntry(sentenceId: string, displayName: string) {
    if (!map[sentenceId]) map[sentenceId] = [];
    if (!map[sentenceId].includes(displayName)) {
      map[sentenceId].push(displayName);
    }
  }

  // Build EHR problem ID → name lookup
  const ehrProblemLookup = new Map<string, string>();
  for (const p of ehrProblems) {
    ehrProblemLookup.set(p.id, p.text);
  }

  // 1. EHR problems via problemSentenceMap
  for (const [ehrProblemId, sentenceIds] of Object.entries(noteTriage.problemSentenceMap)) {
    const problemName = ehrProblemLookup.get(ehrProblemId);
    if (!problemName) continue;
    for (const sid of sentenceIds) {
      addEntry(sid, problemName);
    }
  }

  // 2. Extracted problems via sourceSentenceIds
  for (const ep of noteTriage.extractedProblems) {
    if (!ep.name || !ep.sourceSentenceIds || ep.sourceSentenceIds.length === 0) continue;
    for (const sid of ep.sourceSentenceIds) {
      addEntry(sid, ep.name);
    }
  }

  // 3. Context queries via contextSentenceMap
  //    Resolve short codes → full display labels from ExpandedReasonForStudy
  const codeLabelLookup = buildContextCodeLabelMap(expandedReason);
  for (const [code, sentenceIds] of Object.entries(noteTriage.contextSentenceMap)) {
    const displayLabel = codeLabelLookup.get(code) || formatCodeFallback(code);
    for (const sid of sentenceIds) {
      addEntry(sid, displayLabel);
    }
  }

  // Sort each entry's display names alphabetically
  for (const sid of Object.keys(map)) {
    map[sid].sort((a, b) => a.localeCompare(b));
  }

  return map;
}

/**
 * Build highlight segments for a clinical note's full text.
 *
 * Filters the sentenceIndex for entries belonging to the given noteId,
 * then runs the cursor-advancing indexOf() algorithm against the full
 * note text to produce alternating plain/highlighted segments.
 *
 * @param noteText      Full raw text of the clinical note
 * @param noteId        FHIR note ID to filter sentence index entries
 * @param sentenceIndex Full sentence index from NoteTriageResult
 * @param snippetMap    Reverse map from buildNoteSnippetMap()
 * @returns Array of HighlightSegment for rendering
 */
export function buildNoteHighlightSegments(
  noteText: string,
  noteId: string,
  sentenceIndex: SentenceSnippetIndex[],
  snippetMap: SnippetFindingMap,
): HighlightSegment[] {
  if (!noteText || noteText.trim().length === 0) return [];

  // Filter sentence index for this note AND entries that have at least
  // one associated display name in the snippet map
  const noteSnippets = sentenceIndex
    .filter((entry) => entry.noteId === noteId && snippetMap[entry.id])
    .sort((a, b) => {
      // Sort by numeric suffix to preserve document order
      const numA = parseInt(a.id.split('.')[1] || '0', 10);
      const numB = parseInt(b.id.split('.')[1] || '0', 10);
      return numA - numB;
    });

  if (noteSnippets.length === 0) {
    return [{ text: noteText, snippetIds: null }];
  }

  // ── Sequential matching with cursor advancement ──
  const matches: Array<{ start: number; end: number; snippetId: string }> = [];
  let cursor = 0;

  for (const snippet of noteSnippets) {
    const searchText = snippet.text.trim();
    if (searchText.length === 0) continue;

    const matchIndex = noteText.indexOf(searchText, cursor);
    if (matchIndex === -1) {
      // Fallback: try from the beginning (out-of-order sentence)
      const fallbackIndex = noteText.indexOf(searchText);
      if (fallbackIndex !== -1) {
        matches.push({
          start: fallbackIndex,
          end: fallbackIndex + searchText.length,
          snippetId: snippet.id,
        });
      }
      continue;
    }

    matches.push({
      start: matchIndex,
      end: matchIndex + searchText.length,
      snippetId: snippet.id,
    });
    cursor = matchIndex + searchText.length;
  }

  if (matches.length === 0) {
    return [{ text: noteText, snippetIds: null }];
  }

  // Sort by start position
  matches.sort((a, b) => a.start - b.start);

  // ── Build segments ──
  const segments: HighlightSegment[] = [];
  let pos = 0;

  for (const match of matches) {
    // Handle overlap
    if (match.start < pos) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg?.snippetIds) {
        if (!lastSeg.snippetIds.includes(match.snippetId)) {
          lastSeg.snippetIds.push(match.snippetId);
        }
      }
      if (match.end > pos) {
        const tailText = noteText.substring(pos, match.end);
        segments.push({ text: tailText, snippetIds: [match.snippetId] });
        pos = match.end;
      }
      continue;
    }

    // Plain text gap before this match
    if (match.start > pos) {
      segments.push({
        text: noteText.substring(pos, match.start),
        snippetIds: null,
      });
    }

    // Highlighted segment
    segments.push({
      text: noteText.substring(match.start, match.end),
      snippetIds: [match.snippetId],
    });
    pos = match.end;
  }

  // Trailing plain text
  if (pos < noteText.length) {
    segments.push({
      text: noteText.substring(pos),
      snippetIds: null,
    });
  }

  return segments;
}

/**
 * Find problems (EHR + extracted) whose source snippets could NOT be matched
 * in the note text. Context query items are deliberately EXCLUDED — only
 * problems trigger the unmatched warning.
 *
 * @param noteTriage      Full triage result
 * @param ehrProblems     EHR problem list (for resolving IDs → names)
 * @param noteId          The note being displayed
 * @param matchedSegments Segments produced by buildNoteHighlightSegments
 * @returns Problems with untraceable source text
 */
export function findUnmatchedProblems(
  noteTriage: NoteTriageResult,
  ehrProblems: EhrProblem[],
  noteId: string,
  matchedSegments: HighlightSegment[],
): UnmatchedProblem[] {
  // Collect all snippet IDs that were successfully matched
  const matchedIds = new Set<string>();
  for (const seg of matchedSegments) {
    if (seg.snippetIds) {
      for (const id of seg.snippetIds) {
        matchedIds.add(id);
      }
    }
  }

  // Build set of sentence IDs that belong to this note
  const noteSnippetIds = new Set(
    noteTriage.sentenceIndex
      .filter((entry) => entry.noteId === noteId)
      .map((entry) => entry.id),
  );

  const unmatched: UnmatchedProblem[] = [];
  const seen = new Set<string>();

  // Build EHR problem ID → name lookup
  const ehrProblemLookup = new Map<string, string>();
  for (const p of ehrProblems) {
    ehrProblemLookup.set(p.id, p.text);
  }

  // 1. Check EHR problems from problemSentenceMap
  for (const [ehrProblemId, sentenceIds] of Object.entries(noteTriage.problemSentenceMap)) {
    const problemName = ehrProblemLookup.get(ehrProblemId);
    if (!problemName) continue;

    // Filter to sentence IDs belonging to this note
    const noteSpecificIds = sentenceIds.filter((sid) => noteSnippetIds.has(sid));
    if (noteSpecificIds.length === 0) continue;

    // Check if ALL note-specific IDs are unmatched
    const allUnmatched = noteSpecificIds.every((sid) => !matchedIds.has(sid));
    if (allUnmatched && !seen.has(problemName)) {
      unmatched.push({ name: problemName });
      seen.add(problemName);
    }
  }

  // 2. Check extracted problems
  for (const ep of noteTriage.extractedProblems) {
    if (!ep.name || !ep.sourceSentenceIds || ep.sourceSentenceIds.length === 0) continue;
    // Only check if this extracted problem references this note
    if (!ep.sourceNoteIds?.includes(noteId)) continue;

    const noteSpecificIds = ep.sourceSentenceIds.filter((sid) => noteSnippetIds.has(sid));
    if (noteSpecificIds.length === 0) continue;

    const allUnmatched = noteSpecificIds.every((sid) => !matchedIds.has(sid));
    if (allUnmatched && !seen.has(ep.name)) {
      unmatched.push({ name: ep.name });
      seen.add(ep.name);
    }
  }

  // NOTE: contextSentenceMap items are deliberately NOT checked here.
  // We don't show warnings for reason-for-study data fields.

  return unmatched;
}

// ── Internal Helpers ──────────────────────────────────────────────────────

/**
 * Build a lookup: context query code → human-readable display label.
 * Sources labels from the ExpandedReasonForStudy entries.
 */
function buildContextCodeLabelMap(
  expandedReason: ExpandedReasonForStudy | null | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!expandedReason) return lookup;

  for (const entry of expandedReason.primary.entries) {
    lookup.set(entry.code, entry.displayLabel);
  }
  if (expandedReason.secondary) {
    for (const entry of expandedReason.secondary.entries) {
      lookup.set(entry.code, entry.displayLabel);
    }
  }

  return lookup;
}

/**
 * Fallback: convert a short code like "DX-PRES" to a readable label
 * "Dx Pres" when no ExpandedReasonForStudy entry is available.
 */
function formatCodeFallback(code: string): string {
  return code
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
