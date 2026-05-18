/**
 * erik-data-codes.ts — Data code catalogue for the ERIK engine.
 *
 * Defines the mapping between single-token codes and the patient data slices
 * that ERIK can request. Each code has:
 *   - A human-readable label (for the Pass 1 menu)
 *   - A tier indicator (cost/size guidance for the LLM)
 *   - An availability check (is this data present for the current context?)
 *   - A loader function (returns compact text for LLM consumption)
 *
 * Tiers:
 *   1 = Cheap (~100-800 tokens): demographics, meds, labs, specific finding/problem groups
 *   2 = Moderate (~1-3K tokens): key note sections
 *   3 = Expensive (~3-5K tokens): full note text
 *
 * Dynamic codes (F1..Fn, P1..Pn) are generated based on the executive summary.
 */

import type { ErikDataContext } from './erik-service';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DataCodeDefinition {
  /** Short code (e.g., "MX", "LB", "F1") */
  code: string;
  /** Human-readable label for the data menu */
  label: string;
  /** Cost tier: 1=cheap, 2=moderate, 3=expensive */
  tier: 1 | 2 | 3;
  /** Check if this data is available in the current context */
  available: (ctx: ErikDataContext) => boolean;
  /** Load the data as compact text for LLM consumption */
  load: (ctx: ErikDataContext) => Promise<string>;
}

// ── Static Code Definitions ────────────────────────────────────────────────

const STATIC_CODES: DataCodeDefinition[] = [
  {
    code: 'DX',
    label: 'Patient demographics (name, DOB, MRN, sex, encounter type)',
    tier: 1,
    available: (ctx) => !!ctx.patientRecord,
    load: async (ctx) => {
      const d = ctx.patientRecord?.demographics;
      if (!d) return '(Demographics unavailable)';
      const enc = ctx.patientRecord?.encounter;
      return [
        `Name: ${d.name.last}, ${d.name.first} ${d.name.middle || ''}`.trim(),
        `DOB: ${d.dateOfBirth}`,
        `Sex: ${d.sex}`,
        `MRN: ${d.mrn}`,
        enc?.patientClass ? `Encounter: ${enc.patientClass}` : '',
        enc?.location ? `Location: ${enc.location}` : '',
        enc?.attendingPhysician ? `Attending: Dr. ${enc.attendingPhysician.last}, ${enc.attendingPhysician.first}` : '',
      ].filter(Boolean).join('\n');
    },
  },

  {
    code: 'CS',
    label: 'Current study metadata (description, date, ordering physician, clinical indication)',
    tier: 1,
    available: (ctx) => !!ctx.currentStudy,
    load: async (ctx) => {
      const cs = ctx.currentStudy;
      if (!cs) return '(Current study unavailable)';
      return [
        `Study: ${cs.studyDescription}`,
        `Date: ${cs.studyDateTime}`,
        `Ordering: ${cs.orderingPhysician}`,
        `Indication: ${cs.clinicalIndication || '(none)'}`,
        `Modality: ${cs.labels?.modality || 'NA'}`,
        `Body Regions: ${cs.labels?.bodyRegions?.join(', ') || 'NA'}`,
      ].join('\n');
    },
  },

  {
    code: 'CR',
    label: 'Current report in progress (the report being actively dictated)',
    tier: 1,
    available: (ctx) => !!ctx.currentReportText && ctx.currentReportText.trim().length > 0,
    load: async (ctx) => {
      return ctx.currentReportText || '(No report text available)';
    },
  },

  {
    code: 'OL',
    label: 'One-liner clinical summary (2-sentence patient overview)',
    tier: 1,
    available: (ctx) => !!ctx.summarizationResult?.oneLiner,
    load: async (ctx) => {
      const ol = ctx.summarizationResult?.oneLiner;
      if (!ol) return '(One-liner not available)';
      return [
        `Imaging-only summary: ${ol.imagingOneLiner}`,
        `Full clinical summary: ${ol.fullOneLiner}`,
      ].join('\n');
    },
  },

  {
    code: 'MX',
    label: 'All medications (names, doses, routes, frequencies, last given)',
    tier: 1,
    available: (ctx) => (ctx.ehrData?.medications?.length ?? 0) > 0,
    load: async (ctx) => {
      const meds = ctx.ehrData?.medications;
      if (!meds?.length) return '(No medications on file)';

      const groups: Record<string, typeof meds> = {};
      for (const m of meds) {
        const cat = m.category || 'other';
        (groups[cat] ??= []).push(m);
      }

      const lines: string[] = [];
      for (const [cat, items] of Object.entries(groups)) {
        lines.push(`[${cat.toUpperCase()}]`);
        for (const m of items) {
          const parts = [m.name];
          if (m.dosageInstruction) parts.push(`— ${m.dosageInstruction}`);
          if (m.lastGiven) parts.push(`(last given: ${m.lastGiven})`);
          if (m.status !== 'active') parts.push(`[${m.status}]`);
          lines.push(`  • ${parts.join(' ')}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    code: 'LB',
    label: 'Lab results (all panels with values, trends, and reference ranges)',
    tier: 1,
    available: (ctx) => {
      const panels = ctx.ehrData?.labs?.panels;
      return !!panels && Object.keys(panels).length > 0;
    },
    load: async (ctx) => {
      const panels = ctx.ehrData?.labs?.panels;
      if (!panels || Object.keys(panels).length === 0) return '(No lab results)';

      const lines: string[] = [];
      for (const [name, panel] of Object.entries(panels)) {
        lines.push(`[${name}]`);
        if (panel.columns?.length) {
          lines.push(`  Dates: ${panel.columns.join(' | ')}`);
        }
        for (const row of panel.rows) {
          const vals = row.values.join(' | ');
          const range = row.referenceRange ? ` (ref: ${row.referenceRange})` : '';
          const unit = row.unit ? ` ${row.unit}` : '';
          const trend = row.trend?.dir ? ` ${row.trend.dir}` : '';
          lines.push(`  ${row.name}: ${vals}${unit}${range}${trend}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    code: 'PX',
    label: 'Procedures / surgical history',
    tier: 1,
    available: (ctx) => (ctx.ehrData?.procedures?.length ?? 0) > 0,
    load: async (ctx) => {
      const procs = ctx.ehrData?.procedures;
      if (!procs?.length) return '(No procedures on file)';

      return procs.map(p => {
        const parts = [p.text];
        if (p.date) parts.push(`(${p.date})`);
        if (p.bodySite) parts.push(`[${p.bodySite}]`);
        if (p.status !== 'completed') parts.push(`{${p.status}}`);
        return `• ${parts.join(' ')}`;
      }).join('\n');
    },
  },

  {
    code: 'PA',
    label: 'Pathology reports (titles, dates, and text)',
    tier: 1,
    available: (ctx) => (ctx.ehrData?.pathology?.length ?? 0) > 0,
    load: async (ctx) => {
      const reports = ctx.ehrData?.pathology;
      if (!reports?.length) return '(No pathology reports)';

      const lines: string[] = [];
      for (const r of reports) {
        lines.push(`[${r.title}] (${r.date || 'undated'}) — Status: ${r.status}`);
        // Load text on-demand if path is available
        if (r.textFilePath && ctx.loadText) {
          try {
            const text = await ctx.loadText(r.textFilePath);
            if (text && !text.startsWith('(')) {
              lines.push(text.slice(0, 4000)); // Cap pathology text
            }
          } catch { /* skip */ }
        }
      }
      return lines.join('\n');
    },
  },

  {
    code: 'ER',
    label: 'Expanded reason for study (synthesized clinical indication)',
    tier: 1,
    available: (ctx) => !!ctx.summarizationResult?.expandedReason,
    load: async (ctx) => {
      const er = ctx.summarizationResult?.expandedReason;
      if (!er) return '(Expanded reason not available)';

      const lines: string[] = [];
      lines.push(`Clinical Indication: ${er.clinicalIndication}`);
      if (er.primary) {
        lines.push(`Primary Purpose: ${er.primary.purpose}`);
        for (const entry of er.primary.entries) {
          lines.push(`  ${entry.displayLabel}: ${entry.content}`);
        }
      }
      if (er.secondary) {
        lines.push(`Secondary Purpose: ${er.secondary.purpose}`);
        for (const entry of er.secondary.entries) {
          lines.push(`  ${entry.displayLabel}: ${entry.content}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    code: 'NS',
    label: 'Key sections from top relevant clinical notes (HPI + Assessment/Plan only)',
    tier: 2,
    available: (ctx) => {
      const si = ctx.summarizationResult?.noteTriage?.sentenceIndex;
      return !!si && si.length > 0;
    },
    load: async (ctx) => {
      const si = ctx.summarizationResult?.noteTriage?.sentenceIndex;
      if (!si?.length) return '(No note sections available)';

      // Group sentences by note, filter to key clinical sections
      const KEY_SECTIONS = new Set(['HPI', 'AP', 'CC', 'COURSE', 'PEX']);
      const byNote = new Map<string, { title: string; sentences: { section: string; text: string }[] }>();

      for (const s of si) {
        if (!KEY_SECTIONS.has(s.section)) continue;
        let entry = byNote.get(s.noteId);
        if (!entry) {
          entry = { title: s.noteTitle, sentences: [] };
          byNote.set(s.noteId, entry);
        }
        entry.sentences.push({ section: s.section, text: s.text });
      }

      const lines: string[] = [];
      for (const [, note] of byNote) {
        lines.push(`[${note.title}]`);
        // Group by section
        const bySection = new Map<string, string[]>();
        for (const s of note.sentences) {
          (bySection.get(s.section) ?? (() => { const a: string[] = []; bySection.set(s.section, a); return a; })()).push(s.text);
        }
        for (const [section, texts] of bySection) {
          lines.push(`  ${section}: ${texts.join(' ')}`);
        }
      }

      // Cap total output
      const full = lines.join('\n');
      return full.slice(0, 6000);
    },
  },
];

// ── Dynamic Code Generators ────────────────────────────────────────────────

/**
 * Generate finding group codes (F1..Fn) from the executive summary.
 */
function generateFindingGroupCodes(ctx: ErikDataContext): DataCodeDefinition[] {
  const regions = ctx.summarizationResult?.executiveSummary?.regionGroups;
  if (!regions?.length) return [];

  // Flatten all finding groups across regions with a global index
  const allFindings: { regionName: string; finding: typeof regions[0]['findings'][0]; globalIdx: number }[] = [];
  let idx = 1;
  for (const region of regions) {
    for (const finding of region.findings) {
      allFindings.push({ regionName: region.regionName, finding, globalIdx: idx++ });
    }
  }

  return allFindings.map(({ regionName, finding, globalIdx }) => ({
    code: `F${globalIdx}`,
    label: `Finding: "${finding.name}" (${regionName}) — ${finding.studyEntries.length} study entries`,
    tier: 1 as const,
    available: () => true,
    load: async () => {
      const lines: string[] = [];
      lines.push(`Finding: ${finding.name}`);
      lines.push(`Region: ${regionName}`);
      if (finding.chips?.length) lines.push(`Tags: ${finding.chips.join(', ')}`);
      if (finding.relevancyScore) {
        lines.push(`Relevancy: ${finding.relevancyScore.total}/10 (SAF:${finding.relevancyScore.SAF} CHG:${finding.relevancyScore.CHG} TRK:${finding.relevancyScore.TRK})`);
      }
      for (const entry of finding.studyEntries) {
        lines.push(`  ${entry.studyName} (${entry.studyDate}):`);
        if (entry.sourceExcerpt) lines.push(`    "${entry.sourceExcerpt}"`);
        if (entry.changeStatement) lines.push(`    Change: ${entry.changeStatement}`);
        if (entry.measurement) lines.push(`    Measurement: ${entry.measurement}`);
      }
      return lines.join('\n');
    },
  }));
}

/**
 * Generate problem group codes (P1..Pn) from the problem grouping result.
 */
function generateProblemGroupCodes(ctx: ErikDataContext): DataCodeDefinition[] {
  const entries = ctx.summarizationResult?.problemGrouping?.entries;
  if (!entries?.length) return [];

  // Build a sentence index lookup for source text resolution
  const sentenceIndex = ctx.summarizationResult?.noteTriage?.sentenceIndex ?? [];
  const sentenceLookup = new Map(sentenceIndex.map(s => [s.id, s]));

  return entries.map((entry, idx) => ({
    code: `P${idx + 1}`,
    label: `Problem: "${entry.name}" (relevancy: ${entry.score}/10)`,
    tier: 1 as const,
    available: () => true,
    load: async () => {
      const lines: string[] = [];
      lines.push(`Problem: ${entry.name}`);
      lines.push(`Relevancy to current study: ${entry.score}/10`);
      if (entry.isGroup && entry.members?.length) {
        lines.push(`Member conditions: ${entry.members.map(m => m.name).join(', ')}`);
      }
      // Resolve source text snippets
      if (entry.sentenceSources?.length) {
        lines.push('Source text:');
        for (const sid of entry.sentenceSources) {
          const s = sentenceLookup.get(sid);
          if (s) {
            lines.push(`  [${s.noteTitle} / ${s.section}]: "${s.text}"`);
          }
        }
      }
      return lines.join('\n');
    },
  }));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the full data code catalogue for a given context.
 * Includes static codes + dynamic F/P codes from the executive summary.
 */
export function buildCodeCatalogue(ctx: ErikDataContext): DataCodeDefinition[] {
  return [
    ...STATIC_CODES,
    ...generateFindingGroupCodes(ctx),
    ...generateProblemGroupCodes(ctx),
  ];
}

/**
 * Build the data menu string for the Pass 1 prompt.
 * Only includes codes that are currently available.
 */
export function buildDataMenu(ctx: ErikDataContext): string {
  const catalogue = buildCodeCatalogue(ctx);
  const available = catalogue.filter(c => c.available(ctx));

  const tierLabel = (t: number) => t === 1 ? 'Tier 1, cheap' : t === 2 ? 'Tier 2, moderate' : 'Tier 3, expensive';

  return available
    .map(c => `${c.code} - ${c.label} [${tierLabel(c.tier)}]`)
    .join('\n');
}

/**
 * Build the Tier 0 findings overview string for Pass 1 context.
 */
export function buildFindingsOverview(ctx: ErikDataContext): string | null {
  const regions = ctx.summarizationResult?.executiveSummary?.regionGroups;
  if (!regions?.length) return null;

  const lines: string[] = [];
  let globalIdx = 1;
  for (const region of regions) {
    lines.push(`${region.regionName}:`);
    for (const finding of region.findings) {
      const score = finding.relevancyScore ? ` (relevancy: ${finding.relevancyScore.total}/10)` : '';
      const chips = finding.chips?.length ? ` [${finding.chips.join(', ')}]` : '';
      lines.push(`  F${globalIdx}: ${finding.name}${chips}${score} — ${finding.studyEntries.length} prior mentions`);
      globalIdx++;
    }
  }
  return lines.join('\n');
}

/**
 * Build the Tier 0 problems overview string for Pass 1 context.
 */
export function buildProblemsOverview(ctx: ErikDataContext): string | null {
  const entries = ctx.summarizationResult?.problemGrouping?.entries;
  if (!entries?.length) return null;

  return entries.map((e, idx) => {
    const members = e.isGroup && e.members?.length
      ? ` (includes: ${e.members.map(m => m.name).join(', ')})`
      : '';
    return `  P${idx + 1}: ${e.name} — relevancy: ${e.score}/10${members}`;
  }).join('\n');
}

/**
 * Load data for a set of requested codes.
 * Returns the combined text payload for Pass 2.
 */
export async function loadRequestedData(
  codes: string[],
  ctx: ErikDataContext,
): Promise<{ text: string; loadedCodes: string[] }> {
  const catalogue = buildCodeCatalogue(ctx);
  const codeLookup = new Map(catalogue.map(c => [c.code, c]));

  const loadedCodes: string[] = [];
  const sections: string[] = [];

  for (const code of codes) {
    const def = codeLookup.get(code);
    if (!def) {
      console.warn(`[erik-data-codes] Unknown code: ${code}`);
      continue;
    }
    if (!def.available(ctx)) {
      console.warn(`[erik-data-codes] Code ${code} not available, skipping`);
      continue;
    }

    try {
      const data = await def.load(ctx);
      if (data) {
        sections.push(`=== ${code}: ${def.label} ===\n${data}`);
        loadedCodes.push(code);
      }
    } catch (err) {
      console.error(`[erik-data-codes] Failed to load ${code}:`, err);
    }
  }

  return {
    text: sections.join('\n\n'),
    loadedCodes,
  };
}
