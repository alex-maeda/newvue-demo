/**
 * Quick smoke test to verify AWS Bedrock connectivity and model access.
 * Run: npx tsx scripts/test-claude.ts
 */
import { invokeClaude, isClaudeConfigured } from '../src/services/claude-client';
import { config } from '../src/config';

async function main() {
  console.log('── Bedrock API Smoke Test ──');
  console.log(`Model ID: ${config.bedrockModelId}`);
  console.log(`AWS Region: ${config.awsRegion}`);
  console.log(`Configured: ${isClaudeConfigured()}`);
  console.log('');

  try {
    console.log('Sending test prompt...');
    const result = await invokeClaude({
      systemPrompt: 'You are a helpful assistant. Respond with valid JSON only.',
      userMessage: 'Return a JSON object with a single key "status" and value "ok". Nothing else.',
      maxOutputTokens: 50,
      temperature: 0,
    });

    console.log('');
    console.log('✅ Bedrock API call succeeded!');
    console.log(`   Model: ${result.modelId}`);
    console.log(`   Latency: ${result.latencyMs}ms`);
    console.log(`   Input tokens: ${result.tokenUsage.input}`);
    console.log(`   Output tokens: ${result.tokenUsage.output}`);
    console.log(`   Response: ${result.content}`);
    console.log(`   Parsed JSON: ${JSON.stringify(result.parsedJson)}`);
  } catch (error) {
    console.error('❌ Bedrock API call failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
