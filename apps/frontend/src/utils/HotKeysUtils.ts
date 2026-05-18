import {
  ClinicalInfoUrl,
  DashboardUrl,
  FolllowUpUrl,
  WorklistUrl,
} from '../UrlsConfig';

const getResultHotKey = (e: KeyboardEvent, url: string, isIncludes = true) => {
  const shouldPreventDefault = isIncludes
    ? window.location.href.includes(url)
    : !window.location.href.includes(url);

  if (shouldPreventDefault) {
    e.stopPropagation();
    e.preventDefault();
  }

  return shouldPreventDefault;
};

export const hotKeysMap: Record<string, (e: KeyboardEvent) => boolean> = {
  'Z+R': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // Radiology Report
  'Z+I': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // AI Results
  'Z+P': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // Problem List
  'Z+N': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // Physician Notes
  'Z+M': (e: KeyboardEvent) =>
    getResultHotKey(e, ClinicalInfoUrl) || getResultHotKey(e, WorklistUrl), // Medications or Open the first case on the “My Cases” worklist
  'Z+H': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // Surgical History
  'Z+L': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // Lab Results
  'Z+Y': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl), // Pathology
  'Z+F': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl), // Expand the search pane (if not open) and put the cursor in the search box
  'Z+1': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl), // Open the first worklist etc up to 9 -->
  'Z+2': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+3': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+4': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+5': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+6': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+7': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+8': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl),
  'Z+9': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl), // <--
  'Z+O': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl), // if selected row go to clinical info
  'Z+,': (e: KeyboardEvent) => getResultHotKey(e, WorklistUrl, false), // Worklist tab
  'Z+.': (e: KeyboardEvent) => getResultHotKey(e, ClinicalInfoUrl, false), // Clinical Information tab
  'Z+/': (e: KeyboardEvent) => getResultHotKey(e, FolllowUpUrl, false), // Follow-up Management tab
  // eslint-disable-next-line quotes
  "Z+'": (e: KeyboardEvent) => getResultHotKey(e, DashboardUrl, false), // Dashboard tab
};
