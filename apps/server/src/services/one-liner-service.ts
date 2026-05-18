/**
 * one-liner-service.ts — Orchestrates the One Liner synthesis pass.
 *
 * This is the final LLM call in the pipeline. It:
 *   1. Deterministically pre-filters findings, problems, and procedures
 *   2. Builds a compact data packet for the LLM
 *   3. Invokes Claude (Sonnet 4.6 default) to produce two one-liners
 *   4. Returns a fallback deterministic string if no significant data exists
 *
 * The pre-filtering is aggressive — only clinically significant items
 * reach the LLM. This keeps the input compact, the output focused,
 * and the cost/latency low.
 */

import type {
  ExecutiveSummary,
  ExecutiveFinding,
  OneLinerResult,
  SummarizationQAEntry,
  ProblemGroupEntry,
} from '../models/summarization-types';
import type { CurrentStudy, PatientRecord } from '../models/types';
import type { EhrProcedure } from './fhirDataService';
import type { ExpandedReasonForStudy } from '../models/study-intent-types';
import { invokeClaude } from './claude-client';
import { getDevSettings } from './dev-settings-loader';
import {
  buildOneLinerPrompt,
  type OneLinerFinding,
  type OneLinerProblem,
  type OneLinerProcedure,
  type OneLinerPromptContext,
} from '../prompt-templates/one-liner-v1';

// ── Configuration ─────────────────────────────────────────────────────────

/** Minimum total relevancy score (SAF+CHG+TRK) for a finding to be included */
const FINDING_SCORE_THRESHOLD = 4;

/** Maximum number of findings to send to the LLM */
const MAX_FINDINGS = 8;

/** Minimum problem relevancy score for inclusion */
const PROBLEM_SCORE_THRESHOLD = 5;

/** Maximum number of problems to send to the LLM */
const MAX_PROBLEMS = 8;

/** Maximum number of procedures to send to the LLM */
const MAX_PROCEDURES = 4;

// ── Public API ────────────────────────────────────────────────────────────

export interface OneLinerInput {
  executiveSummary: ExecutiveSummary | null;
  problemGrouping: { entries: ProblemGroupEntry[] } | null;
  currentStudy: CurrentStudy;
  patientRecord: PatientRecord;
  ehrProcedures: EhrProcedure[];
  /** Ordering physician's specialty (resolved from note relevance) */
  orderingSpecialty: string;
  /** Expanded reason for study from synthesis pass (for full-mode context) */
  expandedReason: ExpandedReasonForStudy | null;
}

export interface OneLinerOutput {
  result: OneLinerResult;
  qaEntry: SummarizationQAEntry;
}

/**
 * Run the One Liner synthesis pass.
 *
 * Pre-filters data deterministically, then either:
 *   - Invokes Claude to produce the one-liners (if significant data exists)
 *   - Returns a deterministic fallback string (if nothing significant)
 */
export async function runOneLiner(input: OneLinerInput): Promise<OneLinerOutput> {
  const startTime = Date.now();

  // ── Step 1: Pre-filter findings ──
  const filteredFindings = preFilterFindings(input.executiveSummary);

  // ── Step 2: Pre-filter problems ──
  const filteredProblems = preFilterProblems(input.problemGrouping);

  // ── Step 3: Pre-filter procedures ──
  const filteredProcedures = preFilterProcedures(input.ehrProcedures);

  // ── Step 4: Build context metadata ──
  const patientAge = calculateAge(
    input.patientRecord.demographics.dateOfBirth,
    input.currentStudy.studyDateTime,
  );
  const patientSex = normalizeSex(input.patientRecord.demographics.sex);
  const patientClass = normalizePatientClass(
    input.patientRecord.encounter.patientClass,
  );

  // ── Step 5: Check fallback condition ──
  if (filteredFindings.length === 0 && filteredProblems.length === 0) {
    console.log('[one-liner] No significant findings or problems — returning fallback');

    const ageGenderPrefix = `${patientAge} ${patientSex}`;

    const result: OneLinerResult = {
      imagingOneLiner: `${ageGenderPrefix} with no significant prior radiology findings.`,
      fullOneLiner: `${ageGenderPrefix} with no significant prior radiology findings or medical problems.`,
    };

    return {
      result,
      qaEntry: buildQAEntry(
        { note: 'No significant data — LLM call skipped' },
        result as unknown as Record<string, unknown>,
        0,
        0,
      ),
    };
  }

  // ── Step 6: Build prompt context ──
  // Build expanded reason string for the full-mode one-liner
  const expandedReasonText = serializeExpandedReason(input.expandedReason);

  const promptContext: OneLinerPromptContext = {
    patientAge,
    patientSex,
    patientClass,
    currentStudy: input.currentStudy.studyDescription,
    reasonForStudy: input.currentStudy.clinicalIndication || '',
    orderingSpecialty: input.orderingSpecialty || '',
    findings: filteredFindings,
    problems: filteredProblems,
    procedures: filteredProcedures,
    expandedReasonForStudy: expandedReasonText,
  };

  const { systemPrompt, userMessage } = buildOneLinerPrompt(promptContext);

  // ── Step 7: Invoke Claude ──
  console.log(
    `[one-liner] Invoking Claude: ${filteredFindings.length} findings, ` +
    `${filteredProblems.length} problems, ${filteredProcedures.length} procedures`,
  );

  const devSettings = getDevSettings();
  const { modelId, reasoningEffort } = devSettings.oneLiner;

  console.log(
    `[one-liner] Model: ${modelId}, reasoning: ${reasoningEffort}`,
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
  const llmOutput = llmResult.parsedJson ?? {};

  // ── Step 8: Parse output ──
  const result: OneLinerResult = {
    imagingOneLiner: typeof llmOutput.imagingOneLiner === 'string'
      ? llmOutput.imagingOneLiner
      : '',
    fullOneLiner: typeof llmOutput.fullOneLiner === 'string'
      ? llmOutput.fullOneLiner
      : '',
  };

  console.log(
    `[one-liner] Complete: ${latencyMs}ms, ` +
    `imaging="${result.imagingOneLiner.substring(0, 80)}..."`,
  );

  return {
    result,
    qaEntry: buildQAEntry(
      { systemPrompt, userMessage },
      llmOutput,
      latencyMs,
      0,
      llmResult.tokenUsage,
    ),
  };
}

// ── Internal: Pre-Filtering ───────────────────────────────────────────────

/**
 * Pre-filter and rank findings from the executive summary.
 *
 * Inclusion: total >= 4, OR trend is 'new'/'progressing'
 * Cap: top 8
 * Tiebreak: SAF → CHG → TRK → new/progressing tag → most recent date → alpha
 */
function preFilterFindings(
  executiveSummary: ExecutiveSummary | null,
): OneLinerFinding[] {
  if (!executiveSummary) return [];

  const candidates: (OneLinerFinding & { _recentDate: string })[] = [];

  for (const region of executiveSummary.regionGroups) {
    for (const finding of region.findings) {
      const score = finding.relevancyScore;
      const total = score?.total ?? 0;

      // Determine trend from chips (these carry the trend tag)
      const trend = extractTrend(finding);
      const hasActiveTag = trend === 'new' || trend === 'progressing';

      // Include if score threshold met OR has an active trend tag
      if (total < FINDING_SCORE_THRESHOLD && !hasActiveTag) continue;

      // Build trajectory from study entries
      const trajectory = buildTrajectory(finding);

      // Most recent study date for tiebreaking
      const recentDate = finding.studyEntries.length > 0
        ? finding.studyEntries[0].studyDate  // entries are date-descending
        : '';

      candidates.push({
        name: finding.name,
        totalScore: total,
        SAF: score?.SAF ?? 0,
        CHG: score?.CHG ?? 0,
        TRK: score?.TRK ?? 0,
        trend,
        trajectory,
        _recentDate: recentDate,
      });
    }
  }

  // Sort: total desc → SAF desc → CHG desc → TRK desc → active tag first → recent date → alpha
  candidates.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.SAF !== a.SAF) return b.SAF - a.SAF;
    if (b.CHG !== a.CHG) return b.CHG - a.CHG;
    if (b.TRK !== a.TRK) return b.TRK - a.TRK;

    const aActive = a.trend === 'new' || a.trend === 'progressing' ? 1 : 0;
    const bActive = b.trend === 'new' || b.trend === 'progressing' ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;

    if (b._recentDate !== a._recentDate) {
      return b._recentDate.localeCompare(a._recentDate);
    }

    return a.name.localeCompare(b.name);
  });

  // Cap and strip internal fields
  return candidates.slice(0, MAX_FINDINGS).map(({ _recentDate, ...rest }) => rest);
}

/**
 * Extract the trend tag from an ExecutiveFinding.
 * Checks chips for known trend labels.
 */
function extractTrend(finding: ExecutiveFinding): string | null {
  const trendChips = ['NEW', 'PROGRESSING', 'STABLE', 'IMPROVING', 'RESOLVED'];
  for (const chip of finding.chips) {
    if (trendChips.includes(chip.toUpperCase())) {
      return chip.toLowerCase();
    }
  }
  return null;
}

/**
 * Build a compact trajectory string from a finding's study entries.
 * Shows measurement evolution across studies.
 */
function buildTrajectory(finding: ExecutiveFinding): string {
  if (finding.studyEntries.length <= 1) return '';

  // Look for entries with measurements (changeStatement or measurement)
  const withContext: string[] = [];
  // Entries are already sorted date-descending; we want chronological for trajectory
  const chronological = [...finding.studyEntries].reverse();

  for (const entry of chronological) {
    const label = `${entry.studyName} ${entry.studyDate}`;
    if (entry.measurement) {
      withContext.push(`${entry.measurement} on ${label}`);
    } else if (entry.changeStatement) {
      withContext.push(`${entry.changeStatement} (${label})`);
    }
  }

  if (withContext.length >= 2) {
    return withContext.join(' → ');
  }

  // Fallback: just show the study timeline
  if (chronological.length >= 2) {
    return `Seen on ${chronological.length} studies (${chronological[0].studyDate} – ${chronological[chronological.length - 1].studyDate})`;
  }

  return '';
}

/**
 * Pre-filter and rank problems from the problem grouping result.
 *
 * Inclusion: score >= 5
 * Cap: top 8
 * Tiebreak: score → alphabetical
 */
function preFilterProblems(
  problemGrouping: { entries: ProblemGroupEntry[] } | null,
): OneLinerProblem[] {
  if (!problemGrouping) return [];

  const candidates = problemGrouping.entries
    .filter((e) => e.score >= PROBLEM_SCORE_THRESHOLD)
    .map((e) => ({ name: e.name, score: e.score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

  return candidates.slice(0, MAX_PROBLEMS);
}

/**
 * Pre-filter procedures.
 *
 * Cap: top 4 by date (most recent first)
 */
function preFilterProcedures(
  ehrProcedures: EhrProcedure[],
): OneLinerProcedure[] {
  if (!ehrProcedures || ehrProcedures.length === 0) return [];

  // Already sorted date-descending by fhirDataService
  return ehrProcedures.slice(0, MAX_PROCEDURES).map((p) => ({
    name: p.text,
    date: formatProcedureDate(p.date),
    bodySite: p.bodySite || '',
  }));
}

// ── Internal: Expanded Reason Serialization ───────────────────────────────

/**
 * Serialize the ExpandedReasonForStudy into a compact string for the
 * one-liner prompt. Returns empty string if no expanded reason exists.
 */
function serializeExpandedReason(
  expandedReason: ExpandedReasonForStudy | null,
): string {
  if (!expandedReason) return '';

  const parts: string[] = [];

  // Primary entries
  if (expandedReason.primary.entries.length > 0) {
    parts.push(`Study purpose: ${expandedReason.primary.purpose}`);
    for (const entry of expandedReason.primary.entries) {
      parts.push(`${entry.displayLabel}: ${entry.content}`);
    }
  }

  // Secondary entries
  if (expandedReason.secondary && expandedReason.secondary.entries.length > 0) {
    parts.push(`Secondary purpose: ${expandedReason.secondary.purpose}`);
    for (const entry of expandedReason.secondary.entries) {
      parts.push(`${entry.displayLabel}: ${entry.content}`);
    }
  }

  return parts.join('\n');
}

// ── Internal: Utility ─────────────────────────────────────────────────────

function calculateAge(dob: string, studyDate: string): string {
  if (!dob || dob.length < 8 || !studyDate || studyDate.length < 8) {
    return 'unknown age';
  }

  const birthYear = parseInt(dob.substring(0, 4), 10);
  const birthMonth = parseInt(dob.substring(4, 6), 10);
  const birthDay = parseInt(dob.substring(6, 8), 10);

  const studyYear = parseInt(studyDate.substring(0, 4), 10);
  const studyMonth = parseInt(studyDate.substring(4, 6), 10);
  const studyDay = parseInt(studyDate.substring(6, 8), 10);

  let age = studyYear - birthYear;
  if (studyMonth < birthMonth || (studyMonth === birthMonth && studyDay < birthDay)) {
    age--;
  }

  return `${age}`;
}

function normalizeSex(sex: string): string {
  const s = (sex || '').toUpperCase();
  if (s === 'M' || s === 'MALE') return 'M';
  if (s === 'F' || s === 'FEMALE') return 'F';
  return sex || 'unknown sex';
}

function normalizePatientClass(patientClass: string): string {
  const pc = (patientClass || '').toLowerCase();
  if (pc === 'i' || pc === 'inpatient' || pc === 'in') return 'inpatient';
  if (pc === 'o' || pc === 'outpatient' || pc === 'out') return 'outpatient';
  if (pc === 'e' || pc === 'emergency' || pc === 'ed') return 'ED';
  return patientClass || 'unknown';
}

function formatProcedureDate(dateStr: string): string {
  if (!dateStr) return 'unknown date';
  // FHIR dates are typically YYYY-MM-DD
  if (dateStr.includes('-')) return dateStr;
  // HL7 format: YYYYMMDD
  if (dateStr.length >= 8) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
  return dateStr;
}

// ── Internal: QA Entry Builder ────────────────────────────────────────────

function buildQAEntry(
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>,
  latencyMs: number,
  _totalTokens: number,
  tokenUsage?: { input: number; output: number },
): SummarizationQAEntry {
  return {
    label: 'One Liner',
    studyName: null,
    studyDate: null,
    accessionNumber: null,
    type: 'one-liner',
    inputData,
    outputData,
    validation: { passed: true, checks: [] },
    latencyMs,
    tokenUsage: tokenUsage ?? { input: 0, output: 0 },
  };
}
