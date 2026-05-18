/**
 * subregion-loader.ts — Loads the report-level subregion vocabulary and
 * constructs PRIMARY/OVERLAP subregion lists for LLM prompt construction.
 *
 * The PRIMARY/OVERLAP approach ensures that:
 *   - PRIMARY subregions: from the prior study's canonical body region(s).
 *     These are where most findings will be classified.
 *   - OVERLAP subregions: from the current study's canonical body region(s).
 *     Findings tagged with these are likely visible on the current exam.
 *
 * After the LLM returns findings with subregion tags, deterministic code
 * classifies each finding as 'overlap' (in the current exam's field of view)
 * or 'primary' (in the prior study's anatomy but outside the current exam).
 * This drives the `currentStudyRelevance` flag without LLM inference.
 */

import fs from 'fs';
import path from 'path';
import type { StudyLabels } from '../models/types';

// ── Types ─────────────────────────────────────────────────────────────────

/** Structure of report-subregions.json */
interface ReportSubregionsFile {
  version: string;
  regions: Record<string, {
    description: string;
    subregions: string[];
  }>;
}

/** The PRIMARY/OVERLAP subregion lists constructed for an LLM prompt */
export interface SubregionLists {
  /**
   * Subregions from the prior study's canonical body region(s).
   * Most findings will be classified into these.
   */
  primary: string[];

  /**
   * Subregions from the current study's canonical body region(s)
   * that are NOT already in the primary list.
   * Findings in these regions are likely visible on the current exam.
   * Empty when the prior and current study share the same canonical region(s).
   */
  overlap: string[];

  /**
   * The canonical region names that contributed to the primary list.
   * Used for logging and QA.
   */
  primaryCanonicalRegions: string[];

  /**
   * The canonical region names that contributed to the overlap list.
   * Used for logging and QA.
   */
  overlapCanonicalRegions: string[];
}

// ── Data Loading ──────────────────────────────────────────────────────────

let cachedData: ReportSubregionsFile | null = null;

/**
 * Load and cache the report-subregions.json vocabulary.
 * Uses synchronous read on first call, then serves from cache.
 */
function loadSubregionData(): ReportSubregionsFile {
  if (cachedData) return cachedData;

  const filePath = path.resolve(__dirname, '../data/report-subregions.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  cachedData = JSON.parse(raw) as ReportSubregionsFile;

  console.log(
    `[subregion-loader] Loaded ${Object.keys(cachedData.regions).length} ` +
    `canonical regions from report-subregions.json`,
  );

  return cachedData;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get the subregion list for a single canonical body region.
 *
 * @param canonicalRegion - The canonical region name (e.g., "Chest", "Head")
 * @returns Array of subregion options, or empty array if region is not found
 */
export function getSubregionsForCanonical(canonicalRegion: string): string[] {
  const data = loadSubregionData();
  const entry = data.regions[canonicalRegion];
  return entry ? [...entry.subregions] : [];
}

/**
 * Get all canonical region names that have subregion definitions.
 * Excludes Mass, Soft, Bone, Joint which are handled differently.
 */
export function getAvailableCanonicalRegions(): string[] {
  const data = loadSubregionData();
  return Object.keys(data.regions);
}

/**
 * Build the PRIMARY and OVERLAP subregion lists for a specific
 * prior study × current study pair.
 *
 * This is the core function used by the summarization prompt builder
 * to constrain the LLM's finding region assignments.
 *
 * @param priorLabels - Structured labels from the prior study
 * @param currentLabels - Structured labels from the current study
 * @returns SubregionLists with primary, overlap, and source tracking
 */
export function buildSubregionLists(
  priorLabels: StudyLabels,
  currentLabels: StudyLabels,
): SubregionLists {
  const data = loadSubregionData();

  // Extract canonical body regions from each study's labels
  const priorCanonicals = priorLabels.bodyRegions;
  const currentCanonicals = currentLabels.bodyRegions;

  // Build PRIMARY list: union of all subregions from the prior's canonical regions
  const primarySet = new Set<string>();
  const primaryCanonicalRegions: string[] = [];

  for (const region of priorCanonicals) {
    const entry = data.regions[region];
    if (entry) {
      entry.subregions.forEach((s) => primarySet.add(s));
      primaryCanonicalRegions.push(region);
    }
  }

  // Build OVERLAP list: subregions from the current study's canonical regions
  // that are NOT already in the primary list
  const overlapSet = new Set<string>();
  const overlapCanonicalRegions: string[] = [];

  for (const region of currentCanonicals) {
    // Skip if this canonical region is already in the prior's list
    // (i.e., prior and current share the same canonical region)
    if (primaryCanonicalRegions.includes(region)) continue;

    const entry = data.regions[region];
    if (entry) {
      for (const subregion of entry.subregions) {
        // Only add to overlap if not already in primary
        if (!primarySet.has(subregion)) {
          overlapSet.add(subregion);
        }
      }
      overlapCanonicalRegions.push(region);
    }
  }

  return {
    primary: Array.from(primarySet),
    overlap: Array.from(overlapSet),
    primaryCanonicalRegions,
    overlapCanonicalRegions,
  };
}

/**
 * Determine the `currentStudyRelevance` tag for a finding based on
 * which subregion list its assigned bodySubregion belongs to.
 *
 * This is a deterministic classification — no LLM involved.
 *
 * @param bodySubregion - The subregion assigned by the LLM
 * @param subregionLists - The PRIMARY/OVERLAP lists used for the prompt
 * @returns 'overlapping' if the finding is in the current exam's field of view,
 *          'adjacent' if it's in the prior's anatomy only,
 *          'non-overlapping' if the subregion isn't in either list (edge case)
 */
export function classifyFindingRelevance(
  bodySubregion: string,
  subregionLists: SubregionLists,
): 'overlapping' | 'adjacent' | 'non-overlapping' {
  // If the prior and current share the same canonical region,
  // ALL findings are overlapping by definition
  if (subregionLists.overlap.length === 0 && subregionLists.primary.length > 0) {
    // No overlap list means the canonical regions were identical
    // Check if the subregion is in the primary list (which IS the overlap)
    if (subregionLists.primary.includes(bodySubregion)) {
      return 'overlapping';
    }
  }

  // Check if the finding's subregion is in the overlap list (current exam's anatomy)
  if (subregionLists.overlap.includes(bodySubregion)) {
    return 'overlapping';
  }

  // Check if it's in the primary list (prior study's anatomy)
  if (subregionLists.primary.includes(bodySubregion)) {
    // If there's no overlap list, this means the canonical regions matched,
    // so everything is overlapping
    if (subregionLists.overlapCanonicalRegions.length === 0) {
      return 'overlapping';
    }
    return 'adjacent';
  }

  // "Other" or unrecognized subregion
  return 'non-overlapping';
}
