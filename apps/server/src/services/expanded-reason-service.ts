/**
 * expanded-reason-service.ts — Orchestrates the Expanded Reason for Study
 * synthesis LLM pass.
 *
 * This service:
 *   1. Resolves snippet IDs → text using the sentence index from note triage
 *   2. Pre-filters findings, problems, and procedures (same thresholds as one-liner)
 *   3. Builds the prompt via expanded-reason-v1.ts
 *   4. Invokes Claude (Sonnet 4.6, no reasoning by default)
 *   5. Parses JSON output into ExpandedReasonForStudy
 *   6. Returns result + QA entry for the audit panel
 *
 * The synthesis pass runs after Note Triage + Problem Grouping have completed,
 * but before the One-Liner (which consumes the expanded reason as context).
 */

import type {
  SummarizationQAEntry,
  ExecutiveSummary,
  SentenceSnippetIndex,
} from '../models/summarization-types';
import type {
  StudyIntentResult,
  ContextQuery,
  ExpandedReasonForStudy,
  ExpandedReasonEntry,
  ExpandedReasonBlock,
  StudyPurpose,
} from '../models/study-intent-types';
import type { CurrentStudy } from '../models/types';
import type { EhrProcedure } from './fhirDataService';
import type { ProblemGroupEntry } from '../models/summarization-types';
import { invokeClaude } from './claude-client';
import { getDevSettings } from './dev-settings-loader';
import {
  buildExpandedReasonPrompt,
  type QuerySnippetGroup,
  type ExpandedReasonFinding,
  type ExpandedReasonProblem,
  type ExpandedReasonProcedure,
} from '../prompt-templates/expanded-reason-v1';

// ── Configuration ─────────────────────────────────────────────────────────

/** Minimum total relevancy score for a finding to be included */
const FINDING_SCORE_THRESHOLD = 4;
/** Maximum number of findings to include */
const MAX_FINDINGS = 8;
/** Minimum problem relevancy score for inclusion */
const PROBLEM_SCORE_THRESHOLD = 5;
/** Maximum number of problems to include */
const MAX_PROBLEMS = 8;
/** Maximum number of procedures to include */
const MAX_PROCEDURES = 4;

// ── Public Types ──────────────────────────────────────────────────────────

export interface ExpandedReasonInput {
  /** Deterministic study intent classification */
  studyIntent: StudyIntentResult;
  /** Context queries that were sent to note triage TASK 3 */
  contextQueries: ContextQuery[];
  /** Aggregated context sentence map from note triage (code → sentence IDs) */
  contextSentenceMap: Record<string, string[]>;
  /** Full sentence index from note triage (for resolving IDs → text) */
  sentenceIndex: SentenceSnippetIndex[];
  /** Verbatim clinical indication from the order */
  clinicalIndication: string;
  /** Current study metadata */
  currentStudy: CurrentStudy;
  /** Executive summary (for top findings) */
  executiveSummary: ExecutiveSummary | null;
  /** Problem grouping entries (for top problems) */
  problemGroupingEntries: ProblemGroupEntry[];
  /** EHR procedures */
  ehrProcedures: EhrProcedure[];
}

export interface ExpandedReasonOutput {
  result: ExpandedReasonForStudy;
  qaEntry: SummarizationQAEntry;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Run the Expanded Reason for Study synthesis pass.
 *
 * Resolves snippet IDs, pre-filters data, invokes Claude, and produces
 * a structured ExpandedReasonForStudy result.
 *
 * Returns null if there is nothing meaningful to synthesize
 * (no snippets AND no clinical indication text).
 */
export async function runExpandedReasonSynthesis(
  input: ExpandedReasonInput,
): Promise<ExpandedReasonOutput | null> {
  const startTime = Date.now();

  // ── Step 1: Build snippet index for fast lookup ──
  const sentenceMap = new Map<string, string>();
  for (const s of input.sentenceIndex) {
    sentenceMap.set(s.id, s.text);
  }

  // ── Step 2: Resolve snippet IDs → text for each query ──
  const querySnippets: QuerySnippetGroup[] = input.contextQueries.map((q) => {
    const sentenceIds = input.contextSentenceMap[q.code] || [];
    const snippets = sentenceIds
      .map((id) => sentenceMap.get(id))
      .filter((text): text is string => !!text);

    return {
      code: q.code,
      displayLabel: q.displayLabel,
      description: q.description,
      intentCategory: q.intentCategory,
      snippets,
    };
  });

  // ── Step 3: Check if there's anything to synthesize ──
  const totalSnippets = querySnippets.reduce((sum, q) => sum + q.snippets.length, 0);
  const hasIndication = !!(input.clinicalIndication && input.clinicalIndication.trim());

  if (totalSnippets === 0 && !hasIndication) {
    console.log('[expanded-reason] No snippets and no clinical indication — skipping synthesis');
    return null;
  }

  // ── Step 4: Pre-filter findings ──
  const topFindings = preFilterFindings(input.executiveSummary);

  // ── Step 5: Pre-filter problems ──
  const topProblems = preFilterProblems(input.problemGroupingEntries);

  // ── Step 6: Pre-filter procedures ──
  const topProcedures = preFilterProcedures(input.ehrProcedures);

  // ── Step 7: Build prompt ──
  const promptContext = {
    primaryPurpose: input.studyIntent.primary,
    secondaryPurpose: input.studyIntent.secondary,
    clinicalIndication: input.clinicalIndication,
    studyDescription: input.currentStudy.studyDescription,
    bodyRegions: input.currentStudy.labels.bodyRegions,
    modality: input.currentStudy.labels.modality,
    querySnippets,
    topFindings,
    topProblems,
    topProcedures,
  };

  const { systemPrompt, userMessage } = buildExpandedReasonPrompt(promptContext);

  // ── Step 8: Invoke Claude ──
  const devSettings = getDevSettings();
  const { modelId, reasoningEffort } = devSettings.expandedReason;

  console.log(
    `[expanded-reason] Invoking Claude (${modelId}): ` +
    `${totalSnippets} snippets, ${querySnippets.length} queries, ` +
    `${topFindings.length} findings, ${topProblems.length} problems`,
  );

  const isThinkingCapable = modelId.includes('sonnet') || modelId.includes('opus');
  const thinkingParams = (
    isThinkingCapable && reasoningEffort !== 'none'
  ) ? {
    type: 'adaptive' as const,
    effort: reasoningEffort as 'low' | 'medium' | 'high',
  } : undefined;

  const llmResult = await invokeClaude({
    systemPrompt,
    userMessage,
    temperature: 0,
    maxOutputTokens: thinkingParams ? 4096 : 1024,
    modelId,
    thinking: thinkingParams,
  });

  const latencyMs = Date.now() - startTime;
  const llmOutput = llmResult.parsedJson as Record<string, unknown> | null;

  // ── Step 9: Parse output into ExpandedReasonForStudy ──
  const result = parseOutput(
    llmOutput,
    input.studyIntent,
    input.contextQueries,
    input.clinicalIndication,
  );

  console.log(
    `[expanded-reason] Complete: ${latencyMs}ms, ` +
    `primary=${result.primary.entries.length} entries` +
    (result.secondary ? `, secondary=${result.secondary.entries.length} entries` : ''),
  );

  return {
    result,
    qaEntry: buildQAEntry(
      { systemPrompt, userMessage },
      llmOutput || {},
      latencyMs,
      llmResult.tokenUsage,
    ),
  };
}

// ── Internal: Output Parsing ──────────────────────────────────────────────

function parseOutput(
  llmOutput: Record<string, unknown> | null,
  intent: StudyIntentResult,
  queries: ContextQuery[],
  clinicalIndication: string,
): ExpandedReasonForStudy {
  const primaryQueries = queries.filter((q) => q.intentCategory === 'primary');
  const secondaryQueries = queries.filter((q) => q.intentCategory === 'secondary');

  // Parse primary block
  const primaryBlock = parseIntentBlock(
    intent.primary,
    primaryQueries,
    (llmOutput?.primary as Record<string, unknown>) || {},
  );

  // Parse secondary block
  let secondaryBlock: ExpandedReasonBlock | null = null;
  if (intent.secondary && secondaryQueries.length > 0 && llmOutput?.secondary) {
    secondaryBlock = parseIntentBlock(
      intent.secondary,
      secondaryQueries,
      llmOutput.secondary as Record<string, unknown>,
    );
    // Don't include secondary if it produced no entries
    if (secondaryBlock.entries.length === 0) {
      secondaryBlock = null;
    }
  }

  return {
    primary: primaryBlock,
    secondary: secondaryBlock,
    clinicalIndication: clinicalIndication || '',
  };
}

function parseIntentBlock(
  purpose: StudyPurpose,
  queries: ContextQuery[],
  data: Record<string, unknown>,
): ExpandedReasonBlock {
  const entries: ExpandedReasonEntry[] = [];

  for (const q of queries) {
    const value = data[q.code];
    if (typeof value === 'string' && value.trim()) {
      entries.push({
        code: q.code,
        displayLabel: q.displayLabel,
        content: value.trim(),
      });
    }
    // null or missing → skip (don't render empty rows)
  }

  return { purpose, entries };
}

// ── Internal: Pre-Filtering ───────────────────────────────────────────────

function preFilterFindings(
  executiveSummary: ExecutiveSummary | null,
): ExpandedReasonFinding[] {
  if (!executiveSummary) return [];

  const candidates: ExpandedReasonFinding[] = [];
  for (const region of executiveSummary.regionGroups) {
    for (const finding of region.findings) {
      const total = finding.relevancyScore?.total ?? 0;
      if (total < FINDING_SCORE_THRESHOLD) continue;

      const trend = finding.chips
        .find((c) => ['NEW', 'PROGRESSING', 'STABLE', 'IMPROVING', 'RESOLVED'].includes(c.toUpperCase()));

      candidates.push({
        name: finding.name,
        score: total,
        trend: trend ? trend.toLowerCase() : null,
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FINDINGS);
}

function preFilterProblems(
  entries: ProblemGroupEntry[],
): ExpandedReasonProblem[] {
  if (!entries || entries.length === 0) return [];

  return entries
    .filter((e) => e.score >= PROBLEM_SCORE_THRESHOLD)
    .map((e) => ({ name: e.name, score: e.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROBLEMS);
}

function preFilterProcedures(
  ehrProcedures: EhrProcedure[],
): ExpandedReasonProcedure[] {
  if (!ehrProcedures || ehrProcedures.length === 0) return [];

  return ehrProcedures.slice(0, MAX_PROCEDURES).map((p) => ({
    name: p.text,
    date: p.date || 'unknown',
    bodySite: p.bodySite || '',
  }));
}

// ── Internal: QA Entry Builder ────────────────────────────────────────────

function buildQAEntry(
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>,
  latencyMs: number,
  tokenUsage: { input: number; output: number },
): SummarizationQAEntry {
  return {
    label: 'Expanded Reason for Study',
    studyName: null,
    studyDate: null,
    accessionNumber: null,
    type: 'expanded-reason',
    inputData,
    outputData,
    validation: { passed: true, checks: [] },
    latencyMs,
    tokenUsage,
  };
}
