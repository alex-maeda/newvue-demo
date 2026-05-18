/**
 * executive-summary-service.ts — Tier 2 executive summary synthesis.
 *
 * Architecture: Deterministic core + 2 parallel LLM passes.
 *
 *   1. DETERMINISTIC: Finding ID assignment (already done in Tier 1),
 *      technique filtering, region assignment, chip derivation
 *   2. LLM PASS 1 (Haiku): Similar prior presentations — identifies
 *      which prior studies had clinical presentations matching the current exam
 *   3. LLM PASS 2 (Haiku, configurable): Finding grouping — identifies
 *      which findings within each body region describe the same pathology
 *   4. DETERMINISTIC ASSEMBLY: Merges all pieces into the final
 *      ExecutiveSummary with region groups, chips, study entries,
 *      similar presentations, recommendations, and normalStatement
 *
 * Passes 1 and 2 run in parallel (Promise.all) since they are independent.
 * Recommendations are tracked deterministically (no LLM involvement).
 */

import type {
  PatientRecord,
  CurrentStudy,
} from '../models/types';
import type {
  PriorReportAnalysis,
  ExtractedFinding,
  ExecutiveSummary,
  ExecutiveSummaryRegionGroup,
  ExecutiveFinding,
  StudyEntry,
  SimilarPresentation,
  OpenRecommendation,
  SummarizationQAEntry,
  ValidationResult,
  FindingRelevancyScore,
} from '../models/summarization-types';
import { invokeClaude } from './claude-client';
import { getSubregionsForCanonical } from './subregion-loader';
import { buildSimilarPresentationsPrompt } from '../prompt-templates/similar-presentations-v1';
import { buildFindingGroupingPrompt, type RegionFinding } from '../prompt-templates/finding-grouping-v1';
import { trackRecommendations } from './recommendation-tracker';
import { getDevSettings } from './dev-settings-loader';
import { config } from '../config';
import { compactId } from '../utils/compact-id';

// ── Types ─────────────────────────────────────────────────────────────────

export interface Tier2Result {
  executiveSummary: ExecutiveSummary | null;
  /** Two QA entries: one for similar presentations, one for finding grouping */
  qaEntries: SummarizationQAEntry[];
}

/** Internal: a finding with its parent analysis context */
interface FindingWithContext {
  finding: ExtractedFinding;
  analysis: PriorReportAnalysis;
}

/** Internal: parsed output from LLM Pass 2 — grouped findings */
interface FindingGroup {
  name: string;
  ids: string[];
  SAF: number;
  CHG: number;
  TRK: number;
}

/** Internal: parsed output from LLM Pass 2 — ungrouped findings */
interface UngroupedFindingScore {
  /** Canonical finding ID (resolved from compact alias) */
  id: string;
  SAF: number;
  CHG: number;
  TRK: number;
}

// ── Static Constants ──────────────────────────────────────────────────────

const STATIC_NORMAL_STATEMENT =
  'Remaining assessed regions were unremarkable on available prior imaging.';

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate the executive summary from Tier 1 individual analyses.
 *
 * Pipeline:
 *   1. Deterministic: recommendation tracking
 *   2. Deterministic: technique filtering
 *   3. Deterministic: region assignment (bodySubregion → currentExamSubregions)
 *   4. Parallel LLM: similar presentations + finding grouping
 *   5. Deterministic: assembly into final ExecutiveSummary
 */
export async function generateExecutiveSummary(
  analyses: PriorReportAnalysis[],
  currentStudy: CurrentStudy,
  patientRecord: PatientRecord,
): Promise<Tier2Result> {
  const startTime = Date.now();

  if (analyses.length === 0) {
    return {
      executiveSummary: null,
      qaEntries: [],
    };
  }

  try {
    // ── Step 1: Deterministic recommendation tracking ──
    const openRecommendations = trackRecommendations(
      analyses,
      patientRecord,
      currentStudy.studyDateTime,
    );

    console.log(
      `[executive-summary] Tracked ${openRecommendations.length} recommendations: ` +
      `${openRecommendations.filter((r) => r.status === 'fulfilled').length} fulfilled, ` +
      `${openRecommendations.filter((r) => r.status === 'overdue').length} overdue, ` +
      `${openRecommendations.filter((r) => r.status === 'pending').length} pending`,
    );

    // ── Step 2: Filter findings that don't belong in the executive summary ──
    // - technique findings: scan quality / technical observations (not pathology)
    // - standalone recommendation findings: purely action items with no pathological content
    //   (the recommendation itself is already tracked via the recommendation tracker in step 1)
    const filteredAnalyses = analyses.map((a) => ({
      ...a,
      findings: a.findings.filter((f) => !f.technique && !f.recommendation?.standalone),
    }));

    // ── Step 3: Deterministic region assignment ──
    const currentExamSubregions = getCurrentExamSubregions(currentStudy);
    const regionMap = assignFindingsToRegions(filteredAnalyses, currentExamSubregions);

    console.log(
      `[executive-summary] Region assignment: ` +
      `${Array.from(regionMap.entries())
        .filter(([, findings]) => findings.length > 0)
        .map(([region, findings]) => `${region}(${findings.length})`)
        .join(', ')}`,
    );

    // ── Step 4: Patient age for similar presentations ──
    const patientAge = calculateAge(
      patientRecord.demographics.dateOfBirth,
      currentStudy.studyDateTime,
    );

    // ── Step 5: Parallel LLM passes ──
    const [similarResult, groupingResult] = await Promise.all([
      runSimilarPresentationsPass(filteredAnalyses, currentStudy, patientRecord, patientAge),
      runFindingGroupingPass(regionMap, filteredAnalyses),
    ]);

    // ── Step 6: Deterministic assembly ──
    const executiveSummary = assembleExecutiveSummary(
      regionMap,
      groupingResult.groups,
      groupingResult.ungrouped,
      similarResult.presentations,
      openRecommendations,
      filteredAnalyses,
    );

    const latencyMs = Date.now() - startTime;

    console.log(
      `[executive-summary] Complete: ` +
      `${executiveSummary.regionGroups.length} regions, ` +
      `${executiveSummary.regionGroups.reduce((n, g) => n + g.findings.length, 0)} findings, ` +
      `${groupingResult.groups.length} groups, ` +
      `${executiveSummary.similarPriorPresentations.length} similar presentations, ` +
      `${executiveSummary.openRecommendations.length} recommendations, ` +
      `${latencyMs}ms`,
    );

    return {
      executiveSummary,
      qaEntries: [similarResult.qaEntry, groupingResult.qaEntry],
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[executive-summary] Failed: ${errorMsg}`);

    return {
      executiveSummary: null,
      qaEntries: [
        buildQAEntry('Similar Presentations', 'similar-presentations', {}, { error: errorMsg }, 0, latencyMs),
        buildQAEntry('Finding Grouping', 'finding-grouping', {}, { error: errorMsg }, 0, latencyMs),
      ],
    };
  }
}

// ── Deterministic: Region Assignment ──────────────────────────────────────

/**
 * Assign findings to body regions by matching their Tier 1 bodySubregion
 * against the current exam's subregion list.
 *
 * Both lists derive from the same report-subregions.json vocabulary,
 * so exact string matching works for the vast majority of cases.
 * Unmatched subregions go to "Other".
 *
 * Returns a Map keyed by region name with arrays of findings + context.
 * Empty regions (no matching findings) are excluded.
 */
function assignFindingsToRegions(
  analyses: PriorReportAnalysis[],
  currentExamSubregions: string[],
): Map<string, FindingWithContext[]> {
  const regionMap = new Map<string, FindingWithContext[]>();

  // Initialize regions from the subregion list
  const subregionSet = new Set(currentExamSubregions);

  for (const analysis of analyses) {
    for (const finding of analysis.findings) {
      const region = subregionSet.has(finding.bodySubregion)
        ? finding.bodySubregion
        : 'Other';

      if (!regionMap.has(region)) {
        regionMap.set(region, []);
      }
      regionMap.get(region)!.push({ finding, analysis });
    }
  }

  return regionMap;
}

// ── LLM Pass 1: Similar Presentations ─────────────────────────────────────

interface SimilarPresentationsResult {
  presentations: SimilarPresentation[];
  qaEntry: SummarizationQAEntry;
}

async function runSimilarPresentationsPass(
  analyses: PriorReportAnalysis[],
  currentStudy: CurrentStudy,
  patientRecord: PatientRecord,
  patientAge: string,
): Promise<SimilarPresentationsResult> {
  const startTime = Date.now();

  const { systemPrompt, userMessage } = buildSimilarPresentationsPrompt({
    currentStudy,
    demographics: patientRecord.demographics,
    patientAge,
    individualAnalyses: analyses,
  });

  console.log('[executive-summary] Pass 1: Invoking Claude for similar presentations...');

  const result = await invokeClaude({
    systemPrompt,
    userMessage,
    temperature: 0,
    maxOutputTokens: 2048, // Similar presentations output is small
  });

  const latencyMs = Date.now() - startTime;
  const llmOutput = result.parsedJson ?? {};

  // Parse similar presentations from LLM output
  const rawPresentations = Array.isArray(llmOutput.similarPresentations)
    ? llmOutput.similarPresentations
    : [];

  // Resolve full data from Tier 1 analyses (LLM only returns accession + keyFindings)
  const presentations: SimilarPresentation[] = rawPresentations
    .map((p: Record<string, unknown>) => {
      const accession = String(p.accession || '');
      const analysis = analyses.find((a) => a.accessionNumber === accession);
      if (!analysis) {
        console.warn(`[exec-similar] No analysis found for accession ${accession}`);
        return null;
      }
      return {
        studyName: analysis.studyName,
        studyDate: formatDate(analysis.studyDate),
        accessionNumber: accession,
        priorPresentation: analysis.clinicalPresentation || '',
        keyFindings: Array.isArray(p.keyFindings) ? p.keyFindings.map(String) : [],
      };
    })
    .filter(Boolean) as SimilarPresentation[];

  console.log(
    `[executive-summary] Pass 1 complete: ${presentations.length} similar presentations, ${latencyMs}ms`,
  );

  return {
    presentations,
    qaEntry: buildQAEntry(
      'Similar Presentations',
      'similar-presentations',
      { systemPrompt, userMessage },
      llmOutput,
      result.tokenUsage.input + result.tokenUsage.output,
      latencyMs,
      result.tokenUsage,
    ),
  };
}

// ── LLM Pass 2: Finding Grouping ──────────────────────────────────────────

interface FindingGroupingResult {
  groups: FindingGroup[];
  ungrouped: UngroupedFindingScore[];
  qaEntry: SummarizationQAEntry;
}



async function runFindingGroupingPass(
  regionMap: Map<string, FindingWithContext[]>,
  analyses: PriorReportAnalysis[],
): Promise<FindingGroupingResult> {
  const startTime = Date.now();

  // ── Build compact alias map ──
  // Maps compact IDs (A, B, C, ...) → canonical IDs (ACC-P1-0020-F3)
  // to minimize output tokens in the LLM response.
  const compactToCanonical = new Map<string, string>();
  const canonicalToCompact = new Map<string, string>();
  let idCounter = 0;

  // Build the region → findings mapping for the prompt, using compact IDs
  const regionFindings = new Map<string, RegionFinding[]>();
  for (const [region, contexts] of regionMap) {
    regionFindings.set(
      region,
      contexts.map((ctx) => {
        const alias = compactId(idCounter++);
        compactToCanonical.set(alias, ctx.finding.id);
        canonicalToCompact.set(ctx.finding.id, alias);
        return {
          id: alias,
          name: ctx.finding.name,
          studyLabel: compactStudyLabel(ctx.analysis.studyName, ctx.analysis.studyDate),
        };
      }),
    );
  }

  console.log(
    `[executive-summary] Compact ID map: ${idCounter} findings aliased (A–${compactId(idCounter - 1)})`,
  );

  // Every finding needs a score, so we always call the LLM if there are
  // any findings at all — even single-finding regions still need scoring.
  if (idCounter === 0) {
    console.log('[executive-summary] Pass 2: No findings to score, skipping LLM call');
    return {
      groups: [],
      ungrouped: [],
      qaEntry: buildQAEntry(
        'Finding Grouping',
        'finding-grouping',
        { note: 'No findings — LLM call skipped' },
        { groups: [], ungrouped: [] },
        0,
        0,
      ),
    };
  }

  const { systemPrompt, userMessage } = buildFindingGroupingPrompt({
    regionFindings,
  });

  console.log('[executive-summary] Pass 2: Invoking Claude for finding grouping + scoring...');

  // Read model selection from dev settings at runtime (not cached)
  // so UI changes take effect on the next invocation
  const devSettings = getDevSettings();
  const { modelId, reasoningEffort } = devSettings.findingGrouping;

  console.log(
    `[executive-summary] Finding grouping model: ${modelId}, ` +
    `reasoning: ${reasoningEffort}`,
  );

  // Build thinking params for thinking-capable models (Sonnet 4.6, Opus 4.7)
  const isThinkingCapable = modelId.includes('sonnet') || modelId.includes('opus');
  const thinkingParams = (
    isThinkingCapable && reasoningEffort !== 'none'
  ) ? {
    type: 'adaptive' as const,
    effort: reasoningEffort as 'low' | 'medium' | 'high',
  } : undefined;

  const result = await invokeClaude({
    systemPrompt,
    userMessage,
    temperature: 0,
    // Increase token budget — scoring + ungrouped entries increase output size
    maxOutputTokens: thinkingParams ? 8192 : 4096,
    modelId,
    thinking: thinkingParams,
  });

  const latencyMs = Date.now() - startTime;
  const llmOutput = result.parsedJson ?? {};

  // ── Parse groups: reverse-map compact IDs → canonical IDs + extract scores ──
  const rawGroups = Array.isArray(llmOutput.groups) ? llmOutput.groups : [];
  const groups: FindingGroup[] = rawGroups
    .filter((g: Record<string, unknown>) => g.name && Array.isArray(g.ids) && (g.ids as string[]).length >= 2)
    .map((g: Record<string, unknown>) => ({
      name: String(g.name),
      ids: (g.ids as string[]).map((rawId: unknown) => {
        const alias = String(rawId).toUpperCase();
        return compactToCanonical.get(alias) ?? String(rawId);
      }),
      SAF: clampScore(g.SAF, 0, 5),
      CHG: clampScore(g.CHG, 0, 3),
      TRK: clampScore(g.TRK, 0, 2),
    }));

  // ── Parse ungrouped findings: reverse-map + extract scores ──
  const rawUngrouped = Array.isArray(llmOutput.ungrouped) ? llmOutput.ungrouped : [];
  const ungrouped: UngroupedFindingScore[] = rawUngrouped
    .filter((u: Record<string, unknown>) => u.id)
    .map((u: Record<string, unknown>) => {
      const alias = String(u.id).toUpperCase();
      return {
        id: compactToCanonical.get(alias) ?? String(u.id),
        SAF: clampScore(u.SAF, 0, 5),
        CHG: clampScore(u.CHG, 0, 3),
        TRK: clampScore(u.TRK, 0, 2),
      };
    });

  const totalScored = groups.length + ungrouped.length;
  const avgTotal = totalScored > 0
    ? ([
        ...groups.map((g) => g.SAF + g.CHG + g.TRK),
        ...ungrouped.map((u) => u.SAF + u.CHG + u.TRK),
      ].reduce((a, b) => a + b, 0) / totalScored).toFixed(1)
    : '0';

  console.log(
    `[executive-summary] Pass 2 complete: ${groups.length} groups ` +
    `(${groups.reduce((n, g) => n + g.ids.length, 0)} findings grouped), ` +
    `${ungrouped.length} ungrouped, avg score ${avgTotal}, ${latencyMs}ms`,
  );

  return {
    groups,
    ungrouped,
    qaEntry: buildQAEntry(
      'Finding Grouping',
      'finding-grouping',
      { systemPrompt, userMessage },
      llmOutput,
      result.tokenUsage.input + result.tokenUsage.output,
      latencyMs,
      result.tokenUsage,
    ),
  };
}

// ── Deterministic: Assembly ───────────────────────────────────────────────

/**
 * Build the final ExecutiveSummary from all pipeline outputs.
 *
 * 1. For each region in regionMap:
 *    a. Determine which findings are in a group vs ungrouped
 *    b. Grouped findings → single ExecutiveFinding with LLM group name,
 *       chips derived from most recent member
 *    c. Ungrouped findings → individual ExecutiveFinding with Tier 1 name,
 *       chips derived from that single finding
 * 2. Merge in similar presentations, recommendations, normalStatement
 */
function assembleExecutiveSummary(
  regionMap: Map<string, FindingWithContext[]>,
  groups: FindingGroup[],
  ungrouped: UngroupedFindingScore[],
  similarPresentations: SimilarPresentation[],
  openRecommendations: OpenRecommendation[],
  analyses: PriorReportAnalysis[],
): ExecutiveSummary {
  // Build a lookup: findingId → which group it belongs to (if any)
  const findingToGroup = new Map<string, FindingGroup>();
  for (const group of groups) {
    for (const id of group.ids) {
      findingToGroup.set(id, group);
    }
  }

  // Build a lookup: findingId → ungrouped score (if any)
  const ungroupedScoreMap = new Map<string, UngroupedFindingScore>();
  for (const u of ungrouped) {
    ungroupedScoreMap.set(u.id, u);
  }

  // Build a global findingId → FindingWithContext lookup for resolution
  const findingLookup = new Map<string, FindingWithContext>();
  for (const contexts of regionMap.values()) {
    for (const ctx of contexts) {
      findingLookup.set(ctx.finding.id, ctx);
    }
  }

  const regionGroups: ExecutiveSummaryRegionGroup[] = [];

  // Global set: once a finding is rendered (either as part of a group or
  // individually), it must not appear again in another region.
  // This prevents cross-region groups from being rendered twice.
  const processedIds = new Set<string>();

  for (const [regionName, contexts] of regionMap) {
    if (contexts.length === 0) continue; // Skip empty regions

    const findings: ExecutiveFinding[] = [];

    for (const ctx of contexts) {
      const fId = ctx.finding.id;
      if (processedIds.has(fId)) continue;

      const group = findingToGroup.get(fId);

      if (group) {
        // ── This finding is part of a group ──
        // Skip if we already processed this group (in this or another region)
        if (group.ids.some((id) => processedIds.has(id))) continue;

        // Detect cross-region grouping (LLM error — findings from different
        // regions grouped together despite prompt instructing within-region only)
        const memberRegions = new Set<string>();
        for (const memberId of group.ids) {
          const memberCtx = findingLookup.get(memberId);
          if (memberCtx) {
            // Find which region this member belongs to
            for (const [rn, rcs] of regionMap) {
              if (rcs.some((c) => c.finding.id === memberId)) {
                memberRegions.add(rn);
                break;
              }
            }
          }
        }
        if (memberRegions.size > 1) {
          console.warn(
            `[exec-assembly] Cross-region group detected: "${group.name}" ` +
            `spans ${Array.from(memberRegions).join(', ')}. ` +
            `Rendering under "${regionName}" (first encountered region).`,
          );
        }

        // Resolve all members of this group
        const memberContexts: FindingWithContext[] = [];
        for (const memberId of group.ids) {
          const memberCtx = findingLookup.get(memberId);
          if (memberCtx) {
            memberContexts.push(memberCtx);
            processedIds.add(memberId);
          } else {
            console.warn(`[exec-assembly] Group member ${memberId} not found in finding lookup`);
          }
        }

        if (memberContexts.length === 0) continue;

        // Sort by study date descending (most recent first)
        memberContexts.sort((a, b) =>
          b.analysis.studyDate.localeCompare(a.analysis.studyDate),
        );

        // Derive chips from the MOST RECENT member (user-confirmed design decision)
        const mostRecent = memberContexts[0].finding;
        const chips = deriveFindingChips(mostRecent);

        findings.push({
          name: group.name,
          chips,
          studyEntries: memberContexts.map((mc) => buildStudyEntry(mc)),
          relevancyScore: {
            SAF: group.SAF,
            CHG: group.CHG,
            TRK: group.TRK,
            total: group.SAF + group.CHG + group.TRK,
          },
        });
      } else {
        // ── Ungrouped finding ──
        processedIds.add(fId);

        // Look up the LLM-assigned score for this ungrouped finding
        const scoreEntry = ungroupedScoreMap.get(fId);
        const relevancyScore: FindingRelevancyScore | undefined = scoreEntry
          ? {
              SAF: scoreEntry.SAF,
              CHG: scoreEntry.CHG,
              TRK: scoreEntry.TRK,
              total: scoreEntry.SAF + scoreEntry.CHG + scoreEntry.TRK,
            }
          : undefined;

        findings.push({
          name: ctx.finding.name,
          chips: deriveFindingChips(ctx.finding),
          studyEntries: [buildStudyEntry(ctx)],
          relevancyScore,
        });
      }
    }

    if (findings.length > 0) {
      regionGroups.push({ regionName, findings });
    }
  }

  return {
    regionGroups,
    similarPriorPresentations: similarPresentations,
    openRecommendations,
    normalStatement: STATIC_NORMAL_STATEMENT,
  };
}

// ── Deterministic: Chip Derivation ────────────────────────────────────────

/**
 * Derive display chips from a single finding's multi-dimensional labels.
 * This is a 1:1 deterministic mapping — no LLM involvement.
 */
function deriveFindingChips(finding: ExtractedFinding): string[] {
  const chips: string[] = [];

  if (finding.severity === 'critical') chips.push('CRITICAL');

  if (finding.trend === 'progressing') chips.push('PROGRESSING');
  else if (finding.trend === 'new') chips.push('NEW');
  else if (finding.trend === 'stable') chips.push('STABLE');
  else if (finding.trend === 'improving') chips.push('IMPROVING');
  else if (finding.trend === 'resolved') chips.push('RESOLVED');

  if (finding.incidental) chips.push('INCIDENTAL');

  return chips;
}

// ── Deterministic: StudyEntry Resolution ──────────────────────────────────

/**
 * Build a StudyEntry from a FindingWithContext by resolving all display
 * data from the Tier 1 analysis — no LLM echo-back needed.
 */
function buildStudyEntry(ctx: FindingWithContext): StudyEntry {
  const { finding, analysis } = ctx;

  // Build measurement string from the finding's measurements array
  const measurement = finding.measurements.length > 0
    ? finding.measurements
        .map((m) => m.context ? `${m.dimension} (${m.context})` : m.dimension)
        .join('; ')
    : null;

  return {
    findingId: finding.id,
    studyName: analysis.studyName,
    studyDate: formatDate(analysis.studyDate),
    accessionNumber: analysis.accessionNumber,
    findingName: finding.name,
    measurement,
    sourceExcerpt: finding.sourceExcerpt || null,
    changeStatement: finding.changeStatement,
    sourceSentenceIds: finding.sourceSentenceIds || [],
  };
}

// ── Internal: Subregion Construction ──────────────────────────────────────

/**
 * Get the subregion list for the current exam's body regions.
 */
function getCurrentExamSubregions(currentStudy: CurrentStudy): string[] {
  const subregions: string[] = [];
  for (const region of currentStudy.labels.bodyRegions) {
    const regionSubregions = getSubregionsForCanonical(region);
    for (const sr of regionSubregions) {
      if (!subregions.includes(sr)) {
        subregions.push(sr);
      }
    }
  }
  return subregions;
}

// ── Internal: QA Entry Builder ────────────────────────────────────────────

function buildQAEntry(
  label: string,
  type: 'similar-presentations' | 'finding-grouping',
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>,
  _totalTokens: number,
  latencyMs: number,
  tokenUsage?: { input: number; output: number },
): SummarizationQAEntry {
  return {
    label,
    studyName: null,
    studyDate: null,
    accessionNumber: null,
    type,
    inputData,
    outputData,
    validation: { passed: true, checks: [] },
    latencyMs,
    tokenUsage: tokenUsage ?? { input: 0, output: 0 },
  };
}

// ── Internal: Utility ─────────────────────────────────────────────────────

/**
 * Defensively parse an LLM-returned score value into a clamped integer.
 * Returns 0 if the value is missing, non-numeric, or out of range.
 */
function clampScore(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(min, Math.min(max, Math.round(num)));
}


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

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || 'Unknown';
  return `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}/${dateStr.substring(0, 4)}`;
}

/**
 * Build a compact study provenance label for the finding grouping prompt.
 * E.g., "XR Chest PA Lateral" + "20240919..." → "XR Chest PA Lateral, 09/19"
 *
 * Keeps the full study name (important for modality + anatomy context) and
 * uses MM/DD date format to minimize token overhead.
 */
function compactStudyLabel(studyName: string, studyDate: string): string {
  const datePart = (studyDate && studyDate.length >= 8)
    ? `${studyDate.substring(4, 6)}/${studyDate.substring(6, 8)}`
    : '';
  return datePart ? `${studyName}, ${datePart}` : studyName;
}
