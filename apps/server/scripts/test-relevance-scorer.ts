/// <reference types="node" />
/**
 * Test suite for the relevance scoring engine.
 *
 * Validates all scoring dimensions against the specification examples
 * from the design document, plus edge cases.
 *
 * Run with:
 *   npx tsx scripts/test-relevance-scorer.ts
 */

import { scoreRelevance, computeAllRelevanceScores, detectOncologyContext } from '../src/services/relevance-scorer';
import type { CurrentStudy, Study, StudyLabels, RelevanceResult } from '../src/models/types';

// ── Test Helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed++;
    console.log(`  ✓ ${message} (${actual.toFixed(4)} ≈ ${expected.toFixed(4)})`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message} — expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
  }
}

/** Build a minimal CurrentStudy for testing */
function makeCurrentStudy(overrides: Partial<CurrentStudy> & { labels: StudyLabels }): CurrentStudy {
  return {
    currentStudyId: 'TEST-CURRENT-001',
    studyDescription: 'Test Current Study',
    accessionNumber: 'ACC-TEST',
    studyDateTime: '20250920140000',
    orderingPhysician: 'Test, Doctor',
    clinicalIndication: 'Testing',
    resultStatus: 'IP',
    studyInstanceUid: '1.2.3.4',
    ...overrides,
  };
}

/** Build a minimal Study (prior) for testing */
function makePriorStudy(overrides: Partial<Study> & { labels: StudyLabels }): Study {
  return {
    sequence: 1,
    accessionNumber: 'ACC-PRIOR',
    studyDescription: 'Test Prior Study',
    loincCode: '',
    studyDateTime: '20250913140000', // 1 week before default current
    clinicalIndication: '',
    resultStatus: 'F',
    studyInstanceUid: '1.2.3.5',
    reportSections: { clinicalIndication: null, technique: null, comparison: null, findings: null, impression: null, rawText: [] },
    ...overrides,
  };
}

/** Compute an HL7 datetime string offset by N days from a base date */
function offsetDays(baseDateTime: string, daysBefore: number): string {
  const year = parseInt(baseDateTime.substring(0, 4), 10);
  const month = parseInt(baseDateTime.substring(4, 6), 10) - 1;
  const day = parseInt(baseDateTime.substring(6, 8), 10);
  const hour = parseInt(baseDateTime.substring(8, 10), 10);
  const d = new Date(year, month, day, hour, 0, 0);
  d.setDate(d.getDate() - daysBefore);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return `${y}${m}${dd}${hh}0000`;
}

// ── Specification Example Tests ───────────────────────────────────────────

const CURRENT_DT = '20250920140000';

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  RELEVANCE SCORING ENGINE — TEST SUITE');
console.log('══════════════════════════════════════════════════════════════\n');

// ── Test 1: Max Possible Points ──────────────────────────────────────────

console.log('── Max Possible Points ──');

{
  // CT Head — no angio, no laterality → 12
  const current = makeCurrentStudy({
    studyDescription: 'CT Head',
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 1),
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const result = scoreRelevance(current, prior);
  assert(result.maxPossible === 12, 'CT Head: max possible = 12');
}

{
  // CT Angiography Upper Extremity Left → 17
  const current = makeCurrentStudy({
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['upper extremity'],
      isAngiographic: true, laterality: 'left', allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['upper extremity'],
      isAngiographic: true, laterality: 'left', allModalities: ['CT'],
    },
  });
  const result = scoreRelevance(current, prior);
  assert(result.maxPossible === 17, 'CT Angio UE Left: max possible = 17');
}

// ── Test 2: Spec Example — CT Head vs MR Brain (<1 week) ────────────────

console.log('\n── Spec Example: CT Head vs MR Brain (<1 week) ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3), // 3 days ago
    labels: {
      modality: 'MR', bodyRegions: ['Head'], rawBodyRegions: ['brain'],
      isAngiographic: false, laterality: null, allModalities: ['MR'],
    },
  });
  const result = scoreRelevance(current, prior);

  assert(result.breakdown.modality === 2, 'Modality: 2 pts (MR is useful)');
  assert(result.breakdown.bodyRegion === 4, 'Body region: 4 pts (canonical match)');
  assert(result.breakdown.recency === 4, 'Recency: 4 pts (<1 week)');
  assert(result.totalScore === 10, 'Total: 10 pts');
  assertApprox(result.percentage, 10 / 12, 0.01, 'Percentage ≈ 83%');
  assert(result.isRelevant === true, 'Is relevant');
}

// ── Test 3: Spec Example — CT Head vs MR Spine Cervical (<1 week) ───────

console.log('\n── Spec Example: CT Head vs MR Spine Cervical (<1 week) ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'MR', bodyRegions: ['Cervical', 'Spine'], rawBodyRegions: ['cervical', 'spine'],
      isAngiographic: false, laterality: null, allModalities: ['MR'],
    },
  });
  const result = scoreRelevance(current, prior);

  assert(result.breakdown.modality === 2, 'Modality: 2 pts (MR is useful)');
  assert(result.breakdown.bodyRegion === 1, 'Body region: 1 pt (weak adjacency Head↔Cervical)');
  assert(result.breakdown.recency === 4, 'Recency: 4 pts (<1 week)');
  assert(result.totalScore === 7, 'Total: 7 pts');
  assertApprox(result.percentage, 7 / 12, 0.01, 'Percentage ≈ 58%');
  assert(result.isRelevant === false, 'NOT relevant (below 60%)');
}

// ── Test 4: Spec Example — CT Head vs MR Brain (1 year ago) ─────────────

console.log('\n── Spec Example: CT Head vs MR Brain (1 year ago) ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 365),
    labels: {
      modality: 'MR', bodyRegions: ['Head'], rawBodyRegions: ['brain'],
      isAngiographic: false, laterality: null, allModalities: ['MR'],
    },
  });
  const result = scoreRelevance(current, prior);

  assert(result.breakdown.modality === 2, 'Modality: 2 pts (MR is useful)');
  assert(result.breakdown.bodyRegion === 4, 'Body region: 4 pts (canonical match)');
  // At exactly 365 days ≈ 1 year, the taper should give ≈1.0 pts
  assertApprox(result.breakdown.recency, 1.0, 0.1, 'Recency: ~1 pts (at ~1 year)');
  assertApprox(result.totalScore, 7, 0.1, 'Total: ~7 pts');
  assertApprox(result.percentage, 7 / 12, 0.02, 'Percentage ≈ 58%');
  assert(result.isRelevant === false, 'NOT relevant (below 60%)');
}

// ── Test 5: Spec Example — CT Head vs US Thyroid (<1 week) ──────────────

console.log('\n── Spec Example: CT Head vs US Thyroid (<1 week) ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'US', bodyRegions: ['Neck'], rawBodyRegions: ['thyroid'],
      isAngiographic: false, laterality: null, allModalities: ['US'],
    },
  });
  const result = scoreRelevance(current, prior);

  assert(result.breakdown.modality === 0, 'Modality: 0 pts (US is not useful)');
  assert(result.breakdown.bodyRegion === 1, 'Body region: 1 pt (weak adjacency Head↔Neck)');
  assert(result.breakdown.recency === 4, 'Recency: 4 pts (<1 week)');
  assert(result.totalScore === 5, 'Total: 5 pts');
  assertApprox(result.percentage, 5 / 12, 0.01, 'Percentage ≈ 42%');
  assert(result.isRelevant === false, 'NOT relevant (below 60%)');
}

// ── Test 6: Spec Example — CT Angio UE Left vs US Duplex Left Arm (6mo) ─

console.log('\n── Spec Example: CT Angio UE Left vs US Duplex Left Arm (6 months) ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['upper extremity'],
      isAngiographic: true, laterality: 'left', allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 183), // ~6 months
    labels: {
      modality: 'US', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: true, laterality: 'left', allModalities: ['US'],
    },
  });
  const result = scoreRelevance(current, prior);

  assert(result.breakdown.modality === 0, 'Modality: 0 pts (US not useful for CT comparison)');
  assert(result.breakdown.bodyRegion === 4, 'Body region: 4 pts (canonical match, not raw)');
  assertApprox(result.breakdown.recency, 2.0, 0.1, 'Recency: ~2 pts (at ~6 months)');
  assert(result.breakdown.angiography === 3, 'Angiography: 3 pts (both angiographic)');
  assert(result.breakdown.laterality === 2, 'Laterality: 2 pts (left-left exact)');
  assertApprox(result.totalScore, 11, 0.1, 'Total: ~11 pts');
  assertApprox(result.percentage, 11 / 17, 0.02, 'Percentage ≈ 65%');
  assert(result.isRelevant === true, 'Is relevant');
}

// ── Test 7: Angiography Penalties ────────────────────────────────────────

console.log('\n── Angiography Mismatch Penalty ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: true, laterality: null, allModalities: ['CT'],
    },
  });
  const prior = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const result = scoreRelevance(current, prior);

  assert(result.breakdown.angiography === -2, 'Angiography mismatch: -2 pts');
  assert(result.maxPossible === 15, 'Max possible: 15 (angio adds 3)');
  // 3 + 5 + 4 + (-2) = 10/15 = 67%
  assert(result.breakdown.modality === 3, 'Modality: 3 (exact match)');
  assert(result.breakdown.bodyRegion === 5, 'Body region: 5 (raw match)');
  assert(result.totalScore === 10, 'Total: 10');
}

// ── Test 8: Laterality Scoring ───────────────────────────────────────────

console.log('\n── Laterality Scoring ──');

{
  // L-R mismatch → -2
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: false, laterality: 'left', allModalities: ['CT'],
    },
  });
  const priorRight = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: false, laterality: 'right', allModalities: ['CT'],
    },
  });
  let result = scoreRelevance(current, priorRight);
  assert(result.breakdown.laterality === -2, 'Left-Right mismatch: -2 pts');

  // L-Bilateral → +1
  const priorBilateral = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: false, laterality: 'bilateral', allModalities: ['CT'],
    },
  });
  result = scoreRelevance(current, priorBilateral);
  assert(result.breakdown.laterality === 1, 'Left-Bilateral partial: +1 pt');

  // Bilateral current → 0 regardless of prior
  const currentBilateral = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: false, laterality: 'bilateral', allModalities: ['CT'],
    },
  });
  result = scoreRelevance(currentBilateral, priorRight);
  assert(result.breakdown.laterality === 0, 'Bilateral current, Right prior: 0 pts');
}

// ── Test 9: Multi-Region Averaging ───────────────────────────────────────

console.log('\n── Multi-Region Body Scoring (Average) ──');

{
  // Current has 2 regions; prior matches one exactly, one via close adjacency
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Abdomen', 'Pelvis'], rawBodyRegions: ['abdomen', 'pelvis'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorExact = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Abdomen', 'Pelvis'], rawBodyRegions: ['abdomen', 'pelvis'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  let result = scoreRelevance(current, priorExact);
  assert(result.breakdown.bodyRegion === 5, 'Both regions match exactly: avg(5,5) = 5');

  const priorPartial = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Abdomen'], rawBodyRegions: ['abdomen'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  result = scoreRelevance(current, priorPartial);
  // abdomen matches raw (5), pelvis→abdomen is close adjacency (2), avg = 3.5
  assertApprox(result.breakdown.bodyRegion, 3.5, 0.01, 'Partial: avg(5, 2) = 3.5');
}

// ── Test 10: Close Adjacency ─────────────────────────────────────────────

console.log('\n── Close Adjacency ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Chest'], rawBodyRegions: ['chest'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorArm = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Arm'], rawBodyRegions: ['arm'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const result = scoreRelevance(current, priorArm);
  assert(result.breakdown.bodyRegion === 2, 'Chest↔Arm close adjacency: 2 pts');
}

// ── Test 11: Recency Linear Taper ────────────────────────────────────────

console.log('\n── Recency Linear Taper ──');

{
  const labels: StudyLabels = {
    modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
    isAngiographic: false, laterality: null, allModalities: ['CT'],
  };
  const current = makeCurrentStudy({ studyDateTime: CURRENT_DT, labels });

  // Within 1 week → 4
  let prior = makePriorStudy({ studyDateTime: offsetDays(CURRENT_DT, 5), labels });
  assertApprox(scoreRelevance(current, prior).breakdown.recency, 4, 0.01, '5 days: 4 pts');

  // At 1 month → 3
  prior = makePriorStudy({ studyDateTime: offsetDays(CURRENT_DT, 30), labels });
  assertApprox(scoreRelevance(current, prior).breakdown.recency, 3, 0.1, '~30 days: ~3 pts');

  // At 6 months → 2
  prior = makePriorStudy({ studyDateTime: offsetDays(CURRENT_DT, 183), labels });
  assertApprox(scoreRelevance(current, prior).breakdown.recency, 2, 0.1, '~183 days: ~2 pts');

  // At 1 year → 1
  prior = makePriorStudy({ studyDateTime: offsetDays(CURRENT_DT, 365), labels });
  assertApprox(scoreRelevance(current, prior).breakdown.recency, 1, 0.1, '~365 days: ~1 pt');

  // At 2 years → 0
  prior = makePriorStudy({ studyDateTime: offsetDays(CURRENT_DT, 731), labels });
  assertApprox(scoreRelevance(current, prior).breakdown.recency, 0, 0.01, '~731 days: 0 pts');
}

// ── Test 12: New Spine Sub-Region Adjacency ──────────────────────────────

console.log('\n── Spine Sub-Region Close Adjacency ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'MR', bodyRegions: ['Lumbar'], rawBodyRegions: ['lumbar'],
      isAngiographic: false, laterality: null, allModalities: ['MR'],
    },
  });
  const priorThoracic = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'MR', bodyRegions: ['Thoracic'], rawBodyRegions: ['thoracic'],
      isAngiographic: false, laterality: null, allModalities: ['MR'],
    },
  });
  const result = scoreRelevance(current, priorThoracic);
  assert(result.breakdown.bodyRegion === 2, 'Lumbar↔Thoracic close adjacency: 2 pts');
}

// ── Test 13: Edge Case — No Labels on Prior ──────────────────────────────

console.log('\n── Edge Case: No Labels ──');

{
  const current = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorNoLabels = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: undefined as unknown as StudyLabels,
  });
  const result = scoreRelevance(current, priorNoLabels);
  assert(result.totalScore === 0, 'No labels: total = 0');
  assert(result.isRelevant === false, 'No labels: not relevant');
}

// ── Test 14: Oncology Keyword Detection ──────────────────────────────────

console.log('\n── Oncology Keyword Detection ──');

{
  // Positive detections
  assert(detectOncologyContext('Evaluate for metastatic disease') === true, 'Detects "metastatic"');
  assert(detectOncologyContext('History of lung cancer') === true, 'Detects "cancer"');
  assert(detectOncologyContext('STAGING CT CHEST') === true, 'Detects "staging" (case-insensitive)');
  assert(detectOncologyContext('Known lymphoma follow-up') === true, 'Detects "lymphoma"');
  assert(detectOncologyContext('R/o recurrence of breast carcinoma') === true, 'Detects "carcinoma" and "recurrence"');
  assert(detectOncologyContext('Tumour in left kidney') === true, 'Detects "tumour" (British spelling)');

  // Negative detections
  assert(detectOncologyContext('Chest pain, rule out PE') === false, 'No match for non-oncology');
  assert(detectOncologyContext('Fall from standing height') === false, 'No match for trauma');
  assert(detectOncologyContext('') === false, 'Empty string returns false');
  assert(detectOncologyContext(null) === false, 'Null returns false');
  assert(detectOncologyContext(undefined) === false, 'Undefined returns false');

  // Boundary: should NOT match partial words
  assert(detectOncologyContext('The staging area is clear') === true, 'Matches "staging" as word');
  assert(detectOncologyContext('Malignancies suspected') === false, 'Does NOT match "malignancies" (only exact word forms)');
}

// ── Test 15: Oncology — Whole Body Upgrade ────────────────────────────────

console.log('\n── Oncology Context: Whole Body Upgrade ──');

{
  // WITHOUT oncology context: CT Head vs NM Whole Body → Whole is weak adjacency (1 pt)
  const currentNoOnc = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    clinicalIndication: 'Headache, rule out stroke',
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorWholeBody = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 30),
    labels: {
      modality: 'NM', bodyRegions: ['Whole'], rawBodyRegions: ['whole body'],
      isAngiographic: false, laterality: null, allModalities: ['NM'],
    },
  });
  let result = scoreRelevance(currentNoOnc, priorWholeBody);
  assert(result.breakdown.bodyRegion === 1, 'No oncology: Whole Body = 1 pt (weak adjacency)');

  // WITH oncology context: same pairing → Whole upgraded to 4 pts
  const currentOnc = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    clinicalIndication: 'Known lung cancer, evaluate for metastatic disease',
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorWholeBody2 = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'NM', bodyRegions: ['Whole'], rawBodyRegions: ['whole body'],
      isAngiographic: false, laterality: null, allModalities: ['NM'],
    },
  });
  result = scoreRelevance(currentOnc, priorWholeBody2);
  assert(result.breakdown.bodyRegion === 4, 'Oncology: Whole Body upgraded to 4 pts');
  // Total: 0 (modality) + 4 (body) + 4 (recency <1wk) = 8/12 = 67%
  assert(result.isRelevant === true, 'Oncology: Whole Body study is now relevant');
}

// ── Test 16: Oncology — Non-Whole Adjacency Unaffected ───────────────────

console.log('\n── Oncology Context: Non-Whole Adjacency Unaffected ──');

{
  // Even with oncology context, non-Whole weak adjacency stays at 1 pt
  const currentOnc = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    clinicalIndication: 'Staging for pancreatic carcinoma',
    labels: {
      modality: 'CT', bodyRegions: ['Head'], rawBodyRegions: ['head'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorNeck = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'CT', bodyRegions: ['Neck'], rawBodyRegions: ['neck'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const result = scoreRelevance(currentOnc, priorNeck);
  assert(result.breakdown.bodyRegion === 1, 'Oncology: Head↔Neck stays at 1 pt (Neck is not Whole)');
}

// ── Test 17: Oncology — Multi-Region Average with Whole ──────────────────

console.log('\n── Oncology Context: Multi-Region Average with Whole ──');

{
  // Current: CT Abdomen Pelvis (oncology) vs Prior: NM Whole Body
  // Abdomen→Whole = 4 pts (oncology upgrade), Pelvis→Whole = 4 pts (oncology upgrade)
  // Average = 4.0
  const currentOnc = makeCurrentStudy({
    studyDateTime: CURRENT_DT,
    clinicalIndication: 'Restaging colon cancer',
    labels: {
      modality: 'CT', bodyRegions: ['Abdomen', 'Pelvis'],
      rawBodyRegions: ['abdomen', 'pelvis'],
      isAngiographic: false, laterality: null, allModalities: ['CT'],
    },
  });
  const priorWhole = makePriorStudy({
    studyDateTime: offsetDays(CURRENT_DT, 3),
    labels: {
      modality: 'NM', bodyRegions: ['Whole'], rawBodyRegions: ['whole body'],
      isAngiographic: false, laterality: null, allModalities: ['NM'],
    },
  });
  const result = scoreRelevance(currentOnc, priorWhole);
  assertApprox(result.breakdown.bodyRegion, 4.0, 0.01, 'Oncology multi-region: avg(4, 4) = 4.0');
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
