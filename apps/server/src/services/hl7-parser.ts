/**
 * HL7 ORU^R01 message parser.
 *
 * Parses a raw HL7 message string into a structured PatientRecord.
 * This is a purpose-built parser for HL7 v2.5.1 ORU^R01 messages
 * following the segment layout defined in the HL7_Simulation pipeline:
 *
 *   MSH → PID → PV1 → [OBR → OBX* → ZDS]*
 *
 * Design note: We parse the pipe-delimited format directly rather than
 * using the node-hl7-client library for message parsing. The HL7 v2.x
 * wire format is simple enough that a transparent, purpose-built parser
 * is easier to debug and maintain than wrapping a general-purpose library.
 * The node-hl7-client dependency is retained for its MLLP transport
 * capabilities, which will be needed for production HL7 feed ingestion.
 */

import {
  PatientRecord,
  MessageHeader,
  Demographics,
  Encounter,
  Physician,
  Study,
  ReportSections,
} from '../models/types';

import {
  getField,
  getComponents,
  getComponent,
  getSegmentType,
  unescapeHL7,
  identifyReportSection,
} from '../utils/hl7-helpers';

/**
 * Parse a raw HL7 ORU^R01 message string into a structured PatientRecord.
 *
 * @param patientId - The patient directory identifier (e.g., "Patient_1")
 * @param rawMessage - The complete HL7 message text (segments separated by \r\n or \r)
 * @returns Parsed PatientRecord with all studies and report sections
 * @throws Error if required segments (MSH, PID, PV1) are missing
 */
export function parseHL7Message(patientId: string, rawMessage: string): PatientRecord {
  // Split into segments — handle both \r\n and \r as terminators
  const segments = rawMessage
    .split(/\r\n|\r|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (segments.length === 0) {
    throw new Error(`Empty HL7 message for ${patientId}`);
  }

  // ── Parse header segments (MSH, PID, PV1) ──
  const mshSegment = segments.find(s => getSegmentType(s) === 'MSH');
  const pidSegment = segments.find(s => getSegmentType(s) === 'PID');
  const pv1Segment = segments.find(s => getSegmentType(s) === 'PV1');

  if (!mshSegment) throw new Error(`Missing MSH segment in ${patientId}`);
  if (!pidSegment) throw new Error(`Missing PID segment in ${patientId}`);
  if (!pv1Segment) throw new Error(`Missing PV1 segment in ${patientId}`);

  const messageHeader = parseMSH(mshSegment);
  const demographics = parsePID(pidSegment);
  const encounter = parsePV1(pv1Segment);

  // ── Group OBR/OBX/ZDS into study groups ──
  const studies = parseStudyGroups(segments);

  return {
    patientId,
    demographics,
    encounter,
    messageHeader,
    studies,
    totalStudies: studies.length,
    // Initialized empty — feed-loader populates from encounter_metadata.json
    currentStudies: [],
    // Initialized empty — feed-loader populates after labeling + scoring
    relevanceScores: {},
  };
}

/**
 * Parse MSH segment into MessageHeader.
 *
 * MSH|^~\&|SendApp|SendFac|RecvApp|RecvFac|DateTime||MsgType|CtrlId|ProcId|Version
 *     2     3        4       5       6       7     8   9      10     11    12
 */
function parseMSH(segment: string): MessageHeader {
  return {
    sendingApplication: getField(segment, 3),
    sendingFacility: getField(segment, 4),
    receivingApplication: getField(segment, 5),
    receivingFacility: getField(segment, 6),
    messageDateTime: getField(segment, 7),
    messageType: getField(segment, 9),
    messageControlId: getField(segment, 10),
    hl7Version: getField(segment, 12),
  };
}

/**
 * Parse PID segment into Demographics.
 *
 * PID|1||MRN^^^Auth^MR||LAST^FIRST^MI^^^L||DOB|SEX|||ADDR^^CITY^ST^ZIP^COUNTRY||PHONE
 *    1  2  3            4  5                6  7   8  9 10  11                  12  13
 */
function parsePID(segment: string): Demographics {
  const mrnField = getField(segment, 3);
  const nameField = getField(segment, 5);
  const addressField = getField(segment, 11);

  const mrnComponents = getComponents(mrnField);
  const nameComponents = getComponents(nameField);
  const addressComponents = getComponents(addressField);

  return {
    mrn: mrnComponents[0] || '',
    name: {
      last: nameComponents[0] || '',
      first: nameComponents[1] || '',
      middle: nameComponents[2] || '',
    },
    dateOfBirth: getField(segment, 7),
    sex: getField(segment, 8),
    address: {
      street: addressComponents[0] || '',
      city: addressComponents[2] || '',
      state: addressComponents[3] || '',
      zip: addressComponents[4] || '',
      country: addressComponents[5] || '',
    },
    phone: getField(segment, 13),
  };
}

/**
 * Parse PV1 segment into Encounter.
 *
 * PV1|1|CLASS|LOCATION||||ATT_ID^LAST^FIRST^MI|REF_ID^LAST^FIRST^MI|||...|||||||VISIT
 *    1  2     3       4 5 6  7                   8                  9...        19
 */
function parsePV1(segment: string): Encounter {
  return {
    patientClass: getField(segment, 2),
    location: getField(segment, 3),
    attendingPhysician: parsePhysician(getField(segment, 7)),
    referringPhysician: parsePhysician(getField(segment, 8)),
    visitNumber: getField(segment, 19),
  };
}

/**
 * Parse a physician field (PV1-7 or PV1-8) into a Physician object.
 * Format: ID^LAST^FIRST^MI
 */
function parsePhysician(fieldValue: string): Physician {
  const components = getComponents(fieldValue);
  return {
    id: components[0] || '',
    last: components[1] || '',
    first: components[2] || '',
    middleInitial: components[3] || '',
  };
}

/**
 * Group and parse OBR/OBX/ZDS segments into Study objects.
 *
 * Iterates through all segments after MSH/PID/PV1, grouping OBX and ZDS
 * segments under their parent OBR. Each OBR starts a new study group.
 */
function parseStudyGroups(segments: string[]): Study[] {
  const studies: Study[] = [];

  // State for the current study group being assembled
  let currentOBR: string | null = null;
  let currentOBXSegments: string[] = [];
  let currentZDS: string | null = null;

  for (const segment of segments) {
    const segType = getSegmentType(segment);

    if (segType === 'OBR') {
      // Flush the previous study group if one exists
      if (currentOBR) {
        studies.push(assembleStudy(currentOBR, currentOBXSegments, currentZDS));
      }
      // Start a new group
      currentOBR = segment;
      currentOBXSegments = [];
      currentZDS = null;
    } else if (segType === 'OBX' && currentOBR) {
      currentOBXSegments.push(segment);
    } else if (segType === 'ZDS' && currentOBR) {
      currentZDS = segment;
    }
    // MSH, PID, PV1 are already handled separately
  }

  // Flush the last study group
  if (currentOBR) {
    studies.push(assembleStudy(currentOBR, currentOBXSegments, currentZDS));
  }

  return studies;
}

/**
 * Assemble a Study object from an OBR segment, its child OBX segments,
 * and an optional ZDS segment.
 *
 * OBR|seq||ACC|LOINC^DESC^LN|||DateTime||||||Indication||||||||||||Status
 *    1  2  3   4               5 6  7    8...12 13       14...24     25
 */
function assembleStudy(
  obrSegment: string,
  obxSegments: string[],
  zdsSegment: string | null
): Study {
  const universalServiceField = getField(obrSegment, 4);

  return {
    sequence: parseInt(getField(obrSegment, 1), 10) || 0,
    accessionNumber: getField(obrSegment, 3),
    studyDescription: getComponent(universalServiceField, 2),
    loincCode: getComponent(universalServiceField, 1),
    studyDateTime: getField(obrSegment, 7),
    clinicalIndication: getField(obrSegment, 13),
    resultStatus: getField(obrSegment, 25),
    studyInstanceUid: zdsSegment ? getComponent(getField(zdsSegment, 1), 1) : '',
    reportSections: parseReportSections(obxSegments),
  };
}

/**
 * Parse OBX segments into a ReportSections object.
 *
 * Each OBX contains a text value (field 5) prefixed with a section identifier.
 * The value type (field 2) is either TX (plain text) or FT (formatted text
 * with \.br\ line breaks).
 *
 * OBX|seq|TYPE|LOINC^DESC^LN|subId|VALUE||||||F
 *    1    2    3              4     5    6...11
 */
function parseReportSections(obxSegments: string[]): ReportSections {
  const sections: ReportSections = {
    clinicalIndication: null,
    technique: null,
    comparison: null,
    findings: null,
    impression: null,
    rawText: [],
  };

  for (const obx of obxSegments) {
    const rawValue = getField(obx, 5);
    if (!rawValue) continue;

    // Unescape HL7 sequences (\.br\ → \n, \F\ → |, etc.)
    const unescapedValue = unescapeHL7(rawValue);

    // Add to rawText array (always, for fallback)
    sections.rawText.push(unescapedValue);

    // Identify which report section this OBX belongs to
    const { section, text } = identifyReportSection(unescapedValue);

    switch (section) {
      case 'clinicalIndication':
        sections.clinicalIndication = text;
        break;
      case 'technique':
        sections.technique = text;
        break;
      case 'comparison':
        sections.comparison = text;
        break;
      case 'findings':
        sections.findings = text;
        break;
      case 'impression':
        sections.impression = text;
        break;
      // 'unknown' section — already captured in rawText
    }
  }

  return sections;
}
