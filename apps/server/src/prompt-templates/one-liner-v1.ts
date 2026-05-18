/**
 * one-liner-v1.ts — Prompt template for the One Liner synthesis pass.
 *
 * This is the final LLM call in the pipeline. It receives a compact,
 * deterministically pre-filtered data packet and produces two 1–2 sentence
 * clinical summaries answering "What must I know about this patient?"
 *
 * Two variants are produced in a single LLM call:
 *   - imagingOneLiner: Uses ONLY imaging data (findings + demographics + study context)
 *   - fullOneLiner:    Synthesizes across imaging + EHR data (problems, procedures)
 *
 * The pre-filtering is done in one-liner-service.ts — this template
 * only handles prompt construction from the already-curated inputs.
 *
 * Model: Sonnet 4.6 by default, configurable via dev-settings.
 */

// ── Types ─────────────────────────────────────────────────────────────────

/** A pre-filtered finding ready for one-liner consumption */
export interface OneLinerFinding {
  /** Finding name from executive summary */
  name: string;
  /** Total relevancy score (0–10) */
  totalScore: number;
  /** SAF sub-score (0–5) */
  SAF: number;
  /** CHG sub-score (0–3) */
  CHG: number;
  /** TRK sub-score (0–2) */
  TRK: number;
  /** Trend tag if present (new, progressing, stable, improving, resolved) */
  trend: string | null;
  /**
   * Compact trajectory string showing evolution across studies.
   * e.g., "2.8 cm on CT 03/15 → 3.4 cm on MRI 06/18"
   * Empty string if no multi-study trajectory is available.
   */
  trajectory: string;
}

/** A pre-filtered problem ready for one-liner consumption */
export interface OneLinerProblem {
  /** Problem name (from problem grouping) */
  name: string;
  /** Study-relative relevancy score (0–10) */
  score: number;
}

/** A pre-filtered procedure ready for one-liner consumption */
export interface OneLinerProcedure {
  /** Procedure name */
  name: string;
  /** Procedure date (formatted) */
  date: string;
  /** Body site if available */
  bodySite: string;
}

/** Full context for building the one-liner prompt */
export interface OneLinerPromptContext {
  /** Patient age string, e.g., "67-year-old" */
  patientAge: string;
  /** Patient sex, e.g., "male" or "female" */
  patientSex: string;
  /** Patient class: inpatient, outpatient, ED, etc. */
  patientClass: string;
  /** Current study description, e.g., "MRI Brain with contrast" */
  currentStudy: string;
  /** Clinical indication / reason for study */
  reasonForStudy: string;
  /** Ordering physician's specialty (empty if unknown) */
  orderingSpecialty: string;

  /** Pre-filtered, scored imaging findings (max 8, sorted by score desc) */
  findings: OneLinerFinding[];

  /** Pre-filtered, scored problems from EHR (max 8, sorted by score desc) */
  problems: OneLinerProblem[];

  /** Pre-filtered procedures (max 4, sorted by date desc) */
  procedures: OneLinerProcedure[];

  /**
   * Serialized expanded reason for study (from synthesis pass).
   * Provides richer clinical context for the fullOneLiner variant.
   * Empty string when not available.
   */
  expandedReasonForStudy?: string;
}

// ── Prompt Builder ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clinical synthesis assistant for radiology. Your task is to produce a dense, precise "one-liner" summary that answers: "What must I know about this patient before I read these images?"

You will produce TWO one-liners from the data provided:

1. imagingOneLiner — Based ONLY on the IMAGING DATA section. Do NOT reference any EHR data (problems, procedures).
2. fullOneLiner — Synthesizes across ALL provided data (imaging + EHR). When an imaging finding and an EHR problem describe the same condition (e.g., "right MCA infarct" finding + "cerebrovascular accident" problem), mention it ONCE with the combined context, not twice.

FORMAT RULES:
- Start with the patient's age and sex: e.g., "67M" or "54F"
- Maximum 2 sentences per one-liner
- Write in clinical handoff style — dense, precise, no hedging
- Lead with the most critical/actionable finding that the radiologist CANNOT overlook
- Focus on "what am I about to see in these images" — not care management
- Do NOT restate the clinical presentation or reason for study — this is displayed separately in the UI and would be redundant. Use it only as internal context to guide prioritization.
- Use standard medical abbreviations where appropriate (e.g., "s/p" for status-post, "w/" for with)
- If there is only one significant finding, one sentence is sufficient

OUTPUT: Return ONLY valid JSON with exactly two string fields. No markdown, no commentary.`;

export function buildOneLinerPrompt(
  ctx: OneLinerPromptContext,
): { systemPrompt: string; userMessage: string } {

  // ── Build the imaging data block (always present) ──
  const lines: string[] = [];

  lines.push('PATIENT CONTEXT:');
  lines.push(`- ${ctx.patientAge} ${ctx.patientSex}, ${ctx.patientClass}`);
  lines.push(`- Current Study: ${ctx.currentStudy}`);
  if (ctx.reasonForStudy) {
    lines.push(`- Reason for Study: ${ctx.reasonForStudy}`);
  }
  if (ctx.orderingSpecialty) {
    lines.push(`- Ordering Specialty: ${ctx.orderingSpecialty}`);
  }

  lines.push('');
  lines.push('IMAGING FINDINGS (sorted by clinical relevancy score, highest first):');

  if (ctx.findings.length === 0) {
    lines.push('(No significant prior imaging findings)');
  } else {
    for (let i = 0; i < ctx.findings.length; i++) {
      const f = ctx.findings[i];
      let line = `${i + 1}. [SAF:${f.SAF} CHG:${f.CHG} TRK:${f.TRK} = ${f.totalScore}] ${f.name}`;
      if (f.trend) {
        line += ` (${f.trend.toUpperCase()})`;
      }
      lines.push(line);
      if (f.trajectory) {
        lines.push(`   Trajectory: ${f.trajectory}`);
      }
    }
  }

  // ── Build the EHR data block (only if data is available) ──
  const hasEhrData = ctx.problems.length > 0 || ctx.procedures.length > 0 || !!ctx.expandedReasonForStudy;

  if (hasEhrData) {
    lines.push('');
    lines.push('--- EHR DATA (for fullOneLiner only) ---');

    // Expanded clinical context (when available)
    if (ctx.expandedReasonForStudy) {
      lines.push('');
      lines.push('EXPANDED CLINICAL CONTEXT (synthesized from EHR notes):');
      lines.push(ctx.expandedReasonForStudy);
      lines.push('(Use this as high-fidelity context for prioritization. Do NOT restate it — it is displayed separately in the UI.)');
    }

    if (ctx.problems.length > 0) {
      lines.push('');
      lines.push('RELEVANT PROBLEMS (sorted by study-relevancy score):');
      for (let i = 0; i < ctx.problems.length; i++) {
        const p = ctx.problems[i];
        lines.push(`${i + 1}. [Score: ${p.score}] ${p.name}`);
      }
    }

    if (ctx.procedures.length > 0) {
      lines.push('');
      lines.push('RELEVANT PROCEDURES:');
      for (const proc of ctx.procedures) {
        let line = `- ${proc.name} (${proc.date})`;
        if (proc.bodySite) {
          line += ` — ${proc.bodySite}`;
        }
        lines.push(line);
      }
    }
  }

  // ── Output schema ──
  lines.push('');
  lines.push('Output schema:');
  lines.push('{');
  lines.push('  "imagingOneLiner": "<1-2 sentence summary from IMAGING DATA only>",');
  lines.push('  "fullOneLiner": "<1-2 sentence summary from ALL data>"');
  lines.push('}');

  if (!hasEhrData) {
    lines.push('');
    lines.push('Note: No EHR data is available. Set fullOneLiner equal to imagingOneLiner.');
  }

  return { systemPrompt: SYSTEM_PROMPT, userMessage: lines.join('\n') };
}
