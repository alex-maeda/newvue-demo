/**
 * build-css.js — CSS Namespace Isolation Script
 *
 * Transforms the Reporting index.css into a scoped version where all
 * component selectors are nested under `.reporting-scope`.
 *
 * What gets STRIPPED (already present in the cockpit's own CSS):
 *   - @import (Google Fonts)
 *   - :root {} design tokens
 *   - *, *::before, *::after {} reset
 *   - body {} styles
 *   - #root {} styles
 *   - .sr-only (utility)
 *   - .mono (utility)
 *   - ::-webkit-scrollbar (global scrollbar)
 *   - .app-layout, .app-header, .app-header__title, .app-header__logo
 *   - .app-main, .app-content
 *
 * What stays at ROOT level (cannot be nested):
 *   - @keyframes declarations
 *
 * Everything else gets wrapped under .reporting-scope { ... }
 *
 * Usage: node build-css.js
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, '../../../../Reporting/client/src/index.css');
const OUTPUT = path.resolve(__dirname, 'reporting.css');

let source = fs.readFileSync(INPUT, 'utf-8');

// Strip BOM and normalize line endings
source = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// --- Phase 1: Parse the CSS into a list of top-level blocks ---
// Each block is either a rule, @keyframes, or a comment

/**
 * Parse CSS into top-level blocks by tracking brace depth.
 * Returns array of { type, text, selector } objects.
 */
function parseBlocks(css) {
  const blocks = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(css[i])) i++;
    if (i >= len) break;

    // Comment block
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        blocks.push({ type: 'comment', text: css.slice(i) });
        break;
      }
      blocks.push({ type: 'comment', text: css.slice(i, end + 2) });
      i = end + 2;
      continue;
    }

    // @import — must handle semicolons inside url('...')
    if (css.slice(i, i + 7) === '@import') {
      // Find the closing ')' of url() first, then find the ';' after it
      let semi = i + 7;
      let inQuote = false;
      let quoteChar = '';
      while (semi < len) {
        if (!inQuote && (css[semi] === "'" || css[semi] === '"')) {
          inQuote = true;
          quoteChar = css[semi];
        } else if (inQuote && css[semi] === quoteChar) {
          inQuote = false;
        } else if (!inQuote && css[semi] === ';') {
          break;
        }
        semi++;
      }
      blocks.push({ type: 'at-import', text: css.slice(i, semi + 1) });
      i = semi + 1;
      continue;
    }

    // @keyframes
    if (css.slice(i, i + 11) === '@keyframes ') {
      const braceStart = css.indexOf('{', i);
      let depth = 1;
      let j = braceStart + 1;
      while (j < len && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      blocks.push({
        type: 'keyframes',
        text: css.slice(i, j),
        name: css.slice(i + 11, braceStart).trim(),
      });
      i = j;
      continue;
    }

    // Regular rule: selector { ... }
    const braceStart = css.indexOf('{', i);
    if (braceStart === -1) {
      // Remaining text (shouldn't happen in valid CSS)
      blocks.push({ type: 'trailing', text: css.slice(i) });
      break;
    }

    const selector = css.slice(i, braceStart).trim();

    // Track brace depth to find the matching close
    let depth = 1;
    let j = braceStart + 1;
    while (j < len && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      // Skip string/url content
      if (css[j] === "'" || css[j] === '"') {
        const quote = css[j];
        j++;
        while (j < len && css[j] !== quote) {
          if (css[j] === '\\') j++; // skip escaped chars
          j++;
        }
      }
      j++;
    }

    blocks.push({
      type: 'rule',
      text: css.slice(i, j),
      selector,
      body: css.slice(braceStart + 1, j - 1),
    });
    i = j;
  }

  return blocks;
}

// --- Phase 2: Classify blocks ---

/** Selectors to strip entirely (Reporting's standalone app shell) */
const STRIP_SELECTORS = new Set([
  ':root',
  '*, *::before, *::after',
  '*,\n*::before,\n*::after',
  '*,\r\n*::before,\r\n*::after',
  'body',
  '#root',
  '.mono',
  '.sr-only',
  '::-webkit-scrollbar',
  '::-webkit-scrollbar-track',
  '::-webkit-scrollbar-thumb',
  '::-webkit-scrollbar-thumb:hover',
  '.app-layout',
  '.app-header',
  '.app-header__title',
  '.app-header__logo',
  '.app-main',
  '.app-content',
]);

function shouldStrip(selector) {
  const normalized = selector.replace(/\r\n/g, '\n').trim();
  if (STRIP_SELECTORS.has(normalized)) return true;
  // Also strip any selector that starts with these (handles multi-selector rules)
  if (normalized.startsWith(':root')) return true;
  return false;
}

function isSectionComment(text) {
  return text.includes('===') || text.includes('---');
}

// --- Phase 3: Build output ---

const blocks = parseBlocks(source);
const keyframesOut = [];
const scopedOut = [];
let strippedCount = 0;
let scopedCount = 0;
let keyframesCount = 0;
let commentCount = 0;

for (const block of blocks) {
  if (block.type === 'comment') {
    // Keep section header comments inside the scoped block for readability
    if (isSectionComment(block.text)) {
      scopedOut.push('\n  ' + block.text);
    }
    commentCount++;
    continue;
  }

  if (block.type === 'at-import') {
    // Strip — the cockpit already imports Inter
    strippedCount++;
    continue;
  }

  if (block.type === 'keyframes') {
    keyframesOut.push(block.text);
    keyframesCount++;
    continue;
  }

  if (block.type === 'rule') {
    if (shouldStrip(block.selector)) {
      strippedCount++;
      continue;
    }

    // Indent the entire rule block for nesting under .reporting-scope
    const indented = block.text
      .split('\n')
      .map(line => '  ' + line)
      .join('\n');
    scopedOut.push(indented);
    scopedCount++;
    continue;
  }
}

// --- Assemble final CSS ---

const header = `/* ============================================================
   Reporting CSS — Namespaced under .reporting-scope
   
   AUTO-GENERATED by build-css.js — Do not edit manually.
   Source: Reporting/client/src/index.css
   
   Stripped: global resets, :root tokens, body/html, app-layout shell
   Kept at root: @keyframes (cannot be nested)
   Everything else: wrapped under .reporting-scope { ... }
   ============================================================ */

`;

const keyframesSection = keyframesOut.length > 0
  ? `/* ── @keyframes (root-level — cannot be nested) ───────────── */\n\n${keyframesOut.join('\n\n')}\n\n`
  : '';

const scopedSection = `.reporting-scope {\n  /* Inherit cockpit design tokens, apply Reporting typography */\n  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;\n  font-size: 14px;\n  line-height: 1.5;\n  color: var(--text);\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n\n${scopedOut.join('\n\n')}\n}\n`;

const output = header + keyframesSection + scopedSection;

fs.writeFileSync(OUTPUT, output, 'utf-8');

console.log(`[build-css] Done!`);
console.log(`  Stripped:   ${strippedCount} blocks (resets, tokens, app shell)`);
console.log(`  Keyframes:  ${keyframesCount} blocks (kept at root)`);
console.log(`  Scoped:     ${scopedCount} blocks (under .reporting-scope)`);
console.log(`  Comments:   ${commentCount}`);
console.log(`  Output:     ${OUTPUT}`);
console.log(`  Size:       ${(output.length / 1024).toFixed(1)} KB`);
