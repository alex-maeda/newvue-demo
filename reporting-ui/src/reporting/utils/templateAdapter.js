/**
 * Template Adapter — v2 Hierarchical Template Normalization
 *
 * Normalizes the v2 hierarchical template format into the runtime
 * field conventions expected by existing rendering and service code.
 *
 * v2 Template Format (on disk):
 *   Native tree with `children` arrays. Root object has metadata fields
 *   (version, kind, id, title, modality, bodyRegion, description).
 *   Structural nodes use `title` for display text.
 *   Terminal "text" nodes use `value` for content.
 *   Terminal "dropdown" nodes use `parts` with inline picklists.
 *   All nodes use `tags` (string or array) for semantic classification.
 *
 * Normalized Format (at runtime):
 *   Same tree, augmented with backward-compat fields so existing code
 *   works without modification:
 *     - `type: "text"` → `type: "content"` (internal canonical type)
 *     - `type: "dropdown"` → `type: "content"` with `inputType: "select"`
 *     - `title` → `label` on structural nodes
 *     - `value` → `text` on terminal nodes
 *     - `tags` → `typeAttribute` (always array)
 *     - `parentId` computed and set on each child
 *     - `normalIndex` computed for normal-tagged content under Findings
 *     - Dropdown `parts` → composed default text + flattened options
 *
 * Usage:
 *   const { tree } = normalizeTemplateNodes(templateRootData);
 *   // tree is ready for cloneNodes() → templateNodes in the store
 *
 *   const nodeMap = buildNodeMapFromTree(clonedNodes);
 *   // nodeMap provides O(1) lookups and parent-chain traversal
 */

// ─── Type → Hierarchy Level Map ──────────────────────────────────────
// Used to assign rendering depth. Extensible by adding entries.
// 'content' is always terminal (placed at whatever depth its parent is + 1).

const TYPE_LEVEL_MAP = {
  headline: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  detail: 5,
};

/**
 * Types that act as structural sections (placement targets for findings, etc.).
 * Excludes 'headline' (which groups sections) and 'content' (terminal).
 * Used by pass2Service, findNearestAncestor, etc.
 */
export const SECTION_TYPES = ['section', 'subsection', 'subsubsection', 'detail'];

/**
 * Get the hierarchy level for a node type.
 * Returns the mapped level, or null for 'content' (terminal)
 * and unknown types (derived from tree depth at runtime).
 */
export function getHierarchyLevel(type) {
  if (type === 'content') return null; // terminal — level depends on tree position
  return TYPE_LEVEL_MAP[type] ?? null;
}

// ─── v2 → Runtime Normalization ──────────────────────────────────────

/**
 * Compose the default text for a dropdown node from its `parts` array.
 * Concatenates text values and default picklist selections into a single string.
 *
 * @param {Array} parts - The parts array from a dropdown node
 * @returns {string} The composed default text
 */
function composeDropdownDefaultText(parts) {
  if (!parts?.length) return '';
  return parts.map((part) => {
    if (part.type === 'text') return part.value ?? '';
    if (part.type === 'picklist') {
      const idx = part.defaultIndex ?? 0;
      return part.options?.[idx] ?? '';
    }
    return '';
  }).join('');
}

/**
 * Extract a flat options array from a dropdown node's parts.
 * Returns all picklist options, each with a value key, for backward compat
 * with the v1 DropdownBox/initContentBoxStates pattern.
 *
 * For v2 dropdown nodes with inline picklists, the "options" concept is
 * more complex (multiple picklists per node). This extracts options from
 * the FIRST picklist only, for backward compat with the single-select
 * dropdown pattern. Full multi-picklist support is handled by the
 * node.parts structure directly.
 *
 * @param {Array} parts - The parts array from a dropdown node
 * @returns {{ options: Array, defaultOptionIndex: number }}
 */
function extractDropdownOptions(parts) {
  if (!parts?.length) return { options: [], defaultOptionIndex: 0 };

  // Find the first picklist for backward-compat options
  const firstPicklist = parts.find((p) => p.type === 'picklist');
  if (!firstPicklist) return { options: [], defaultOptionIndex: 0 };

  const options = (firstPicklist.options || []).map((opt) => ({
    value: typeof opt === 'string' ? opt : opt.value ?? '',
  }));

  return {
    options,
    defaultOptionIndex: firstPicklist.defaultIndex ?? 0,
  };
}

/**
 * Compute picklist offset information for a dropdown node.
 * Returns an array of picklist descriptors with start/end character offsets.
 *
 * @param {Array} parts - The parts array from a dropdown node
 * @returns {Array} Picklist descriptors: [{ partIndex, startOffset, endOffset, selectedIndex, active }]
 */
function computePicklistOffsets(parts) {
  if (!parts?.length) return [];

  const picklists = [];
  let offset = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type === 'text') {
      offset += (part.value ?? '').length;
    } else if (part.type === 'picklist') {
      const defaultIdx = part.defaultIndex ?? 0;
      const defaultText = part.options?.[defaultIdx] ?? '';
      picklists.push({
        partIndex: i,
        startOffset: offset,
        endOffset: offset + defaultText.length,
        selectedIndex: defaultIdx,
        active: true,
      });
      offset += defaultText.length;
    }
  }

  return picklists;
}

/**
 * Normalize a v2 hierarchical template into the runtime format.
 *
 * Walks the tree from the root document's `children` array and applies
 * field mappings, type conversions, and backward-compat augmentations.
 *
 * @param {object} rootDocument - The parsed v2 template JSON (root object)
 * @returns {{ tree: Array }} - tree: normalized root nodes with nested children
 */
export function normalizeTemplateNodes(rootDocument) {
  const children = rootDocument.children;
  if (!children?.length) {
    console.warn('[TemplateAdapter] No children to normalize');
    return { tree: [] };
  }

  // Counter for computing normalIndex across the Findings section
  let normalCounter = 0;
  let insideFindings = false;

  /**
   * Recursively normalize a single node and its children.
   */
  function normalizeNode(node, parentId) {
    // Determine the v2 type
    const v2Type = node.type;
    const isText = v2Type === 'text';
    const isDropdown = v2Type === 'dropdown';
    const isTerminal = isText || isDropdown;

    // --- Type mapping ---
    // Map v2 "text" and "dropdown" types to internal "content"
    const normalizedType = isTerminal ? 'content' : v2Type;

    // --- Tags normalization ---
    // v2 tags can be a string or array; normalize to array for typeAttribute compat
    let typeAttribute = [];
    if (node.tags) {
      typeAttribute = Array.isArray(node.tags) ? [...node.tags] : [node.tags];
    }

    // Track if we're inside the Findings section for normalIndex computation
    const wasInsideFindings = insideFindings;
    if (!isTerminal && typeAttribute.includes('findings')) {
      insideFindings = true;
    }

    // --- Build normalized node ---
    const normalized = {
      id: node.id,
      type: normalizedType,
      typeAttribute,
      parentId: parentId,
      children: [],
    };

    // --- Structural node fields ---
    if (!isTerminal) {
      // Map v2 `title` → backward-compat `label` and `text`
      normalized.label = node.title ?? '';
      normalized.text = node.title ?? '';
    }

    // --- Terminal text node fields ---
    if (isText) {
      // Map v2 `value` → backward-compat `text`
      normalized.text = node.value ?? '';
      normalized.inputType = 'text';

      // Compute normalIndex for normal-tagged content nodes under Findings
      if (insideFindings && typeAttribute.includes('normal')) {
        normalized.normalIndex = normalCounter++;
      }
    }

    // --- Dropdown node fields ---
    if (isDropdown) {
      const defaultText = composeDropdownDefaultText(node.parts);
      const { options, defaultOptionIndex } = extractDropdownOptions(node.parts);
      const picklists = computePicklistOffsets(node.parts);

      normalized.text = defaultText;
      normalized.inputType = 'select';
      normalized.options = options;
      normalized.defaultOptionIndex = defaultOptionIndex;

      // Preserve the full parts structure for the new DropdownBox rendering
      normalized.parts = node.parts;
      normalized.picklists = picklists;

      // Add 'dropdown' to typeAttribute for backward compat with v1 checks
      if (!typeAttribute.includes('dropdown')) {
        typeAttribute.push('dropdown');
        normalized.typeAttribute = typeAttribute;
      }

      // Compute normalIndex for normal-tagged dropdown nodes under Findings
      if (insideFindings && typeAttribute.includes('normal')) {
        normalized.normalIndex = normalCounter++;
      }
    }

    // --- Recurse into children ---
    if (node.children?.length) {
      normalized.children = node.children.map((child) =>
        normalizeNode(child, node.id)
      );
      // Set childrenId for backward compat
      normalized.childrenId = normalized.children.map((c) => c.id);
    }

    // Restore insideFindings state after processing this node's subtree.
    // When we leave the Findings section's tree, insideFindings goes back
    // to whatever it was before we entered this node.
    insideFindings = wasInsideFindings;

    return normalized;
  }

  // Normalize each root child (headline nodes)
  const tree = children.map((child) => normalizeNode(child, null));

  // Reset state
  normalCounter = 0;
  insideFindings = false;

  const totalNodes = countNodes(tree);
  console.log(
    `[TemplateAdapter] Normalized ${totalNodes} nodes → ${tree.length} root nodes`
  );

  return { tree };
}

/** Count total nodes in a tree (for logging). */
function countNodes(nodes) {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children?.length) count += countNodes(node.children);
  }
  return count;
}

// ─── Legacy Compatibility ────────────────────────────────────────────

/**
 * Hydrate a flat array of nodes into a nested tree.
 * DEPRECATED — kept for backward compatibility with any v1 templates
 * that may still be loaded. New templates use normalizeTemplateNodes().
 *
 * @param {Array} flatNodes - Array of flat node objects from JSON
 * @returns {{ tree: Array }} - tree: root nodes with nested children arrays
 */
export function hydrateFlatNodes(flatNodes) {
  if (!flatNodes?.length) {
    console.warn('[TemplateAdapter] No nodes to hydrate');
    return { tree: [] };
  }

  // 1. Build flat ID → node lookup
  const flatMap = {};
  for (const node of flatNodes) {
    if (flatMap[node.id]) {
      console.warn(`[TemplateAdapter] Duplicate node ID: ${node.id}`);
    }
    flatMap[node.id] = node;
  }

  // 2. Create hydrated node objects with backward-compat fields
  const hydratedMap = {};
  for (const node of flatNodes) {
    const hydrated = { ...node };

    // Backward compat: non-content nodes need 'label' mapped from 'text'
    // (ReportNode.jsx, pass2Service.js, impressionService.js read node.label)
    if (node.type !== 'content') {
      hydrated.label = node.text;
    }

    // Backward compat: dropdown content nodes
    // (initContentBoxStates, DropdownBox.jsx read node.inputType, node.options)
    if (node.typeAttribute?.includes('dropdown')) {
      hydrated.inputType = 'select';
      hydrated.options = node.typeData?.options || [];
      hydrated.defaultOptionIndex = node.typeData?.defaultOptionIndex ?? 0;
    }

    // Backward compat: normal finding index
    // (pass2Service.js checks node.normalIndex !== undefined)
    if (node.typeAttribute?.includes('normal') && node.typeData?.normalIndex !== undefined) {
      hydrated.normalIndex = node.typeData.normalIndex;
    }

    // Initialize children array (populated in step 3)
    hydrated.children = [];

    hydratedMap[node.id] = hydrated;
  }

  // 3. Validate parentId/childrenId bidirectional consistency and resolve children
  for (const node of flatNodes) {
    const hydrated = hydratedMap[node.id];

    // Validate parentId references an existing node
    if (node.parentId && !flatMap[node.parentId]) {
      console.warn(`[TemplateAdapter] Node ${node.id} references missing parent: ${node.parentId}`);
    }

    // Resolve childrenId into nested children array, sorted by orderIndex
    if (node.childrenId?.length) {
      hydrated.children = node.childrenId
        .map((childId) => {
          const child = hydratedMap[childId];
          if (!child) {
            console.warn(`[TemplateAdapter] Node ${node.id} references missing child: ${childId}`);
          }
          return child;
        })
        .filter(Boolean)
        .sort((a, b) => a.orderIndex - b.orderIndex);
    }
  }

  // 4. Build root array (nodes with parentId === null), sorted by orderIndex
  const tree = flatNodes
    .filter((n) => n.parentId === null)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((n) => hydratedMap[n.id]);

  console.log(
    `[TemplateAdapter] Hydrated ${flatNodes.length} flat nodes → ${tree.length} root nodes`
  );

  return { tree };
}

// ─── Node Map Builder ────────────────────────────────────────────────

/**
 * Build a flat ID → node map from a hydrated tree.
 * The map references the SAME node objects in the tree, so mutations
 * to either the tree or the map stay in sync.
 *
 * Call this AFTER cloneNodes() to ensure the map references the cloned
 * tree nodes (not the originals from the adapter).
 *
 * @param {Array} treeNodes - Root nodes of the hydrated tree
 * @returns {Object} nodeMap: { [nodeId]: hydratedNodeObject }
 */
export function buildNodeMapFromTree(treeNodes) {
  const map = {};

  function walk(nodes) {
    for (const node of nodes) {
      map[node.id] = node;
      if (node.children?.length) {
        walk(node.children);
      }
    }
  }

  walk(treeNodes);
  return map;
}

// ─── Ancestor / Parent-Chain Utilities ───────────────────────────────

/**
 * Walk the parent chain from a node up to the root, returning an array
 * of ancestor nodes in bottom-up order (immediate parent first).
 *
 * @param {string} nodeId - Starting node ID
 * @param {object} nodeMap - Flat ID → node lookup
 * @returns {Array} Ancestor nodes, bottom-up (empty if root)
 */
export function getAncestorChain(nodeId, nodeMap) {
  const ancestors = [];
  let current = nodeMap[nodeId];
  if (!current) return ancestors;

  while (current.parentId) {
    const parent = nodeMap[current.parentId];
    if (!parent) break; // orphaned parentId reference
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/**
 * Find the nearest parent of a given structural type(s).
 * Walks up from nodeId until it finds a node whose type is in `types`.
 *
 * @param {string} nodeId - Starting node ID
 * @param {object} nodeMap - Flat ID → node lookup
 * @param {string[]} types - Node types to match (e.g. ['section', 'subsection'])
 * @returns {object|null} The matched ancestor node, or null
 */
export function findNearestAncestor(nodeId, nodeMap, types) {
  const typesSet = new Set(types);
  const ancestors = getAncestorChain(nodeId, nodeMap);
  return ancestors.find((n) => typesSet.has(n.type)) || null;
}

/**
 * Check if a node is a descendant of a given ancestor (by label match on type).
 * E.g. isDescendantOfSection(nodeId, 'findings', nodeMap)
 *
 * @param {string} nodeId - Node to check
 * @param {string} ancestorLabel - Label to match (case-insensitive)
 * @param {object} nodeMap - Flat ID → node lookup
 * @returns {boolean}
 */
export function isDescendantOfLabel(nodeId, ancestorLabel, nodeMap) {
  const target = ancestorLabel.toLowerCase();
  const ancestors = getAncestorChain(nodeId, nodeMap);
  return ancestors.some(
    (n) => (n.label || n.text || '').toLowerCase() === target
  );
}

/**
 * Build the full section path for a node (top-down).
 * Returns array of label strings from root → immediate parent.
 * Only includes structural nodes (headline, section, subsection, etc.)
 *
 * @param {string} nodeId - Node to build path for
 * @param {object} nodeMap - Flat ID → node lookup
 * @returns {string[]} Path labels, top-down
 */
export function buildSectionPath(nodeId, nodeMap) {
  const ancestors = getAncestorChain(nodeId, nodeMap);
  // Filter to structural types and reverse to top-down
  return ancestors
    .filter((n) => n.type !== 'content')
    .reverse()
    .map((n) => n.label || n.text || n.id);
}

/**
 * Collect all descendant nodes of a given parent (recursive via children).
 *
 * @param {string} parentId - Parent node ID
 * @param {object} nodeMap - Flat ID → node lookup
 * @returns {Array} All descendant nodes (does NOT include the parent itself)
 */
export function getDescendants(parentId, nodeMap) {
  const parent = nodeMap[parentId];
  if (!parent) return [];

  const descendants = [];
  function walk(node) {
    for (const child of node.children || []) {
      descendants.push(child);
      walk(child);
    }
  }
  walk(parent);
  return descendants;
}
