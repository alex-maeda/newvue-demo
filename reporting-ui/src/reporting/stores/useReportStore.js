import { create } from 'zustand';
import { createActionQueueSlice } from './actionQueueSlice';
import { createActionLogSlice } from './actionLogSlice';
import { clearAll as clearCaretPositions } from '../services/caretTracker';
import { cancelAllTimers, startSafetyTimeout } from '../services/actionQueueService';
import asrService from '../services/asrService';
import { buildNodeMapFromTree } from '../utils/templateAdapter';
import { createActiveReport, restoreStoreFromSnapshot, generateReportId } from '../utils/activeReportDocument';
import useUserStore from './useUserStore';

// --- Phase 6: Impression Preferences now live in useUserStore.js ---
// (Migrated from useReportStore to support per-user persistence)

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Collect all content nodes and initialize ContentBoxState for each.
 * Supports both flat nodeMap iteration (preferred) and recursive tree walk (fallback).
 *
 * @param {Array} nodes - Template tree nodes (used for recursive walk)
 * @param {object} [nodeMap] - Optional flat node map for direct iteration
 * @returns {object} ContentBoxState map
 */
function initContentBoxStates(nodes, nodeMap) {
  const states = {};

  // Prefer flat iteration via nodeMap if available
  const contentNodes = nodeMap
    ? Object.values(nodeMap).filter((n) => n.type === 'content')
    : collectContentNodesFromTree(nodes);

  for (const node of contentNodes) {
    const isDropdown = node.inputType === 'select';
    // v2 normalized nodes: node.text is already the composed default text
    // (set by normalizeTemplateNodes for both text and dropdown nodes)
    const defaultText = node.text ?? '';

    states[node.id] = {
      contentBoxId: node.id,
      currentText: defaultText,
      originalText: defaultText,    // Baseline text for rollback (never mutated after init)
      version: 0,
      manuallyEdited: false,
      deleted: false,
      // Dropdown-specific
      inputType: node.inputType ?? 'text',
      options: node.options ?? null,
      selectedOptionIndex: node.defaultOptionIndex ?? 0,
      defaultOptionIndex: node.defaultOptionIndex ?? 0,
      // Dropdown picklist offsets (v2 inline picklists)
      picklists: node.picklists ?? null,
      // Phase 5: Pass 2 fields
      pass2Inserted: false,
      sourceSegmentIds: [],
      pass2RunId: null,
      suppressedBySegmentIds: [],
      // Phase 5.1: Partial normal editing
      editedBySegmentIds: [],
    };
  }
  return states;
}

/** Recursive fallback: collect content nodes from a nested tree. */
function collectContentNodesFromTree(nodes, result = []) {
  for (const node of nodes) {
    if (node.type === 'content') result.push(node);
    if (node.children?.length) collectContentNodesFromTree(node.children, result);
  }
  return result;
}

/**
 * Initialize text states for non-content nodes (headlines, sections, subsections).
 * These track whether labels have been edited from their template defaults.
 *
 * @param {object} nodeMap - Flat ID → node lookup
 * @returns {object} { [nodeId]: { text, originalText, edited } }
 */
function initNodeTextStates(nodeMap) {
  const states = {};
  for (const node of Object.values(nodeMap)) {
    if (node.type === 'content') continue;
    const text = node.label || node.text || '';
    states[node.id] = {
      text,
      originalText: text,
      edited: false,
    };
  }
  return states;
}

/**
 * Deep clone template nodes (for reset purposes)
 */
function cloneNodes(nodes) {
  return JSON.parse(JSON.stringify(nodes));
}

/**
 * Strip dynamically-injected nodes from a template tree to produce a clean
 * baseline template. Removes:
 *   - Synthetic section nodes (recommendations/guidelines)
 *   - Impression-generated content boxes
 *   - Pass 2-inserted content boxes
 *
 * Used to produce clean rawTemplateData for session resets after restoring
 * a snapshot that contains dynamically-added content.
 *
 * @param {Array} nodes - Template tree nodes
 * @param {object} contentBoxStates - Current content box state map
 * @returns {Array} Clean template nodes
 */
function stripDynamicNodes(nodes, contentBoxStates) {
  if (!nodes?.length) return [];

  return nodes.reduce((acc, node) => {
    // Remove synthetic section nodes entirely
    if (node.syntheticSection) return acc;

    // Remove dynamically-generated content boxes
    if (node.type === 'content') {
      const box = contentBoxStates?.[node.id];
      if (box?.impressionGenerated || box?.pass2Inserted || box?.syntheticContent) {
        return acc;
      }
    }

    // Recurse into children
    const cleaned = { ...node };
    if (node.children?.length) {
      cleaned.children = stripDynamicNodes(node.children, contentBoxStates);
      cleaned.childrenId = cleaned.children.map((c) => c.id);
    }

    acc.push(cleaned);
    return acc;
  }, []);
}

/**
 * Find the IMPRESSION headline node.
 * Uses nodeMap for O(n) flat scan when available, falls back to tree search.
 *
 * @param {Array} nodes - Template tree nodes
 * @param {object} [nodeMap] - Optional flat node map for direct lookup
 * @returns {object|null} The impression headline node, or null
 */
function findImpressionHeadline(nodes, nodeMap) {
  // Prefer flat lookup via nodeMap
  if (nodeMap) {
    return Object.values(nodeMap).find(
      (n) => n.type === 'headline' && (n.text || n.label || '').toLowerCase() === 'impression'
    ) || null;
  }
  // Fallback: recursive tree search
  for (const node of nodes) {
    if (node.type === 'headline' && (node.label || node.text || '').toLowerCase() === 'impression') {
      return node;
    }
    if (node.children?.length) {
      const found = findImpressionHeadline(node.children);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Build initial segment entries for content boxes that have pre-populated text.
 * This gives Pass 1 proper preceding/following context when the user later
 * dictates into or near these content boxes (especially dropdown defaults).
 *
 * @param {object} contentBoxStates - The initialized ContentBoxState map
 * @returns {object} segments map: { [contentBoxId]: [segment] }
 */
function initContentBoxSegments(contentBoxStates) {
  const segments = { 'dictation-box': [] };
  for (const [boxId, box] of Object.entries(contentBoxStates)) {
    const text = box.currentText || '';
    if (text.length > 0) {
      segments[boxId] = [{
        segmentId: generateId('seg'),
        textareaTarget: boxId,
        startOffset: 0,
        endOffset: text.length,
        length: text.length,
        text,
        status: 'sanitized',
        sourceActionId: null,
      }];
    }
  }
  return segments;
}

const useReportStore = create((set, get) => ({
  // --- Template ---
  templateData: null,
  templateNodes: [],
  nodeMap: {},             // Flat ID → node lookup (references same objects as templateNodes tree)
  contentBoxStates: {},
  nodeTextStates: {},      // Non-content node label text: { [nodeId]: { text, originalText, edited } }
  rawTemplateData: null,   // Stashed raw template JSON for clean resets

  // --- Session State (Phase 2: Active Report Document) ---
  sessionId: null,           // Unique session identifier
  lastSavedAt: null,         // Timestamp of last successful save
  hasUnsavedChanges: false,  // Dirty flag — true after any content edit, false after save

  // --- UI State ---
  activeTextareaId: null,
  focusedTextareaId: null,    // Which textarea has native browser focus (null = none)
  caretVersion: 0,            // Monotonic counter — bumped by voice commands that reposition the caret externally
  qaLog: [],
  qaLogCollapsed: false,

  // --- ASR State ---
  asrStatus: 'idle',        // 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error'
  asrVendor: 'speechmatics', // 'deepgram' | 'speechmatics'
  availableStudies: [],       // Current studies from parent cockpit
  currentStudyId: null,       // Currently selected study ID
  interimText: '',          // Current interim transcript
  dictationText: '',        // Full accumulated dictation textarea content
  asrError: null,           // Error message string or null

  // --- Action Queue Slice (Phase 3) ---
  ...createActionQueueSlice(set, get),

  // --- Action Log Slice (Undo/Redo) ---
  ...createActionLogSlice(set, get),

  // --- Phase 4: Pass 1 State ---
  openFragments: {},           // Per-textarea open fragments: { 'dictation-box': '', [contentBoxId]: '' }

  // --- Phase 5: Pass 2 State ---
  pass2Status: 'idle',         // 'idle' | 'debouncing' | 'in_flight' | 'error'
  pass1Status: 'idle',         // 'idle' | 'debouncing' | 'in_flight' | 'error'

  // --- Phase 6: Impression State ---
  impressionStatus: 'idle',      // 'idle' | 'debouncing' | 'in_flight' | 'stale' | 'error'
  impressionRunId: null,
  // Note: impressionPrefs and priorImpressionSamples moved to useUserStore.js

  // --- Token Usage Tracking ---
  tokenUsage: {
    pass1:      { inputTokens: 0, outputTokens: 0 },
    pass2a:     { inputTokens: 0, outputTokens: 0 },
    pass2b:     { inputTokens: 0, outputTokens: 0 },
    impression: { inputTokens: 0, outputTokens: 0 },
  },

  // --- Provenance Tracing State ---
  // Ephemeral UI state for provenance highlight interactions.
  // provenanceHighlightSegmentIds: dictation-box segment IDs to highlight (report body → dictation box)
  // provenanceHighlightContentBoxIds: content box IDs to highlight (dictation box → report body, or impression → report body)
  provenanceHighlightSegmentIds: [],
  provenanceHighlightContentBoxIds: [],
  // impressionSourceMap: reverse lookup from report body contentBoxId → [impressionBoxIds]
  // Built during applyImpressionResults for efficient ContentBox → Impression tracing.
  impressionSourceMap: {},

  // --- Voice Command State ---
  lastVoiceCommand: null,        // { commandId, description, timestamp } — drives the header toast
  erikCollecting: false,         // true while VCE is in COLLECTING_OPEN_PAYLOAD phase for ERIK

  // --- UI Popout State ---
  isDictationPoppedOut: false,
  popoutWindowRef: null,         // Reference to the pop-out Window object (non-serializable)

  // --- Actions ---
  loadTemplate: (templateData) => {
    const nodes = cloneNodes(templateData.nodes);
    const nodeMap = buildNodeMapFromTree(nodes);
    const states = initContentBoxStates(nodes, nodeMap);
    const segments = initContentBoxSegments(states);
    const nodeTextStates = initNodeTextStates(nodeMap);
    set({
      templateData,
      templateNodes: nodes,
      nodeMap,
      contentBoxStates: states,
      nodeTextStates,
      segments,
      // Phase 2: stash raw template for clean resets and generate session ID
      rawTemplateData: cloneNodes([templateData])[0],
      sessionId: generateReportId(),
      lastSavedAt: null,
      hasUnsavedChanges: false,
    });
  },

  updateContentBox: (id, text) => {
    set((state) => ({
      contentBoxStates: {
        ...state.contentBoxStates,
        [id]: {
          ...state.contentBoxStates[id],
          currentText: text,
          version: (state.contentBoxStates[id]?.version ?? 0) + 1,
          manuallyEdited: true,
        },
      },
      hasUnsavedChanges: true,
    }));
  },

  /**
   * Update the label text of a non-content node.
   * Syncs into `nodeTextStates`, updates the node's `label` and `text` fields
   * in the tree/nodeMap (same reference), and marks as edited.
   */
  updateNodeText: (nodeId, newText) => {
    set((state) => {
      // Update nodeTextStates
      const prevState = state.nodeTextStates[nodeId];
      if (!prevState) return state;

      const newNodeTextStates = {
        ...state.nodeTextStates,
        [nodeId]: {
          ...prevState,
          text: newText,
          edited: newText !== prevState.originalText,
        },
      };

      // Also update the node's label/text fields in-place (nodeMap references
      // the same objects as templateNodes tree, so both stay in sync)
      const node = state.nodeMap[nodeId];
      if (node) {
        node.label = newText;
        node.text = newText;
      }

      return { nodeTextStates: newNodeTextStates };
    });
  },

  toggleSoftDelete: (id) => {
    set((state) => {
      const box = state.contentBoxStates[id];
      if (!box) return state;

      // Q4: If restoring a normal that was suppressed by Pass 2,
      // mark as manuallyEdited to protect from future auto-suppression.
      // If the user explicitly restores a soft-deleted normal, that's
      // a "hands off" signal — Pass 2 should not re-suppress it.
      const isRestoring = box.deleted;
      const wasSuppressedByPass2 = (box.suppressedBySegmentIds || []).length > 0;

      return {
        contentBoxStates: {
          ...state.contentBoxStates,
          [id]: {
            ...box,
            deleted: !box.deleted,
            // If restoring a Pass 2-suppressed normal: mark as manually edited (protected)
            // If restoring a non-Pass2 soft-delete: reset per §8.4
            manuallyEdited: isRestoring
              ? (wasSuppressedByPass2 ? true : false)
              : box.manuallyEdited,
            // Clear suppression tracking on manual restore
            suppressedBySegmentIds: isRestoring ? [] : box.suppressedBySegmentIds,
          },
        },
      };
    });
  },

  selectDropdownOption: (id, optionIndex) => {
    set((state) => {
      const box = state.contentBoxStates[id];
      if (!box || !box.options) return state;
      const option = box.options[optionIndex];
      if (!option) return state;

      const isDefault = optionIndex === box.defaultOptionIndex;
      return {
        contentBoxStates: {
          ...state.contentBoxStates,
          [id]: {
            ...box,
            selectedOptionIndex: optionIndex,
            currentText: option.value,
            manuallyEdited: !isDefault,
            version: box.version + 1,
          },
        },
      };
    });
  },

  setActiveTextarea: (id) => {
    const state = get();
    const prevId = state.activeTextareaId;

    console.log(`[VCE-DIAG] setActiveTextarea: "${prevId}" → "${id}"`);

    // If switching textareas while a pending dictate entry exists for the OLD
    // textarea, mark it as awaiting_final (cursor-move = boundary, §4.2).
    // The entry will resolve to the OLD textarea when its is_final arrives.
    if (prevId && prevId !== id) {
      const pendingEntry = state.actionQueue.find(
        (e) => e.status === 'pending' && e.actionType === 'dictate' && e.targetId === prevId
      );
      if (pendingEntry) {
        console.log(`[VCE-DIAG] setActiveTextarea: FOUND pending entry ${pendingEntry.actionId} for "${prevId}" — calling asrService.finalize() and marking awaiting_final`);
        // Force ASR to finalize buffered audio NOW — this flushes
        // all in-flight speech into the pending entry (which targets
        // the OLD textarea) before we switch targets.
        asrService.finalize();

        set({
          activeTextareaId: id,
          actionQueue: state.actionQueue.map((e) =>
            e.actionId === pendingEntry.actionId
              ? { ...e, status: 'awaiting_final' }
              : e
          ),
        });
        // Safety timeout: close the entry if no final arrives within 1s.
        // With persistent entries, text was already inserted incrementally,
        // so we just close (no re-insertion needed).
        startSafetyTimeout(
          pendingEntry.actionId,
          (actionId) => get().closeDictationEntry(actionId),
          (actionId) => get().actionQueue.find((e) => e.actionId === actionId)
        );
        return;
      }

      // Even without a pending entry, if ASR is recording, send finalize
      // to flush any buffered audio that hasn't produced a final yet.
      if (state.asrStatus === 'listening') {
        console.log(`[VCE-DIAG] setActiveTextarea: No pending entry, but ASR listening — calling asrService.finalize()`);
        asrService.finalize();
      }
    }

    set({ activeTextareaId: id });
  },

  // --- Focus Tracking (for virtual caret visibility) ---
  setFocusedTextarea: (id) => set({ focusedTextareaId: id }),
  clearFocusedTextarea: (id) => {
    // Only clear if the blurring textarea is still the recorded focused one
    // (avoids race conditions when focus moves from A → B: B's onFocus fires
    // before A's onBlur, so A's blur should not overwrite B's focus)
    set((s) => (s.focusedTextareaId === id ? { focusedTextareaId: null } : s));
  },
  bumpCaretVersion: () => set((s) => ({ caretVersion: s.caretVersion + 1 })),

  setAsrStatus: (status) => set({ asrStatus: status, asrError: status === 'error' ? get().asrError : null }),

  setAsrVendor: (vendor) => set({ asrVendor: vendor }),

  setAvailableStudies: (studies, currentId) => set({ availableStudies: studies, currentStudyId: currentId }),

  setAsrError: (message) => set({ asrError: message, asrStatus: 'error' }),

  setInterimText: (text) => set({ interimText: text }),

  setDictationText: (text) => set({ dictationText: text }),

  /**
   * Create a segment for manually typed or pasted text.
   * Used when the user types directly (not via ASR).
   */
  createTypingSegment: (targetId, startOffset, text) => {
    const segmentId = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      segments: {
        ...s.segments,
        [targetId]: [
          ...(s.segments[targetId] || []),
          {
            segmentId,
            textareaTarget: targetId,
            startOffset,
            endOffset: startOffset + text.length,
            length: text.length,
            text,
            status: 'raw',
            sourceActionId: null,
          },
        ],
      },
    }));
  },

  addQaLogEntry: (entry) => {
    set((state) => {
      const newLog = [...state.qaLog, { ...entry, id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString() }];
      // Cap at 200 entries
      if (newLog.length > 200) newLog.shift();
      return { qaLog: newLog };
    });
  },

  /**
   * Accumulate token usage for a given LLM operation type.
   * @param {'pass1'|'pass2a'|'pass2b'|'impression'} operation
   * @param {number} inputTokens
   * @param {number} outputTokens
   */
  addTokenUsage: (operation, inputTokens, outputTokens) => {
    if (!inputTokens && !outputTokens) return;
    set((state) => ({
      tokenUsage: {
        ...state.tokenUsage,
        [operation]: {
          inputTokens: (state.tokenUsage[operation]?.inputTokens || 0) + (inputTokens || 0),
          outputTokens: (state.tokenUsage[operation]?.outputTokens || 0) + (outputTokens || 0),
        },
      },
    }));
  },

  // Legacy alias — derived from asrStatus
  get micActive() { return get().asrStatus === 'listening'; },
  toggleMic: () => {}, // No-op — mic is now managed by asrService

  // --- Phase 4: Pass 1 actions ---
  setOpenFragment: (targetId, text) => {
    set((s) => ({
      openFragments: { ...s.openFragments, [targetId]: text },
    }));
  },

  getOpenFragment: (targetId) => {
    return get().openFragments[targetId] || '';
  },

  setPass1Status: (status) => set({ pass1Status: status }),

  // --- Phase 5: Pass 2 actions ---
  setPass2Status: (status) => set({ pass2Status: status }),

  // --- Phase 6: Impression actions ---
  setImpressionStatus: (status) => set({ impressionStatus: status }),

  // Note: setImpressionPrefs and setPriorImpressionSamples moved to useUserStore.js
  //       → useUserStore.updateImpressionSettings()
  //       → useUserStore.updatePriorImpressionSamples()

  // --- Provenance Tracing actions ---
  setProvenanceHighlight: (segmentIds) => set({ provenanceHighlightSegmentIds: segmentIds }),
  clearProvenanceHighlight: () => set({ provenanceHighlightSegmentIds: [] }),
  setProvenanceHighlightContentBoxes: (ids) => set({ provenanceHighlightContentBoxIds: ids }),
  clearProvenanceHighlightContentBoxes: () => set({ provenanceHighlightContentBoxIds: [] }),

  // --- Voice Command actions ---
  setLastVoiceCommand: (commandId, description) => {
    set({ lastVoiceCommand: { commandId, description, timestamp: Date.now() } });
  },
  clearLastVoiceCommand: () => set({ lastVoiceCommand: null }),
  setErikCollecting: (collecting) => set({ erikCollecting: collecting }),

  // --- Pop-out actions ---
  openDictationPopout: (windowRef) => set({ isDictationPoppedOut: true, popoutWindowRef: windowRef }),
  closeDictationPopout: () => {
    const { popoutWindowRef } = get();
    // Set state BEFORE closing window to prevent re-entrant pagehide handler issues
    set({ isDictationPoppedOut: false, popoutWindowRef: null });
    if (popoutWindowRef && !popoutWindowRef.closed) {
      popoutWindowRef.close();
    }
  },

  /**
   * Apply impression generation results.
   * Replaces all non-manually-edited content boxes in the IMPRESSION section
   * with new impression items. Manually edited boxes are preserved verbatim
   * but may be repositioned.
   *
   * After building the main impression items, synthesizes "Recommendations"
   * and "Guidelines" section nodes gated by user preferences.
   *
   * @param {Array} impressionItems - Array of { text, isCritical, guideline, recommendation, isLocked }
   * @param {string} runId - Impression run ID for traceability
   */
  applyImpressionResults: (impressionItems, runId) => {
    set((state) => {
      const newNodes = cloneNodes(state.templateNodes);
      const newNodeMap = buildNodeMapFromTree(newNodes);
      const newContentBoxStates = { ...state.contentBoxStates };
      const newSegments = { ...state.segments };
      const newNodeTextStates = { ...state.nodeTextStates };

      // Find the impression headline node
      const impressionHeadline = findImpressionHeadline(newNodes, newNodeMap);
      if (!impressionHeadline) {
        console.warn('[applyImpressionResults] No IMPRESSION headline found in template');
        return state;
      }

      // Collect existing impression children
      const existingChildren = impressionHeadline.children || [];

      // Separate existing children into:
      //   - regular content boxes (type === 'content' without syntheticContent)
      //   - synthetic section nodes (syntheticSection === true)
      //   - non-content structural nodes (kept as-is)
      const keptRegularContent = [];
      const keptSyntheticSections = {}; // keyed by 'recommendations' | 'guidelines'
      const removedIds = [];

      for (const child of existingChildren) {
        if (child.syntheticSection) {
          // Track synthetic sections for potential preservation
          const sectionType = child.syntheticSectionType; // 'recommendations' or 'guidelines'
          const sectionNts = newNodeTextStates[child.id];
          const sectionEdited = sectionNts?.edited ?? false;

          // Collect manually-edited content boxes within the section
          const editedChildren = [];
          const removedSectionChildIds = [];
          for (const sChild of (child.children || [])) {
            const sBox = newContentBoxStates[sChild.id];
            if (sBox && sBox.manuallyEdited) {
              editedChildren.push(sChild);
            } else {
              removedSectionChildIds.push(sChild.id);
            }
          }

          // Clean up removed synthetic content boxes
          for (const id of removedSectionChildIds) {
            delete newContentBoxStates[id];
            delete newSegments[id];
            delete newNodeMap[id];
          }

          keptSyntheticSections[sectionType] = {
            node: child,
            sectionEdited,
            editedChildren,
          };
          continue;
        }

        if (child.type !== 'content') {
          // Structural nodes that aren't synthetic sections — keep
          keptRegularContent.push(child);
          continue;
        }

        // Regular impression content box
        const box = newContentBoxStates[child.id];
        if (box && box.manuallyEdited) {
          keptRegularContent.push(child);
        } else {
          removedIds.push(child.id);
        }
      }

      // Clean up removed regular impression content boxes
      for (const id of removedIds) {
        delete newContentBoxStates[id];
        delete newSegments[id];
        delete newNodeMap[id];
      }

      // Build new children list from impression items
      const newChildren = [];
      // Track impression box IDs in order for recommendation/guideline linkage
      const impressionBoxIds = [];

      for (const item of impressionItems) {
        if (item.isLocked) {
          const matchedChild = keptRegularContent.find((c) => {
            const box = newContentBoxStates[c.id];
            return box && box.manuallyEdited &&
              box.currentText?.trim() === (item.text || '').trim();
          }) || keptRegularContent.find((c) => {
            const box = newContentBoxStates[c.id];
            return box && box.manuallyEdited;
          });
          if (matchedChild) {
            const idx = keptRegularContent.indexOf(matchedChild);
            if (idx >= 0) keptRegularContent.splice(idx, 1);
            newChildren.push(matchedChild);
            impressionBoxIds.push(matchedChild.id);
          }
          continue;
        }

        // Create a new content box for this impression item
        const newId = `content_imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newNode = {
          id: newId,
          type: 'content',
          text: item.text,
          children: [],
          typeAttribute: [],
          typeData: {},
          parentId: impressionHeadline.id,
          childrenId: [],
          orderIndex: newChildren.length,
          misc: {},
        };

        newChildren.push(newNode);
        impressionBoxIds.push(newId);
        newNodeMap[newId] = newNode;

        newContentBoxStates[newId] = {
          contentBoxId: newId,
          currentText: item.text,
          version: 0,
          manuallyEdited: false,
          deleted: false,
          inputType: 'text',
          options: null,
          selectedOptionIndex: 0,
          defaultOptionIndex: 0,
          pass2Inserted: false,
          sourceSegmentIds: [],
          pass2RunId: null,
          suppressedBySegmentIds: [],
          // Phase 6: Impression-specific fields
          impressionGenerated: true,
          impressionRunId: runId,
          isCritical: item.isCritical || false,
          guideline: item.guideline || null,
          recommendation: item.recommendation || null,
          // Provenance: which report body content boxes contributed to this impression item
          sourceContentBoxIds: item.sourceContentBoxIds || [],
        };

        const segId = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        newSegments[newId] = [{
          segmentId: segId,
          textareaTarget: newId,
          startOffset: 0,
          endOffset: item.text.length,
          length: item.text.length,
          text: item.text,
          status: 'sanitized',
          sourceActionId: null,
        }];
      }

      // Append any remaining manually edited children that weren't matched
      for (const child of keptRegularContent) {
        if (child.type === 'content') {
          newChildren.push(child);
        }
      }

      // ── Synthesize Recommendations & Guidelines Sections ──────────
      const userPrefs = useUserStore.getState().preferences.impressionSettings;

      // Helper: create a synthetic section with content boxes
      function createSyntheticSection(sectionType, sectionLabel, items, keptSection) {
        // If no items and no kept edited children, skip entirely
        const hasKeptEdited = keptSection && keptSection.editedChildren.length > 0;
        if (items.length === 0 && !hasKeptEdited) return null;

        // Reuse the existing section node if its title was manually edited
        let sectionNode;
        if (keptSection && keptSection.sectionEdited) {
          sectionNode = keptSection.node;
          sectionNode.children = [];
        } else {
          const sectionId = `section_synth_${sectionType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          sectionNode = {
            id: sectionId,
            type: 'section',
            label: sectionLabel,
            text: sectionLabel,
            children: [],
            syntheticSection: true,
            syntheticSectionType: sectionType,
            impressionDerived: true,
            impressionRunId: runId,
            typeAttribute: [],
            typeData: {},
            parentId: impressionHeadline.id,
            childrenId: [],
            orderIndex: 0,
            misc: {},
          };
          // Register nodeTextStates for the new section label
          newNodeTextStates[sectionNode.id] = {
            text: sectionLabel,
            originalText: sectionLabel,
            edited: false,
          };
          // Clean up old section node if it existed but wasn't edited
          if (keptSection) {
            delete newNodeMap[keptSection.node.id];
            delete newNodeTextStates[keptSection.node.id];
          }
        }

        newNodeMap[sectionNode.id] = sectionNode;

        // Add new content boxes for each item
        for (const entry of items) {
          const contentId = `content_synth_${sectionType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const contentNode = {
            id: contentId,
            type: 'content',
            text: entry.text,
            children: [],
            typeAttribute: [],
            typeData: {},
            parentId: sectionNode.id,
            childrenId: [],
            orderIndex: sectionNode.children.length,
            misc: {},
          };
          sectionNode.children.push(contentNode);
          newNodeMap[contentId] = contentNode;

          newContentBoxStates[contentId] = {
            contentBoxId: contentId,
            currentText: entry.text,
            version: 0,
            manuallyEdited: false,
            deleted: false,
            inputType: 'text',
            options: null,
            selectedOptionIndex: 0,
            defaultOptionIndex: 0,
            pass2Inserted: false,
            sourceSegmentIds: [],
            pass2RunId: null,
            suppressedBySegmentIds: [],
            impressionGenerated: true,
            impressionRunId: runId,
            isCritical: false,
            guideline: null,
            recommendation: null,
            // Synthetic provenance fields
            syntheticContent: sectionType,          // 'recommendations' or 'guidelines'
            sourceImpressionBoxId: entry.sourceId,  // ID of the source impression content box
          };

          const segId = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          newSegments[contentId] = [{
            segmentId: segId,
            textareaTarget: contentId,
            startOffset: 0,
            endOffset: entry.text.length,
            length: entry.text.length,
            text: entry.text,
            status: 'sanitized',
            sourceActionId: null,
          }];
        }

        // Append any manually-edited children from the previous section
        if (hasKeptEdited) {
          for (const child of keptSection.editedChildren) {
            sectionNode.children.push(child);
          }
        }

        sectionNode.childrenId = sectionNode.children.map((c) => c.id);
        return sectionNode;
      }

      // --- Recommendations Section ---
      if (userPrefs.recommendations && userPrefs.recommendations !== 'none') {
        const recItems = [];
        for (let i = 0; i < impressionItems.length; i++) {
          const item = impressionItems[i];
          if (item.recommendation && item.recommendation.trim()) {
            recItems.push({
              text: item.recommendation.trim(),
              sourceId: impressionBoxIds[i] || null,
            });
          }
        }
        const recSection = createSyntheticSection(
          'recommendations', 'Recommendations', recItems,
          keptSyntheticSections['recommendations'] || null
        );
        if (recSection) newChildren.push(recSection);
      } else {
        // Prefs disabled — clean up any existing recommendations section
        const oldRec = keptSyntheticSections['recommendations'];
        if (oldRec) {
          delete newNodeMap[oldRec.node.id];
          delete newNodeTextStates[oldRec.node.id];
          for (const child of oldRec.editedChildren) {
            delete newContentBoxStates[child.id];
            delete newSegments[child.id];
            delete newNodeMap[child.id];
          }
        }
      }

      // --- Guidelines Section ---
      if (userPrefs.guidelines) {
        const guideItems = [];
        for (let i = 0; i < impressionItems.length; i++) {
          const item = impressionItems[i];
          if (item.guideline && item.guideline.trim()) {
            guideItems.push({
              text: item.guideline.trim(),
              sourceId: impressionBoxIds[i] || null,
            });
          }
        }
        const guideSection = createSyntheticSection(
          'guidelines', 'Guidelines', guideItems,
          keptSyntheticSections['guidelines'] || null
        );
        if (guideSection) newChildren.push(guideSection);
      } else {
        // Prefs disabled — clean up any existing guidelines section
        const oldGuide = keptSyntheticSections['guidelines'];
        if (oldGuide) {
          delete newNodeMap[oldGuide.node.id];
          delete newNodeTextStates[oldGuide.node.id];
          for (const child of oldGuide.editedChildren) {
            delete newContentBoxStates[child.id];
            delete newSegments[child.id];
            delete newNodeMap[child.id];
          }
        }
      }

      // Replace the impression headline's children and update childrenId
      impressionHeadline.children = newChildren;
      impressionHeadline.childrenId = newChildren.map((c) => c.id);

      const recCount = newChildren.filter((c) => c.syntheticSectionType === 'recommendations').length;
      const guideCount = newChildren.filter((c) => c.syntheticSectionType === 'guidelines').length;
      console.log(`[applyImpressionResults] Run ${runId}: ${impressionItems.length} items, ${removedIds.length} removed, ${newChildren.length} final children (rec sections: ${recCount}, guide sections: ${guideCount})`);

      // Build reverse lookup: report body box ID → impression box IDs that reference it
      const impressionSourceMap = {};
      for (const [boxId, box] of Object.entries(newContentBoxStates)) {
        if (box.impressionGenerated && box.sourceContentBoxIds?.length > 0) {
          for (const srcId of box.sourceContentBoxIds) {
            if (!impressionSourceMap[srcId]) impressionSourceMap[srcId] = [];
            impressionSourceMap[srcId].push(boxId);
          }
        }
      }

      return {
        templateNodes: newNodes,
        nodeMap: newNodeMap,
        contentBoxStates: newContentBoxStates,
        nodeTextStates: newNodeTextStates,
        segments: newSegments,
        impressionRunId: runId,
        impressionSourceMap,
      };
    });
  },

  /**
   * Insert a new finding content box into the template tree.
   * Position: above normal findings, below previously inserted Pass 2 findings.
   *
   * @param {string} parentSectionId - Section/subsection ID where the finding belongs
   * @param {string[]} sourceSegmentIds - Full dictation segment IDs that produced this finding
   * @param {string} findingText - The finding text to insert
   * @param {string} runId - Pass 2 run ID for traceability
   */
  insertFindingContentBox: (parentSectionId, sourceSegmentIds, findingText, runId) => {
    set((state) => {
      const newId = `content_pass2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newNode = {
        id: newId,
        type: 'content',
        text: findingText,
        children: [],
        pass2Inserted: true,
        // Flat node fields for nodeMap consistency
        typeAttribute: [],
        typeData: {},
        parentId: parentSectionId,
        childrenId: [],
        orderIndex: 0, // Will be set after insertion
        misc: {},
      };

      // Deep clone and insert at the correct position within the parent section
      const newNodes = cloneNodes(state.templateNodes);
      const newNodeMap = buildNodeMapFromTree(newNodes);

      function insertInSection(nodes) {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === parentSectionId) {
            const children = nodes[i].children || [];

            // Find insertion point: after last Pass 2-inserted content,
            // before normal findings
            let insertIdx = 0;
            for (let j = 0; j < children.length; j++) {
              const child = children[j];
              const childBox = state.contentBoxStates[child.id];
              if (child.type === 'content' && childBox?.pass2Inserted) {
                insertIdx = j + 1;
              }
            }

            // If no Pass 2 boxes found, insert at position 0 (before normals)
            children.splice(insertIdx, 0, newNode);
            nodes[i].children = children;

            // Update parent's childrenId and new node's orderIndex
            nodes[i].childrenId = children.map((c) => c.id);
            newNode.orderIndex = insertIdx;

            // Register in nodeMap
            newNodeMap[newId] = newNode;
            return true;
          }
          if (nodes[i].children?.length) {
            if (insertInSection(nodes[i].children)) return true;
          }
        }
        return false;
      }

      insertInSection(newNodes);

      // Create a sanitized segment for the finding text
      const findingSegmentId = generateId('seg');
      const findingSegment = {
        segmentId: findingSegmentId,
        textareaTarget: newId,
        startOffset: 0,
        endOffset: findingText.length,
        length: findingText.length,
        text: findingText,
        status: 'sanitized',
        sourceActionId: null,
      };

      return {
        templateNodes: newNodes,
        nodeMap: newNodeMap,
        contentBoxStates: {
          ...state.contentBoxStates,
          [newId]: {
            contentBoxId: newId,
            currentText: findingText,
            version: 0,
            manuallyEdited: false,
            deleted: false,
            inputType: 'text',
            options: null,
            selectedOptionIndex: 0,
            defaultOptionIndex: 0,
            pass2Inserted: true,
            sourceSegmentIds: sourceSegmentIds,
            pass2RunId: runId,
            suppressedBySegmentIds: [],
          },
        },
        segments: {
          ...state.segments,
          [newId]: [findingSegment],
        },
      };
    });
  },

  /**
   * Soft-delete a normal finding content box, tracking which segment caused it.
   *
   * @param {string} normalId - Content box ID of the normal finding
   * @param {string} bySegmentId - Segment ID responsible for the suppression
   */
  softDeleteNormal: (normalId, bySegmentId) => {
    set((state) => {
      const box = state.contentBoxStates[normalId];
      if (!box) return state;

      const existingIds = box.suppressedBySegmentIds || [];
      const newIds = existingIds.includes(bySegmentId)
        ? existingIds
        : [...existingIds, bySegmentId];

      return {
        contentBoxStates: {
          ...state.contentBoxStates,
          [normalId]: {
            ...box,
            deleted: true,
            suppressedBySegmentIds: newIds,
          },
        },
      };
    });
  },

  /**
   * Restore a normal finding by removing a segment from its suppression list.
   * Only un-deletes if ALL suppressing segments have been removed.
   *
   * @param {string} normalId - Content box ID of the normal finding
   * @param {string} bySegmentId - Segment ID being removed from suppression
   */
  restoreNormal: (normalId, bySegmentId) => {
    set((state) => {
      const box = state.contentBoxStates[normalId];
      if (!box) return state;

      const newIds = (box.suppressedBySegmentIds || []).filter((id) => id !== bySegmentId);
      const shouldRestore = newIds.length === 0;

      return {
        contentBoxStates: {
          ...state.contentBoxStates,
          [normalId]: {
            ...box,
            deleted: shouldRestore ? false : box.deleted,
            suppressedBySegmentIds: newIds,
          },
        },
      };
    });
  },

  /**
   * Partially edit a normal finding's text (Phase 5.1: Partial Normal Editing).
   * Updates currentText while preserving originalText for future rollback.
   * The normal remains visible (NOT deleted) — only its text changes.
   *
   * @param {string} normalId - Content box ID of the normal finding
   * @param {string} newText - The replacement text for the normal
   * @param {string} bySegmentId - Segment ID responsible for the edit
   */
  editNormalText: (normalId, newText, bySegmentId) => {
    set((state) => {
      const box = state.contentBoxStates[normalId];
      if (!box) return state;

      const existingEditors = box.editedBySegmentIds || [];
      const newEditors = existingEditors.includes(bySegmentId)
        ? existingEditors
        : [...existingEditors, bySegmentId];

      return {
        contentBoxStates: {
          ...state.contentBoxStates,
          [normalId]: {
            ...box,
            currentText: newText,
            version: box.version + 1,
            editedBySegmentIds: newEditors,
            // NOT setting deleted: true — partial edit keeps the normal visible
          },
        },
      };
    });
  },

  /**
   * Restore a partially-edited normal by removing a segment from its edit list.
   * If no more segments are editing this normal, revert to originalText.
   *
   * @param {string} normalId - Content box ID of the normal finding
   * @param {string} bySegmentId - Segment ID being removed from edit tracking
   */
  restoreNormalText: (normalId, bySegmentId) => {
    set((state) => {
      const box = state.contentBoxStates[normalId];
      if (!box) return state;

      const newEditors = (box.editedBySegmentIds || []).filter((id) => id !== bySegmentId);
      const shouldRestore = newEditors.length === 0;

      return {
        contentBoxStates: {
          ...state.contentBoxStates,
          [normalId]: {
            ...box,
            currentText: shouldRestore ? box.originalText : box.currentText,
            version: box.version + 1,
            editedBySegmentIds: newEditors,
          },
        },
      };
    });
  },

  /**
   * Rollback all findings inserted by a given segment and restore suppressed normals.
   * Called when a "structured" segment goes "dirty" or is deleted.
   *
   * @param {string} segmentId - The segment ID being rolled back
   */
  rollbackSegmentFindings: (segmentId) => {
    set((state) => {
      const newNodes = cloneNodes(state.templateNodes);
      const newContentBoxStates = { ...state.contentBoxStates };

      // 1. Find and remove Pass 2-inserted content boxes from this segment
      //    (only if not manually edited by the user)
      const boxesToRemove = [];
      for (const [boxId, box] of Object.entries(newContentBoxStates)) {
        if (box.pass2Inserted &&
            (box.sourceSegmentIds || []).includes(segmentId) &&
            !box.manuallyEdited) {
          boxesToRemove.push(boxId);
        }
      }

      // Remove from template tree
      function removeFromTree(nodes) {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (boxesToRemove.includes(nodes[i].id)) {
            // Update parent's childrenId if available
            nodes.splice(i, 1);
          } else if (nodes[i].children?.length) {
            removeFromTree(nodes[i].children);
          }
        }
      }
      removeFromTree(newNodes);

      // Rebuild nodeMap from the mutated tree
      const newNodeMap = buildNodeMapFromTree(newNodes);

      // Remove from content box states
      for (const boxId of boxesToRemove) {
        delete newContentBoxStates[boxId];
      }

      // 2. Restore any normals that were suppressed by this segment
      for (const [boxId, box] of Object.entries(newContentBoxStates)) {
        if ((box.suppressedBySegmentIds || []).includes(segmentId)) {
          const newIds = box.suppressedBySegmentIds.filter((id) => id !== segmentId);
          newContentBoxStates[boxId] = {
            ...box,
            suppressedBySegmentIds: newIds,
            deleted: newIds.length === 0 ? false : box.deleted,
          };
        }
      }

      // 3. Restore partially-edited normals (Phase 5.1)
      for (const [boxId, box] of Object.entries(newContentBoxStates)) {
        if ((box.editedBySegmentIds || []).includes(segmentId)) {
          const newEditors = box.editedBySegmentIds.filter((id) => id !== segmentId);
          newContentBoxStates[boxId] = {
            ...newContentBoxStates[boxId],  // Use latest state (may have been updated in step 2)
            editedBySegmentIds: newEditors,
            currentText: newEditors.length === 0
              ? (newContentBoxStates[boxId].originalText || box.originalText)
              : newContentBoxStates[boxId].currentText,
            version: (newContentBoxStates[boxId].version || box.version) + 1,
          };
        }
      }

      console.log(`[Pass2 Rollback] Segment ${segmentId}: removed ${boxesToRemove.length} findings, checked normals/edits`);

      return {
        templateNodes: newNodes,
        nodeMap: newNodeMap,
        contentBoxStates: newContentBoxStates,
      };
    });
  },

  /**
   * Roll back a segment's findings AND all co-participants, then re-mark
   * co-participant segments as 'sanitized' for Pass 2 replay.
   *
   * A co-participant is any segment that edited or suppressed the same normal
   * content boxes as the given segment. When one participant is removed, the
   * others' effects must be re-evaluated because the normal text may have
   * changed.
   *
   * Phase 5.1: Enhanced rollback with co-participant replay.
   *
   * @param {string} segmentId - The segment being rolled back
   */
  rollbackWithCoParticipantReplay: (segmentId) => {
    // 1. Find co-participants BEFORE any rollback (tracking arrays still intact)
    const state = get();
    const coParticipants = new Set();

    for (const box of Object.values(state.contentBoxStates)) {
      const editors = box.editedBySegmentIds || [];
      const suppressors = box.suppressedBySegmentIds || [];
      const allRelated = [...editors, ...suppressors];

      if (allRelated.includes(segmentId)) {
        for (const other of allRelated) {
          if (other !== segmentId) {
            coParticipants.add(other);
          }
        }
      }
    }

    // 2. Roll back the primary segment
    get().rollbackSegmentFindings(segmentId);

    // 3. Roll back co-participants and re-mark as 'sanitized'
    if (coParticipants.size > 0) {
      console.log(`[Pass2 Rollback] Co-participant rollback: segment ${segmentId} has ${coParticipants.size} co-participant(s): [${[...coParticipants].join(', ')}]`);

      for (const coSegId of coParticipants) {
        get().rollbackSegmentFindings(coSegId);
      }

      // Re-mark co-participant segments as 'sanitized' so Pass 2 replays them
      set((s) => {
        const dictSegs = s.segments['dictation-box'] || [];
        const toReSanitize = [];
        for (const coSegId of coParticipants) {
          const seg = dictSegs.find((seg) => seg.segmentId === coSegId);
          if (seg && seg.status === 'structured') {
            toReSanitize.push(coSegId);
          }
        }

        if (toReSanitize.length === 0) return s;

        console.log(`[Pass2 Rollback] Re-queued ${toReSanitize.length} co-participant segment(s) as 'sanitized' for replay`);

        return {
          segments: {
            ...s.segments,
            'dictation-box': dictSegs.map((seg) =>
              toReSanitize.includes(seg.segmentId)
                ? { ...seg, status: 'sanitized' }
                : seg
            ),
          },
        };
      });
    }
  },

  toggleQALog: () => set((state) => ({ qaLogCollapsed: !state.qaLogCollapsed })),

  // --- Phase 2: Active Report Document ---

  /**
   * Build the Active Report Document on demand from current store state.
   * This is a read-only snapshot — not stored persistently.
   *
   * @param {object} [sessionOverrides] - Optional overrides for session metadata
   * @returns {object} The Active Report Document (JSON-serializable)
   */
  getActiveReport: (sessionOverrides = {}) => {
    const s = get();
    return createActiveReport({
      templateData: s.templateData,
      templateNodes: s.templateNodes,
      contentBoxStates: s.contentBoxStates,
      nodeTextStates: s.nodeTextStates,
      segments: s.segments,
      tokenUsage: s.tokenUsage,
      dictationText: s.dictationText,
      sessionMeta: {
        reportId: s.sessionId,
        sessionId: s.sessionId,
        status: 'in-progress',
        createdAt: s.lastSavedAt ?? new Date().toISOString(),
        ...sessionOverrides,
      },
    });
  },

  /**
   * Restore a saved session from a snapshot.
   * Populates all existing store fields from the decomposed snapshot.
   *
   * @param {object} snapshot - A saved Active Report Document
   */
  loadSession: (snapshot) => {
    const restored = restoreStoreFromSnapshot(snapshot);
    if (!restored) {
      console.error('[loadSession] Failed to restore snapshot');
      return;
    }

    const segments = restored.segments;
    // Ensure dictation-box segment bucket exists
    if (!segments['dictation-box']) {
      segments['dictation-box'] = [];
    }

    // Build a clean rawTemplateData by stripping dynamically-injected nodes
    // (impression items, Pass 2 insertions, synthetic sections) from the
    // restored tree. This ensures resetSession produces a pristine template.
    const cleanNodes = stripDynamicNodes(
      cloneNodes(restored.templateNodes),
      restored.contentBoxStates
    );
    const cleanTemplateData = {
      ...restored.templateData,
      nodes: cleanNodes,
    };

    // Rebuild impressionSourceMap from restored contentBoxStates
    const impressionSourceMap = {};
    for (const [boxId, box] of Object.entries(restored.contentBoxStates)) {
      if (box.impressionGenerated && box.sourceContentBoxIds?.length > 0) {
        for (const srcId of box.sourceContentBoxIds) {
          if (!impressionSourceMap[srcId]) impressionSourceMap[srcId] = [];
          impressionSourceMap[srcId].push(boxId);
        }
      }
    }

    set({
      templateData: restored.templateData,
      templateNodes: restored.templateNodes,
      nodeMap: restored.nodeMap,
      contentBoxStates: restored.contentBoxStates,
      nodeTextStates: restored.nodeTextStates,
      segments,
      tokenUsage: restored.tokenUsage,
      dictationText: restored.dictationText,
      rawTemplateData: cleanTemplateData,
      sessionId: restored.sessionMeta.sessionId || generateReportId(),
      lastSavedAt: restored.sessionMeta.updatedAt || null,
      hasUnsavedChanges: false,
      impressionSourceMap,
    });

    console.log(`[loadSession] Restored session ${restored.sessionMeta.sessionId}, ` +
      `${Object.keys(restored.contentBoxStates).length} content boxes, ` +
      `${Object.keys(restored.nodeTextStates).length} structural nodes`);
  },

  /**
   * Mark the session as saved. Sets hasUnsavedChanges = false, records timestamp.
   *
   * @param {string} [timestamp] - ISO timestamp of the save (defaults to now)
   */
  markSaved: (timestamp) => {
    set({
      hasUnsavedChanges: false,
      lastSavedAt: timestamp ?? new Date().toISOString(),
    });
  },

  resetSession: () => {
    const { templateData, rawTemplateData } = get();
    if (!templateData) return;
    // Use rawTemplateData (pristine original) for a truly clean reset.
    // templateData.nodes may contain dynamically-injected impression nodes,
    // synthetic recommendation/guideline sections, etc. that should NOT survive a reset.
    const sourceNodes = rawTemplateData?.nodes ?? templateData.nodes;
    const nodes = cloneNodes(sourceNodes);
    const nodeMap = buildNodeMapFromTree(nodes);
    const states = initContentBoxStates(nodes, nodeMap);

    // Clean up services
    clearCaretPositions();
    cancelAllTimers();

    set({
      templateNodes: nodes,
      nodeMap,
      contentBoxStates: states,
      nodeTextStates: initNodeTextStates(nodeMap),
      // Phase 2: reset session state
      sessionId: generateReportId(),
      lastSavedAt: null,
      hasUnsavedChanges: false,
      activeTextareaId: null,
      focusedTextareaId: null,
      caretVersion: 0,
      qaLog: [],
      asrStatus: 'idle',
      interimText: '',
      dictationText: '',
      asrError: null,
      // Phase 3: clear action queue state
      actionQueue: [],
      segments: initContentBoxSegments(states),
      typingLocked: false,
      // Phase 4: clear Pass 1 state
      openFragments: {},
      pass1Status: 'idle',
      // Phase 5: clear Pass 2 state
      pass2Status: 'idle',
      // Phase 6: clear Impression state
      impressionStatus: 'idle',
      impressionRunId: null,
      // Undo/Redo: clear action log and stacks
      actionLog: [],
      undoStack: [],
      redoStack: [],
      // Token usage: reset all counters
      tokenUsage: {
        pass1:      { inputTokens: 0, outputTokens: 0 },
        pass2a:     { inputTokens: 0, outputTokens: 0 },
        pass2b:     { inputTokens: 0, outputTokens: 0 },
        impression: { inputTokens: 0, outputTokens: 0 },
      },
      // Provenance: clear ephemeral highlight state
      provenanceHighlightSegmentIds: [],
      provenanceHighlightContentBoxIds: [],
      impressionSourceMap: {},
      // Note: impressionPrefs and priorImpressionSamples are user-level
      // preferences stored in useUserStore — NOT reset on session reset.
    });
  },

  // Add a blank content node after a given node within a parent
  addContentNode: (parentId, afterNodeId) => {
    set((state) => {
      const newId = `content_user_${Date.now()}`;

      // Deep clone and insert
      const newNodes = cloneNodes(state.templateNodes);

      // Determine parent by finding the afterNode's parent in the cloned tree
      let resolvedParentId = null;
      const newNode = {
        id: newId,
        type: 'content',
        text: '',
        children: [],
        // Flat node fields
        typeAttribute: [],
        typeData: {},
        parentId: null, // Will be set after insertion
        childrenId: [],
        orderIndex: 0,  // Will be set after insertion
        misc: {},
      };

      function insertAfter(nodes, currentParentId) {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === afterNodeId) {
            nodes.splice(i + 1, 0, newNode);
            resolvedParentId = currentParentId;
            newNode.parentId = currentParentId;
            newNode.orderIndex = i + 1;
            return true;
          }
          if (nodes[i].children?.length) {
            if (insertAfter(nodes[i].children, nodes[i].id)) return true;
          }
        }
        return false;
      }

      insertAfter(newNodes, null);

      // Rebuild nodeMap from the mutated tree
      const newNodeMap = buildNodeMapFromTree(newNodes);

      return {
        templateNodes: newNodes,
        nodeMap: newNodeMap,
        contentBoxStates: {
          ...state.contentBoxStates,
          [newId]: {
            contentBoxId: newId,
            currentText: '',
            version: 0,
            manuallyEdited: false,
            deleted: false,
            inputType: 'text',
            options: null,
            selectedOptionIndex: 0,
            defaultOptionIndex: 0,
          },
        },
      };
    });
  },

  // Remove a user-added node
  removeNode: (nodeId) => {
    set((state) => {
      const newNodes = cloneNodes(state.templateNodes);

      function removeFromTree(nodes) {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === nodeId) {
            nodes.splice(i, 1);
            return true;
          }
          if (nodes[i].children?.length) {
            if (removeFromTree(nodes[i].children)) return true;
          }
        }
        return false;
      }

      removeFromTree(newNodes);

      // Rebuild nodeMap from the mutated tree
      const newNodeMap = buildNodeMapFromTree(newNodes);

      const newStates = { ...state.contentBoxStates };
      delete newStates[nodeId];

      return {
        templateNodes: newNodes,
        nodeMap: newNodeMap,
        contentBoxStates: newStates,
      };
    });
  },
}));

export default useReportStore;

// Dev-only: expose store for console testing
if (import.meta.env.DEV) {
  window.__reportStore = useReportStore;
}
