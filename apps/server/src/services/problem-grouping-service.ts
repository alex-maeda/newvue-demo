/**
 * problem-grouping-service.ts — Orchestrates the problem list deduplication
 * and relevancy scoring LLM pass.
 *
 * This service:
 *   1. Accepts the raw EHR problem list and current study context
 *   2. Assigns compact single-letter codes (A–Z, AA–AZ) to each problem
 *   3. Builds the prompt via the template in problem-grouping-v1.ts
 *   4. Invokes Claude (model selected from dev-settings.json)
 *   5. Parses the JSON response and maps compact codes back to FHIR IDs
 *   6. Constructs a QA entry for the right-rail audit panel
 *
 * Design decisions:
 *   - Never throws — errors are captured in the QA entry (same pattern
 *     as all other LLM passes in the summarization pipeline)
 *   - The problem list order (by recordedDate descending, from fhirDataService)
 *     is preserved in the compact code assignment for deterministic mapping
 *   - Empty problem lists short-circuit before any LLM invocation
 */

import type { CurrentStudy } from '../models/types';
import type {
  SummarizationQAEntry,
  ValidationResult,
} from '../models/summarization-types';
import type { EhrProblem } from './fhirDataService';
import { invokeClaude } from './claude-client';
import { getDevSettings } from './dev-settings-loader';
import { compactId } from '../utils/compact-id';
import {
  buildProblemGroupingPrompt,
  type ProblemPromptEntry,
} from '../prompt-templates/problem-grouping-v1';

// ── Public Types ──────────────────────────────────────────────────────────

/**
 * A single entry in the deduplicated, scored problem list.
 * Can represent either a merged group of related problems or a standalone problem.
 */
export interface ProblemGroupEntry {
  /** Unified heading (for groups) or original problem name (ungrouped) */
  name: string;
  /** Clinical relevancy score (0–10) relative to the current imaging study */
  score: number;
  /** FHIR Condition resource IDs belonging to this entry */
  memberIds: string[];
  /** Compact codes used in the LLM prompt (e.g., ["J", "K", "L"]) */
  memberCodes: string[];
  /** True if this entry merges 2+ raw problems; false if standalone */
  isGroup: boolean;
  /** Aggregated sentence IDs across all members (populated post-grouping) */
  sentenceSources?: string[];
  /** Earliest recordedDate across all member problems (for "New" chip) */
  oldestDate?: string;
  /** Per-member detail with individual sentence IDs for citation provenance */
  members?: ProblemMemberDetail[];
}

/**
 * Detail for a single member problem within a ProblemGroupEntry.
 */
export interface ProblemMemberDetail {
  id: string;
  name: string;
  sentenceIds: string[];
}

/**
 * Complete result of the problem grouping LLM pass.
 */
export interface ProblemGroupingResult {
  /** All grouped + ungrouped entries, sorted by score descending */
  entries: ProblemGroupEntry[];
  /** True if the patient has no problems (LLM was not called) */
  problemListEmpty: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Run the problem grouping and relevancy scoring LLM pass.
 *
 * Never throws — errors are captured in the returned QA entry.
 *
 * @param problems - Raw EHR problem list from fhirDataService
 * @param currentStudy - The imaging study being read
 * @returns Problem grouping result + QA entry for the audit panel
 */
export async function runProblemGrouping(
  problems: EhrProblem[],
  currentStudy: CurrentStudy,
): Promise<{ result: ProblemGroupingResult; qaEntry: SummarizationQAEntry }> {
  const startTime = Date.now();

  // ── Guard: empty problem list ──
  if (problems.length === 0) {
    console.log('[problem-grouping] No problems in patient record, skipping LLM call');
    return {
      result: {
        entries: [],
        problemListEmpty: true,
      },
      qaEntry: buildQAEntry(
        {},
        { skipped: 'empty problem list' },
        { input: 0, output: 0 },
        Date.now() - startTime,
      ),
    };
  }

  try {
    // ── Step 1: Build compact code mapping ──
    const codeToId = new Map<string, string>();
    const idToCode = new Map<string, string>();

    const promptProblems: ProblemPromptEntry[] = problems.map((p, i) => {
      const code = compactId(i);
      codeToId.set(code, p.id);
      idToCode.set(p.id, code);
      return {
        code,
        name: p.text,
        status: p.status || 'active',
        date: formatDate(p.recordedDate),
      };
    });

    const llmExtractedCount = problems.filter(p => p.status === 'llm-extracted').length;
    console.log(
      `[problem-grouping] Encoding ${problems.length} problems ` +
      `(${llmExtractedCount} LLM-extracted) as ${compactId(0)}–${compactId(problems.length - 1)}`,
    );

    // ── Step 2: Build prompt ──
    const { systemPrompt, userMessage } = buildProblemGroupingPrompt({
      studyDescription: currentStudy.studyDescription,
      bodyRegions: currentStudy.labels.bodyRegions,
      clinicalIndication: currentStudy.clinicalIndication || '',
      problems: promptProblems,
    });

    // ── Step 3: Invoke Claude ──
    const devSettings = getDevSettings();
    const modelConfig = devSettings.problemGrouping;

    console.log(
      `[problem-grouping] Invoking Claude (model=${modelConfig.modelId}, ` +
      `reasoning=${modelConfig.reasoningEffort}) for ${problems.length} problems...`,
    );

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

    // ── Step 4: Parse response ──
    if (!llmResult.parsedJson) {
      throw new Error('LLM response was not valid JSON');
    }

    const llmOutput = llmResult.parsedJson as Record<string, unknown>;
    const entries = parseGroupingResponse(llmOutput, codeToId, problems);

    const latencyMs = Date.now() - startTime;
    console.log(
      `[problem-grouping] Complete: ${entries.filter(e => e.isGroup).length} groups, ` +
      `${entries.filter(e => !e.isGroup).length} ungrouped, ` +
      `${llmResult.tokenUsage.input}+${llmResult.tokenUsage.output} tokens, ` +
      `${latencyMs}ms`,
    );

    return {
      result: {
        entries,
        problemListEmpty: false,
      },
      qaEntry: buildQAEntry(
        { systemPrompt, userMessage },
        llmOutput,
        llmResult.tokenUsage,
        latencyMs,
      ),
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[problem-grouping] Failed: ${errorMsg}`);

    return {
      result: {
        entries: [],
        problemListEmpty: false,
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

// ── Internal: Response Parsing ────────────────────────────────────────────

/**
 * Parse the LLM's JSON response into typed ProblemGroupEntry array.
 *
 * Validates that:
 *   - Every compact code maps to a known problem
 *   - No code appears in multiple groups
 *   - All problems are accounted for (groups + ungrouped)
 *
 * Missing problems are assigned a default score of 0 and logged.
 */
function parseGroupingResponse(
  llmOutput: Record<string, unknown>,
  codeToId: Map<string, string>,
  allProblems: EhrProblem[],
): ProblemGroupEntry[] {
  const entries: ProblemGroupEntry[] = [];
  const usedCodes = new Set<string>();

  // Parse groups
  const rawGroups = Array.isArray(llmOutput.groups) ? llmOutput.groups : [];
  for (const g of rawGroups) {
    const group = g as Record<string, unknown>;
    const name = String(group.name || 'Unnamed Group');
    const score = clampScore(group.score);
    const memberCodes = Array.isArray(group.members)
      ? (group.members as string[]).filter((c) => codeToId.has(c))
      : [];

    if (memberCodes.length < 2) {
      // Invalid group (< 2 members) — treat members as ungrouped
      for (const code of memberCodes) {
        if (!usedCodes.has(code)) {
          usedCodes.add(code);
          entries.push({
            name: findProblemName(code, codeToId, allProblems),
            score,
            memberIds: [codeToId.get(code)!],
            memberCodes: [code],
            isGroup: false,
          });
        }
      }
      continue;
    }

    // Valid group
    const memberIds: string[] = [];
    for (const code of memberCodes) {
      if (usedCodes.has(code)) continue; // Skip duplicates
      usedCodes.add(code);
      memberIds.push(codeToId.get(code)!);
    }

    entries.push({
      name,
      score,
      memberIds,
      memberCodes: memberCodes.filter(c => !usedCodes.has(c) || memberIds.includes(codeToId.get(c)!)),
      isGroup: true,
    });
  }

  // Parse ungrouped
  const rawUngrouped = Array.isArray(llmOutput.ungrouped) ? llmOutput.ungrouped : [];
  for (const u of rawUngrouped) {
    const item = u as Record<string, unknown>;
    const code = String(item.code || '');
    if (!codeToId.has(code) || usedCodes.has(code)) continue;

    usedCodes.add(code);
    entries.push({
      name: findProblemName(code, codeToId, allProblems),
      score: clampScore(item.score),
      memberIds: [codeToId.get(code)!],
      memberCodes: [code],
      isGroup: false,
    });
  }

  // Handle any problems the LLM missed (assign score 0)
  for (const [code, id] of codeToId) {
    if (!usedCodes.has(code)) {
      const problem = allProblems.find(p => p.id === id);
      console.warn(`[problem-grouping] LLM missed problem ${code} (${problem?.text}), assigning score 0`);
      entries.push({
        name: problem?.text || 'Unknown',
        score: 0,
        memberIds: [id],
        memberCodes: [code],
        isGroup: false,
      });
    }
  }

  // Sort by score descending
  entries.sort((a, b) => b.score - a.score);

  return entries;
}

// ── Internal: Helpers ─────────────────────────────────────────────────────

/** Clamp a score value to 0–10 integer range */
function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** Look up the original problem name from a compact code */
function findProblemName(
  code: string,
  codeToId: Map<string, string>,
  allProblems: EhrProblem[],
): string {
  const id = codeToId.get(code);
  if (!id) return 'Unknown';
  const problem = allProblems.find(p => p.id === id);
  return problem?.text || 'Unknown';
}

/**
 * Format a FHIR date string to YYYY-MM-DD.
 * Handles both YYYY-MM-DD and YYYYMMDD formats.
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return 'unknown';
  // Already in YYYY-MM-DD format
  if (dateStr.includes('-')) return dateStr.substring(0, 10);
  // YYYYMMDD format
  if (dateStr.length >= 8) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
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
    label: 'Problem Grouping',
    studyName: null,
    studyDate: null,
    accessionNumber: null,
    type: 'problem-grouping',
    inputData,
    outputData,
    validation: { passed: true, checks: [] },
    latencyMs,
    tokenUsage,
  };
}
