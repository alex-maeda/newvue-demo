/**
 * Load a report template JSON file.
 * In development, templates are served from /templates/ by Vite's static server.
 * In production (future), these would come from the Express API.
 *
 * The loader handles v2 hierarchical templates by normalizing them via
 * the template adapter before returning. The caller receives a ready-to-use
 * tree structure in `data.nodes` along with template metadata.
 *
 * Supported formats:
 *   - v2 (hierarchical): has `id`, `children`, `kind: "radiology-template"`
 *   - v1 (flat, deprecated): has `template_id`, `nodes` array
 */

import { normalizeTemplateNodes, hydrateFlatNodes } from './templateAdapter';

const TEMPLATE_BASE = '/config/templates';

export async function loadTemplate(templateId = 'MRI_brain_without_contrast') {
  const url = `${TEMPLATE_BASE}/${templateId}.json`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Detect v2 format: has `children` array and `id` field (or `kind`)
    const isV2 = data.children && Array.isArray(data.children) && (data.id || data.kind);

    if (isV2) {
      // v2 hierarchical format — normalize into runtime tree
      const { tree } = normalizeTemplateNodes(data);

      return {
        templateId: data.id,
        fileTemplateId: templateId,  // file-based ID for session matching
        title: data.title,
        version: data.version,
        kind: data.kind,
        modality: data.modality,
        bodyRegion: data.bodyRegion,
        description: data.description,
        nodes: tree,
      };
    }

    // v1 flat format (deprecated fallback)
    if (!data.template_id || !data.nodes || !Array.isArray(data.nodes)) {
      throw new Error('Invalid template format: missing template_id/nodes (v1) or id/children (v2)');
    }

    const { tree } = hydrateFlatNodes(data.nodes);

    return {
      ...data,
      // Map v1 fields to consistent return shape
      templateId: data.template_id,
      title: data.study_title || data.template_id,
      nodes: tree,
    };
  } catch (error) {
    console.error('[TemplateLoader] Error loading template:', error);
    throw error;
  }
}

export default loadTemplate;
