# HL7 Simulation — Engineering Reference

> **Project**: NewVue Radiology Report Summarization System  
> **Module**: Simulated HL7 ORU^R01 Data Pipeline  
> **HL7 Version**: 2.5.1  
> **Last Updated**: 2026-04-23

---

## 1. Purpose and Context

### Why This Module Exists

The NewVue Radiology Report Summarization system is designed to ingest radiology
report data from hospital Radiology Information Systems (RIS) via HL7 v2.x message
feeds, parse the clinical content, and present prioritized summaries to radiologists
through a web-based UI. In production, these feeds arrive as real-time HL7 ORU^R01
messages from customer RIS systems.

This simulation module provides **synthetic but structurally faithful HL7 message
feeds** that replicate the format, field layout, and clinical complexity of real
hospital data. These simulated feeds serve as the development and demonstration
data source until the system is deployed against live customer integrations.

### What This Module Produces

For each of 7 simulated patients, the pipeline produces a single `.hl7` file
containing a complete HL7 ORU^R01 message with:

- **MSH** (Message Header) — routing, timestamps, HL7 version
- **PID** (Patient Identification) — MRN, name, DOB, sex, address
- **PV1** (Patient Visit) — encounter class, location, physicians
- **OBR/OBX/ZDS groups** (one per study) — study metadata, parsed report text
  by semantic section, and DICOM Study Instance UIDs

The 7 patients collectively represent **130 radiology studies** producing
**852 HL7 segments** across a range of imaging modalities (CT, MR, XR, US, NM,
IR, MG) and clinical scenarios (oncology staging, trauma, screening, ED workups).

### Relationship to Source Reports

The actual radiology report text lives in `../Reports/Patient_#/` directories.
These are the **source clinical data** — de-identified radiology reports manually
curated from realistic clinical scenarios. The HL7 simulation pipeline reads these
reports and wraps them in HL7 message envelopes. The report text itself is **not
duplicated** in this directory; the `.hl7` files reference it via the OBX segments.

---

## 2. Directory Structure

```
HL7_Simulation/
├── README.md                          ← This file
├── shared_metadata.json               ← Hospital/system constants (MSH, ZDS defaults)
├── physician_pool.json                ← Mock attending + referring physician pool (12)
├── loinc_study_map.json               ← Study type → LOINC code mapping (49 types)
├── Patient_1/
│   ├── patient_demographics.json      ← PID segment: name, DOB, sex, address, MRN
│   ├── encounter_metadata.json        ← MSH + PV1: message timing, encounter context
│   ├── study_metadata.json            ← OBR data: accession #s, LOINC, indications, UIDs
│   └── hl7_feed.hl7                   ← Generated HL7 ORU^R01 message (all studies)
├── Patient_2/ ... Patient_7/          ← Same structure per patient
```

---

## 3. Design Decisions and Rationale

This section documents the key architectural decisions made during the simulation
design. Per project conventions (§11: Architecture Decision Records), these are
recorded here because the simulation module is self-contained.

### 3.1 Single-Encounter Model

**Decision**: Each patient has exactly one active clinical encounter. All prior
studies for that patient are transmitted within a single HL7 message.

**Rationale**: In a real clinical workflow, the summarization system would be
invoked when a radiologist opens a new study in the worklist. At that point, the
system needs access to all relevant prior imaging for that patient. The single-
encounter model simulates this "current visit" context. The prior studies'
original encounter data (from years prior) is not needed — only the current
encounter's PV1 appears in the message header, and each study's OBR carries its
own historical date/time.

### 3.2 Best-Effort LOINC Mapping

**Decision**: Each of the 49 unique study types is mapped to the most clinically
appropriate LOINC code from the standard LOINC Radiology subset, stored in
`loinc_study_map.json`.

**Rationale**: The OBR-4 (Universal Service Identifier) field in production HL7
feeds uses a coded value to identify the imaging procedure. LOINC is the standard
coding system for this field. Some specialized procedures (e.g., interventional
radiology drainage, vertebroplasty) do not have exact LOINC matches; in these
cases, the closest clinically appropriate code was selected. This is documented
in the `_note` field within each mapping entry. For production systems, these
codes would be reconciled with the customer's order catalogue.

### 3.3 Deterministic ID Generation

**Decision**: Accession numbers (`ACC-P#-####`), Message Control IDs
(`MSG<date>-P#-###`), and DICOM Study Instance UIDs
(`1.2.840.113619.2.55.3.<patient>.<sequence>`) are generated algorithmically
from the patient number and study sequence.

**Rationale**: Deterministic generation ensures that re-running the pipeline
produces identical output, which is critical for repeatable testing. The
accession number format is intentionally simple and sortable. The DICOM UID
uses a real OID prefix (`1.2.840.113619.2.55.3`) to simulate institutional
UIDs but is namespaced by patient to guarantee uniqueness.

### 3.4 Mock Physician Pool

**Decision**: A shared pool of 6 attending and 6 referring physicians is defined
in `physician_pool.json`. Each patient's encounter randomly draws from this pool.

**Rationale**: Physician identity is carried in the PV1-7 (Attending) and PV1-8
(Referring) fields. Real hospital feeds include physician NPI numbers and names.
For simulation, fictional physicians with deterministic IDs (ATT001-ATT006,
REF001-REF006) are sufficient. The pool approach avoids duplicating physician
data across patient files and allows the same physician to appear across multiple
patients, which is realistic.

### 3.5 Report Text in OBX Segments

**Decision**: Report text is split into semantic sections (Clinical Indication,
Technique, Comparison, Findings, Impression) and each section is placed in a
separate OBX segment. Findings use the `FT` (formatted text) OBX type with
`\.br\` line breaks; all other sections use `TX` (text).

**Rationale**: This mirrors the IHE Radiology Results Distribution (RD) profile,
which recommends structured OBX segments for radiology results. Downstream
parsers can extract specific report sections by their OBX observation identifiers
rather than having to re-parse free text. The FT type for Findings preserves
the anatomical sub-section formatting that radiologists use.

---

## 4. Report Format Variants

The source reports come from multiple clinical systems and span 20+ years of
documentation. The HL7 generator handles 4 distinct structural formats:

### Format A: Multi-line with `Impression` / `Narrative` Headings
**Used by**: Most CT, MR, XR, US, and NM reports (Patients 1-4, 7)

```
Impression

IMPRESSION:
1. Finding one.
2. Finding two.

Narrative

CT CHEST WITH CONTRAST
** HISTORY **:
65 years old, chest pain.

** TECHNIQUE **:
CT images of the chest acquired with 100 mL Omnipaque...

COMPARISON: CT 6/24/2025

** FINDINGS **:
HEART: Heart size normal.
LUNGS: There is a left posterior perihilar mass...
```

**Key characteristics**: "Impression" and "Narrative" appear as standalone
headings. The Impression section appears *first*, before the Narrative. Section
headers within the narrative use `** SECTION **:` delimiters. The study title
is the first non-empty line after the Narrative heading.

### Format B: Compact Single-Block
**Used by**: Patients 5-6 (compact report style)

```
    XRAY CHEST
** HISTORY **:  69 years old, chest pain.
** TECHNIQUE **:  1 view of the chest acquired.
COMPARISON: Radiograph 9/17/2025
** FINDINGS **:  LUNGS: No consolidation. No pleural effusion.
IMPRESSION:   No acute abnormality.
```

**Key characteristics**: All content on ~7 lines. Study title is indented on
line 1. `** HISTORY **` and `** FINDINGS **` have inline content on the same
line. IMPRESSION appears as a bare label (no `**` wrapper) at the end.

### Format C: CTA-style with `CLINICAL INDICATION:`
**Used by**: Patient 3 CTA chest reports

```
Impression

IMPRESSION:
1. No evidence of acute pulmonary embolism

Narrative

CLINICAL INDICATION:    Shortness Of Breath.

COMPARISON: None

TECHNIQUE:
Postcontrast helical CT Angiogram acquisition...

FINDINGS:
There is no acute pulmonary embolism.
```

**Key characteristics**: Uses "Impression/Narrative" headings like Format A,
but within the narrative uses `CLINICAL INDICATION:` instead of `** HISTORY **:`
and bare section headers (`COMPARISON:`, `TECHNIQUE:`, `FINDINGS:`) without
the `**` delimiters.

### Format D: Echocardiogram
**Used by**: Patient 3 echocardiogram reports

```
Transthoracic Echocardiogram

Indication:
MS, POSSIBLE CHF
Rhythm:       Sinus
BP:           177/84

Conclusions
Mild LVH with hyperdynamic LV systolic function...

Findings
Left Ventricle:
The left ventricular chamber size is normal...

Measurements
Name                    Value         Normal Range
AV cusp separation      0.41 cm       -
```

**Key characteristics**: Unique section structure with `Indication:`,
`Conclusions`, `Findings`, and `Measurements` sections. Conclusions maps to
the clinical impression. Measurements include tabular echocardiographic data.

---

## 5. HL7 Message Structure

Each patient's `.hl7` file follows this segment layout:

```
MSH|^~\&|NEWVUE_RIS|RADIOLOGY_DEPT|NEWVUE_EHR|NEWVUE_HOSPITAL|<datetime>||ORU^R01|<msgId>|P|2.5.1
PID|1||<MRN>^^^NEWVUE_HOSPITAL^MR||<LAST>^<FIRST>^^^^L||<DOB>|<SEX>|||<ADDR>||<PHONE>
PV1|1|<CLASS>|<LOCATION>||||<ATT_ID>^<LAST>^<FIRST>^<MI>|<REF_ID>^<LAST>^<FIRST>^<MI>|||||||||||<VISIT_NUM>
── Per study (repeats for each prior imaging study) ──────────────
OBR|<seq>||<ACC>|<LOINC>^<DESC>^LN|||<DATETIME>||||||<INDICATION>||||||||||||F
OBX|1|TX|<LOINC>^<DESC>^LN|1|CLINICAL INDICATION: <text>||||||F
OBX|2|TX|<LOINC>^<DESC>^LN|2|TECHNIQUE: <text>||||||F
OBX|3|TX|<LOINC>^<DESC>^LN|3|COMPARISON: <text>||||||F
OBX|4|FT|<LOINC>^<DESC>^LN|4|FINDINGS: <text with \.br\ breaks>||||||F
OBX|5|TX|<LOINC>^<DESC>^LN|5|IMPRESSION: <text>||||||F
ZDS|<DICOM_UID>^NEWVUE_PACS^Application^DICOM
──────────────────────────────────────────────────────────────────
```

### OBX Segment Notes

- **OBX-2 Value Type**: `TX` (plain text) for most sections; `FT` (formatted
  text) for Findings, which may contain `\.br\` line break escape sequences
  to preserve anatomical sub-section formatting.
- **OBX-3 Observation Identifier**: Repeats the LOINC code from the parent OBR-4.
  This links each text section to its parent study order.
- **OBX-4 Sub-ID**: Sequential integer (1-5) identifying the section within the
  study. The downstream parser should use the text prefix (`CLINICAL INDICATION:`,
  `TECHNIQUE:`, `COMPARISON:`, `FINDINGS:`, `IMPRESSION:`) to identify section
  semantics, not the sub-ID number.
- **Not all OBX sections are present** for every study. Some reports lack a
  Technique or Comparison section. The sub-ID numbering adjusts accordingly.

### HL7 Escape Sequences

Per HL7 v2.5.1 §2.7, the following escape sequences are applied within OBX-5
field values:

| Character | Escape | Purpose |
|-----------|--------|---------|
| `\|` | `\F\` | Field separator (pipe) |
| `^` | `\S\` | Component separator |
| `~` | `\R\` | Repetition separator |
| `\` | `\E\` | Escape character |
| `&` | `\T\` | Sub-component separator |
| newline | `\.br\` | Line break (FT type only) |

---

## 6. Data Model Reference

### shared_metadata.json
| Field | HL7 Segment | Value | Purpose |
|-------|-------------|-------|---------|
| `msh.sendingApplication` | MSH-3 | `NEWVUE_RIS` | Source RIS system |
| `msh.sendingFacility` | MSH-4 | `RADIOLOGY_DEPT` | Radiology department |
| `msh.receivingApplication` | MSH-5 | `NEWVUE_EHR` | Target EHR system |
| `msh.receivingFacility` | MSH-6 | `NEWVUE_HOSPITAL` | Hospital |
| `msh.messageType` | MSH-9 | `ORU^R01` | Unsolicited observation result |
| `msh.processingId` | MSH-11 | `P` | Production processing mode |
| `msh.versionId` | MSH-12 | `2.5.1` | HL7 version |
| `pid.assigningAuthority` | PID-3.4 | `NEWVUE_HOSPITAL` | MRN assigning authority |
| `pid.identifierTypeCode` | PID-3.5 | `MR` | Medical Record Number type |
| `zds.pacsIdentifier` | ZDS-1.2 | `NEWVUE_PACS` | PACS system identifier |
| `zds.studyInstanceUidPrefix` | ZDS-1.1 | `1.2.840.113619.2.55.3` | DICOM OID prefix |

### patient_demographics.json (PID Segment)
| Field | HL7 Field | Format | Example |
|-------|-----------|--------|---------|
| `mrn` | PID-3.1 | `MRN#####` | `MRN00001` |
| `name.last` | PID-5.1 | UPPERCASE | `EVERYLY` |
| `name.first` | PID-5.2 | UPPERCASE | `PAULA` |
| `name.middle` | PID-5.3 | Initial | (empty or initial) |
| `dateOfBirth` | PID-7 | `YYYYMMDD` | `19590210` |
| `sex` | PID-8 | `M` or `F` | `F` |
| `address.street` | PID-11.1 | US format | `742 EVERGREEN TER` |
| `address.city` | PID-11.3 | UPPERCASE | `SPRINGFIELD` |
| `address.state` | PID-11.4 | 2-letter | `IL` |
| `address.zip` | PID-11.5 | 5-digit | `62704` |
| `address.country` | PID-11.6 | ISO 3166 | `USA` |
| `phone` | PID-13 | `555-####` | `555-0101` |

### encounter_metadata.json (MSH + PV1 Segments)
| Field | HL7 Field | Format | Example |
|-------|-----------|--------|---------|
| `msh.messageDateTime` | MSH-7 | `YYYYMMDDHHMMSS` | `20250920120000` |
| `msh.messageControlId` | MSH-10 | Unique ID | `MSG20250920-P1-001` |
| `pv1.patientClass` | PV1-2 | `I`, `O`, or `E` | `I` (Inpatient) |
| `pv1.assignedPatientLocation` | PV1-3 | `UNIT^ROOM^BED` | `MED^RM412^BED-A` |
| `pv1.attendingPhysician` | PV1-7 | `ID^LAST^FIRST^MI` | `ATT006^OKONKWO^ADAEZE^F` |
| `pv1.referringPhysician` | PV1-8 | `ID^LAST^FIRST^MI` | `REF002^KLEIN^MARCUS^J` |
| `pv1.visitNumber` | PV1-19 | Encounter ID | `ENC20250918-0001` |

### study_metadata.json (OBR Segment — per study)
| Field | HL7 Field | Format | Example |
|-------|-----------|--------|---------|
| `obrSequence` | OBR-1 | Integer | `1` |
| `accessionNumber` | OBR-3 | `ACC-P#-####` | `ACC-P1-0001` |
| `universalServiceId.loincCode` | OBR-4.1 | LOINC code | `24627-2` |
| `universalServiceId.description` | OBR-4.2 | Study name | `CT Chest` |
| `universalServiceId.codingSystem` | OBR-4.3 | Always `LN` | `LN` |
| `studyDateTime` | OBR-7 | `YYYYMMDDHHMMSS` | `20250624102200` |
| `clinicalIndication` | OBR-13 | Free text | `left perihilar mass` |
| `resultStatus` | OBR-25 | Always `F` | `F` (Final) |
| `studyInstanceUid` | ZDS-1.1 | DICOM UID | `1.2.840.113619.2.55.3.1.1` |
| `sourceFile` | N/A | Report filename | `BIN-RPT-2025-0624-CTCHEST-1022.txt` |

---

## 7. Patient Summary

| # | Name | Sex | DOB | Age* | MRN | Class | Studies | Segments |
|---|------|-----|-----|------|-----|-------|---------|----------|
| 1 | Paula Everyly | F | 1959-02-10 | 66 | MRN00001 | Inpatient | 26 | 184 |
| 2 | Alberto Seels | M | 1946-04-22 | 79 | MRN00002 | Outpatient | 49 | 293 |
| 3 | Elisa Paniagua | F | 1942-11-15 | 79 | MRN00003 | Inpatient | 23 | 152 |
| 4 | Dolores French | F | 1939-09-27 | 86 | MRN00004 | Emergency | 14 | 96 |
| 5 | Monica Blackwell | F | 1956-09-28 | 69 | MRN00005 | Inpatient | 15 | 102 |
| 6 | Franklin Tanner | M | 1978-06-12 | 47 | MRN00006 | Emergency | 2 | 17 |
| 7 | Celeste Johnson | F | 1983-03-27 | 42 | MRN00007 | Outpatient | 1 | 8 |

*Age calculated at the time of the HL7 message date for each patient.

### Clinical Scenario Coverage

| Patient | Clinical Context | Modalities |
|---------|-----------------|------------|
| 1 | Lung cancer staging, metastatic workup, stroke, ICU | CT, MR, XR, PET-CT, IR |
| 2 | Chronic orthopedic, stroke, prostate cancer, trauma | CT, MR, XR, US, CTA |
| 3 | Breast cancer screening, cardiac disease, brain met | CT, MR, XR, US, MG, Echo |
| 4 | Interventional radiology, vascular, breast imaging | CT, IR, US, MG, Echo |
| 5 | Diverticulitis, splenic abscess, IR drainage | CT, XR, US, IR, Echo |
| 6 | ED workup — chest pain, shortness of breath | XR |
| 7 | Routine screening mammogram | MG |

---

## 8. Generation Pipeline

### Prerequisites

- Node.js (v18+)
- No external npm dependencies — all scripts use built-in `fs` and `path` modules

### Pipeline Scripts

All generator scripts live in the project root (`../` relative to this directory).
They are run sequentially; each phase's output is consumed by the next.

```
Phase 1: Manual         → shared_metadata.json, physician_pool.json,
                           patient_demographics.json, encounter_metadata.json
                           (hand-authored per patient)

Phase 2: Automated      → node generate_study_metadata.js
  Reads:  Reports/Patient_#/*.txt, loinc_study_map.json
  Writes: HL7_Simulation/Patient_#/study_metadata.json (per patient)

Phase 3: Automated      → node generate_hl7_messages.js
  Reads:  HL7_Simulation/**/*.json, Reports/Patient_#/*.txt
  Writes: HL7_Simulation/Patient_#/hl7_feed.hl7 (per patient)
```

### How to Regenerate

If source reports or metadata change, regenerate from Phase 2 onwards:

```bash
# From the project root directory:
node generate_study_metadata.js    # Regenerates study_metadata.json for all patients
node generate_hl7_messages.js      # Regenerates hl7_feed.hl7 for all patients
node validate_hl7_feeds.js         # Validates structural integrity of all feeds
```

Phase 1 metadata (demographics, encounters, shared config) is hand-authored and
does not have a generator script. If patient data changes, edit the JSON files
directly.

### Validation Scripts

| Script | Purpose |
|--------|---------|
| `validate_hl7_metadata.js` | Phase 1: Validates JSON integrity, age calculations, directory structure |
| `validate_hl7_feeds.js` | Phase 3: Validates HL7 segment ordering, field counts, OBR/OBX/ZDS grouping, sequence numbers |
| `catalog_study_types.js` | Utility: Enumerates all unique study types across the report library |

---

## 9. Filename Convention for Source Reports

Source report files follow a standardized naming convention:

```
BIN-RPT-YYYY-MMDD-STUDYTYPE-HHMM.txt
```

| Component | Description | Example |
|-----------|-------------|---------|
| `BIN-RPT` | Fixed prefix (Binary Report) | `BIN-RPT` |
| `YYYY` | Study year | `2025` |
| `MMDD` | Study month and day | `0624` |
| `STUDYTYPE` | Normalized study type (no spaces) | `CTCHEST` |
| `HHMM` | Study time (24-hour) | `1022` |

The `STUDYTYPE` component is used to look up the LOINC code from
`loinc_study_map.json`. The date/time components are used to construct the
OBR-7 (Observation Date/Time) field in `YYYYMMDDHHMMSS` format, with seconds
set to `00`.

---

## 10. Usage Notes

- All date/time values use HL7 v2.x format: `YYYYMMDDHHMMSS`
- All patient names are stored in UPPERCASE per HL7 XPN data type conventions
- Phone numbers use the `555-####` mock format (de-identified data)
- Physician IDs reference the shared `physician_pool.json`
- The `_comment` field in each JSON file is for human documentation only and
  should be ignored by any parsing code
- The `.hl7` files use CR+LF (`\r\n`) as segment terminators for cross-platform
  compatibility (HL7 spec requires only CR, but CR+LF is widely accepted)

---

## 11. Build History

| Phase | Status | Output | Validation |
|-------|--------|--------|------------|
| **Phase 1**: Patient metadata | ✅ Complete | 16 JSON files | All valid, ages verified |
| **Phase 2**: LOINC + study metadata | ✅ Complete | 49 LOINC mappings, 130 studies | 130/130 LOINC, 129/130 indications |
| **Phase 3**: HL7 message generation | ✅ Complete | 852 segments, 7 feeds | 0 errors, 0 warnings |
