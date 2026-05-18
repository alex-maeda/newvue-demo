/**
 * Active Report Document — Unified Report State Builder & Restorer
 *
 * This module provides utilities to:
 *   1. **Build** a unified JSON "Active Report Document" from the current
 *      Zustand store state (templateNodes, contentBoxStates, nodeTextStates).
 *   2. **Restore** Zustand store state from a saved Active Report Document.
 *
 * The Active Report Document is the **serializable artifact** of the current
 * report's contents and state. It is built on demand at save-time (not kept
 * in sync continuously) and can be used for:
 *   - Session persistence (save/resume)
 *   - Final report export to the medical record
 *   - QA logging and audit trails
 *
 * Document Structure:
 * ```
 * {
 *   // ── Root Metadata (from template + session) ──
 *   version, kind, title, modality, bodyRegion, description,
 *   templateId, reportId, status, author, createdAt, updatedAt, signedAt,
 *   patient: { patientId, mrn, name, sex, dateOfBirth },
 *   study: { accessionNumber, performedAt },
 *
 *   // ── Report Content Tree ──
 *   children: [
 *     {
 *       id, type, label, tags, children: [...],
 *       // Structural node state:
 *       templateText, currentText, state: { edited }
 *     },
 *     {
 *       id, type, tags, children: [],
 *       // Content node state:
 *       templateText, currentText, state: {
 *         version, manuallyEdited, deleted, inputType, options, ...
 *       }
 *     },
 *   ],
 *
 *   // ── Session-level Data ──
 *   segments: { ... },
 *   tokenUsage: { ... },
 *   dictationText: "...",
 * }
 * ```
 *
 * @module activeReportDocument
 */

import { buildNodeMapFromTree } from './templateAdapter';

// ─── ID Generation ───────────────────────────────────────────────────

/**
 * Generate a unique report ID.
 * Format: report-{timestamp}-{random6}
 *
 * @returns {string}
 */
export function generateReportId() {
  return `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Build Active Report (Store → JSON) ──────────────────────────────

/**
 * Create an Active Report Document by composing store state into a unified
 * JSON structure with embedded per-node state.
 *
 * This is a READ-ONLY snapshot — it does not modify any input data.
 *
 * @param {object} params
 * @param {object} params.templateData - Raw template metadata (from templateLoader)
 * @param {Array}  params.templateNodes - The live template node tree
 * @param {object} params.contentBoxStates - Content box state map
 * @param {object} params.nodeTextStates - Structural node text state map
 * @param {object} params.segments - Segment map { [textareaId]: [segment, ...] }
 * @param {object} params.tokenUsage - Token usage counters
 * @param {string} params.dictationText - Current dictation textarea content
 * @param {object} params.sessionMeta - Session metadata
 * @param {string} params.sessionMeta.reportId - Unique report identifier
 * @param {string} params.sessionMeta.sessionId - Session identifier
 * @param {string} [params.sessionMeta.status='in-progress'] - Report status
 * @param {object} [params.sessionMeta.author] - { id, name }
 * @param {string} [params.sessionMeta.createdAt] - ISO timestamp
 * @param {object} [params.sessionMeta.patient] - Patient data
 * @param {object} [params.sessionMeta.study] - Study/exam data
 * @returns {object} The Active Report Document (JSON-serializable)
 */
export function createActiveReport({
  templateData,
  templateNodes,
  contentBoxStates,
  nodeTextStates,
  segments,
  tokenUsage,
  dictationText,
  sessionMeta,
}) {
  // ── Root metadata from template ──
  const doc = {
    // Template origin
    version: templateData?.version ?? '1.0',
    kind: templateData?.kind ?? 'radiology-template',
    title: templateData?.title ?? '',
    modality: templateData?.modality ?? '',
    bodyRegion: templateData?.bodyRegion ?? '',
    description: templateData?.description ?? '',
    templateId: templateData?.templateId ?? templateData?.id ?? '',
    fileTemplateId: templateData?.fileTemplateId ?? '',

    // Session metadata
    reportId: sessionMeta?.reportId ?? '',
    sessionId: sessionMeta?.sessionId ?? '',
    status: sessionMeta?.status ?? 'in-progress',
    author: sessionMeta?.author ?? null,
    createdAt: sessionMeta?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    signedAt: sessionMeta?.signedAt ?? null,

    // Patient & study context
    patient: sessionMeta?.patient ?? null,
    study: sessionMeta?.study ?? null,

    // ── Report content tree with embedded state ──
    children: embedStateInTree(templateNodes, contentBoxStates, nodeTextStates),

    // ── Session-level data ──
    segments: segments ?? {},
    tokenUsage: tokenUsage ?? {},
    dictationText: dictationText ?? '',
  };

  return doc;
}

/**
 * Walk the template node tree and embed per-node state into each node.
 * Returns a deep clone — does not mutate the input tree.
 *
 * @param {Array} nodes - Template nodes tree
 * @param {object} contentBoxStates - Content box state map
 * @param {object} nodeTextStates - Structural node text state map
 * @returns {Array} Cloned tree with embedded state
 */
function embedStateInTree(nodes, contentBoxStates, nodeTextStates) {
  if (!nodes?.length) return [];

  return nodes.map((node) => {
    const isContent = node.type === 'content';
    const cloned = { ...node };

    if (isContent) {
      // ── Content / Dropdown node ──
      const box = contentBoxStates?.[node.id];
      cloned.templateText = node.text ?? '';
      cloned.currentText = box?.currentText ?? node.text ?? '';
      cloned.state = box
        ? {
            version: box.version ?? 0,
            manuallyEdited: box.manuallyEdited ?? false,
            deleted: box.deleted ?? false,
            inputType: box.inputType ?? 'text',
            options: box.options ?? null,
            selectedOptionIndex: box.selectedOptionIndex ?? 0,
            defaultOptionIndex: box.defaultOptionIndex ?? 0,
            originalText: box.originalText ?? '',
            // Dropdown picklist offsets
            picklists: box.picklists ?? null,
            // Pass 2 fields
            pass2Inserted: box.pass2Inserted ?? false,
            sourceSegmentIds: box.sourceSegmentIds ?? [],
            pass2RunId: box.pass2RunId ?? null,
            suppressedBySegmentIds: box.suppressedBySegmentIds ?? [],
            editedBySegmentIds: box.editedBySegmentIds ?? [],
            // Impression fields
            impressionGenerated: box.impressionGenerated ?? false,
            impressionRunId: box.impressionRunId ?? null,
            isCritical: box.isCritical ?? false,
            guideline: box.guideline ?? null,
            recommendation: box.recommendation ?? null,
            // Synthetic provenance fields (recommendations/guidelines sections)
            syntheticContent: box.syntheticContent ?? null,
            sourceImpressionBoxId: box.sourceImpressionBoxId ?? null,
            // Impression → report body provenance
            sourceContentBoxIds: box.sourceContentBoxIds ?? [],
          }
        : { version: 0, manuallyEdited: false, deleted: false, inputType: 'text' };
    } else {
      // ── Structural node (headline, section, subsection, etc.) ──
      const nts = nodeTextStates?.[node.id];
      const labelText = node.label ?? node.text ?? '';
      cloned.templateText = nts?.originalText ?? labelText;
      cloned.currentText = nts?.text ?? labelText;
      cloned.state = {
        edited: nts?.edited ?? false,
        // Synthetic section metadata
        syntheticSection: node.syntheticSection ?? false,
        syntheticSectionType: node.syntheticSectionType ?? null,
        impressionDerived: node.impressionDerived ?? false,
      };
    }

    // Recurse into children
    if (node.children?.length) {
      cloned.children = embedStateInTree(node.children, contentBoxStates, nodeTextStates);
    } else {
      cloned.children = [];
    }

    return cloned;
  });
}

// ─── Restore Store State (JSON → Store) ──────────────────────────────

/**
 * Decompose a saved Active Report Document back into the separate structures
 * expected by the current Zustand store.
 *
 * This is the reverse of createActiveReport(): it walks the saved tree,
 * strips embedded state into separate maps, and returns the structures
 * needed to hydrate the store.
 *
 * @param {object} snapshot - A saved Active Report Document
 * @returns {object} Store-compatible structures:
 *   {
 *     templateData,      // Template metadata (for store.templateData)
 *     templateNodes,     // Clean tree without embedded state
 *     contentBoxStates,  // Flat { [id]: ContentBoxState }
 *     nodeTextStates,    // Flat { [id]: { text, originalText, edited } }
 *     nodeMap,           // Flat { [id]: node } lookup
 *     segments,          // Segment map
 *     tokenUsage,        // Token usage counters
 *     dictationText,     // Dictation textarea content
 *     sessionMeta,       // Session metadata extracted from root
 *   }
 */
export function restoreStoreFromSnapshot(snapshot) {
  if (!snapshot?.children) {
    console.warn('[ActiveReport] Cannot restore: snapshot has no children');
    return null;
  }

  const contentBoxStates = {};
  const nodeTextStates = {};

  // Walk the tree: strip embedded state into separate maps,
  // return a clean tree matching the expected templateNodes shape
  const templateNodes = stripStateFromTree(snapshot.children, contentBoxStates, nodeTextStates);

  // Build nodeMap from the clean tree
  const nodeMap = buildNodeMapFromTree(templateNodes);

  // Reconstruct templateData from root metadata
  const templateData = {
    templateId: snapshot.templateId ?? '',
    fileTemplateId: snapshot.fileTemplateId ?? '',
    id: snapshot.templateId ?? '',
    title: snapshot.title ?? '',
    version: snapshot.version ?? '1.0',
    kind: snapshot.kind ?? 'radiology-template',
    modality: snapshot.modality ?? '',
    bodyRegion: snapshot.bodyRegion ?? '',
    description: snapshot.description ?? '',
    nodes: templateNodes, // The loader convention
  };

  // Extract session metadata
  const sessionMeta = {
    reportId: snapshot.reportId ?? '',
    sessionId: snapshot.sessionId ?? '',
    status: snapshot.status ?? 'in-progress',
    author: snapshot.author ?? null,
    createdAt: snapshot.createdAt ?? null,
    updatedAt: snapshot.updatedAt ?? null,
    signedAt: snapshot.signedAt ?? null,
    patient: snapshot.patient ?? null,
    study: snapshot.study ?? null,
  };

  return {
    templateData,
    templateNodes,
    contentBoxStates,
    nodeTextStates,
    nodeMap,
    segments: snapshot.segments ?? {},
    tokenUsage: snapshot.tokenUsage ?? {},
    dictationText: snapshot.dictationText ?? '',
    sessionMeta,
  };
}

/**
 * Walk a saved tree and strip embedded state (templateText, currentText, state)
 * into separate contentBoxStates and nodeTextStates maps. Returns a clean tree
 * matching the templateNodes shape.
 *
 * @param {Array} nodes - Saved tree nodes with embedded state
 * @param {object} contentBoxStates - Accumulator for content box states (mutated)
 * @param {object} nodeTextStates - Accumulator for structural node states (mutated)
 * @returns {Array} Clean tree nodes without embedded state fields
 */
function stripStateFromTree(nodes, contentBoxStates, nodeTextStates) {
  if (!nodes?.length) return [];

  return nodes.map((node) => {
    const isContent = node.type === 'content';

    // Clone without the embedded state fields
    const { templateText, currentText, state, ...rest } = node;
    const clean = { ...rest };

    if (isContent) {
      // Restore the node's `text` field from the saved templateText
      // (this is what the adapter originally set)
      clean.text = templateText ?? currentText ?? '';

      // Rebuild contentBoxStates entry
      contentBoxStates[node.id] = {
        contentBoxId: node.id,
        currentText: currentText ?? templateText ?? '',
        originalText: state?.originalText ?? templateText ?? '',
        version: state?.version ?? 0,
        manuallyEdited: state?.manuallyEdited ?? false,
        deleted: state?.deleted ?? false,
        inputType: state?.inputType ?? 'text',
        options: state?.options ?? null,
        selectedOptionIndex: state?.selectedOptionIndex ?? 0,
        defaultOptionIndex: state?.defaultOptionIndex ?? 0,
        // Dropdown picklist offsets
        picklists: state?.picklists ?? null,
        // Pass 2 fields
        pass2Inserted: state?.pass2Inserted ?? false,
        sourceSegmentIds: state?.sourceSegmentIds ?? [],
        pass2RunId: state?.pass2RunId ?? null,
        suppressedBySegmentIds: state?.suppressedBySegmentIds ?? [],
        editedBySegmentIds: state?.editedBySegmentIds ?? [],
        // Impression fields
        impressionGenerated: state?.impressionGenerated ?? false,
        impressionRunId: state?.impressionRunId ?? null,
        isCritical: state?.isCritical ?? false,
        guideline: state?.guideline ?? null,
        recommendation: state?.recommendation ?? null,
        // Synthetic provenance fields
        syntheticContent: state?.syntheticContent ?? null,
        sourceImpressionBoxId: state?.sourceImpressionBoxId ?? null,
        // Impression → report body provenance
        sourceContentBoxIds: state?.sourceContentBoxIds ?? [],
      };
    } else {
      // Structural node: restore label/text and rebuild nodeTextStates
      const labelText = currentText ?? templateText ?? node.label ?? node.text ?? '';
      clean.label = labelText;
      clean.text = labelText;

      nodeTextStates[node.id] = {
        text: currentText ?? templateText ?? '',
        originalText: templateText ?? currentText ?? '',
        edited: state?.edited ?? false,
      };

      // Restore synthetic section metadata onto the clean node
      if (state?.syntheticSection) {
        clean.syntheticSection = true;
        clean.syntheticSectionType = state.syntheticSectionType ?? null;
        clean.impressionDerived = state.impressionDerived ?? false;
      }
    }

    // Recurse into children
    clean.children = stripStateFromTree(node.children || [], contentBoxStates, nodeTextStates);

    return clean;
  });
}
