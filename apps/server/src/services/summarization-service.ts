/**
 * summarization-service.ts — Core orchestration for the multi-tier
 * LLM summarization pipeline.
 *
 * Tier 1: Summarize each top-N relevant prior report individually
 *         (parallel execution via Promise.all).
 * Problem Pipeline: Note Triage (extract new problems from clinical notes)
 *         → Problem Grouping (deduplicate and relevancy-score the combined
 *         EHR + extracted problem list). Runs in parallel with Tier 1.
 * Tier 2: Synthesize an executive summary from the structured outputs
 *         of Tier 1, plus deterministic recommendation tracking.
 *
 * This module is the single entry point called by the REST endpoint.
 * It coordinates:
 *   - Identifying the top-N relevant priors from pre-computed scores
 *   - Building subregion lists for each prior-current pair
 *   - Constructing prompts via the template system
 *   - Invoking Claude via the abstraction layer
 *   - Parsing and validating LLM outputs
 *   - Assembling the full SummarizationResponse
 */

import type {
  PatientRecord,
  CurrentStudy,
  Study,
  RelevanceResult,
} from '../models/types';
import type {
  PriorReportAnalysis,
  ExtractedFinding,
  SummarizationQAEntry,
  SummarizationResponse,
  ValidationResult,
  ExtractedProblem,
  ProblemGroupEntry,
  ProblemMemberDetail,
  NoteTriageResult,
  SentenceSnippetIndex,
} from '../models/summarization-types';
import { invokeClaude } from './claude-client';
import { buildSubregionLists, classifyFindingRelevance } from './subregion-loader';
import {
  buildIndividualReportPrompt,
  type IndividualReportPromptContext,
} from '../prompt-templates/individual-report-v1';
import { compactId } from '../utils/compact-id';
import { validateExtraction } from './validation-service';
import { generateExecutiveSummary } from './executive-summary-service';
import { runProblemGrouping, type ProblemGroupingResult } from './problem-grouping-service';
import { runNoteTriage, type RelevantNoteInput } from './note-triage-service';
import { runOneLiner } from './one-liner-service';
import { classifyStudyIntent, getContextQueries } from './study-intent-classifier';
import { runExpandedReasonSynthesis } from './expanded-reason-service';
import type { ExpandedReasonForStudy } from '../models/study-intent-types';
import type { EhrProblem, EhrProcedure } from './fhirDataService';

// ── Configuration ─────────────────────────────────────────────────────────

/** Default maximum number of relevant priors to summarize */
const MAX_PRIORS_TO_SUMMARIZE = 3;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Run the full summarization pipeline for a given current study.
 *
 * Steps:
 *   1. Identify the top-N relevant prior studies
 *   2. Summarize each individually (Tier 1, parallel)
 *   3. (Phase 3) Synthesize executive summary (Tier 2)
 *   4. Return all results with QA log
 *
 * @param patientRecord - Full patient record with studies and relevance scores
 * @param currentStudyId - ID of the current study being read
 * @returns Complete summarization response
 */
export async function runSummarizationPipeline(
  patientRecord: PatientRecord,
  currentStudyId: string,
  maxPriorsOverride?: number,
  ehrProblems?: EhrProblem[],
  relevantNotes?: RelevantNoteInput[],
  ehrProcedures?: EhrProcedure[],
  orderingSpecialty?: string,
): Promise<SummarizationResponse> {
  const pipelineStart = Date.now();

  // ── Step 1: Find the current study ──
  const currentStudy = patientRecord.currentStudies.find(
    (cs) => cs.currentStudyId === currentStudyId,
  );
  if (!currentStudy) {
    throw new Error(`Current study not found: ${currentStudyId}`);
  }

  // ── Step 2: Identify top-N relevant priors ──
  // Use client-provided override (clamped to 1–10) or fall back to the default
  const effectiveMaxPriors = maxPriorsOverride != null
    ? Math.max(1, Math.min(10, Math.floor(maxPriorsOverride)))
    : MAX_PRIORS_TO_SUMMARIZE;

  const topPriors = getTopRelevantPriors(
    patientRecord,
    currentStudyId,
    effectiveMaxPriors,
  );

  if (topPriors.length === 0) {
    console.log('[summarization] No relevant prior studies to summarize.');
    return {
      currentStudyId,
      individualAnalyses: [],
      executiveSummary: null,
      noteTriage: null,
      problemGrouping: null,
      oneLiner: null,
      expandedReason: null,
      studyIntent: classifyStudyIntent(currentStudy.clinicalIndication),
      qaLog: [],
      totalLatencyMs: Date.now() - pipelineStart,
      totalTokenUsage: { input: 0, output: 0 },
    };
  }

  console.log(
    `[summarization] Summarizing ${topPriors.length} relevant priors ` +
    `for ${currentStudy.studyDescription} (${currentStudyId})`,
  );

  // ── Step 2.5: Deterministic study intent classification (< 1ms) ──
  const studyIntent = classifyStudyIntent(currentStudy.clinicalIndication);
  const contextQueries = getContextQueries(studyIntent, currentStudy.labels.bodyRegions);

  // ── Step 3: Tier 1 (individual reports) + Problem Pipeline — parallel ──
  // Problem Pipeline: Note Triage → Problem Grouping (sequential chain)
  const problemPipelinePromise = runProblemPipeline(
    relevantNotes || [],
    ehrProblems || [],
    currentStudy,
    contextQueries,
  );

  const [tier1Results, problemPipelineResult] = await Promise.all([
    Promise.all(
      topPriors.map(({ study, relevanceResult }, reportIndex) =>
        summarizeSingleReport(study, currentStudy, patientRecord, relevanceResult, reportIndex),
      ),
    ),
    problemPipelinePromise,
  ]);

  // Separate successes from failures
  const individualAnalyses: PriorReportAnalysis[] = [];
  const qaLog: SummarizationQAEntry[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (const result of tier1Results) {
    if (result.analysis) {
      individualAnalyses.push(result.analysis);
    }
    qaLog.push(result.qaEntry);
    totalInput += result.qaEntry.tokenUsage.input;
    totalOutput += result.qaEntry.tokenUsage.output;
  }

  console.log(
    `[summarization] Tier 1 complete: ${individualAnalyses.length}/${topPriors.length} ` +
    `successful. Total tokens: ${totalInput} in / ${totalOutput} out`,
  );

  // ── Step 4: Tier 2 — Executive Summary ──
  let executiveSummary = null;

  if (individualAnalyses.length > 0) {
    console.log('[summarization] Starting Tier 2 — Executive Summary synthesis...');

    const tier2Result = await generateExecutiveSummary(
      individualAnalyses,
      currentStudy,
      patientRecord,
    );

    executiveSummary = tier2Result.executiveSummary;
    // Push all Tier 2 QA entries (similar presentations + finding grouping)
    for (const qaEntry of tier2Result.qaEntries) {
      qaLog.push(qaEntry);
      totalInput += qaEntry.tokenUsage.input;
      totalOutput += qaEntry.tokenUsage.output;
    }
  }

  // ── Integrate problem pipeline results ──
  let noteTriage: NoteTriageResult | null = null;
  let problemGrouping: ProblemGroupingResult | null = null;

  if (problemPipelineResult.triageOutcome) {
    noteTriage = problemPipelineResult.triageOutcome.result;
    qaLog.push(problemPipelineResult.triageOutcome.qaEntry);
    totalInput += problemPipelineResult.triageOutcome.qaEntry.tokenUsage.input;
    totalOutput += problemPipelineResult.triageOutcome.qaEntry.tokenUsage.output;
  }

  if (problemPipelineResult.groupingOutcome) {
    problemGrouping = problemPipelineResult.groupingOutcome.result;
    qaLog.push(problemPipelineResult.groupingOutcome.qaEntry);
    totalInput += problemPipelineResult.groupingOutcome.qaEntry.tokenUsage.input;
    totalOutput += problemPipelineResult.groupingOutcome.qaEntry.tokenUsage.output;
  }

  // ── Step 5: Expanded Reason for Study synthesis ──
  let expandedReason: ExpandedReasonForStudy | null = null;

  if (contextQueries.length > 0) {
    console.log('[summarization] Starting Expanded Reason for Study synthesis...');
    try {
      const expandedReasonOutput = await runExpandedReasonSynthesis({
        studyIntent,
        contextQueries,
        contextSentenceMap: noteTriage?.contextSentenceMap ?? {},
        sentenceIndex: noteTriage?.sentenceIndex ?? [],
        clinicalIndication: currentStudy.clinicalIndication,
        currentStudy,
        executiveSummary,
        problemGroupingEntries: problemGrouping?.entries ?? [],
        ehrProcedures: ehrProcedures || [],
      });

      if (expandedReasonOutput) {
        expandedReason = expandedReasonOutput.result;
        qaLog.push(expandedReasonOutput.qaEntry);
        totalInput += expandedReasonOutput.qaEntry.tokenUsage.input;
        totalOutput += expandedReasonOutput.qaEntry.tokenUsage.output;
        console.log(
          `[summarization] Expanded Reason complete: ` +
          `primary=${expandedReason.primary.entries.length} entries` +
          (expandedReason.secondary ? `, secondary=${expandedReason.secondary.entries.length}` : ''),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[summarization] Expanded Reason failed: ${msg}`);
      // Non-fatal — expandedReason stays null
    }
  }

  // ── Step 6: One Liner — final synthesis pass ──
  let oneLiner = null;

  console.log('[summarization] Starting One Liner synthesis...');
  try {
    const oneLinerOutput = await runOneLiner({
      executiveSummary,
      problemGrouping,
      currentStudy,
      patientRecord,
      ehrProcedures: ehrProcedures || [],
      orderingSpecialty: orderingSpecialty || '',
      expandedReason,
    });

    oneLiner = oneLinerOutput.result;
    qaLog.push(oneLinerOutput.qaEntry);
    totalInput += oneLinerOutput.qaEntry.tokenUsage.input;
    totalOutput += oneLinerOutput.qaEntry.tokenUsage.output;

    console.log(
      `[summarization] One Liner complete: imaging="${oneLiner.imagingOneLiner.substring(0, 60)}..."`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[summarization] One Liner failed: ${msg}`);
    // Non-fatal — oneLiner stays null
  }

  return {
    currentStudyId,
    individualAnalyses,
    executiveSummary,
    noteTriage,
    problemGrouping,
    oneLiner,
    expandedReason,
    studyIntent,
    qaLog,
    totalLatencyMs: Date.now() - pipelineStart,
    totalTokenUsage: { input: totalInput, output: totalOutput },
  };
}

// ── Internal: Problem Pipeline (Note Triage → Problem Grouping) ───────────

/**
 * Result from the sequential problem pipeline.
 */
interface ProblemPipelineResult {
  triageOutcome: Awaited<ReturnType<typeof runNoteTriage>> | null;
  groupingOutcome: Awaited<ReturnType<typeof runProblemGrouping>> | null;
}

/**
 * Run the problem pipeline: Note Triage → Problem Grouping (sequential).
 *
 * 1. Note Triage: extract new problems from clinical note snippets
 * 2. Merge extracted problems with EHR problem list
 * 3. Problem Grouping: deduplicate and score the combined list
 *
 * This entire chain runs in parallel with Tier 1 report summarization.
 * Never throws — both services have internal error handling.
 */
async function runProblemPipeline(
  relevantNotes: RelevantNoteInput[],
  ehrProblems: EhrProblem[],
  currentStudy: CurrentStudy,
  contextQueries: import('../models/study-intent-types').ContextQuery[] = [],
): Promise<ProblemPipelineResult> {
  // Step 1: Note Triage — extract new problems from note snippets
  let triageOutcome: ProblemPipelineResult['triageOutcome'] = null;
  let allProblems = ehrProblems;

  if (relevantNotes.length > 0) {
    triageOutcome = await runNoteTriage(relevantNotes, ehrProblems, currentStudy, contextQueries);

    // Step 2: Merge extracted problems with EHR problems
    if (triageOutcome.result.extractedProblems.length > 0) {
      allProblems = mergeProblems(ehrProblems, triageOutcome.result.extractedProblems);
      console.log(
        `[problem-pipeline] Merged ${triageOutcome.result.extractedProblems.length} ` +
        `extracted problems → ${allProblems.length} total`,
      );
    }
  }

  // Step 3: Problem Grouping — deduplicate and score the combined list
  let groupingOutcome: ProblemPipelineResult['groupingOutcome'] = null;
  if (allProblems.length > 0) {
    groupingOutcome = await runProblemGrouping(allProblems, currentStudy);
  }

  // Step 4: Post-grouping enrichment (sentence aggregation + date derivation)
  if (groupingOutcome) {
    // sentMap is now keyed by problem ID (not compact code)
    const sentMap = { ...(triageOutcome?.result.problemSentenceMap ?? {}) };

    // Add LLM-extracted problems' sourceSentenceIds (not covered by note triage's code-based mapping)
    if (triageOutcome?.result.extractedProblems) {
      for (let i = 0; i < triageOutcome.result.extractedProblems.length; i++) {
        const ep = triageOutcome.result.extractedProblems[i];
        const syntheticId = `LLM-EXTRACTED-${String(i + 1).padStart(3, '0')}`;
        if (ep.sourceSentenceIds.length > 0) {
          sentMap[syntheticId] = [...ep.sourceSentenceIds].sort();
        }
      }
    }

    enrichProblemGroupEntries(groupingOutcome.result.entries, sentMap, allProblems);
  }

  return { triageOutcome, groupingOutcome };
}

/**
 * Merge LLM-extracted problems into the EHR problem list.
 * Extracted problems are given synthetic IDs, "llm-extracted" status,
 * and the date from the most recent source note.
 */
function mergeProblems(
  ehrProblems: EhrProblem[],
  extractedProblems: ExtractedProblem[],
): EhrProblem[] {
  const merged = [...ehrProblems];

  for (let i = 0; i < extractedProblems.length; i++) {
    const ep = extractedProblems[i];
    merged.push({
      id: `LLM-EXTRACTED-${String(i + 1).padStart(3, '0')}`,
      text: ep.name,
      status: 'llm-extracted',
      recordedDate: ep.mostRecentNoteDate,
      note: `Extracted from sentences: ${ep.sourceSentenceIds.join(', ')}`,
    });
  }

  return merged;
}

/**
 * After problem grouping, enrich each ProblemGroupEntry with:
 *   1. sentenceSources — aggregated sentence IDs from member problem codes
 *   2. oldestDate — earliest recordedDate across all member problems
 *   3. members — per-member detail with individual name + sentence IDs
 */
function enrichProblemGroupEntries(
  entries: ProblemGroupEntry[],
  sentMap: Record<string, string[]>,
  allProblems: EhrProblem[],
): void {
  // Build id → problem lookup for name + date derivation
  const problemById = new Map<string, EhrProblem>();
  for (const p of allProblems) {
    problemById.set(p.id, p);
  }

  // Build code → id lookup (reverse of the compact coding)
  // memberCodes[i] corresponds to memberIds[i] within each entry
  for (const entry of entries) {
    // ── Sentence aggregation (flat) — keyed by problem ID ──
    const allSentences = new Set<string>();
    for (const memberId of entry.memberIds) {
      const sids = sentMap[memberId];
      if (sids) {
        for (const sid of sids) allSentences.add(sid);
      }
    }
    if (allSentences.size > 0) {
      entry.sentenceSources = [...allSentences].sort();
    }

    // ── Per-member detail — keyed by problem ID ──
    const members: ProblemMemberDetail[] = [];
    for (let i = 0; i < entry.memberIds.length; i++) {
      const memberId = entry.memberIds[i];
      const problem = problemById.get(memberId);
      const sentenceIds = sentMap[memberId] || [];

      members.push({
        id: memberId,
        name: problem?.text || entry.name,
        sentenceIds: [...sentenceIds].sort(),
      });
    }
    entry.members = members;

    // ── Oldest date derivation ──
    let oldest: string | undefined;
    for (const memberId of entry.memberIds) {
      const d = problemById.get(memberId)?.recordedDate;
      if (d && (!oldest || d < oldest)) {
        oldest = d;
      }
    }
    if (oldest) {
      entry.oldestDate = oldest;
    }
  }
}

// ── Internal: Top-N Prior Selection ───────────────────────────────────────

/**
 * Get the top-N relevant prior studies sorted by relevance score (descending).
 * Only includes studies with isRelevant=true and valid labels.
 */
function getTopRelevantPriors(
  patientRecord: PatientRecord,
  currentStudyId: string,
  maxCount: number,
): { study: Study; relevanceResult: RelevanceResult }[] {
  const scores = patientRecord.relevanceScores[currentStudyId];
  if (!scores) return [];

  // Build array of (study, score) pairs, filtering for relevant + labeled
  const candidates: { study: Study; relevanceResult: RelevanceResult }[] = [];

  for (const study of patientRecord.studies) {
    const score = scores[study.sequence];
    if (!score || !score.isRelevant) continue;
    if (!study.labels) continue; // Need labels for subregion building

    // Must have report text to summarize
    const rs = study.reportSections;
    if (!rs.impression && !rs.findings && rs.rawText.length === 0) continue;

    candidates.push({ study, relevanceResult: score });
  }

  // Sort by percentage descending, then by recency (most recent first)
  candidates.sort((a, b) => {
    const scoreDiff = b.relevanceResult.percentage - a.relevanceResult.percentage;
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    // Tiebreak: more recent study first
    return b.study.studyDateTime.localeCompare(a.study.studyDateTime);
  });

  return candidates.slice(0, maxCount);
}

// ── Internal: Single Report Summarization ─────────────────────────────────

interface Tier1Result {
  analysis: PriorReportAnalysis | null;
  qaEntry: SummarizationQAEntry;
}

/**
 * Summarize a single prior report via Claude.
 * Never throws — errors are captured in the QA entry.
 *
 * @param reportIndex - 0-based index of this report in the processing batch,
 *                      used to generate a globally unique letter code (A, B, C...)
 *                      for sentence IDs (RA.01, RB.01, etc.)
 */
async function summarizeSingleReport(
  priorStudy: Study,
  currentStudy: CurrentStudy,
  patientRecord: PatientRecord,
  relevanceResult: RelevanceResult,
  reportIndex: number = 0,
): Promise<Tier1Result> {
  const startTime = Date.now();
  const reportLetterCode = compactId(reportIndex); // A, B, C, ...
  const studyLabel = `${priorStudy.studyDescription} (${formatDate(priorStudy.studyDateTime)})`;

  console.log(`[summarization] Starting: ${studyLabel} [R${reportLetterCode}]`);

  try {
    // Build subregion lists for this prior-current pair
    const subregionLists = buildSubregionLists(
      priorStudy.labels!,
      currentStudy.labels,
    );

    // Calculate patient age at time of prior study
    const patientAge = calculateAge(
      patientRecord.demographics.dateOfBirth,
      priorStudy.studyDateTime,
    );

    // Build the prompt (now returns sentence index alongside the prompt)
    const promptContext: IndividualReportPromptContext = {
      priorStudy,
      currentStudy,
      demographics: patientRecord.demographics,
      subregionLists,
      patientAgeAtStudy: patientAge,
      reportLetterCode,
    };

    const { systemPrompt, userMessage, sentenceIndex } = buildIndividualReportPrompt(promptContext);

    // Invoke Claude
    const result = await invokeClaude({
      systemPrompt,
      userMessage,
      temperature: 0,
    });

    // Parse the LLM response
    if (!result.parsedJson) {
      throw new Error('LLM response was not valid JSON');
    }

    const llmOutput = result.parsedJson as Record<string, unknown>;
    const analysis = buildAnalysisFromLLMOutput(
      llmOutput,
      priorStudy,
      subregionLists,
      sentenceIndex,
      reportLetterCode,
    );

    // Assign deterministic finding IDs: {accessionNumber}-F{1-based index}
    analysis.findings.forEach((f, i) => {
      f.id = `${analysis.accessionNumber}-F${i + 1}`;
    });

    // Validate findings against source text
    const validation = validateExtraction(analysis, priorStudy.reportSections);

    const latencyMs = Date.now() - startTime;
    console.log(
      `[summarization] Complete: ${studyLabel} — ` +
      `${analysis.findings.length} findings, ` +
      `${validation.checks.filter((c) => c.status === 'pass').length}/${validation.checks.length} validated, ` +
      `${latencyMs}ms`,
    );

    return {
      analysis,
      qaEntry: buildQAEntry(
        priorStudy,
        'individual',
        { systemPrompt, userMessage },
        llmOutput,
        validation,
        result.tokenUsage,
        latencyMs,
        relevanceResult,
      ),
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[summarization] Failed: ${studyLabel} — ${errorMsg}`);

    return {
      analysis: null,
      qaEntry: buildQAEntry(
        priorStudy,
        'individual',
        {},
        { error: errorMsg },
        { passed: false, checks: [] },
        { input: 0, output: 0 },
        latencyMs,
      ),
    };
  }
}

/**
 * Convert raw LLM JSON output into a typed PriorReportAnalysis.
 *
 * The LLM outputs single-token field codes (e.g., "src", "region", "meas")
 * to reduce output tokens. This function maps them back to the full
 * ExtractedFinding field names used by the API and client.
 *
 * For "src", the LLM now outputs an array of sentence ID numbers (e.g., ["03", "14"]).
 * These are resolved to full text via the sentence index, producing a deterministic
 * sourceExcerpt from the original report text.
 *
 * Backward compatibility: also checks for legacy full field names
 * (e.g., "sourceExcerpt") and plain string "src" values.
 */
function buildAnalysisFromLLMOutput(
  llmOutput: Record<string, unknown>,
  priorStudy: Study,
  subregionLists: ReturnType<typeof buildSubregionLists>,
  sentenceIndex: SentenceSnippetIndex[] = [],
  reportLetterCode: string = 'A',
): PriorReportAnalysis {
  const findings = Array.isArray(llmOutput.findings) ? llmOutput.findings : [];
  const referencedPriors = Array.isArray(llmOutput.referencedPriorStudies)
    ? llmOutput.referencedPriorStudies
    : [];

  // Build a quick lookup from numeric sentence IDs → text
  // Sentence index entries have global IDs like "RA.03", so we also index by just the numeric part
  const sentenceTextByNum = new Map<string, string>();
  for (const entry of sentenceIndex) {
    // Extract the numeric part from "RA.03" → "03"
    const numericPart = entry.id.split('.')[1];
    if (numericPart) {
      sentenceTextByNum.set(numericPart, entry.text);
    }
  }

  const extractedFindings: ExtractedFinding[] = findings.map((f: Record<string, unknown>) => {
    // Map coded field names → full names (with legacy fallback)
    const bodySubregion = String(f.region ?? f.bodySubregion ?? 'Other');

    // Deterministic subregion source classification
    const relevance = classifyFindingRelevance(bodySubregion, subregionLists);
    const subregionSource: 'primary' | 'overlap' =
      relevance === 'overlapping' ? 'overlap' : 'primary';

    // ── Resolve src → sourceExcerpt ──
    const srcResolved = resolveSentenceField(f.src ?? f.sourceExcerpt, sentenceTextByNum, reportLetterCode);

    // ── Resolve change → changeStatement ──
    const changeResolved = resolveSentenceField(f.change ?? f.changeStatement, sentenceTextByNum, reportLetterCode);

    // Map coded measurement fields → full names
    const rawMeas = Array.isArray(f.meas) ? f.meas
      : Array.isArray(f.measurements) ? f.measurements
      : [];

    // Map coded recommendation fields → full names
    const rawRec = (f.rec ?? f.recommendation) as Record<string, unknown> | null | undefined;

    return {
      id: '', // Placeholder — overwritten by deterministic ID assignment after build
      name: String(f.name || 'Unnamed finding'),
      sourceExcerpt: srcResolved.text,
      sourceSentenceIds: srcResolved.globalIds,
      bodySubregion,
      subregionSource,
      reportSubsection: String(f.subsection ?? f.reportSubsection ?? ''),
      sourceSection: validateSourceSection(f.section ?? f.sourceSection),
      severity: f.severity === 'critical' ? 'critical' : null,
      technique: Boolean(f.tech ?? f.technique ?? false),
      trend: validateTrend(f.trend),
      incidental: Boolean(f.incidental),
      measurements: rawMeas.map((m: Record<string, unknown>) => ({
        dimension: String(m.dim ?? m.dimension ?? ''),
        location: String(m.loc ?? m.location ?? ''),
        context: String(m.ctx ?? m.context ?? ''),
      })),
      changeStatement: changeResolved.text || null,
      recommendation: rawRec && typeof rawRec === 'object'
        ? {
            action: String(rawRec.action || rawRec.act || ''),
            timeframe: rawRec.timeframe || rawRec.tf ? String(rawRec.timeframe ?? rawRec.tf) : null,
            guideline: rawRec.guideline ? String(rawRec.guideline) : null,
            standalone: Boolean(rawRec.so ?? rawRec.standalone ?? false),
          }
        : null,
      comparisonStudyReference: (f.ref ?? f.comparisonStudyReference)
        ? String(f.ref ?? f.comparisonStudyReference)
        : null,
    };
  });

  return {
    studyName: priorStudy.studyDescription,
    studyDate: priorStudy.studyDateTime,
    accessionNumber: priorStudy.accessionNumber,
    clinicalPresentation: llmOutput.clinicalPresentation
      ? String(llmOutput.clinicalPresentation)
      : null,
    findings: extractedFindings,
    referencedPriorStudies: referencedPriors.map((r: Record<string, unknown>) => ({
      studyType: String(r.studyType || ''),
      studyDate: String(r.studyDate || ''),
      context: String(r.context || ''),
    })),
    reportSentenceIndex: sentenceIndex.length > 0 ? sentenceIndex : undefined,
  };
}

// ── Internal: Validation Helpers ──────────────────────────────────────────

function validateSourceSection(
  value: unknown,
): 'impression' | 'findings' | 'both' {
  if (value === 'impression' || value === 'findings' || value === 'both') {
    return value;
  }
  return 'findings'; // safe default
}

function validateTrend(
  value: unknown,
): 'new' | 'progressing' | 'stable' | 'improving' | 'resolved' | null {
  const valid = ['new', 'progressing', 'stable', 'improving', 'resolved'];
  if (typeof value === 'string' && valid.includes(value)) {
    return value as ExtractedFinding['trend'];
  }
  return null;
}
// ── Internal: Sentence ID Resolution ──────────────────────────────────────
/**
 * Resolve a sentence ID field from LLM output to full text,
 * also returning the resolved global sentence IDs.
 *
 * Handles three formats:
 *   1. Array of sentence IDs: ["03", "14"] → resolved text joined by space
 *   2. Comma-separated string of IDs: "03, 14" → resolved text joined by space
 *   3. Plain text string (legacy): returned as-is (no IDs)
 *   4. null/undefined/falsy: returns empty string (no IDs)
 *
 * Used for both `src` → `sourceExcerpt` and `change` → `changeStatement`.
 */
function resolveSentenceField(
  rawValue: unknown,
  sentenceTextByNum: Map<string, string>,
  reportLetterCode: string,
): { text: string; globalIds: string[] } {
  if (rawValue == null) return { text: '', globalIds: [] };

  if (Array.isArray(rawValue)) {
    // New format: array of sentence ID numbers
    const resolvedTexts: string[] = [];
    const globalIds: string[] = [];
    for (const idRaw of rawValue) {
      const id = String(idRaw).padStart(2, '0');
      const text = sentenceTextByNum.get(id);
      if (text) {
        resolvedTexts.push(text);
        globalIds.push(`R${reportLetterCode}.${id}`);
      } else {
        console.warn(`[summarization] Sentence ID "${id}" not found in index for R${reportLetterCode}`);
      }
    }
    return { text: resolvedTexts.join(' '), globalIds };
  }

  if (typeof rawValue === 'string') {
    // Try to resolve as comma-separated IDs first
    const ids = rawValue.split(',').map(s => s.trim());
    const allResolvable = ids.length > 0 && ids.every(id => sentenceTextByNum.has(id.padStart(2, '0')));
    if (allResolvable && sentenceTextByNum.size > 0) {
      const globalIds = ids.map(id => `R${reportLetterCode}.${id.padStart(2, '0')}`);
      const text = ids
        .map(id => sentenceTextByNum.get(id.padStart(2, '0'))!)
        .join(' ');
      return { text, globalIds };
    }
    // Legacy: plain text
    return { text: rawValue, globalIds: [] };
  }

  return { text: '', globalIds: [] };
}

// ── Internal: QA Log Builder ──────────────────────────────────────────────

function buildQAEntry(
  study: Study,
  type: SummarizationQAEntry['type'],
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>,
  validation: ValidationResult,
  tokenUsage: { input: number; output: number },
  latencyMs: number,
  relevanceResult?: RelevanceResult,
): SummarizationQAEntry {
  const entry: SummarizationQAEntry = {
    label: `${study.studyDescription} ${formatDate(study.studyDateTime)}`,
    studyName: study.studyDescription,
    studyDate: study.studyDateTime,
    accessionNumber: study.accessionNumber,
    type,
    inputData,
    outputData,
    validation,
    latencyMs,
    tokenUsage,
  };

  // Attach per-component score breakdown for individual entries
  if (relevanceResult) {
    const bd = relevanceResult.breakdown;
    const currentIsAngio = relevanceResult.maxPossible > 12 + 2; // 12 base + 2 laterality
    const currentHasLat = (relevanceResult.maxPossible - (currentIsAngio ? 3 : 0)) > 12;
    entry.relevanceScore = {
      percentage: relevanceResult.percentage,
      totalScore: relevanceResult.totalScore,
      maxPossible: relevanceResult.maxPossible,
      breakdown: {
        modality:    { score: bd.modality,    maxPossible: 3 },
        bodyRegion:  { score: bd.bodyRegion,  maxPossible: 5 },
        recency:     { score: bd.recency,     maxPossible: 4 },
        angiography: { score: bd.angiography, maxPossible: currentIsAngio ? 3 : 0 },
        laterality:  { score: bd.laterality,  maxPossible: currentHasLat ? 2 : 0 },
      },
    };
  }

  return entry;
}

// ── Internal: Utility Functions ───────────────────────────────────────────

/**
 * Calculate age from DOB (YYYYMMDD) to a study date (YYYYMMDDHHMMSS).
 * Returns a human-readable string like "65-year-old".
 */
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

  return `${age}-year-old`;
}

/**
 * Format a YYYYMMDDHHMMSS date string to MM/DD/YYYY.
 */
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || 'Unknown';
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${month}/${day}/${year}`;
}
