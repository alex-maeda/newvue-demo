/**
 * sentence-splitter.ts — Clinical-aware sentence splitter for note text.
 *
 * Designed for radiology cockpit provenance mapping: each returned sentence
 * should be a self-contained thought unit suitable for linking to a clinical
 * problem.
 *
 * Splitting strategy (priority order):
 *   1. Line breaks (\n) are the primary delimiter — each line is ≥1 sentence
 *   2. Within multi-sentence lines, split on sentence-ending punctuation
 *      (. ? !) followed by whitespace + uppercase letter
 *   2b. Run-on detection: split on period directly between lowercase and
 *       uppercase word (no whitespace) — catches EHR copy-paste artifacts
 *   3. Abbreviations (medical + general safelist, plus a period-proximity
 *      heuristic) are NOT treated as sentence breaks
 *   4. Bullet/list items are atomic (no intra-line splitting)
 *   5. Short fragments from intra-line splits (< 20 chars) fold back into
 *      the preceding sentence
 *   6. Standalone short lines (< 20 chars, own \n line) are discarded —
 *      too short to name a problem AND explain it
 *   7. Long sentences (> 500 chars) split on semicolons or em-dashes;
 *      never force-split without a clear delimiter
 *   8. Empty / whitespace-only lines are filtered out
 */

// ── Configuration ─────────────────────────────────────────────────────────

/** Minimum character length for a standalone line to be kept */
const MIN_STANDALONE_LENGTH = 20;

/** Minimum character length for a fragment from an intra-line split.
 *  Shorter fragments are folded back into the preceding sentence. */
const MIN_FRAGMENT_LENGTH = 20;

/** Maximum character length before attempting semicolon/em-dash splitting */
const MAX_SENTENCE_LENGTH = 500;

// ── Abbreviation Safelist ─────────────────────────────────────────────────

/**
 * Periods after these tokens do NOT indicate sentence breaks.
 * All entries are lowercase without trailing period.
 *
 * Categories:
 *   - Medical titles and credentials
 *   - Pharmacy / prescription (sig codes, routes, forms)
 *   - Medical measurement units and vitals
 *   - Medical shorthand and patient status
 *   - Anatomical abbreviations
 *   - General English abbreviations
 *
 * Informed by clinical SBD interference lexicon analysis.
 */
const ABBREVIATION_SAFELIST = new Set([
  // Medical titles / credentials
  'dr', 'mr', 'mrs', 'ms', 'prof',
  'b.s.n', 'l.p.n', 'p.t', 'o.t', 'r.t', 'ph.d', 'pharm.d',

  // Pharmacy — frequencies & timing
  'q.d', 'b.i.d', 't.i.d', 'q.i.d', 'q.o.d', 'q.h', 'q.2.h',
  'q.a.m', 'q.p.m', 'q.h.s', 'h.s', 'a.m', 'p.m',
  'stat', 'p.r.n', 'prn', 'ad lib',

  // Pharmacy — routes
  'p.o', 'n.p.o', 'i.v', 'i.m', 's.c', 's.q', 'subq',
  'p.r', 'p.v', 's.l', 'top',

  // Pharmacy — forms & modifiers
  'tab', 'cap', 'syr', 'sol', 'susp', 'gtt', 'gtts',
  'ung', 'supp', 'inj', 'a.c', 'p.c', 'q.s', 'sig', 'disp',

  // Laterality — eyes & ears
  'o.d', 'o.s', 'o.u', 'a.d', 'a.s', 'a.u',

  // Medical units
  'mg', 'mcg', 'ml', 'dl', 'meq', 'mmol', 'kg', 'lb', 'lbs',
  'oz', 'cc', 'cm', 'mm', 'wt', 'ht',

  // Labs / vitals
  'temp', 'b.p', 'h.r', 'r.r', 'w.b.c', 'r.b.c', 'hgb', 'hct',

  // Medical shorthand / patient status
  'pt', 'hx', 'dx', 'tx', 'rx', 'sx', 'fx', 'yo', 'y.o', 'mo', 'wk', 'hr',
  'r.n', 'n.p', 'p.a', 'c.n.s', 'm.d', 'd.o',
  'c.o', 'h.o', 'r.o', 's.p',
  'w.n.l', 'd.c', 'a.m.a', 'd.o.a', 'n.k.d.a',

  // Anatomical
  'bilat', 'lat', 'ant', 'post', 'sup', 'inf', 'prox', 'dist',
  'r.u.q', 'l.u.q', 'r.l.q', 'l.l.q',

  // General English
  'e.g', 'i.e', 'vs', 'etc', 'et al', 'viz', 'approx', 'incl',
  'max', 'misc', 'no', 'st', 'ave', 'blvd',
  'dept', 'est', 'inc', 'jr', 'sr', 'ltd', 'vol', 'ed', 'ref',
  'fig', 'sec', 'min', 'resp',
]);

/**
 * Build a regex-safe pattern from the safelist.
 * For abbreviations containing internal periods (like "p.o", "b.i.d"),
 * we need to match the FULL abbreviation form as it appears in text.
 *
 * IMPORTANT: Uses \b word boundary to prevent matching as a suffix of
 * a longer word (e.g., "ed." should match standalone but NOT the tail
 * of "described." — otherwise every past-tense verb ending in "-ed"
 * would have its sentence-ending period masked).
 */
function buildAbbreviationRegex(): RegExp {
  // Sort by length descending so longer matches win
  const terms = [...ABBREVIATION_SAFELIST].sort((a, b) => b.length - a.length);

  // Escape each term for regex, replacing literal dots with escaped dots
  const escaped = terms.map(t =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );

  // Match the abbreviation followed by a period at the end.
  // \b ensures we only match at a word boundary — not as a suffix.
  // e.g., "Dr." or "p.o." or "M.D." but NOT "described."
  return new RegExp(`\\b(?:${escaped.join('|')})\\.`, 'gi');
}

const ABBREVIATION_RX = buildAbbreviationRegex();

// ── Bullet / List Detection ───────────────────────────────────────────────

/** Matches lines that start with a bullet or numbered list prefix */
const BULLET_RX = /^\s*(?:[-•*▪▸►]\s|(?:\d{1,3}|[a-zA-Z])[.)]\s)/;

// ── Period Proximity Heuristic ────────────────────────────────────────────

/**
 * Detect abbreviation-like patterns based on period proximity:
 * Multiple periods separated by 1-3 characters (e.g., "e.g.", "M.D.", "q.h.s.")
 *
 * This catches abbreviations NOT on the safelist.
 */
const PERIOD_PROXIMITY_RX = /\b(?:[A-Za-z]{1,3}\.){2,}/g;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Split clinical note text into sentence-level units.
 *
 * @param text - Raw clinical note section text (may contain \n)
 * @returns Array of sentence strings, each suitable for provenance mapping.
 *          Empty array if the input is empty or all lines are too short.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Rule 8: Skip empty lines
    if (!line) continue;

    // Rule 6: Discard standalone short lines
    if (line.length < MIN_STANDALONE_LENGTH) continue;

    // Rule 4: Bullet/list items are atomic — no intra-line splitting
    if (BULLET_RX.test(line)) {
      result.push(line);
      continue;
    }

    // Attempt intra-line sentence splitting
    const sentences = splitLineIntoSentences(line);
    result.push(...sentences);
  }

  // Rule 7: Handle long sentences by splitting on semicolons / em-dashes
  return result.flatMap(s => splitLongSentence(s));
}

// ── Internal: Intra-Line Splitting ────────────────────────────────────────

/**
 * Split a single line into sentences, respecting abbreviations.
 *
 * Strategy:
 *   1. Mask known abbreviations and period-proximity patterns with placeholders
 *   2. Split on sentence-ending punctuation followed by whitespace + uppercase
 *   3. Restore placeholders
 *   4. Fold short trailing fragments back into the preceding sentence
 */
function splitLineIntoSentences(line: string): string[] {
  // If the line is short enough that it can't contain multiple sentences, return as-is
  if (line.length < 40) return [line];

  // Step 1: Mask abbreviations with unlikely placeholders
  const masks: Array<{ placeholder: string; original: string }> = [];
  let masked = line;

  // Mask period-proximity patterns first (they may overlap with safelist)
  masked = masked.replace(PERIOD_PROXIMITY_RX, (match) => {
    const ph = `\x00PP${masks.length}\x00`;
    masks.push({ placeholder: ph, original: match });
    return ph;
  });

  // Mask safelist abbreviations
  masked = masked.replace(ABBREVIATION_RX, (match) => {
    const ph = `\x00AB${masks.length}\x00`;
    masks.push({ placeholder: ph, original: match });
    return ph;
  });



  // Step 2: Split on sentence-ending punctuation followed by space + uppercase
  // Also handles run-on sentences (no space: "pain.Lungs") via the second alternative
  const parts: string[] = [];
  // Primary: "." + whitespace + uppercase  |  Run-on: lowercase + "." + uppercase word
  const splitRx = /([.?!])\s+(?=[A-Z])|(?<=[a-z])(\.)(?=[A-Z][a-z])/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = splitRx.exec(masked)) !== null) {
    // match[1] = punctuation from primary pattern, match[2] = period from run-on pattern
    const punct = match[1] || match[2];
    const end = match.index + punct.length;
    parts.push(masked.substring(lastIdx, end));
    lastIdx = end + (match[0].length - punct.length); // Skip whitespace (0 for run-ons)
  }

  // Add the remainder
  if (lastIdx < masked.length) {
    parts.push(masked.substring(lastIdx));
  }

  // If no splits were made, return the original line
  if (parts.length <= 1) return [line];

  // Step 3: Restore placeholders and trim
  const restored = parts.map(p => {
    let s = p;
    for (const { placeholder, original } of masks) {
      s = s.split(placeholder).join(original);
    }
    return s.trim();
  }).filter(s => s.length > 0);

  // Step 4: Fold short trailing/middle fragments into the preceding sentence
  return foldShortFragments(restored);
}

/**
 * Merge any fragment shorter than MIN_FRAGMENT_LENGTH into the PRECEDING sentence.
 *
 * - Fragments ending with sentence-final punctuation (. ? !) are NEVER folded —
 *   they are legitimate short sentences, not split artifacts.
 * - First fragments that are broken remain standalone (no forward folding)
 *   to avoid bridging unrelated sentences.
 * - Terminal punctuation check looks at the last few characters to handle
 *   trailing whitespace or clinical markers (e.g., "Action required. +").
 */
function foldShortFragments(sentences: string[]): string[] {
  if (sentences.length <= 1) return sentences;

  /** Returns true if the fragment looks like a broken split (no terminal punctuation) */
  const isBrokenFragment = (s: string): boolean => {
    if (s.length >= MIN_FRAGMENT_LENGTH) return false;
    // Check for sentence-final punctuation anywhere in the last 3 characters
    // to handle trailing markers like "Action required. +"
    const tail = s.trim().slice(-3);
    return !/[.?!]/.test(tail);
  };

  // Single pass: fold broken fragments into the preceding sentence only
  const result: string[] = [sentences[0]];
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    if (isBrokenFragment(s)) {
      result[result.length - 1] += ' ' + s;
    } else {
      result.push(s);
    }
  }

  return result;
}

// ── Internal: Long Sentence Splitting ─────────────────────────────────────

/**
 * If a sentence exceeds MAX_SENTENCE_LENGTH, attempt to split on
 * semicolons (;) or em-dashes (—). Never force-split.
 */
function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_LENGTH) return [sentence];

  // Try splitting on semicolons first
  const semiParts = sentence.split(/;\s*/);
  if (semiParts.length > 1) {
    // Re-add semicolons to each part except the last
    const withSemi = semiParts.map((p, i) =>
      i < semiParts.length - 1 ? p + ';' : p,
    );
    // Fold short fragments and return
    return foldShortFragments(withSemi.map(s => s.trim()).filter(s => s.length > 0));
  }

  // Try splitting on em-dashes
  const dashParts = sentence.split(/\s*—\s*/);
  if (dashParts.length > 1) {
    return foldShortFragments(dashParts.map(s => s.trim()).filter(s => s.length > 0));
  }

  // No clear delimiter — keep as a single long sentence
  return [sentence];
}
