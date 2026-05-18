/**
 * individual-report-v1.ts — Prompt template for Tier 1 individual
 * prior report structured extraction.
 *
 * This prompt instructs Claude to extract structured findings, measurements,
 * recommendations, and referenced studies from a single prior radiology report.
 * Findings are classified into constrained anatomical subregions derived from
 * the report-subregions.json vocabulary.
 *
 * The report text is pre-split into numbered sentences so the LLM outputs
 * sentence IDs instead of verbatim excerpts — reducing output tokens and
 * ensuring deterministic source provenance.
 *
 * VERSION: 1.1  (sentence-level provenance)
 * MODEL TARGET: Claude Haiku 4.5 (claude-3-5-haiku-20241022)
 */

import type { SubregionLists } from '../services/subregion-loader';
import type { ReportSections, Study, CurrentStudy, Demographics } from '../models/types';
import type { SentenceSnippetIndex } from '../models/summarization-types';
import { splitIntoSentences } from '../utils/sentence-splitter';

// ── Types ─────────────────────────────────────────────────────────────────

/** Input context assembled by the summarization service for this prompt */
export interface IndividualReportPromptContext {
  /** The prior study being summarized */
  priorStudy: Study;

  /** The current study being read */
  currentStudy: CurrentStudy;

  /** Patient demographics (age/sex context for the LLM) */
  demographics: Demographics;

  /** PRIMARY/OVERLAP subregion lists for constrained region tagging */
  subregionLists: SubregionLists;

  /** Computed patient age at time of prior study (for context) */
  patientAgeAtStudy: string;

  /**
   * Report letter code for globally unique sentence IDs.
   * Assigned by the orchestrator based on processing order (A, B, C, ...).
   * Sentence IDs are prefixed as R{code}.{nn} → e.g., "RA.01", "RB.03".
   */
  reportLetterCode: string;
}

/** Result of building the prompt — includes the sentence index for downstream resolution */
export interface IndividualReportPromptResult {
  systemPrompt: string;
  userMessage: string;
  /** Sentence index mapping each numbered sentence to its text and metadata */
  sentenceIndex: SentenceSnippetIndex[];
}

// ── System Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a specialized radiology report analysis assistant. Your role is to extract structured, clinically relevant findings from radiology reports with high fidelity to the source text.

CRITICAL RULES:
1. EXTRACT, do not interpret. Every finding you output must be directly traceable to sentences in the report. Never infer findings not explicitly stated.
2. PRESERVE the radiologist's language. Use near-verbatim descriptions from the report. Do not rephrase or editorialize.
3. CLASSIFY findings into exactly ONE of the provided anatomical subregions. Do not create new region names.
4. LABEL findings conservatively:
   - severity: "critical" ONLY when the report uses words like "critical", "urgent", "emergent", "stat", or documents communication to a clinician (e.g., "results communicated to Dr. X").
   - tech: true ONLY when the finding describes scan quality, artifacts, or technical limitations rather than pathology (e.g., "motion degradation", "metallic artifact", "suboptimal contrast bolus", "limited examination"). Statements about the exam itself, NOT about anatomy.
   - trend: ONLY when the report explicitly describes change over time (e.g., "increased", "stable", "new", "resolved").
   - incidental: true ONLY when the report explicitly uses "incidental", "incidentally noted", or similar language.
5. FINDING NAMES must be succinct: pathological process + anatomical location ONLY. No measurements, no trend/change language, no size modifiers. Example: "Left lower lobe mass" NOT "5.5 cm enlarging left lower lobe mass".
6. MEASUREMENTS must be verbatim from the report (do not convert units or round).
7. SOURCE SENTENCE IDs: For each finding, list the sentence ID numbers that support it. Use the numbered format from the input (e.g., ["03", "14"]).
8. Return ONLY valid JSON matching the specified schema. No markdown, no commentary, no preamble.
9. Use the EXACT field codes shown in the schema — these are abbreviated for efficiency.`;

// ── Prompt Builder ────────────────────────────────────────────────────────

/**
 * Build the complete user message for the individual report extraction prompt.
 *
 * This assembles all contextual data (report text as numbered sentences,
 * study metadata, subregion constraints) into a structured prompt.
 *
 * Output schema uses single-token field codes (e.g., "src" for source sentence IDs,
 * "region" for bodySubregion) to reduce output tokens at scale. The server
 * maps these back to full names before serving the API response.
 */
export function buildIndividualReportPrompt(ctx: IndividualReportPromptContext): IndividualReportPromptResult {
  const { priorStudy, currentStudy, demographics, subregionLists, patientAgeAtStudy, reportLetterCode } = ctx;
  const rs = priorStudy.reportSections;

  // ── Assemble subregion constraint section ──
  const regionSection = buildSubregionSection(subregionLists);

  // ── Split report text into numbered sentences ──
  const { sentenceBlock, sentenceIndex } = buildSentenceSections(
    rs,
    reportLetterCode,
    priorStudy.accessionNumber,
    `${priorStudy.studyDescription} (${formatStudyDate(priorStudy.studyDateTime)})`,
  );

  const userMessage = `## TASK
Analyze the following radiology report and extract all abnormal findings as structured data. Return ONLY a JSON object matching the schema below.

## STUDY METADATA
- Study: ${priorStudy.studyDescription}
- Date: ${formatStudyDate(priorStudy.studyDateTime)}
- Accession: ${priorStudy.accessionNumber}
- Patient: ${patientAgeAtStudy} ${demographics.sex === 'M' ? 'male' : 'female'}
- Current Exam Being Read: ${currentStudy.studyDescription} (${formatStudyDate(currentStudy.studyDateTime)})

## ANATOMICAL REGION CLASSIFICATION
${regionSection}

## REPORT TEXT (numbered sentences)
${sentenceBlock}

## OUTPUT SCHEMA
Field code legend: name=finding name, src=source sentence IDs, region=body subregion, subsection=report subsection heading, section=source section, tech=technique finding flag, meas=measurements, dim=dimension value, loc=image location, ctx=anatomical context, change=sentence IDs describing change/trend, rec=recommendation, so=standalone recommendation flag, ref=comparison study reference.

Return a JSON object with this exact structure:
\`\`\`json
{
  "clinicalPresentation": "string or null — clinical history/indication from the report",
  "findings": [
    {
      "name": "succinct: pathological process + location ONLY, e.g., 'Left lower lobe mass'",
      "src": ["03", "14"],
      "region": "MUST be one of the region options listed above",
      "subsection": "the report section heading this finding appeared under, e.g., 'LUNGS'",
      "section": "impression | findings | both",
      "severity": "critical | null",
      "tech": false,
      "trend": "new | progressing | stable | improving | resolved | null",
      "incidental": false,
      "meas": [
        {
          "dim": "verbatim measurement, e.g., '5.5 x 4.8 cm'",
          "loc": "image reference if provided, e.g., 'image 47:3'",
          "ctx": "anatomical context of what was measured, or null"
        }
      ],
      "change": ["05"],
      "rec": {
        "action": "recommended follow-up action",
        "timeframe": "when, if specified, or null",
        "guideline": "referenced guideline or null",
        "so": "true if the finding IS entirely a recommendation with no pathological observation; false if the finding describes pathology that also includes a recommended action"
      },
      "ref": "which prior study this change references, or null"
    }
  ],
  "referencedPriorStudies": [
    {
      "studyType": "type as written in report, e.g., 'CT chest'",
      "studyDate": "date as written, e.g., '7/9/2025'",
      "context": "comparison | findings"
    }
  ]
}
\`\`\`

## INSTRUCTIONS
1. Extract ALL abnormal findings from the FINDINGS and IMPRESSION sections. Also extract technique/quality findings (flag with tech: true).
2. Do NOT extract normal/unremarkable findings (e.g., "Liver: Normal", "No lymphadenopathy").
3. Finding "name" MUST be succinct: pathological process and anatomical location ONLY. No measurements, no trend/change language (e.g., "new", "stable", "enlarging"), no size modifiers (e.g., "large", "small"). Measurements belong in "meas", trends in "trend" and "change".
4. Classify each finding into exactly ONE region from the lists above. Prefer PRIMARY regions unless a finding is explicitly about anatomy in the OVERLAP region list.
5. The report uses section headings to organize findings (e.g., "LUNGS:", "LIVER:", "BRAIN PARENCHYMA:"). Use these headings as strong signals for the subsection field and for region classification.
6. If a finding involves multiple anatomical regions, assign it to the single most clinically significant region.
7. If a finding does not clearly fit any listed region, assign it to "Other".
8. For severity, look specifically for communication statements (e.g., "Results communicated to...", "Attending notified...") as strong indicators of critical findings.
9. Capture ALL explicit measurements (sizes, volumes, SUV values) with their verbatim text.
10. Set tech: true for findings about scan quality, artifacts, motion degradation, limited examinations, or contrast issues — anything describing the exam's technical quality rather than pathology.
11. For "src", list ALL sentence ID numbers that inform or support the finding. Include sentences from both FINDINGS and IMPRESSION if both discuss the same finding.
12. For "change", list the sentence ID numbers that describe how the finding changed over time relative to prior studies. Use null if no change is described. A sentence can appear in both "src" and "change".`;

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    sentenceIndex,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Split report sections (COMPARISON, CLINICAL HISTORY, IMPRESSION, FINDINGS)
 * into numbered sentences for the LLM prompt.
 *
 * Each sentence gets a numeric ID (01, 02, ...) shown to the LLM, and a
 * globally unique ID (e.g., "RA.01") stored in the sentence index.
 *
 * @param rs            Report sections from the study
 * @param letterCode    Report letter code (A, B, C, ...) for global uniqueness
 * @param accessionNum  Accession number for provenance
 * @param studyTitle    Human-readable study title for the index
 * @returns sentenceBlock for the prompt + sentenceIndex for resolution
 */
function buildSentenceSections(
  rs: ReportSections,
  letterCode: string,
  accessionNum: string,
  studyTitle: string,
): { sentenceBlock: string; sentenceIndex: SentenceSnippetIndex[] } {

  const sentenceIndex: SentenceSnippetIndex[] = [];
  const promptLines: string[] = [];
  let counter = 1;

  // Process each section in reading order
  const sectionPairs: Array<{ label: string; text: string | null | undefined }> = [
    { label: 'COMPARISON', text: rs.comparison },
    { label: 'CLINICAL HISTORY', text: rs.clinicalIndication },
    { label: 'IMPRESSION', text: rs.impression },
    { label: 'FINDINGS', text: rs.findings },
  ];

  for (const { label, text } of sectionPairs) {
    if (!text || text.trim().length === 0) continue;

    promptLines.push(`### ${label}`);

    const sentences = splitIntoSentences(text);
    for (const sentence of sentences) {
      const paddedNum = String(counter).padStart(2, '0');
      const globalId = `R${letterCode}.${paddedNum}`;

      sentenceIndex.push({
        id: globalId,
        noteId: accessionNum,
        noteTitle: studyTitle,
        section: label,
        text: sentence,
      });

      // Show only the numeric ID in the prompt (LLM output uses these)
      promptLines.push(`[${paddedNum}] ${sentence}`);
      counter++;
    }
    promptLines.push(''); // blank line between sections
  }

  // Fallback: if no sections parsed, use raw text
  if (sentenceIndex.length === 0 && rs.rawText.length > 0) {
    promptLines.push('### FULL REPORT TEXT');
    const sentences = splitIntoSentences(rs.rawText.join('\n'));
    for (const sentence of sentences) {
      const paddedNum = String(counter).padStart(2, '0');
      const globalId = `R${letterCode}.${paddedNum}`;

      sentenceIndex.push({
        id: globalId,
        noteId: accessionNum,
        noteTitle: studyTitle,
        section: 'FULL TEXT',
        text: sentence,
      });

      promptLines.push(`[${paddedNum}] ${sentence}`);
      counter++;
    }
  }

  return {
    sentenceBlock: promptLines.join('\n'),
    sentenceIndex,
  };
}

/**
 * Build the subregion constraint section of the prompt.
 * Separates PRIMARY and OVERLAP lists with clear labels explaining their meaning.
 */
function buildSubregionSection(lists: SubregionLists): string {
  const lines: string[] = [];

  if (lists.overlap.length === 0) {
    // Prior and current share the same canonical region — single list
    lines.push('Classify each finding into exactly ONE of the following regions:');
    lines.push('');
    for (const region of lists.primary) {
      lines.push(`  - ${region}`);
    }
  } else {
    // Two separate lists — PRIMARY from prior's anatomy, OVERLAP from current's
    lines.push('PRIMARY regions (from this prior study\'s body area):');
    lines.push('These cover the anatomy typically described in this type of study.');
    lines.push('');
    for (const region of lists.primary) {
      lines.push(`  - ${region}`);
    }
    lines.push('');
    lines.push('OVERLAP regions (from the current exam\'s body area):');
    lines.push('Use these ONLY when a finding is explicitly about anatomy in this list.');
    lines.push('');
    for (const region of lists.overlap) {
      lines.push(`  - ${region}`);
    }
    lines.push('');
    lines.push('Classify each finding into exactly ONE of the above regions.');
    lines.push('Prefer PRIMARY regions unless a finding is explicitly about anatomy in the OVERLAP list.');
  }

  return lines.join('\n');
}

/**
 * Format a YYYYMMDDHHMMSS date string to a readable format.
 */
function formatStudyDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || 'Unknown';
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${month}/${day}/${year}`;
}

/**
 * Get the system prompt for external reference (e.g., QA log).
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
