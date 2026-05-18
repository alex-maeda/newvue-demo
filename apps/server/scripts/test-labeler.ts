/**
 * Quick test of the study labeler — run with:
 *   npx ts-node --esm scripts/test-labeler.ts
 */

import { labelStudyDescription } from '../src/services/study-labeler';

const testCases = [
  'CT Chest',
  'MR Brain without Contrast',
  'XR Chest 2 Views',
  'CT Angiogram Chest for PE',
  'US Diagnostic Breast Left Limited',
  'XR Right Foot',
  'Screening Mammogram Bilateral with CAD',
  'Echocardiogram 2D with M-Mode',
  'US Vascular Lower Extremity',
  'PET-CT Whole Body',
  'IR Vascular Procedure',
  'MR Cervical Spine',
  'MR Lumbar Spine',
  'CT Head',
  'US-Guided Biopsy',
  'CT Musculoskeletal',
];

console.log('Study Description'.padEnd(42), '  MOD', ' Regions'.padEnd(30), ' Angio?', ' Lat');
console.log('─'.repeat(100));

for (const name of testCases) {
  const labels = labelStudyDescription(name);
  console.log(
    name.padEnd(42),
    labels.modality.padEnd(4),
    labels.bodyRegions.join(', ').padEnd(30),
    labels.isAngiographic ? 'YES  ' : 'no   ',
    labels.laterality ?? '-',
  );
}
