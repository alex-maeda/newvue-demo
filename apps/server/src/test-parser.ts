/**
 * Quick smoke test for the HL7 parser.
 * Run with: npx ts-node src/test-parser.ts
 */

import { loadPatientFeed, listAvailablePatients } from './services/feed-loader';

console.log('=== Testing listAvailablePatients() ===\n');
const patients = listAvailablePatients();
patients.forEach(p => {
  console.log(`  ${p.patientId}: ${p.name} (${p.mrn}, ${p.sex}, class=${p.patientClass}, studies=${p.totalStudies})`);
});

console.log('\n=== Testing loadPatientFeed("Patient_6") ===\n');
const p6 = loadPatientFeed('Patient_6');
if (!p6) {
  console.error('FAIL: Could not load Patient_6');
  process.exit(1);
}

console.log('MSH:', JSON.stringify(p6.messageHeader, null, 2));
console.log('\nPID:', JSON.stringify(p6.demographics, null, 2));
console.log('\nPV1:', JSON.stringify(p6.encounter, null, 2));
console.log('\nStudies:', p6.totalStudies);

for (const study of p6.studies) {
  console.log(`\n  Study #${study.sequence}: ${study.studyDescription}`);
  console.log(`    Accession: ${study.accessionNumber}`);
  console.log(`    LOINC: ${study.loincCode}`);
  console.log(`    DateTime: ${study.studyDateTime}`);
  console.log(`    Indication: ${study.clinicalIndication}`);
  console.log(`    UID: ${study.studyInstanceUid}`);
  console.log(`    Sections present:`);
  const s = study.reportSections;
  console.log(`      Clinical Indication: ${s.clinicalIndication ? 'YES (' + s.clinicalIndication.substring(0, 50) + '...)' : 'NO'}`);
  console.log(`      Technique: ${s.technique ? 'YES' : 'NO'}`);
  console.log(`      Comparison: ${s.comparison ? 'YES' : 'NO'}`);
  console.log(`      Findings: ${s.findings ? 'YES (' + s.findings.substring(0, 50) + '...)' : 'NO'}`);
  console.log(`      Impression: ${s.impression ? 'YES (' + s.impression.substring(0, 50) + '...)' : 'NO'}`);
  console.log(`      Raw OBX count: ${s.rawText.length}`);
}

console.log('\n=== Testing all patients study counts ===\n');
const expectedCounts: Record<string, number> = {
  Patient_1: 26, Patient_2: 49, Patient_3: 23,
  Patient_4: 14, Patient_5: 15, Patient_6: 2, Patient_7: 1,
};

let allPass = true;
for (const [id, expected] of Object.entries(expectedCounts)) {
  const record = loadPatientFeed(id);
  if (!record) {
    console.log(`  FAIL: ${id} - could not load`);
    allPass = false;
    continue;
  }
  const pass = record.totalStudies === expected;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${id} - expected ${expected} studies, got ${record.totalStudies}`);
  if (!pass) allPass = false;
}

console.log(`\n${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
