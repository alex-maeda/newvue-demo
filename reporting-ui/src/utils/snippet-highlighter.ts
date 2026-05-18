/**
 * snippet-highlighter.ts — Text matching and segment building for inline
 * report highlighting.
 *
 * Matches sentence snippets (from the Tier 1 sentence index) back to their
 * positions in the original report text, producing a segment array that the
 * HighlightedReportText component renders as alternating plain/highlighted spans.
 *
 * Matching strategy:
 *   1. Filter sentence index entries for the current report section
 *   2. Walk entries in ID order, using indexOf(snippetText, cursor) to find
 *      each match — the cursor advances past each match to leverage the
 *      sequential ordering of sentence IDs
 *   3. Split the section text into alternating plain/highlighted segments
 *
 * This sequential cursor approach serves as the disambiguation safety net
 * described in the design: if a snippet appears multiple times in the text,
 * we match the occurrence closest to (but after) the previous snippet.
 */

import type { ExtractedFinding, SentenceSnippetIndex } from '../types/api';

// ── Public Types ──────────────────────────────────────────────────────────

/** A contiguous segment of report text — either plain or highlighted */
export interface HighlightSegment {
  /** The text content of this segment */
  text: string;
  /**
   * When non-null, this segment is highlighted.
   * Contains the snippet IDs that cover this span of text.
   */
  snippetIds: string[] | null;
}

/**
 * Reverse map: snippet ID → alphabetically sorted finding names.
 * Built once per analysis, shared across all sections.
 */
export type SnippetFindingMap = Record<string, string[]>;

/**
 * A finding whose source text could not be located in the report.
 * Displayed in the warning footer.
 */
export interface UnmatchedFinding {
  name: string;
  snippetIds: string[];
}

// ── Section Label Mapping ─────────────────────────────────────────────────

/**
 * Map from sentence index section labels (used in the prompt template)
 * to the report section keys used by the Study.reportSections interface.
 *
 * The prompt template uses uppercase labels like "IMPRESSION", "FINDINGS";
 * the client uses camelCase keys like "impression", "findings".
 */
const SECTION_LABEL_TO_KEY: Record<string, string> = {
  'IMPRESSION': 'impression',
  'FINDINGS': 'findings',
  'COMPARISON': 'comparison',
  'CLINICAL HISTORY': 'clinicalIndication',
  'FULL TEXT': 'rawText',
};

const KEY_TO_SECTION_LABELS: Record<string, string[]> = {};
for (const [label, key] of Object.entries(SECTION_LABEL_TO_KEY)) {
  if (!KEY_TO_SECTION_LABELS[key]) KEY_TO_SECTION_LABELS[key] = [];
  KEY_TO_SECTION_LABELS[key].push(label);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build a reverse map from snippet IDs to finding names.
 *
 * Iterates through all findings and their sourceSentenceIds to produce
 * a map where each snippet ID points to an alphabetically sorted list
 * of finding names that cite that snippet as source material.
 */
export function buildSnippetFindingMap(findings: ExtractedFinding[]): SnippetFindingMap {
  const map: SnippetFindingMap = {};

  for (const finding of findings) {
    const sentenceIds = finding.sourceSentenceIds;
    if (!sentenceIds || sentenceIds.length === 0) continue;

    for (const sid of sentenceIds) {
      if (!map[sid]) map[sid] = [];
      if (!map[sid].includes(finding.name)) {
        map[sid].push(finding.name);
      }
    }
  }

  // Sort each finding list alphabetically for consistent display
  for (const sid of Object.keys(map)) {
    map[sid].sort((a, b) => a.localeCompare(b));
  }

  return map;
}

/**
 * Split a report section's text into highlighted and non-highlighted segments.
 *
 * @param sectionText   Full text of the report section
 * @param sectionKey    Report section key (e.g., "findings", "impression")
 * @param sentenceIndex Full sentence index from the PriorReportAnalysis
 * @param snippetFindingMap  Reverse map from snippet IDs to finding names
 * @returns Array of segments for rendering (plain text + highlighted spans)
 */
export function buildHighlightSegments(
  sectionText: string,
  sectionKey: string,
  sentenceIndex: SentenceSnippetIndex[],
  snippetFindingMap: SnippetFindingMap,
): HighlightSegment[] {
  if (!sectionText || sectionText.trim().length === 0) return [];

  // Determine which section labels correspond to this section key
  const matchingLabels = KEY_TO_SECTION_LABELS[sectionKey] || [];
  if (matchingLabels.length === 0) {
    // No mapping — return as plain text
    return [{ text: sectionText, snippetIds: null }];
  }

  // Filter sentence index for entries belonging to this section
  // AND that have at least one finding associated with them
  const sectionSnippets = sentenceIndex
    .filter((entry) =>
      matchingLabels.includes(entry.section) && snippetFindingMap[entry.id],
    )
    .sort((a, b) => {
      // Sort by numeric suffix to preserve document order
      const numA = parseInt(a.id.split('.')[1] || '0', 10);
      const numB = parseInt(b.id.split('.')[1] || '0', 10);
      return numA - numB;
    });

  if (sectionSnippets.length === 0) {
    return [{ text: sectionText, snippetIds: null }];
  }

  // ── Sequential matching with cursor advancement ──
  // Walk through snippets in order, finding each in the text starting from
  // the position after the previous match (safety net for duplicate text).

  const matches: Array<{ start: number; end: number; snippetId: string }> = [];
  let cursor = 0;

  for (const snippet of sectionSnippets) {
    const searchText = snippet.text.trim();
    if (searchText.length === 0) continue;

    const matchIndex = sectionText.indexOf(searchText, cursor);
    if (matchIndex === -1) {
      // Try from the beginning as a fallback (snippet may appear earlier
      // due to section reordering or the LLM citing sentences out of order)
      const fallbackIndex = sectionText.indexOf(searchText);
      if (fallbackIndex !== -1) {
        matches.push({
          start: fallbackIndex,
          end: fallbackIndex + searchText.length,
          snippetId: snippet.id,
        });
        // Don't advance cursor for out-of-order matches
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
    return [{ text: sectionText, snippetIds: null }];
  }

  // Sort matches by start position (may differ from ID order due to fallbacks)
  matches.sort((a, b) => a.start - b.start);

  // ── Build segments ──
  // Walk through the text, emitting plain segments for gaps and highlighted
  // segments for matches. Overlapping matches are merged into the same segment
  // with multiple snippet IDs.

  const segments: HighlightSegment[] = [];
  let pos = 0;

  for (const match of matches) {
    // Handle overlap: if this match starts before the current position,
    // it overlaps with the previous match. Add the snippet ID to the
    // previous segment instead of creating a new one.
    if (match.start < pos) {
      // Find the most recent highlighted segment and add this snippet ID
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && lastSeg.snippetIds) {
        if (!lastSeg.snippetIds.includes(match.snippetId)) {
          lastSeg.snippetIds.push(match.snippetId);
        }
      }
      // Extend the segment if this match extends past the previous one
      if (match.end > pos) {
        // There's a tail portion not covered by the previous segment
        const overlapEnd = pos;
        const tailText = sectionText.substring(overlapEnd, match.end);
        segments.push({ text: tailText, snippetIds: [match.snippetId] });
        pos = match.end;
      }
      continue;
    }

    // Plain text gap before this match
    if (match.start > pos) {
      segments.push({
        text: sectionText.substring(pos, match.start),
        snippetIds: null,
      });
    }

    // Highlighted segment
    segments.push({
      text: sectionText.substring(match.start, match.end),
      snippetIds: [match.snippetId],
    });
    pos = match.end;
  }

  // Trailing plain text after the last match
  if (pos < sectionText.length) {
    segments.push({
      text: sectionText.substring(pos),
      snippetIds: null,
    });
  }

  return segments;
}

/**
 * Identify findings whose source text could not be matched in the report.
 *
 * Compares the snippet IDs referenced by findings against the IDs that
 * were successfully matched during segment building.
 *
 * @param findings       All extracted findings for this report
 * @param sentenceIndex  Full sentence index from the analysis
 * @param matchedSnippetIds  Set of snippet IDs that were successfully matched
 * @returns Findings with at least one unmatched snippet (for the warning footer)
 */
export function findUnmatchedFindings(
  findings: ExtractedFinding[],
  allSegments: HighlightSegment[][],
): UnmatchedFinding[] {
  // Collect all snippet IDs that appear in highlighted segments
  const matchedIds = new Set<string>();
  for (const segments of allSegments) {
    for (const seg of segments) {
      if (seg.snippetIds) {
        for (const id of seg.snippetIds) {
          matchedIds.add(id);
        }
      }
    }
  }

  // Check each finding for unmatched snippet IDs
  const unmatched: UnmatchedFinding[] = [];

  for (const finding of findings) {
    const sentenceIds = finding.sourceSentenceIds;
    if (!sentenceIds || sentenceIds.length === 0) continue;

    const missingIds = sentenceIds.filter((id) => !matchedIds.has(id));
    if (missingIds.length === sentenceIds.length) {
      // ALL snippets unmatched — finding is fully untraceable
      unmatched.push({ name: finding.name, snippetIds: missingIds });
    }
  }

  return unmatched;
}

/**
 * Collect the unique finding names for a set of snippet IDs.
 * Returns an alphabetically sorted array.
 */
export function getFindingsForSnippets(
  snippetIds: string[],
  snippetFindingMap: SnippetFindingMap,
): string[] {
  const names = new Set<string>();
  for (const id of snippetIds) {
    const findings = snippetFindingMap[id];
    if (findings) {
      for (const name of findings) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
