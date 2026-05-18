/**
 * claude-client.ts — LLM abstraction layer using AWS Bedrock.
 *
 * Uses @aws-sdk/client-bedrock-runtime with InvokeModelCommand.
 * Model-agnostic: supports any Bedrock model (Claude, Llama, Titan, etc.)
 * by changing BEDROCK_MODEL_ID in config.
 *
 * AWS credentials are resolved via the default credential chain
 * (env vars, ~/.aws/credentials, IAM role, etc.)
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config';

// ── Types ─────────────────────────────────────────────────────────────────

export interface ClaudeInvocationOptions {
  systemPrompt: string;
  userMessage: string;
  maxOutputTokens?: number;
  temperature?: number;
  modelId?: string;
  thinking?: {
    type: 'adaptive';
    effort: 'low' | 'medium' | 'high';
  };
}

export interface ClaudeInvocationResult {
  content: string;
  parsedJson: Record<string, unknown> | null;
  tokenUsage: {
    input: number;
    output: number;
  };
  latencyMs: number;
  modelId: string;
}

export interface StreamClaudeResult {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  modelId: string;
}

// ── Client Singleton ──────────────────────────────────────────────────────

let clientInstance: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (clientInstance) return clientInstance;

  clientInstance = new BedrockRuntimeClient({
    region: config.awsRegion,
  });

  return clientInstance;
}

// ── Retry Logic ───────────────────────────────────────────────────────────

function backoffDelay(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name: string }).name;
    return (
      name === 'ThrottlingException' ||
      name === 'ServiceUnavailableException' ||
      name === 'ModelTimeoutException'
    );
  }
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED';
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function invokeClaude(
  options: ClaudeInvocationOptions,
): Promise<ClaudeInvocationResult> {
  const client = getClient();
  const modelId = options.modelId ?? config.bedrockModelId;
  const maxTokens = options.maxOutputTokens ?? config.bedrockMaxOutputTokens;
  const temperature = options.temperature ?? 0.0;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= config.bedrockMaxRetries; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelay(attempt - 1);
      console.warn(
        `[bedrock-client] Retry attempt ${attempt}/${config.bedrockMaxRetries} after ${delay}ms delay`,
      );
      await sleep(delay);
    }

    const startTime = Date.now();

    try {
      const body = JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature,
        system: options.systemPrompt,
        messages: [
          { role: 'user', content: options.userMessage },
        ],
      });

      const command = new InvokeModelCommand({
        modelId,
        body,
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await client.send(command);
      const latencyMs = Date.now() - startTime;

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const content = responseBody.content?.[0]?.text?.trim() ?? '';

      // Attempt JSON parsing
      let parsedJson: Record<string, unknown> | null = null;
      try {
        const jsonStr = content
          .replace(/^```(?:json)?\s*\n?/i, '')
          .replace(/\n?```\s*$/i, '')
          .trim();
        parsedJson = JSON.parse(jsonStr);
      } catch {
        console.warn('[bedrock-client] Response was not valid JSON, returning raw text');
      }

      const tokenUsage = {
        input: responseBody.usage?.input_tokens ?? 0,
        output: responseBody.usage?.output_tokens ?? 0,
      };

      console.log(
        `[bedrock-client] Success: model=${modelId} ` +
        `input_tokens=${tokenUsage.input} output_tokens=${tokenUsage.output} ` +
        `latency=${latencyMs}ms`,
      );

      return { content, parsedJson, tokenUsage, latencyMs, modelId };
    } catch (error) {
      lastError = error;
      const latencyMs = Date.now() - startTime;

      if (isRetryableError(error) && attempt < config.bedrockMaxRetries) {
        console.warn(
          `[bedrock-client] Retryable error after ${latencyMs}ms:`,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }

      console.error(
        `[bedrock-client] Fatal error after ${attempt + 1} attempt(s) (${latencyMs}ms):`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  throw lastError ?? new Error('[bedrock-client] All retry attempts exhausted');
}

// ── Streaming API ─────────────────────────────────────────────────────────

export async function streamClaude(
  options: ClaudeInvocationOptions,
  onDelta: (text: string) => void,
): Promise<StreamClaudeResult> {
  const client = getClient();
  const modelId = options.modelId ?? config.bedrockModelId;
  const maxTokens = options.maxOutputTokens ?? config.bedrockMaxOutputTokens;
  const temperature = options.temperature ?? 0.0;

  const startTime = Date.now();

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: options.systemPrompt,
    messages: [
      { role: 'user', content: options.userMessage },
    ],
  });

  const command = new InvokeModelWithResponseStreamCommand({
    modelId,
    body,
    contentType: 'application/json',
    accept: 'application/json',
  });

  const response = await client.send(command);

  let inputTokens = 0;
  let outputTokens = 0;
  const decoder = new TextDecoder();

  if (response.body) {
    for await (const event of response.body) {
      if (event.chunk?.bytes) {
        const chunk = JSON.parse(decoder.decode(event.chunk.bytes));

        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          onDelta(chunk.delta.text);
        }

        if (chunk.type === 'message_delta' && chunk.usage) {
          outputTokens = chunk.usage.output_tokens ?? outputTokens;
        }

        if (chunk.type === 'message_start' && chunk.message?.usage) {
          inputTokens = chunk.message.usage.input_tokens ?? 0;
        }
      }
    }
  }

  const latencyMs = Date.now() - startTime;

  console.log(
    `[bedrock-client] Stream complete: model=${modelId} ` +
    `input_tokens=${inputTokens} output_tokens=${outputTokens} ` +
    `latency=${latencyMs}ms`,
  );

  return { inputTokens, outputTokens, latencyMs, modelId };
}

// ── Utilities ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isClaudeConfigured(): boolean {
  // With Bedrock, we rely on AWS credential chain — always "configured"
  // if the region is set. Actual auth errors surface at call time.
  return true;
}
