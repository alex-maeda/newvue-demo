# HL7 Parsing Service

> **Module**: `newvue-hl7-parser`  
> **Stack**: Node.js · TypeScript · Express  
> **Port**: 3001  
> **Status**: Development — simulated feed ingestion

---

## 1. Purpose

This service parses HL7 ORU^R01 radiology result messages and exposes the
extracted clinical data as structured JSON via a REST API. It serves as the
backend data layer for the NewVue Radiology Report Summarization UI.

In development, the service reads simulated `.hl7` feed files from the
`HL7_Simulation/` directory. In production, this data source would be
replaced by an MLLP listener or message queue consumer — the parsing and
API layers are architecturally decoupled from the data ingestion mechanism.

---

## 2. Quick Start

```bash
# From the server/ directory:
npm install          # Install dependencies (first time only)
npm run dev          # Start dev server with ts-node (auto-compiles)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (production)
```

The server starts on `http://localhost:3001`. Verify with:
```bash
curl http://localhost:3001/api/v1/health
```

---

## 3. REST API

Base URL: `http://localhost:3001/api/v1`

### GET /health

Returns service status and configured data path.

```json
{
  "status": "ok",
  "service": "newvue-hl7-parser",
  "timestamp": "2026-04-24T05:26:25.431Z",
  "hl7SimulationPath": "...\\HL7_Simulation"
}
```

### GET /patients

Lists all available patients without parsing any HL7 feeds. Reads lightweight
JSON metadata files from each `Patient_*` directory for fast response.

```json
[
  {
    "patientId": "Patient_1",
    "mrn": "MRN00001",
    "name": "EVERYLY, PAULA",
    "sex": "F",
    "dateOfBirth": "19590210",
    "patientClass": "I",
    "totalStudies": 26
  }
]
```

### GET /patients/:id

Parses the specified patient's HL7 feed on demand and returns the full
patient record including demographics, encounter, message header, and
all imaging studies with parsed report sections.

**Parameters**: `:id` — Patient directory name (e.g., `Patient_1`)

**Response**: `PatientRecord` (see Data Model below)

### GET /patients/:id/studies

Returns only the studies array for a patient.

**Response**: `Study[]`

### GET /patients/:id/studies/:seq

Returns a single study by its OBR sequence number (1-based).

**Parameters**: `:seq` — Study sequence number (e.g., `1`)

**Response**: `Study`

### Error Responses

All errors follow [RFC 7807 Problem Details](https://tools.ietf.org/html/rfc7807):

```json
{
  "type": "https://newvue.com/errors/patient-not-found",
  "title": "Patient Not Found",
  "status": 404,
  "detail": "No HL7 feed found for patient ID: Patient_99"
}
```

| Status | Type | When |
|--------|------|------|
| 404 | `patient-not-found` | Patient ID doesn't match any feed |
| 404 | `study-not-found` | Study sequence doesn't exist for patient |
| 400 | `invalid-parameter` | Non-numeric study sequence |
| 500 | `parse-error` | HL7 feed parsing failure |
| 500 | `internal` | Unexpected server error |

---

## 4. Data Model

### PatientRecord

Top-level object returned by `GET /patients/:id`:

```
PatientRecord
├── patientId: string          ("Patient_1")
├── totalStudies: number       (26)
├── demographics               ← from PID segment
│   ├── mrn: string            ("MRN00001")
│   ├── name: { last, first, middle }
│   ├── dateOfBirth: string    ("19590210")
│   ├── sex: string            ("F")
│   ├── address: { street, city, state, zip, country }
│   └── phone: string          ("555-0101")
├── encounter                  ← from PV1 segment
│   ├── patientClass: string   ("I" | "O" | "E")
│   ├── location: string       ("MED^RM412^BED-A")
│   ├── attendingPhysician: { id, last, first, middleInitial }
│   ├── referringPhysician: { id, last, first, middleInitial }
│   └── visitNumber: string    ("ENC20250918-0001")
├── messageHeader              ← from MSH segment
│   ├── sendingApplication, sendingFacility
│   ├── receivingApplication, receivingFacility
│   ├── messageDateTime, messageType, messageControlId
│   └── hl7Version: string     ("2.5.1")
└── studies: Study[]           ← from OBR/OBX/ZDS groups
```

### Study

```
Study
├── sequence: number           (1-based OBR sequence)
├── accessionNumber: string    ("ACC-P1-0001")
├── studyDescription: string   ("CT Chest")
├── loincCode: string          ("24627-2")
├── studyDateTime: string      ("20250624102200")
├── clinicalIndication: string ("left perihilar mass")
├── resultStatus: string       ("F" = Final)
├── studyInstanceUid: string   (DICOM UID)
└── reportSections
    ├── clinicalIndication: string | null
    ├── technique: string | null
    ├── comparison: string | null
    ├── findings: string | null    (line breaks preserved)
    ├── impression: string | null
    └── rawText: string[]          (all OBX values for fallback)
```

---

## 5. Architecture

### Module Structure

```
server/src/
├── index.ts                   ← Express app entry point + middleware
├── config.ts                  ← Port, paths, CORS origin
├── routes/
│   └── patients.ts            ← REST route handlers (4 endpoints)
├── services/
│   ├── hl7-parser.ts          ← Core HL7 message parsing logic
│   └── feed-loader.ts         ← File-based data source (swappable)
├── models/
│   └── types.ts               ← TypeScript interfaces for all data
└── utils/
    └── hl7-helpers.ts         ← Field extraction, escape handling
```

### Data Flow

```
                  ┌──────────────┐
                  │  .hl7 files  │  (HL7_Simulation/Patient_#/)
                  └──────┬───────┘
                         │ fs.readFileSync
                         ▼
              ┌─────────────────────┐
              │    feed-loader.ts   │  File-based data source
              │  (swappable layer)  │  Production: MLLP / SQS
              └──────────┬──────────┘
                         │ raw HL7 string
                         ▼
              ┌─────────────────────┐
              │   hl7-parser.ts     │  Segment parsing
              │  + hl7-helpers.ts   │  Field extraction, unescaping
              └──────────┬──────────┘
                         │ PatientRecord
                         ▼
              ┌─────────────────────┐
              │   routes/patients   │  REST API handlers
              │   (Express Router)  │  JSON serialization
              └──────────┬──────────┘
                         │ HTTP JSON
                         ▼
              ┌─────────────────────┐
              │    React Frontend   │  (future)
              └─────────────────────┘
```

### On-Demand Loading

The service does **not** preload all patient data at startup. When a
request arrives for a specific patient, the service:

1. Reads that patient's `.hl7` file from disk
2. Parses it into a `PatientRecord`
3. Returns the JSON response
4. Does not cache the result (stateless per convention §1)

This matches the production model where a radiologist reviews one
patient at a time. The patient list endpoint (`GET /patients`) is the
exception — it reads lightweight JSON metadata files, not HL7 feeds.

---

## 6. HL7 Parsing Approach

### Current Implementation: Direct Parsing

The parser reads the pipe-delimited HL7 v2.5.1 message format directly
using utility functions in `hl7-helpers.ts`:

- **`getField(segment, index)`** — Extracts a specific field from a
  pipe-delimited segment. Handles the MSH offset (MSH-1 is the field
  separator itself, so MSH-3 maps to array index 2).
- **`getComponents(field)`** — Splits a field value on the `^` component
  separator (e.g., `"24627-2^CT Chest^LN"` → `["24627-2", "CT Chest", "LN"]`).
- **`unescapeHL7(text)`** — Reverses HL7 escape sequences in OBX text fields.
- **`identifyReportSection(value)`** — Matches OBX-5 text prefixes to
  semantic section names (Clinical Indication, Technique, Comparison,
  Findings, Impression).

The parser groups segments by iterating through the message and associating
OBX and ZDS segments with their parent OBR. This produces a clean
OBR → OBX[] → ZDS grouping that maps directly to the `Study` data model.

### Why Not node-hl7-client for Parsing?

The `node-hl7-client` library is included as a dependency but is **not
used for message parsing** in this implementation. The reasons:

1. **Transparency**: HL7 v2.x is a pipe-delimited text format. A
   purpose-built parser with ~120 lines of utility code is easier to
   debug, test, and reason about than wrapping a general-purpose library.
2. **Our feeds have a known format**: We control the HL7 generation
   pipeline, so we know the exact segment layout. A general-purpose
   parser that handles every HL7 variant adds complexity without benefit.
3. **Debuggability**: When a parsing issue arises, developers can step
   through `getField()` and `getComponents()` directly rather than
   tracing through a library's abstraction layers.

The `node-hl7-client` dependency is retained for its **MLLP transport
capabilities**, which will be needed when the system integrates with
production HL7 feeds from customer RIS systems.

### Production Path: HAPI Considerations

Per the project conventions (§8), the production path for HL7 parsing is:

> *"HL7 ingestion should be implemented as a dedicated parsing
> microservice (Java/HAPI) that exposes a REST or gRPC API to the
> Node.js backend, or alternatively use a validated Node.js HL7 parsing
> library for initial development with a path to HAPI for production
> hardening."*

The current implementation follows the "Node.js for initial development"
path. The architecture is designed so that migrating to HAPI in
production requires changing **only the `feed-loader.ts` module**:

| Concern | Current (Development) | Production (HAPI) |
|---------|----------------------|-------------------|
| **Data source** | `.hl7` files on disk | MLLP stream or SQS queue |
| **Parser** | Direct pipe-delimited parsing | HAPI Java library |
| **Transport** | `fs.readFileSync()` | MLLP listener or gRPC client |
| **API contract** | REST JSON (unchanged) | REST JSON (unchanged) |
| **Data model** | `PatientRecord` (unchanged) | `PatientRecord` (unchanged) |

The key insight is that the REST API contract and TypeScript data model
remain identical regardless of which parser backs them. The frontend
never knows or cares whether the data was parsed by our Node.js code
or by HAPI running in a JVM sidecar.

#### When to Consider HAPI

The current Node.js parser is sufficient for:
- Development and demonstration with simulated feeds
- Integration testing with known HL7 message formats
- Initial production deployment with a single customer whose feed
  format has been validated

HAPI becomes valuable when:
- The system must handle HL7 feeds from multiple customers with
  varying message structures and conformance profiles
- Strict HL7 conformance validation is required (HAPI provides
  profile-based validation that catches subtle spec violations)
- The feed volume requires the JVM's performance characteristics
- Regulatory review requires use of an industry-standard parser

---

## 7. HL7 Escape Sequence Handling

The parser reverses the following HL7 v2.5.1 §2.7 escape sequences:

| Escape | Character | Used In |
|--------|-----------|---------|
| `\.br\` | Newline (`\n`) | FT-type OBX (Findings sections) |
| `\F\` | `\|` | Pipe characters in free text |
| `\S\` | `^` | Caret characters in free text |
| `\R\` | `~` | Tilde characters in free text |
| `\T\` | `&` | Ampersand characters in free text |
| `\E\` | `\` | Backslash characters in free text |

Processing order is important: `\.br\` is processed first (it contains
a backslash that would be affected by `\E\` if processed out of order),
and `\E\` is processed last to avoid double-unescaping.

---

## 8. Testing

### Test Scripts

```bash
# Parser unit test (no server required)
npx ts-node src/test-parser.ts

# API endpoint tests (requires server running on :3001)
npx ts-node src/test-api.ts

# Deep validation against source metadata (no server required)
npx ts-node src/test-validation.ts
```

### Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `test-parser.ts` | Patient listing, Patient 6 deep parse, all study counts | 7/7 PASS |
| `test-api.ts` | Health, patient list, 7 patient records, studies, errors | 15/15 PASS |
| `test-validation.ts` | Demographics, encounters, MSH, study metadata, sections | 625/625 PASS |

### Validation Details

The `test-validation.ts` script cross-references every parsed field
against the source JSON metadata files (`patient_demographics.json`,
`encounter_metadata.json`, `study_metadata.json`). For each of 130
studies, it verifies:

- Accession number matches `study_metadata.json`
- LOINC code matches `study_metadata.json`
- Study date/time matches `study_metadata.json`
- DICOM Study Instance UID matches `study_metadata.json`
- At least one clinical indication, findings, and impression section exists
- No residual HL7 escape sequences in parsed text

---

## 9. Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | HTTP server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin (Vite dev server) |

The HL7 simulation data path is resolved relative to the server
directory: `../../HL7_Simulation`. This assumes the standard project
layout where `server/` is a sibling of `HL7_Simulation/`.

---

## 10. Dependencies

| Package | Version | Purpose | Runtime |
|---------|---------|---------|---------|
| `express` | pinned | HTTP server and routing | Yes |
| `cors` | pinned | Cross-origin request handling | Yes |
| `node-hl7-client` | pinned | MLLP transport (future use) | Yes |
| `typescript` | ^5.x | TypeScript compiler | Dev |
| `ts-node` | pinned | TypeScript execution for dev | Dev |
| `@types/express` | pinned | Express type definitions | Dev |
| `@types/cors` | pinned | CORS type definitions | Dev |
| `@types/node` | pinned | Node.js type definitions | Dev |

Total: 99 packages, 0 known vulnerabilities (as of initial build).
