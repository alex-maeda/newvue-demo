/**
 * LLM Client Abstraction — AWS Bedrock
 *
 * Uses @aws-sdk/client-bedrock-runtime with InvokeModelCommand.
 * Model-agnostic: supports any Bedrock model by changing env vars.
 *
 * AWS credentials resolved via default credential chain.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

class BedrockLLMClient {
  /**
   * @param {string} region - AWS region
   * @param {string} defaultModel - Default Bedrock model ID
   */
  constructor(region = 'us-east-1', defaultModel = 'us.anthropic.claude-haiku-4-5-20251001-v1:0') {
    this.defaultModel = defaultModel;
    this.region = region;

    try {
      this.client = new BedrockRuntimeClient({ region });
      console.log(`[LLMClient] Bedrock initialized — region: ${region}, model: ${defaultModel}`);
    } catch (err) {
      this.client = null;
      console.warn('[LLMClient] Failed to initialize Bedrock client:', err.message);
    }
  }

  /**
   * Check if the Bedrock client is configured and ready.
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.client;
  }

  /**
   * Send a completion request via Bedrock.
   *
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User message content
   * @param {object} [options] - Optional configuration
   * @param {number} [options.temperature=0] - Sampling temperature
   * @param {number} [options.maxTokens=1024] - Maximum tokens in response
   * @param {string} [options.model] - Override the default model
   * @returns {Promise<{text: string, usage: {inputTokens: number, outputTokens: number}}>}
   */
  async complete(systemPrompt, userPrompt, options = {}) {
    if (!this.client) {
      throw new Error('Bedrock client not initialized');
    }

    const {
      temperature = 0,
      maxTokens = 1024,
      model = this.defaultModel,
    } = options;

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    });

    const command = new InvokeModelCommand({
      modelId: model,
      body,
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const rawText = responseBody.content?.[0]?.text?.trim() || '';

    const usage = {
      inputTokens: responseBody.usage?.input_tokens ?? 0,
      outputTokens: responseBody.usage?.output_tokens ?? 0,
    };

    return { text: rawText, usage };
  }

  /**
   * Parse a JSON response, stripping markdown fences if present.
   *
   * @param {string} rawText - Raw text response from complete()
   * @returns {object|null} Parsed JSON object, or null if parsing fails
   */
  parseJSON(rawText) {
    if (!rawText) return null;

    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
      cleaned = cleaned.replace(/\n?```\s*$/, '');
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn('[LLMClient] JSON parse failed:', e.message);
      console.warn('[LLMClient] Raw response:', rawText.slice(0, 500));
      return null;
    }
  }
}

// Singleton instance — reads config from environment
export const claudeClient = new BedrockLLMClient(
  process.env.AWS_REGION || 'us-east-1',
  process.env.BEDROCK_MODEL_ID || process.env.PASS1_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
);

export default claudeClient;
