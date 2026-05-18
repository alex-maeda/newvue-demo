import path from 'path';
import dotenv from 'dotenv';

// Load .env — search upward from server/src/ to find it
// tsx (dev): __dirname = apps/server/src/ → ../../../.env = newvue-demo/.env
// node (prod): __dirname = dist/ → ../../.env = newvue-demo/.env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Server configuration.
 *
 * All paths are resolved relative to the server directory.
 * The HL7 simulation data lives one level up from the server root.
 */
export const config = {
  /** HTTP port for the Express server */
  port: parseInt(process.env.PORT || '8000', 10),

  /** Base path to the HL7_Simulation directory containing patient feeds */
  hl7SimulationPath: path.resolve(__dirname, '../HL7_Simulation'),

  /** Base path to the FHIR directory containing EHR data */
  fhirBasePath: path.resolve(__dirname, '../FHIR'),

  /** API version prefix for all routes */
  apiPrefix: '/api/v1',

  /** CORS origin whitelist (React dev server) */
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // ── AWS Bedrock Configuration ───────────────────────────────────────────

  /** AWS region for Bedrock */
  awsRegion: process.env.AWS_REGION || 'us-east-1',

  /** Bedrock model ID — supports any Bedrock-available model (Claude, Llama, Titan, etc.) */
  bedrockModelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',

  /** Model for the finding grouping pass (Tier 2 Pass 2) */
  findingGroupingModelId: process.env.FINDING_GROUPING_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',

  /** Maximum retry attempts for failed Bedrock API calls */
  bedrockMaxRetries: parseInt(process.env.BEDROCK_MAX_RETRIES || '3', 10),

  /** Maximum output tokens per Bedrock API call */
  bedrockMaxOutputTokens: parseInt(process.env.BEDROCK_MAX_OUTPUT_TOKENS || '4096', 10),

  // ── Reporting Config Paths ────────────────────────────────────────────

  /** Path to the reporting config directory (autocorrect, ASR lists, templates, etc.) */
  reportingConfigDir: path.resolve(__dirname, '../config'),
};
