/**
 * compact-id.ts — Single-token alias generator for LLM prompts.
 *
 * Converts a 0-based numeric index into a compact uppercase letter code:
 *   0→A, 1→B, ... 25→Z, 26→AA, 27→AB, ... 51→AZ, 52→BA, etc.
 *
 * Single uppercase letters are always 1 BPE token, saving ~7 tokens
 * per ID compared to canonical identifiers (e.g., "ACC-P1-0020-F3"
 * or "COND-P12345-0010").
 *
 * Used by both finding-grouping and problem-grouping LLM passes.
 */

/**
 * Generate a compact uppercase letter ID from a 0-based index.
 *
 * @param index - Zero-based index to convert (0 = A, 25 = Z, 26 = AA)
 * @returns Compact letter code (1 or 2 characters)
 */
export function compactId(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index); // A–Z
  // For >26 entries: AA, AB, ... AZ, BA, BB, ...
  const first = String.fromCharCode(65 + Math.floor(index / 26) - 1);
  const second = String.fromCharCode(65 + (index % 26));
  return first + second;
}
