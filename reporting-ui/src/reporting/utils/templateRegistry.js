/**
 * templateRegistry.js — Maps study descriptions to template file IDs.
 *
 * The study description (from encounter_metadata.json) is the key,
 * and the template ID (JSON filename without extension in config/templates/)
 * is the value.
 *
 * Used by ReportingPanel to dynamically load the correct template when
 * the radiologist selects a "current exam" from the cockpit dropdown.
 */

const STUDY_TO_TEMPLATE = {
  'MR Brain without Contrast':            'MRI_brain_without_contrast',
  'MR Brain with Contrast':               'MRI_brain_with_contrast',
  'XR Chest – PA and Lateral':            'XR_chest_PA_lateral',
  'XR Chest – PA Only':                   'XR_chest_PA_only',
  'CT Abdomen Pelvis with Contrast':      'CT_abdomen_pelvis_with_IV_contrast',
  'CT Head without Contrast':             'CT_head_without_contrast',
  'CT Chest with Contrast':               'CT_chest_with_contrast',
  'US Abdomen Complete':                  'US_abdomen_complete',
  'US Breast Limited Left':               'US_breast_limited_left',
  'XR Foot 2 Views – Right':              'XR_foot_2_views_right',
  'US Doppler Extremity Artery Right':    'US_doppler_extremity_artery_right',
  'MG Breast Bilateral Screening':        'MG_breast_bilateral_screening',
};

/** Default template if no mapping is found */
const DEFAULT_TEMPLATE = 'MRI_brain_without_contrast';

/**
 * Resolve the template file ID for a given study description.
 *
 * @param {string} studyDescription — e.g. "MR Brain without Contrast"
 * @returns {string} — template file ID, e.g. "MRI_brain_without_contrast"
 */
export function getTemplateIdForStudy(studyDescription) {
  if (!studyDescription) return DEFAULT_TEMPLATE;
  return STUDY_TO_TEMPLATE[studyDescription] ?? DEFAULT_TEMPLATE;
}

export default STUDY_TO_TEMPLATE;
