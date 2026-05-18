/**
 * note-triage-service.ts — Orchestrates sentence-level Problem Extraction
 * with per-note LLM batching and problem→sentence provenance mapping.
 *
 * This service:
 *   1. Re-extracts note sections from relevant notes (CC, HPI, PEX, AP, COURSE)
 *   2. Splits each section into sentences using the clinical sentence splitter
 *   3. Assigns flat IDs per note (A.01, A.02, ...) with section metadata
 *   4. Assigns compact codes to input EHR problems (A, B, ... Z, AA, AB, ...)
 *   5. Runs parallel per-note LLM calls (one call per note)
 *   6. Aggregates results: merges extracted problems + unions sentence mappings
 *   7. Converts code-keyed sentence map to ID-keyed map for downstream enrichment
 *   8. Constructs a QA entry labeled "Problem Extraction" for the right-rail panel
 *
 * Design decisions:
 *   - Per-note batching keeps each LLM call small (~50-80 sentences) for
 *     reliable Haiku performance vs. one large call with 300+ sentences
 *   - Parallel execution — all per-note calls run simultaneously
 *   - Cross-note duplicate extractions are left as-is; the downstream
 *     Problem Grouping step handles deduplication
 *   - Never throws — errors are captured in the QA entry (pipeline resiliency)
 *   - Uses the shared compactId() coding function (A, B, ..., Z, AA, AB, ...)
 *     which is the same scheme used by Problem Grouping, ensuring stable
 *     code↔problem alignment in the downstream enrichment step
 */

import fs from 'fs';
import type { CurrentStudy, NoteSection } from '../models/types';
import type {
  SummarizationQAEntry,
  NoteTriageResult,
  ExtractedProblem,
  SentenceSnippetIndex,
} from '../models/summarization-types';
import type { ContextQuery } from '../models/study-intent-types';
import type { EhrNote, EhrProblem } from './fhirDataService';
import { extractNoteSections } from './noteRelevanceService';
import { splitIntoSentences } from '../utils/sentence-splitter';
import { invokeClaude } from './claude-client';
import { getDevSettings } from './dev-settings-loader';
import { compactId } from '../utils/compact-id';
import {
  buildNoteTriagePrompt,
  type SentenceEntry,
  type CodedProblemEntry,
} from '../prompt-templates/note-triage-v1';

// ── Public Types ──────────────────────────────────────────────────────────

/** A relevant note with metadata needed for triage */
export interface RelevantNoteInput {
  /** Note metadata from FHIR data service */
  note: EhrNote;
  /** 0-based index for compact code assignment */
  noteIndex: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

const SECTION_KEYS: NoteSection[] = ['CC', 'HPI', 'PEX', 'AP', 'COURSE'];

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Run the sentence-level problem extraction with per-note LLM batching.
 *
 * Never throws — errors are captured in the returned QA entry.
 *
 * @param relevantNotes - Top relevant notes with text file paths
 * @param ehrProblems - Raw EHR problem list (coded and sent in prompt)
 * @param currentStudy - The imaging study being read
 * @returns Triage result + QA entry for the audit panel
 */
export async function runNoteTriage(
  relevantNotes: RelevantNoteInput[],
  ehrProblems: EhrProblem[],
  currentStudy: CurrentStudy,
  contextQueries: ContextQuery[] = [],
): Promise<{ result: NoteTriageResult; qaEntry: SummarizationQAEntry }> {
  const startTime = Date.now();

  // ── Guard: no relevant notes ──
  if (relevantNotes.length === 0) {
    console.log('[note-triage] No relevant notes provided, skipping LLM call');
    return {
      result: {
        extractedProblems: [],
        problemSentenceMap: {},
        contextSentenceMap: {},
        sentenceIndex: [],
        noRelevantNotes: true,
      },
      qaEntry: buildQAEntry(
        {},
        { skipped: 'no relevant notes' },
        { input: 0, output: 0 },
        Date.now() - startTime,
      ),
    };
  }

  try {
    // ── Step 1: Code the input problems ──
    const codedProblems: CodedProblemEntry[] = ehrProblems.map((p, i) => ({
      code: compactId(i),
      name: p.text,
      status: p.status,
      date: p.recordedDate || 'unknown',
    }));

    // Build reverse map: compact code → EHR problem ID (for converting to ID-keyed map)
    const codeToEhrId = new Map(codedProblems.map((cp, i) => [cp.code, ehrProblems[i].id]));

    // ── Step 2: Extract sections and split into sentences per note ──
    interface NoteData {
      noteCode: string;
      noteId: string;
      noteTitle: string;
      noteDate: string;
      sentences: SentenceEntry[];
      sentenceIndex: SentenceSnippetIndex[];
    }

    const noteDataList: NoteData[] = [];

    for (const { note, noteIndex } of relevantNotes) {
      if (!note.textFilePath) continue;

      let text: string;
      try {
        text = fs.readFileSync(note.textFilePath, 'utf8');
      } catch {
        console.warn(`[note-triage] Could not read note text: ${note.textFilePath}`);
        continue;
      }

      const sections = extractNoteSections(text);
      const noteCode = compactId(noteIndex);
      const noteTitle = `${note.type || 'Note'} by ${note.author || 'Unknown'} (${formatShortDate(note.date)})`;

      const sentences: SentenceEntry[] = [];
      const sentenceIndex: SentenceSnippetIndex[] = [];
      let sentenceCounter = 1;

      for (const key of SECTION_KEYS) {
        const sectionText = sections[key];
        if (!sectionText || !sectionText.trim()) continue;

        const splitSentences = splitIntoSentences(sectionText);

        for (const sentText of splitSentences) {
          const id = `${noteCode}.${String(sentenceCounter).padStart(2, '0')}`;
          sentenceCounter++;

          sentences.push({
            id,
            section: key,
            text: sentText,
          });

          sentenceIndex.push({
            id,
            noteId: note.id,
            noteTitle,
            section: key,
            text: sentText,
          });
        }
      }

      if (sentences.length > 0) {
        noteDataList.push({
          noteCode,
          noteId: note.id,
          noteTitle,
          noteDate: note.date,
          sentences,
          sentenceIndex,
        });
      }
    }

    // ── Guard: no extractable sentences ──
    const totalSentences = noteDataList.reduce((sum, nd) => sum + nd.sentences.length, 0);
    if (totalSentences === 0) {
      console.log('[note-triage] No sentences found in relevant notes, skipping LLM call');
      return {
        result: {
          extractedProblems: [],
          problemSentenceMap: {},
          contextSentenceMap: {},
          sentenceIndex: [],
          noRelevantNotes: false,
        },
        qaEntry: buildQAEntry(
          { noteCount: relevantNotes.length },
          { skipped: 'no extractable sentences' },
          { input: 0, output: 0 },
          Date.now() - startTime,
        ),
      };
    }

    console.log(
      `[note-triage] Prepared ${totalSentences} sentences from ${noteDataList.length} notes ` +
      `(${codedProblems.length} coded problems)`,
    );

    // ── Step 3: Run per-note LLM calls in parallel ──
    const devSettings = getDevSettings();
    const modelConfig = devSettings.noteTriage;

    console.log(
      `[note-triage] Launching ${noteDataList.length} parallel LLM calls ` +
      `(model=${modelConfig.modelId}, reasoning=${modelConfig.reasoningEffort})`,
    );

    const perNotePromises = noteDataList.map(async (nd) => {
      const { systemPrompt, userMessage } = buildNoteTriagePrompt({
        studyDescription: currentStudy.studyDescription,
        bodyRegions: currentStudy.labels.bodyRegions,
        problems: codedProblems,
        sentences: nd.sentences,
        noteTitle: nd.noteTitle,
        contextQueries,
      });

      // Build thinking params for thinking-capable models (Sonnet 4.6, Opus 4.7)
      const isThinkingCapable = modelConfig.modelId.includes('sonnet') || modelConfig.modelId.includes('opus');
      const thinkingParams = (
        isThinkingCapable && modelConfig.reasoningEffort !== 'none'
      ) ? {
        type: 'adaptive' as const,
        effort: modelConfig.reasoningEffort as 'low' | 'medium' | 'high',
      } : undefined;

      const llmResult = await invokeClaude({
        systemPrompt,
        userMessage,
        temperature: 0,
        modelId: modelConfig.modelId,
        thinking: thinkingParams,
      });

      return {
        noteCode: nd.noteCode,
        noteTitle: nd.noteTitle,
        noteDate: nd.noteDate,
        noteId: nd.noteId,
        sentenceIds: new Set(nd.sentences.map(s => s.id)),
        llmResult,
        systemPrompt,
        userMessage,
      };
    });

    const perNoteResults = await Promise.all(perNotePromises);

    // ── Step 4: Aggregate results across notes ──
    const allExtractedProblems: ExtractedProblem[] = [];
    const aggregatedMap: Record<string, Set<string>> = {};
    const contextAggregatedMap: Record<string, Set<string>> = {};
    let totalInput = 0;
    let totalOutput = 0;
    const perNoteQA: Array<Record<string, unknown>> = [];

    // Initialize aggregated map with all problem codes
    for (const cp of codedProblems) {
      aggregatedMap[cp.code] = new Set();
    }

    // Initialize context aggregated map with all query codes
    for (const q of contextQueries) {
      contextAggregatedMap[q.code] = new Set();
    }

    for (const pnr of perNoteResults) {
      totalInput += pnr.llmResult.tokenUsage.input;
      totalOutput += pnr.llmResult.tokenUsage.output;

      // Track per-note QA data
      perNoteQA.push({
        note: pnr.noteTitle,
        noteCode: pnr.noteCode,
        tokens: { input: pnr.llmResult.tokenUsage.input, output: pnr.llmResult.tokenUsage.output },
        systemPrompt: pnr.systemPrompt,
        userMessage: pnr.userMessage,
        rawOutput: pnr.llmResult.parsedJson || pnr.llmResult.content,
      });

      if (!pnr.llmResult.parsedJson) {
        console.warn(`[note-triage] Note ${pnr.noteCode} returned non-JSON response`);
        continue;
      }

      const llmOutput = pnr.llmResult.parsedJson as Record<string, unknown>;

      // Parse extracted problems
      const rawExtracted = Array.isArray(llmOutput.extractedProblems)
        ? llmOutput.extractedProblems
        : [];

      for (const ep of rawExtracted) {
        const item = ep as Record<string, unknown>;
        const name = String(item.name || '').trim();
        if (!name) continue;

        const sentIds = Array.isArray(item.sentences)
          ? (item.sentences as string[]).filter(
              (s) => typeof s === 'string' && pnr.sentenceIds.has(s),
            )
          : [];

        allExtractedProblems.push({
          name,
          sourceSentenceIds: sentIds,
          sourceNoteIds: [pnr.noteId],
          mostRecentNoteDate: pnr.noteDate || 'unknown',
        });
      }

      // Parse problem mappings
      const rawMappings = llmOutput.problemMappings as Record<string, unknown> | undefined;
      if (rawMappings && typeof rawMappings === 'object') {
        for (const [code, sentIds] of Object.entries(rawMappings)) {
          if (!aggregatedMap[code]) {
            // LLM output an unknown code — skip it
            continue;
          }
          if (Array.isArray(sentIds)) {
            for (const sid of sentIds) {
              if (typeof sid === 'string' && pnr.sentenceIds.has(sid)) {
                aggregatedMap[code].add(sid);
              }
            }
          }
        }
      }

      // Parse context mappings (TASK 3)
      const rawContext = llmOutput.contextMappings as Record<string, unknown> | undefined;
      if (rawContext && typeof rawContext === 'object') {
        for (const [code, sentIds] of Object.entries(rawContext)) {
          if (!contextAggregatedMap[code]) {
            // Unknown query code — skip
            continue;
          }
          if (Array.isArray(sentIds)) {
            for (const sid of sentIds) {
              if (typeof sid === 'string' && pnr.sentenceIds.has(sid)) {
                contextAggregatedMap[code].add(sid);
              }
            }
          }
        }
      }
    }

    // Convert code-keyed aggregation to ID-keyed problemSentenceMap
    const problemSentenceMap: Record<string, string[]> = {};
    for (const [code, sids] of Object.entries(aggregatedMap)) {
      const ehrId = codeToEhrId.get(code);
      if (ehrId) {
        problemSentenceMap[ehrId] = [...sids].sort();
      }
    }

    // Build the context sentence map (query code → sorted sentence IDs)
    const contextSentenceMap: Record<string, string[]> = {};
    for (const [code, sids] of Object.entries(contextAggregatedMap)) {
      const sorted = [...sids].sort();
      if (sorted.length > 0) {
        contextSentenceMap[code] = sorted;
      }
    }

    // Build the unified sentence index across all notes
    const sentenceIndex: SentenceSnippetIndex[] = noteDataList.flatMap(nd => nd.sentenceIndex);

    const latencyMs = Date.now() - startTime;
    const contextHits = Object.values(contextSentenceMap).filter(v => v.length > 0).length;
    console.log(
      `[note-triage] Complete: ${allExtractedProblems.length} new problems extracted, ` +
      `${Object.values(problemSentenceMap).filter(v => v.length > 0).length}/${codedProblems.length} problems mapped, ` +
      (contextQueries.length > 0 ? `${contextHits}/${contextQueries.length} context queries mapped, ` : '') +
      `${totalInput}+${totalOutput} tokens (${noteDataList.length} calls), ` +
      `${latencyMs}ms`,
    );

    return {
      result: {
        extractedProblems: allExtractedProblems,
        problemSentenceMap,
        contextSentenceMap,
        sentenceIndex,
        noRelevantNotes: false,
      },
      qaEntry: buildQAEntry(
        { perNoteInputs: perNoteQA },
        {
          extractedProblems: allExtractedProblems,
          problemSentenceMap,
          contextSentenceMap,
          noteCount: noteDataList.length,
          totalSentences,
        },
        { input: totalInput, output: totalOutput },
        latencyMs,
      ),
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[note-triage] Failed: ${errorMsg}`);

    return {
      result: {
        extractedProblems: [],
        problemSentenceMap: {},
        contextSentenceMap: {},
        sentenceIndex: [],
        noRelevantNotes: false,
      },
      qaEntry: buildQAEntry(
        {},
        { error: errorMsg },
        { input: 0, output: 0 },
        latencyMs,
      ),
    };
  }
}

// ── Internal: Two-Letter Problem Coding ───────────────────────────────────

/**
 * Generate a two-letter code from a 0-based index.
 * AA=0, AB=1, ..., AZ=25, BA=26, BB=27, ..., ZZ=675.
 *
 * Uses two-letter codes to avoid collision with single-letter note IDs.
 */
// twoLetterCode deleted — now using shared compactId() from ../utils/compact-id

// ── Internal: Helpers ─────────────────────────────────────────────────────

/** Format a date string to a short display format (e.g., "Sep 19, 2025") */
function formatShortDate(dateStr: string): string {
  if (!dateStr) return 'unknown date';

  // Handle YYYYMMDD format
  const hl7Rx = /^(\d{4})(\d{2})(\d{2})/;
  const m = hl7Rx.exec(dateStr);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Already ISO
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch { /* fall through */ }

  return dateStr;
}

// ── Internal: QA Entry Builder ────────────────────────────────────────────

function buildQAEntry(
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>,
  tokenUsage: { input: number; output: number },
  latencyMs: number,
): SummarizationQAEntry {
  return {
    label: 'Problem Extraction',
    studyName: null,
    studyDate: null,
    accessionNumber: null,
    type: 'note-triage',
    inputData,
    outputData,
    validation: { passed: true, checks: [] },
    latencyMs,
    tokenUsage,
  };
}
