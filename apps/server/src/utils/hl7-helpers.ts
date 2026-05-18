/**
 * HL7 v2.x utility functions for field extraction and escape handling.
 *
 * HL7 v2.x messages use a pipe-delimited format with the following separators
 * (defined in MSH-2, always "^~\&" in our feeds):
 *   |  — Field separator
 *   ^  — Component separator
 *   ~  — Repetition separator
 *   \  — Escape character
 *   &  — Sub-component separator
 *
 * Within text fields (OBX-5), special characters are escaped per §2.7 of the
 * HL7 v2.5.1 specification.
 */

/**
 * Extract a specific field from a pipe-delimited HL7 segment.
 *
 * Field indices are 0-based from the segment type identifier:
 *   Field 0 = segment type (e.g., "MSH", "PID")
 *   Field 1 = first data field
 *
 * NOTE: For MSH, field indexing is offset by 1 because MSH-1 IS the field
 * separator itself. This function handles that automatically when the
 * segment starts with "MSH".
 */
export function getField(segment: string, fieldIndex: number): string {
  const fields = segment.split('|');

  // MSH is special: MSH-1 is the field separator "|" (which we split on),
  // so MSH-2 is actually fields[1], MSH-3 is fields[2], etc.
  // For all other segments, field 1 is fields[1].
  if (segment.startsWith('MSH')) {
    // MSH field numbering: MSH-1 = "|", MSH-2 = fields[1], MSH-3 = fields[2]
    // So fieldIndex 3 → array index 2
    const arrayIndex = fieldIndex - 1;
    return arrayIndex >= 0 && arrayIndex < fields.length ? fields[arrayIndex] : '';
  }

  // For non-MSH segments: field 1 = fields[1], field 2 = fields[2], etc.
  return fieldIndex >= 0 && fieldIndex < fields.length ? fields[fieldIndex] : '';
}

/**
 * Split a field value into its components using the ^ separator.
 *
 * Example: "24627-2^CT Chest^LN" → ["24627-2", "CT Chest", "LN"]
 */
export function getComponents(fieldValue: string): string[] {
  return fieldValue.split('^');
}

/**
 * Extract a specific component from a field.
 * Component indices are 1-based per HL7 convention.
 *
 * Example: getComponent("24627-2^CT Chest^LN", 2) → "CT Chest"
 */
export function getComponent(fieldValue: string, componentIndex: number): string {
  const components = getComponents(fieldValue);
  const arrayIndex = componentIndex - 1;
  return arrayIndex >= 0 && arrayIndex < components.length
    ? components[arrayIndex]
    : '';
}

/**
 * Reverse HL7 escape sequences in text fields back to their original characters.
 *
 * HL7 v2.5.1 §2.7 defines these escape sequences:
 *   \F\  → |  (field separator)
 *   \S\  → ^  (component separator)
 *   \R\  → ~  (repetition separator)
 *   \E\  → \  (escape character)
 *   \T\  → &  (sub-component separator)
 *   \.br\ → newline (line break in FT formatted text)
 *
 * Processing order matters: \E\ (escape char) must be processed last
 * to avoid double-unescaping.
 */
export function unescapeHL7(text: string): string {
  return text
    .replace(/\\\.br\\/g, '\n')    // Line breaks first (FT formatted text)
    .replace(/\\F\\/g, '|')        // Field separator
    .replace(/\\S\\/g, '^')        // Component separator
    .replace(/\\R\\/g, '~')        // Repetition separator
    .replace(/\\T\\/g, '&')        // Sub-component separator
    .replace(/\\E\\/g, '\\');      // Escape character (last, to avoid conflicts)
}

/**
 * Identify the report section type from an OBX observation value.
 *
 * OBX-5 values in our feeds are prefixed with section identifiers:
 *   "CLINICAL INDICATION: ..."
 *   "TECHNIQUE: ..."
 *   "COMPARISON: ..."
 *   "FINDINGS: ..."
 *   "IMPRESSION: ..."
 *
 * Returns the section name and the text content after the prefix.
 */
export function identifyReportSection(
  obxValue: string
): { section: string; text: string } {
  // Try each known section prefix
  const prefixes: Array<{ prefix: RegExp; section: string }> = [
    { prefix: /^CLINICAL INDICATION:\s*/i, section: 'clinicalIndication' },
    { prefix: /^TECHNIQUE:\s*/i, section: 'technique' },
    { prefix: /^COMPARISON:\s*/i, section: 'comparison' },
    { prefix: /^FINDINGS:\s*/i, section: 'findings' },
    { prefix: /^IMPRESSION:\s*/i, section: 'impression' },
  ];

  for (const { prefix, section } of prefixes) {
    const match = obxValue.match(prefix);
    if (match) {
      return {
        section,
        text: obxValue.substring(match[0].length).trim(),
      };
    }
  }

  // Unknown section — return as-is
  return { section: 'unknown', text: obxValue };
}

/**
 * Identify the segment type from a raw HL7 segment string.
 * Returns the 3-character segment identifier (e.g., "MSH", "PID", "OBR").
 */
export function getSegmentType(segment: string): string {
  const pipeIndex = segment.indexOf('|');
  return pipeIndex >= 0 ? segment.substring(0, pipeIndex) : segment.substring(0, 3);
}
