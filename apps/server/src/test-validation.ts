/**
 * Deep validation of HL7 parser output against source data.
 *
 * Verifies:
 * 1. All report sections are correctly identified and extracted
 * 2. HL7 escape sequences are properly reversed
 * 3. Parsed demographics match the source JSON metadata
 * 4. Parsed encounter data matches the source JSON metadata
 * 5. Study metadata (accession, LOINC, dates) matches study_metadata.json
 *
 * Run with: npx ts-node src/test-validation.ts
 */

import fs from 'fs';
import path from 'path';
import { loadPatientFeed } from './services/feed-loader';

const HL7_BASE = path.resolve(__dirname, '../../HL7_Simulation');

interface ValidationResult {
  patient: string;
  check: string;
  pass: boolean;
  detail: string;
}

const results: ValidationResult[] = [];

function check(patient: string, name: string, condition: boolean, detail: string): void {
  results.push({ patient, check: name, pass: condition, detail: condition ? 'OK' : detail });
}

// ── Validate each patient ────────────────────────────────────────────────

for (let p = 1; p <= 7; p++) {
  const patientId = `Patient_${p}`;
  const record = loadPatientFeed(patientId);

  if (!record) {
    check(patientId, 'Feed loads', false, 'Could not load feed');
    continue;
  }

  // ── Cross-reference demographics against JSON source ──
  const demoPath = path.join(HL7_BASE, patientId, 'patient_demographics.json');
  const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));

  check(patientId, 'MRN match', record.demographics.mrn === demo.mrn,
    `Expected ${demo.mrn}, got ${record.demographics.mrn}`);
  check(patientId, 'Last name match', record.demographics.name.last === demo.name.last,
    `Expected ${demo.name.last}, got ${record.demographics.name.last}`);
  check(patientId, 'First name match', record.demographics.name.first === demo.name.first,
    `Expected ${demo.name.first}, got ${record.demographics.name.first}`);
  check(patientId, 'DOB match', record.demographics.dateOfBirth === demo.dateOfBirth,
    `Expected ${demo.dateOfBirth}, got ${record.demographics.dateOfBirth}`);
  check(patientId, 'Sex match', record.demographics.sex === demo.sex,
    `Expected ${demo.sex}, got ${record.demographics.sex}`);

  // ── Cross-reference encounter against JSON source ──
  const encPath = path.join(HL7_BASE, patientId, 'encounter_metadata.json');
  const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));

  check(patientId, 'Patient class match', record.encounter.patientClass === enc.pv1.patientClass,
    `Expected ${enc.pv1.patientClass}, got ${record.encounter.patientClass}`);
  check(patientId, 'Visit number match', record.encounter.visitNumber === enc.pv1.visitNumber,
    `Expected ${enc.pv1.visitNumber}, got ${record.encounter.visitNumber}`);

  // ── Cross-reference MSH ──
  check(patientId, 'Message type', record.messageHeader.messageType === 'ORU^R01',
    `Expected ORU^R01, got ${record.messageHeader.messageType}`);
  check(patientId, 'HL7 version', record.messageHeader.hl7Version === '2.5.1',
    `Expected 2.5.1, got ${record.messageHeader.hl7Version}`);
  check(patientId, 'Control ID match', record.messageHeader.messageControlId === enc.msh.messageControlId,
    `Expected ${enc.msh.messageControlId}, got ${record.messageHeader.messageControlId}`);

  // ── Cross-reference study metadata ──
  const studyMetaPath = path.join(HL7_BASE, patientId, 'study_metadata.json');
  const studyMeta = JSON.parse(fs.readFileSync(studyMetaPath, 'utf8'));

  check(patientId, 'Study count', record.totalStudies === studyMeta.totalStudies,
    `Expected ${studyMeta.totalStudies}, got ${record.totalStudies}`);

  // Check each study's accession number and LOINC code
  for (const srcStudy of studyMeta.studies) {
    const parsed = record.studies.find(s => s.sequence === srcStudy.obrSequence);
    if (!parsed) {
      check(patientId, `Study #${srcStudy.obrSequence} exists`, false, 'Study not found in parsed output');
      continue;
    }

    check(patientId, `Study #${srcStudy.obrSequence} accession`,
      parsed.accessionNumber === srcStudy.accessionNumber,
      `Expected ${srcStudy.accessionNumber}, got ${parsed.accessionNumber}`);

    check(patientId, `Study #${srcStudy.obrSequence} LOINC`,
      parsed.loincCode === srcStudy.universalServiceId.loincCode,
      `Expected ${srcStudy.universalServiceId.loincCode}, got ${parsed.loincCode}`);

    check(patientId, `Study #${srcStudy.obrSequence} datetime`,
      parsed.studyDateTime === srcStudy.studyDateTime,
      `Expected ${srcStudy.studyDateTime}, got ${parsed.studyDateTime}`);

    check(patientId, `Study #${srcStudy.obrSequence} UID`,
      parsed.studyInstanceUid === srcStudy.studyInstanceUid,
      `Expected ${srcStudy.studyInstanceUid}, got ${parsed.studyInstanceUid}`);
  }

  // ── Verify report sections are populated ──
  let sectionsWithIndication = 0;
  let sectionsWithFindings = 0;
  let sectionsWithImpression = 0;

  for (const study of record.studies) {
    if (study.reportSections.clinicalIndication) sectionsWithIndication++;
    if (study.reportSections.findings) sectionsWithFindings++;
    if (study.reportSections.impression) sectionsWithImpression++;
  }

  check(patientId, 'Indications present', sectionsWithIndication > 0,
    `No clinical indications found in any study`);
  check(patientId, 'Findings present', sectionsWithFindings > 0,
    `No findings found in any study`);
  check(patientId, 'Impressions present', sectionsWithImpression > 0,
    `No impressions found in any study`);

  // ── Verify no residual HL7 escape sequences ──
  let escapeLeaks = 0;
  for (const study of record.studies) {
    const allText = study.reportSections.rawText.join(' ');
    if (/\\F\\|\\S\\|\\R\\|\\E\\|\\T\\|\\\.br\\/.test(allText)) {
      escapeLeaks++;
    }
  }
  check(patientId, 'No residual escapes', escapeLeaks === 0,
    `${escapeLeaks} studies have un-reversed escape sequences`);
}

// ── Report ────────────────────────────────────────────────────────────────

console.log('\n=== Deep Validation Results ===\n');

const failures = results.filter(r => !r.pass);
const byPatient = new Map<string, { total: number; passed: number }>();

for (const r of results) {
  const entry = byPatient.get(r.patient) || { total: 0, passed: 0 };
  entry.total++;
  if (r.pass) entry.passed++;
  byPatient.set(r.patient, entry);
}

for (const [patient, counts] of byPatient) {
  const status = counts.passed === counts.total ? 'PASS' : 'FAIL';
  console.log(`  ${status}: ${patient} — ${counts.passed}/${counts.total} checks`);
}

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  for (const f of failures) {
    console.log(`    ${f.patient} / ${f.check}: ${f.detail}`);
  }
}

console.log(`\n${results.length - failures.length}/${results.length} total checks passed`);
console.log(failures.length === 0 ? 'ALL VALIDATION PASSED' : 'VALIDATION FAILED');
