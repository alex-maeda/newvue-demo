// ERIK UI Actions Service
// Handles parsing and execution of ERIK agent actions

import { EExaminations } from '../models/enums';

// Action types supported by ERIK
export type ErikActionType = 'open_tab' | 'open_rad' | 'open_note';

export interface ErikAction {
  type: ErikActionType;
  params: string[];
  raw: string;
}

// Tab name mapping from ERIK action IDs to EExaminations enum
export const TAB_NAME_MAP: Record<string, EExaminations> = {
  summary: EExaminations.SUMMARY,
  radiology: EExaminations.RADIOLOGY,
  problems: EExaminations.PROBLEM_LIST,
  notes: EExaminations.PHYSICIAN_NOTES,
  surgery: EExaminations.SURGICAL_HISTORY,
  meds: EExaminations.MEDICATIONS,
  labs: EExaminations.LAB_RESULT,
  path: EExaminations.PATHOLOGY,
  erik: EExaminations.AI_RESULTS,
};

// All supported ERIK actions for reference
export const AGENT_ACTIONS = [
  // Tabs
  { id: 'open_tab:summary', label: 'Open Summary Tab' },
  { id: 'open_tab:radiology', label: 'Open Radiology Studies Tab' },
  { id: 'open_tab:problems', label: 'Open Problem List Tab' },
  { id: 'open_tab:notes', label: 'Open Clinical Notes Tab' },
  { id: 'open_tab:surgery', label: 'Open Surgical History Tab' },
  { id: 'open_tab:meds', label: 'Open Medications Tab' },
  { id: 'open_tab:labs', label: 'Open Lab Results Tab' },
  { id: 'open_tab:path', label: 'Open Pathology Tab' },
  { id: 'open_tab:erik', label: 'Open ERIK Tab' },

  // Notes
  { id: 'open_note:ordering', label: 'Open Ordering Physician\u0027s Note' },
  { id: 'open_note:top', label: 'Open Top Scoring Note' },
  { id: 'open_note:recent:1', label: 'Open Most Recent Note' },
  { id: 'open_note:recent:2', label: 'Open Second Most Recent Note' },
  { id: 'open_note:recent:3', label: 'Open Third Most Recent Note' },

  // Radiology: generic / by modality
  { id: 'open_rad:latest', label: 'Open Most Recent Radiology Report' },
  { id: 'open_rad:latest_mod:CT', label: 'Open Most Recent CT' },
  { id: 'open_rad:latest_mod:MR', label: 'Open Most Recent MRI' },
  { id: 'open_rad:latest_mod:US', label: 'Open Most Recent Ultrasound' },
  { id: 'open_rad:latest_mod:XR', label: 'Open Most Recent X-ray' },
  { id: 'open_rad:latest_mod:PET', label: 'Open Most Recent PET' },
  { id: 'open_rad:latest_mod:NM', label: 'Open Most Recent Nuclear Medicine' },
  { id: 'open_rad:latest_mod:MG', label: 'Open Most Recent Mammogram' },

  // Radiology by modality + region
  {
    id: 'open_rad:latest_mod_region:CT:head',
    label: 'Open Most Recent CT Head',
  },
  {
    id: 'open_rad:latest_mod_region:CT:neck',
    label: 'Open Most Recent CT Neck',
  },
  {
    id: 'open_rad:latest_mod_region:CT:spine',
    label: 'Open Most Recent CT Spine',
  },
  {
    id: 'open_rad:latest_mod_region:CT:chest',
    label: 'Open Most Recent CT Chest',
  },
  {
    id: 'open_rad:latest_mod_region:CT:abdomen',
    label: 'Open Most Recent CT Abdomen',
  },
  {
    id: 'open_rad:latest_mod_region:CT:pelvis',
    label: 'Open Most Recent CT Pelvis',
  },
  {
    id: 'open_rad:latest_mod_region:MR:head',
    label: 'Open Most Recent MRI Brain',
  },
  {
    id: 'open_rad:latest_mod_region:MR:neck',
    label: 'Open Most Recent MRI Neck',
  },
  {
    id: 'open_rad:latest_mod_region:MR:spine',
    label: 'Open Most Recent MRI Spine',
  },
  {
    id: 'open_rad:latest_mod_region:MR:chest',
    label: 'Open Most Recent MRI Chest',
  },
  {
    id: 'open_rad:latest_mod_region:MR:abdomen',
    label: 'Open Most Recent MRI Abdomen',
  },
  {
    id: 'open_rad:latest_mod_region:MR:pelvis',
    label: 'Open Most Recent MRI Pelvis',
  },
  {
    id: 'open_rad:latest_mod_region:XR:chest',
    label: 'Open Most Recent Chest X-ray',
  },
];

/**
 * Parse an ERIK action string into structured action object
 */
export function parseErikAction(actionString: string): ErikAction | null {
  if (!actionString) return null;

  const parts = actionString.split(':');
  const actionType = parts[0] as ErikActionType;
  const params = parts.slice(1);

  if (!['open_tab', 'open_rad', 'open_note'].includes(actionType)) {
    console.warn('Unknown ERIK action type:', actionType);
    return null;
  }

  return {
    type: actionType,
    params,
    raw: actionString,
  };
}

/**
 * Get the EExaminations enum value for a tab name
 */
export function getTabEnumFromActionParam(
  tabName: string,
): EExaminations | null {
  return TAB_NAME_MAP[tabName] || null;
}

/**
 * Find radiology report by modality
 */
export function findRadiologyByModality<
  T extends { modality?: string; date?: string },
>(reports: T[], modality: string): T | null {
  let latestReport: T | null = null;
  let latestDate: Date | null = null;

  for (const report of reports) {
    if (report.modality === modality) {
      const reportDate = report.date ? new Date(report.date) : null;
      if (!latestDate || (reportDate && reportDate > latestDate)) {
        latestDate = reportDate;
        latestReport = report;
      }
    }
  }

  return latestReport;
}

/**
 * Find radiology report by modality and region
 */
export function findRadiologyByModalityAndRegion<
  T extends {
    modality?: string;
    date?: string;
    title?: string;
    region?: string;
  },
>(reports: T[], modality: string, region: string): T | null {
  let latestReport: T | null = null;
  let latestDate: Date | null = null;
  const regionLower = region.toLowerCase();

  for (const report of reports) {
    const matchesModality = report.modality === modality;
    const matchesRegion =
      report.region?.toLowerCase().includes(regionLower) ||
      report.title?.toLowerCase().includes(regionLower);

    if (matchesModality && matchesRegion) {
      const reportDate = report.date ? new Date(report.date) : null;
      if (!latestDate || (reportDate && reportDate > latestDate)) {
        latestDate = reportDate;
        latestReport = report;
      }
    }
  }

  return latestReport;
}

/**
 * Find the latest radiology report
 */
export function findLatestRadiology<T extends { date?: string }>(
  reports: T[],
): T | null {
  if (!reports.length) return null;

  return reports.reduce((latest, current) => {
    const latestDate = latest.date ? new Date(latest.date) : new Date(0);
    const currentDate = current.date ? new Date(current.date) : new Date(0);
    return currentDate > latestDate ? current : latest;
  });
}

/**
 * Find note by type or recency
 */
export function findNote<T extends { type?: string; date?: string }>(
  notes: T[],
  noteType: string,
): T | null {
  if (noteType === 'ordering') {
    return notes.find((note) => note.type === 'ordering') || null;
  }

  if (noteType === 'top') {
    // Return first note (assuming sorted by relevance)
    return notes[0] || null;
  }

  if (noteType.startsWith('recent:')) {
    const index = parseInt(noteType.split(':')[1], 10) - 1;
    // Sort by date descending
    const sorted = [...notes].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
    return sorted[index] || null;
  }

  return null;
}

export default {
  parseErikAction,
  getTabEnumFromActionParam,
  findRadiologyByModality,
  findRadiologyByModalityAndRegion,
  findLatestRadiology,
  findNote,
  AGENT_ACTIONS,
  TAB_NAME_MAP,
};
