/**
 * study-intent-classifier.ts — Deterministic study purpose classification
 * and clinical context query definition.
 *
 * Classifies radiology orders into high-level purpose categories
 * (Diagnostic, Trauma, Follow-up, etc.) using keyword matching from
 * config/study_intent_rules.json. No LLM involved.
 *
 * Also defines the set of clinical context queries for each purpose
 * category, which are used by the Note Triage TASK 3 to tag relevant
 * note sentences for downstream synthesis.
 */

import fs from 'fs';
import path from 'path';
import type {
  StudyPurpose,
  StudyIntentResult,
  ContextQuery,
} from '../models/study-intent-types';

// ── Rules Loading ─────────────────────────────────────────────────────────

interface StudyIntentRules {
  priority_order: string[];
  categories: Record<string, { terms: string[] }>;
}

let cachedRules: StudyIntentRules | null = null;

function loadRules(): StudyIntentRules {
  if (cachedRules) return cachedRules;

  const rulesPath = path.resolve(__dirname, '../../config/study_intent_rules.json');
  const raw = fs.readFileSync(rulesPath, 'utf8');
  cachedRules = JSON.parse(raw) as StudyIntentRules;
  return cachedRules;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Classify the study's high-level purpose from the ServiceRequest
 * clinicalIndication text.
 *
 * Algorithm:
 *   1. Normalize the indication text (lowercase, trim)
 *   2. For each category, count word-boundary keyword matches
 *   3. Primary = category with the most matches
 *   4. Secondary = next category with >0 matches (different from primary)
 *   5. Ties broken by priority_order from the rules file
 *   6. No matches → default to "Diagnostic"
 *
 * @param clinicalIndication - The verbatim reason for study from the order
 * @returns Classification result with primary, optional secondary, and counts
 */
export function classifyStudyIntent(clinicalIndication: string): StudyIntentResult {
  const rules = loadRules();
  const src = (clinicalIndication || '').toLowerCase().trim();

  // Count matches per category
  const counts: Partial<Record<StudyPurpose, number>> = {};

  for (const [cat, obj] of Object.entries(rules.categories)) {
    let matchCount = 0;
    for (const term of obj.terms) {
      // Escape regex special chars in the term, then do word-boundary match
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(src)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      counts[cat as StudyPurpose] = matchCount;
    }
  }

  // Build sorted list of categories with matches, ordered by count desc then priority
  const priorityOrder = rules.priority_order as StudyPurpose[];
  const matched = Object.entries(counts)
    .filter(([, count]) => count! > 0)
    .sort((a, b) => {
      // Sort by match count descending
      const countDiff = b[1]! - a[1]!;
      if (countDiff !== 0) return countDiff;
      // Tiebreak by priority order (lower index = higher priority)
      const aIdx = priorityOrder.indexOf(a[0] as StudyPurpose);
      const bIdx = priorityOrder.indexOf(b[0] as StudyPurpose);
      return aIdx - bIdx;
    });

  // Determine primary and secondary
  const primary: StudyPurpose = matched.length > 0
    ? matched[0][0] as StudyPurpose
    : 'Diagnostic';
  const primaryMatchCount = matched.length > 0 ? matched[0][1]! : 0;

  const secondaryEntry = matched.length > 1 ? matched[1] : null;
  const secondary: StudyPurpose | null = secondaryEntry
    ? secondaryEntry[0] as StudyPurpose
    : null;
  const secondaryMatchCount = secondaryEntry ? secondaryEntry[1]! : 0;

  console.log(
    `[study-intent] Classification: primary=${primary} (${primaryMatchCount} matches)` +
    (secondary ? `, secondary=${secondary} (${secondaryMatchCount} matches)` : '') +
    ` — from "${src.substring(0, 80)}"`,
  );

  return {
    primary,
    secondary,
    primaryMatchCount,
    secondaryMatchCount,
    matchDetails: counts,
  };
}

// ── Context Query Definitions ─────────────────────────────────────────────

/**
 * Static definitions of clinical context queries per study purpose.
 * Each purpose category has a set of data queries that the note triage
 * LLM pass should use to tag relevant sentences.
 */
const QUERY_DEFINITIONS: Record<StudyPurpose, Array<{
  code: string;
  displayLabel: string;
  description: string;
}>> = {
  Diagnostic: [
    {
      code: 'DX-PRES',
      displayLabel: 'CLINICAL PRESENTATION',
      description: 'Acute symptoms, signs, and examination findings that prompted this study — do NOT include patient demographics, age, sex, or past medical history',
    },
    {
      code: 'DX-DDX',
      displayLabel: 'DIFFERENTIAL DIAGNOSIS',
      description: 'Candidate diagnoses being considered, either explicitly stated or strongly implied',
    },
  ],
  Trauma: [
    {
      code: 'TR-MECH',
      displayLabel: 'MECHANISM OF INJURY',
      description: 'How the injury occurred — type of force, speed, height, weapon, etc.',
    },
    {
      code: 'TR-AREA',
      displayLabel: 'AREAS INVOLVED',
      description: 'Body areas involved, injured, or at risk based on the mechanism',
    },
    {
      code: 'TR-KNOWN',
      displayLabel: 'KNOWN / SUSPECTED INJURIES',
      description: 'Specific injuries already identified or strongly suspected from clinical assessment',
    },
  ],
  'Follow-up': [
    {
      code: 'FU-FIND',
      displayLabel: 'FINDING UNDER SURVEILLANCE',
      description: 'The specific finding, condition, or abnormality being followed over time',
    },
    {
      code: 'FU-LAST',
      displayLabel: 'LAST ASSESSMENT',
      description: 'Date and details of the most recent prior assessment of this finding',
    },
    {
      code: 'FU-TREND',
      displayLabel: 'TREND',
      description: 'How the finding has changed over time — trajectory, progression, stability, or improvement',
    },
  ],
  Hardware: [
    {
      code: 'HW-NAME',
      displayLabel: 'HARDWARE / DEVICE',
      description: 'Name, type, and manufacturer of the hardware, device, or implant',
    },
    {
      code: 'HW-DATE',
      displayLabel: 'DATE OF PLACEMENT',
      description: 'When the hardware was inserted, implanted, or placed',
    },
    {
      code: 'HW-ISSUE',
      displayLabel: 'KNOWN ISSUES',
      description: 'Known complications, malfunctions, or concerns about the hardware',
    },
  ],
  Guidance: [
    {
      code: 'GD-PROC',
      displayLabel: 'PROCEDURE',
      description: 'Name and purpose of the procedure requiring imaging guidance',
    },
  ],
  'Post-Op': [
    {
      code: 'PO-PROC',
      displayLabel: 'PROCEDURE',
      description: 'Name and type of the surgical procedure that was performed',
    },
    {
      code: 'PO-COMP',
      displayLabel: 'COMPLICATIONS',
      description: 'Documented or suspected post-operative complications',
    },
  ],
  Screening: [
    {
      code: 'SC-COND',
      displayLabel: 'CONDITION SCREENED',
      description: 'The condition or disease being screened for and relevant risk factors',
    },
  ],
  Medicolegal: [
    {
      code: 'ML-TARG',
      displayLabel: 'EVALUATION TARGET',
      description: 'The specific concern, allegation, or question driving the medicolegal evaluation',
    },
  ],
  Research: [
    {
      code: 'RS-STUDY',
      displayLabel: 'RESEARCH STUDY',
      description: 'Name of the research study and its imaging protocol purpose',
    },
  ],
};

/**
 * Get the set of clinical context queries for a given study intent result.
 *
 * Returns queries for both primary and secondary purposes (if present),
 * tagged with which intent category they belong to.
 *
 * @param intent - The deterministic study intent classification
 * @param bodyRegions - Canonical body regions for the current study
 * @returns Array of context queries to send to the note triage TASK 3
 */
export function getContextQueries(
  intent: StudyIntentResult,
  bodyRegions: string[],
): ContextQuery[] {
  const queries: ContextQuery[] = [];

  // Primary queries
  const primaryDefs = QUERY_DEFINITIONS[intent.primary] || [];
  for (const def of primaryDefs) {
    queries.push({
      code: def.code,
      displayLabel: def.displayLabel,
      description: def.description,
      intentCategory: 'primary',
    });
  }

  // Secondary queries (if secondary intent exists)
  if (intent.secondary) {
    const secondaryDefs = QUERY_DEFINITIONS[intent.secondary] || [];
    for (const def of secondaryDefs) {
      // Avoid duplicate codes if primary and secondary share categories
      if (queries.some((q) => q.code === def.code)) continue;
      queries.push({
        code: def.code,
        displayLabel: def.displayLabel,
        description: def.description,
        intentCategory: 'secondary',
      });
    }
  }

  return queries;
}
