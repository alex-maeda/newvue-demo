/**
 * finding-grouping-v1.ts — Prompt for consolidating/deduplicating findings
 * that describe the same underlying pathological process AND assigning
 * a 3-axis clinical relevancy score to every finding (grouped or standalone).
 *
 * This is the cognitively demanding LLM pass that receives findings
 * pre-grouped by body region and determines which findings across
 * different studies (or occasionally within the same study) are
 * describing the same pathology.
 *
 * Input: Findings grouped by region, each with ID + name + study label.
 *        Source sentences are intentionally NOT included — the finding
 *        names already encode the pathological concept, and source text
 *        introduces detail that biases models toward splitting rather
 *        than consolidating.
 *
 * Output: Every input finding must appear exactly once — either in a
 *         consolidated group or in the ungrouped array. Each entry
 *         (group or ungrouped) carries a decomposed relevancy score:
 *           SAF (0–5): Safety risk / threat to patient life or function
 *           CHG (0–3): Probability of change on follow-up imaging
 *           TRK (0–2): Tracking relevance for the reading radiologist
 *
 *         These scores are study-independent — they characterize the
 *         finding's intrinsic clinical weight, NOT its relevance to
 *         any particular imaging study being read.
 *
 * Model: Haiku by default, configurable to Sonnet or Opus via dev-settings.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface FindingGroupingPromptContext {
  /**
   * Findings pre-grouped by body region.
   * Key = region name, Value = findings in that region.
   */
  regionFindings: Map<string, RegionFinding[]>;
}

export interface RegionFinding {
  /** Compact letter alias (A, B, ..., Z, AA, AB, ...) for token efficiency */
  id: string;
  /** Tier 1 finding name */
  name: string;
  /**
   * Compact study provenance label, e.g., "XR Chest, 09/19".
   * Lets the LLM understand which study each finding comes from
   * to better judge temporal tracking of the same pathology.
   */
  studyLabel: string;
}

// ── Prompt Builder ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a radiology finding consolidation and scoring assistant. You have two tasks:

TASK 1 — CONSOLIDATION: Consolidate findings that describe the SAME underlying pathological process into a single unified entry, reducing redundancy for the reading radiologist. When in doubt, CONSOLIDATE.

TASK 2 — SCORING: Assign a 3-axis clinical relevancy score to every finding (grouped or ungrouped). These scores characterize the finding's intrinsic clinical importance — they are NOT relative to any particular imaging study.

CONSOLIDATION RULES:
1. Consolidate findings that describe the same or closely related pathological process. Focus on the underlying PATHOLOGY/PATHOPHYSIOLOGY, not on differences in imaging technique or wording.
2. Condensing/consolidating is strongly preferred, but do NOT force consolidation of genuinely different pathologies (e.g., "pleural effusion" vs "lung nodule").
3. Findings from different studies tracking the same pathology over time SHOULD be consolidated.
4. Assign a succinct, clinically accurate name for each consolidated group (process + ALL locations). Do NOT include imaging study names (CT, MR, XR) in the group name.
5. A finding may only appear in ONE group.

SCORING AXES:

SAF (Safety Risk, 0–5):
5 — Immediately life-threatening, requires emergent intervention (tension pneumothorax, cardiac tamponade, aortic dissection/rupture, acute herniation, saddle PE, active hemorrhage)
4 — Highly urgent, significant threat to life/function (obvious malignancy, large PE, DVT, pericardial effusion, spinal cord compression, large abscess, empyema, displaced fractures)
3 — Urgent, likely requires intervention within weeks-months (suspected malignancy, pneumonia, non-displaced fractures, acute pancreatitis, significant PVD, cirrhosis, kidney stones)
2 — Monitoring-level, needs surveillance but may not require near-term intervention (indeterminate nodules, cholelithiasis, emphysema, soft tissue MSK injuries, suspicious calcifications)
1 — Low risk, unlikely to require action (simple cysts, hemangioma, aortic calcification, mild degenerative joint disease)
0 — No pathologic significance (normal variants, anatomic landmarks, incidental non-pathologic findings)
Note: Score higher within a tier when findings are bilateral, multifocal, or extensive.

CHG (Probability of Change, 0–3):
3 — Rapid evolution expected, days-weeks (active hemorrhage, bowel perforation, acute cholecystitis, displaced fractures, tension processes)
2 — Near-term evolution expected, weeks-months (abscesses, moderate effusions, non-displaced fractures, small-moderate hematomas)
1 — Gradual evolution expected months-years, or any expected change (nodules under surveillance, healing fractures, slow-growing masses, unruptured aneurysms, atherosclerosis progression)
0 — No meaningful change expected on imaging timescales (stable chronic findings, calcified granulomas, post-surgical anatomy, congenital variants)

TRK (Tracking Relevance, 0–2):
2 — Actively tracked: should be referenced on every follow-up study (resolving hemorrhages, masses under treatment, post-operative changes, fractures under healing, nodules under surveillance)
1 — Background-relevant: stable finding that provides important context but is not actively monitored (old infarcts, stable chronic disease, prior surgery, degenerative changes)
0 — No tracking needed: transient finding expected to resolve or truly incidental (atelectasis, physiologic fluid, normal variants)

CRITICAL RULES:
- Every input finding must appear exactly once — either as a member of a group or in the ungrouped list.
- Return ONLY valid JSON. No markdown, no commentary.`;

export function buildFindingGroupingPrompt(
  ctx: FindingGroupingPromptContext,
): { systemPrompt: string; userMessage: string } {

  // ── Build region blocks ──
  // Include ALL regions (even single-finding regions) because every
  // finding needs a score, even if there's nothing to consolidate.
  const regionBlocks: string[] = [];
  let totalFindings = 0;

  for (const [regionName, findings] of ctx.regionFindings) {
    if (findings.length === 0) continue;
    totalFindings += findings.length;

    const findingLines = findings.map((f) => {
      return `- ${f.id}: "${f.name}" (${f.studyLabel})`;
    }).join('\n');

    regionBlocks.push(`## ${regionName}\n${findingLines}`);
  }

  // Edge case: no findings at all
  if (totalFindings === 0) {
    return {
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `No findings to process. Return: { "groups": [], "ungrouped": [] }`,
    };
  }

  // ── Assemble the user message ──
  const userMessage = `Below are radiology findings grouped by body region. Each finding has a unique ID, name, and source study.

1. Consolidate findings within each region that describe the SAME pathological process.
2. Score EVERY finding (grouped and ungrouped) on the SAF/CHG/TRK axes.

${regionBlocks.join('\n\n')}

Output schema:
{
  "groups": [
    {
      "name": "<succinct unified name>",
      "ids": ["<id>", "<id>"],
      "SAF": <0-5>,
      "CHG": <0-3>,
      "TRK": <0-2>
    }
  ],
  "ungrouped": [
    { "id": "<id>", "SAF": <0-5>, "CHG": <0-3>, "TRK": <0-2> }
  ]
}

Example:
Input: A: "Bilateral pleural effusions" (CT Chest, 03/15), B: "Small left pleural effusion" (XR Chest, 03/12), C: "8mm right upper lobe pulmonary nodule" (CT Chest, 03/15)
Output:
{
  "groups": [
    { "name": "Bilateral pleural effusions", "ids": ["A", "B"], "SAF": 2, "CHG": 2, "TRK": 2 }
  ],
  "ungrouped": [
    { "id": "C", "SAF": 2, "CHG": 1, "TRK": 2 }
  ]
}

Reminders:
- When in doubt about whether two findings share the same pathology, prefer consolidation.
- Every input finding ID must appear exactly once (in a group or ungrouped).
- Groups must have 2+ members.
- Score every entry on all three axes (SAF, CHG, TRK).`;

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
