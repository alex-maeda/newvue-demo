/**
 * Word-level diff utility using Longest Common Subsequence (LCS).
 *
 * Designed for computing readable diffs of medical report text
 * (e.g., normal finding edits by Pass 2B). Tokenizes on whitespace
 * so punctuation stays attached to its word ("hemorrhage." is one token).
 *
 * @module wordDiff
 */

/**
 * Tokenize a string into words by splitting on whitespace.
 * Empty tokens are filtered out.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return (text || '').split(/\s+/).filter(Boolean);
}

/**
 * Compute the LCS table for two token arrays.
 * Returns a 2D array where dp[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 *
 * @param {string[]} a - Original tokens
 * @param {string[]} b - Modified tokens
 * @returns {number[][]}
 */
function buildLcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Backtrack through the LCS table to produce a diff of tokens.
 *
 * @param {number[][]} dp - LCS table
 * @param {string[]} a - Original tokens
 * @param {string[]} b - Modified tokens
 * @returns {Array<{type: 'equal'|'delete'|'insert', text: string}>}
 */
function backtrack(dp, a, b) {
  const result = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: 'equal', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'insert', text: b[j - 1] });
      j--;
    } else {
      result.push({ type: 'delete', text: a[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Compute a word-level diff between two strings.
 *
 * Returns an array of diff tokens, each with:
 *   - `type`: 'equal' (unchanged), 'delete' (removed from original), 'insert' (added in modified)
 *   - `text`: the word
 *
 * @param {string} original - The original/baseline text
 * @param {string} modified - The modified/current text
 * @returns {Array<{type: 'equal'|'delete'|'insert', text: string}>}
 *
 * @example
 * computeWordDiff(
 *   "No acute infarct or hemorrhage.",
 *   "No acute hemorrhage."
 * )
 * // → [
 * //   { type: 'equal', text: 'No' },
 * //   { type: 'equal', text: 'acute' },
 * //   { type: 'delete', text: 'infarct' },
 * //   { type: 'delete', text: 'or' },
 * //   { type: 'equal', text: 'hemorrhage.' },
 * // ]
 */
export function computeWordDiff(original, modified) {
  const a = tokenize(original);
  const b = tokenize(modified);

  // Fast paths
  if (a.join(' ') === b.join(' ')) {
    return a.map((text) => ({ type: 'equal', text }));
  }
  if (a.length === 0) {
    return b.map((text) => ({ type: 'insert', text }));
  }
  if (b.length === 0) {
    return a.map((text) => ({ type: 'delete', text }));
  }

  const dp = buildLcsTable(a, b);
  return backtrack(dp, a, b);
}
