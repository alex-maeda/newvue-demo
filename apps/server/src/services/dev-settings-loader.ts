/**
 * dev-settings-loader.ts — Reads and writes development-only settings
 * from config/dev-settings.json.
 *
 * This file is intentionally separate from user profile preferences
 * (config/profiles/<profile>/preferences.json) because these settings are
 * development/testing tools for A/B model comparison, not production
 * user configuration.
 *
 * Settings are read from disk on every access (no caching) so that
 * changes made via the UI take effect on the next LLM invocation
 * without requiring a server restart.
 */

import fs from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface FindingGroupingDevSettings {
  /** Full Anthropic model ID */
  modelId: string;
  /**
   * Reasoning effort level for adaptive thinking.
   * Only meaningful when modelId targets a thinking-capable model
   * (Sonnet 4.6, Opus 4.7). "none" disables thinking entirely; other
   * levels map to the Anthropic `thinking.effort` parameter.
   */
  reasoningEffort: ReasoningEffort;
}

export interface DevSettings {
  findingGrouping: FindingGroupingDevSettings;
  problemGrouping: FindingGroupingDevSettings;
  noteTriage: FindingGroupingDevSettings;
  oneLiner: FindingGroupingDevSettings;
  expandedReason: FindingGroupingDevSettings;
}

// ── Constants ─────────────────────────────────────────────────────────────

const DEV_SETTINGS_PATH = path.resolve(__dirname, '../../config/dev-settings.json');

const BEDROCK_HAIKU = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const BEDROCK_SONNET = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

const DEFAULT_SETTINGS: DevSettings = {
  findingGrouping: {
    modelId: BEDROCK_HAIKU,
    reasoningEffort: 'none',
  },
  problemGrouping: {
    modelId: BEDROCK_HAIKU,
    reasoningEffort: 'none',
  },
  noteTriage: {
    modelId: BEDROCK_HAIKU,
    reasoningEffort: 'none',
  },
  oneLiner: {
    modelId: BEDROCK_SONNET,
    reasoningEffort: 'low',
  },
  expandedReason: {
    modelId: BEDROCK_SONNET,
    reasoningEffort: 'none',
  },
};

const VALID_REASONING_EFFORTS: ReadonlySet<string> = new Set(['none', 'low', 'medium', 'high']);

const VALID_MODEL_IDS: ReadonlySet<string> = new Set([
  BEDROCK_HAIKU,
  BEDROCK_SONNET,
  'us.anthropic.claude-opus-4-20250514-v1:0',
]);

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Read dev settings from disk. Returns safe defaults if the file
 * is missing, unreadable, or contains invalid data.
 *
 * No caching — every call reads fresh from disk so that UI changes
 * are picked up on the very next LLM invocation.
 */
export function getDevSettings(): DevSettings {
  try {
    const raw = fs.readFileSync(DEV_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch {
    // File missing or corrupt — return defaults (fail-safe, not fail-fast,
    // because this is a dev convenience feature, not a clinical data path)
    console.warn('[dev-settings] Could not read dev-settings.json, using defaults');
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Deep-merge partial updates into the current dev settings and persist
 * the result to disk. Returns the updated settings.
 */
export function updateDevSettings(partial: Partial<DevSettings>): DevSettings {
  const current = getDevSettings();

  // Merge finding grouping settings
  if (partial.findingGrouping) {
    if (partial.findingGrouping.modelId && VALID_MODEL_IDS.has(partial.findingGrouping.modelId)) {
      current.findingGrouping.modelId = partial.findingGrouping.modelId;
    }
    if (
      partial.findingGrouping.reasoningEffort &&
      VALID_REASONING_EFFORTS.has(partial.findingGrouping.reasoningEffort)
    ) {
      current.findingGrouping.reasoningEffort = partial.findingGrouping.reasoningEffort;
    }
  }

  // Merge problem grouping settings
  if (partial.problemGrouping) {
    if (partial.problemGrouping.modelId && VALID_MODEL_IDS.has(partial.problemGrouping.modelId)) {
      current.problemGrouping.modelId = partial.problemGrouping.modelId;
    }
    if (
      partial.problemGrouping.reasoningEffort &&
      VALID_REASONING_EFFORTS.has(partial.problemGrouping.reasoningEffort)
    ) {
      current.problemGrouping.reasoningEffort = partial.problemGrouping.reasoningEffort;
    }
  }

  // Merge note triage settings
  if (partial.noteTriage) {
    if (partial.noteTriage.modelId && VALID_MODEL_IDS.has(partial.noteTriage.modelId)) {
      current.noteTriage.modelId = partial.noteTriage.modelId;
    }
    if (
      partial.noteTriage.reasoningEffort &&
      VALID_REASONING_EFFORTS.has(partial.noteTriage.reasoningEffort)
    ) {
      current.noteTriage.reasoningEffort = partial.noteTriage.reasoningEffort;
    }
  }

  // Merge one-liner settings
  if (partial.oneLiner) {
    if (partial.oneLiner.modelId && VALID_MODEL_IDS.has(partial.oneLiner.modelId)) {
      current.oneLiner.modelId = partial.oneLiner.modelId;
    }
    if (
      partial.oneLiner.reasoningEffort &&
      VALID_REASONING_EFFORTS.has(partial.oneLiner.reasoningEffort)
    ) {
      current.oneLiner.reasoningEffort = partial.oneLiner.reasoningEffort;
    }
  }

  // Merge expanded reason settings
  if (partial.expandedReason) {
    if (partial.expandedReason.modelId && VALID_MODEL_IDS.has(partial.expandedReason.modelId)) {
      current.expandedReason.modelId = partial.expandedReason.modelId;
    }
    if (
      partial.expandedReason.reasoningEffort &&
      VALID_REASONING_EFFORTS.has(partial.expandedReason.reasoningEffort)
    ) {
      current.expandedReason.reasoningEffort = partial.expandedReason.reasoningEffort;
    }
  }

  // Write back to disk
  try {
    fs.writeFileSync(DEV_SETTINGS_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
    console.log(
      `[dev-settings] Updated: findingGrouping=${current.findingGrouping.modelId}/${current.findingGrouping.reasoningEffort}, ` +
      `problemGrouping=${current.problemGrouping.modelId}/${current.problemGrouping.reasoningEffort}, ` +
      `noteTriage=${current.noteTriage.modelId}/${current.noteTriage.reasoningEffort}, ` +
      `oneLiner=${current.oneLiner.modelId}/${current.oneLiner.reasoningEffort}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[dev-settings] Failed to write dev-settings.json: ${msg}`);
  }

  return current;
}

// ── Internal: Sanitization ────────────────────────────────────────────────

/**
 * Validate and sanitize parsed JSON, falling back to defaults for
 * any invalid or missing fields.
 */
function sanitize(parsed: unknown): DevSettings {
  const result: DevSettings = {
    findingGrouping: { ...DEFAULT_SETTINGS.findingGrouping },
    problemGrouping: { ...DEFAULT_SETTINGS.problemGrouping },
    noteTriage: { ...DEFAULT_SETTINGS.noteTriage },
    oneLiner: { ...DEFAULT_SETTINGS.oneLiner },
    expandedReason: { ...DEFAULT_SETTINGS.expandedReason },
  };

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    // Sanitize finding grouping
    const fg = obj.findingGrouping;
    if (fg && typeof fg === 'object' && !Array.isArray(fg)) {
      const fgObj = fg as Record<string, unknown>;

      if (typeof fgObj.modelId === 'string' && VALID_MODEL_IDS.has(fgObj.modelId)) {
        result.findingGrouping.modelId = fgObj.modelId;
      }

      if (
        typeof fgObj.reasoningEffort === 'string' &&
        VALID_REASONING_EFFORTS.has(fgObj.reasoningEffort)
      ) {
        result.findingGrouping.reasoningEffort = fgObj.reasoningEffort as ReasoningEffort;
      }
    }

    // Sanitize problem grouping
    const pg = obj.problemGrouping;
    if (pg && typeof pg === 'object' && !Array.isArray(pg)) {
      const pgObj = pg as Record<string, unknown>;

      if (typeof pgObj.modelId === 'string' && VALID_MODEL_IDS.has(pgObj.modelId)) {
        result.problemGrouping.modelId = pgObj.modelId;
      }

      if (
        typeof pgObj.reasoningEffort === 'string' &&
        VALID_REASONING_EFFORTS.has(pgObj.reasoningEffort)
      ) {
        result.problemGrouping.reasoningEffort = pgObj.reasoningEffort as ReasoningEffort;
      }
    }

    // Sanitize note triage
    const nt = obj.noteTriage;
    if (nt && typeof nt === 'object' && !Array.isArray(nt)) {
      const ntObj = nt as Record<string, unknown>;

      if (typeof ntObj.modelId === 'string' && VALID_MODEL_IDS.has(ntObj.modelId)) {
        result.noteTriage.modelId = ntObj.modelId;
      }

      if (
        typeof ntObj.reasoningEffort === 'string' &&
        VALID_REASONING_EFFORTS.has(ntObj.reasoningEffort)
      ) {
        result.noteTriage.reasoningEffort = ntObj.reasoningEffort as ReasoningEffort;
      }
    }

    // Sanitize one-liner
    const ol = obj.oneLiner;
    if (ol && typeof ol === 'object' && !Array.isArray(ol)) {
      const olObj = ol as Record<string, unknown>;

      if (typeof olObj.modelId === 'string' && VALID_MODEL_IDS.has(olObj.modelId)) {
        result.oneLiner.modelId = olObj.modelId;
      }

      if (
        typeof olObj.reasoningEffort === 'string' &&
        VALID_REASONING_EFFORTS.has(olObj.reasoningEffort)
      ) {
        result.oneLiner.reasoningEffort = olObj.reasoningEffort as ReasoningEffort;
      }
    }

    // Sanitize expanded reason
    const er = obj.expandedReason;
    if (er && typeof er === 'object' && !Array.isArray(er)) {
      const erObj = er as Record<string, unknown>;

      if (typeof erObj.modelId === 'string' && VALID_MODEL_IDS.has(erObj.modelId)) {
        result.expandedReason.modelId = erObj.modelId;
      }

      if (
        typeof erObj.reasoningEffort === 'string' &&
        VALID_REASONING_EFFORTS.has(erObj.reasoningEffort)
      ) {
        result.expandedReason.reasoningEffort = erObj.reasoningEffort as ReasoningEffort;
      }
    }
  }

  return result;
}
