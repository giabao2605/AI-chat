import test from 'node:test';
import assert from 'node:assert/strict';
import { ReasoningMemoryProfiledRoom } from '../src/reasoning-memory-room.js';

const agents = {
  a: { id: 'a', name: 'A', apiKey: 'a', model: 'gpt-5.6-luna', baseUrl: 'https://provider.example/v1' },
  b: { id: 'b', name: 'B', apiKey: 'b', model: 'gpt-5.6-luna', baseUrl: 'https://provider.example/v1' },
};

test('runtime provider wrapper attaches token anatomy without prompt plaintext', async () => {
  const room = new ReasoningMemoryProfiledRoom({
    agents,
    providerFactory: () => ({
      async streamChat(options = {}) {
        return {
          text: 'ok',
          usage: { inputTokens: 123, outputTokens: 4, totalTokens: 127, exact: true },
          toolCalls: [],
          diagnostics: { reasoningEffort: options.reasoningEffort || null },
        };
      },
    }),
  });

  room.createProviders();
  room.agentProfiles = {
    a: { name: 'A', temperature: 0.8, maxOutputTokens: 1200 },
    b: { name: 'B', temperature: 0.8, maxOutputTokens: 1200 },
  };
  room.profileTurnActive.add('a');
  const result = await room.providers.a.streamChat({
    messages: [
      { role: 'system', content: 'SECRET SYSTEM PROMPT' },
      { role: 'user', content: '<agent_memory>memory</agent_memory>' },
      { role: 'user', content: '<private_agent_context>PRIVATE SECRET</private_agent_context>' },
      { role: 'user', content: 'hello' },
    ],
    tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }],
  });
  room.profileTurnActive.delete('a');

  const profile = result.diagnostics.inputProfile;
  assert.equal(profile.reportedInputTokens, 123);
  assert.equal(profile.usageExact, true);
  assert.ok(profile.breakdown.systemAndPersona > 0);
  assert.ok(profile.breakdown.memory > 0);
  assert.ok(profile.breakdown.privateContext > 0);
  assert.ok(profile.breakdown.toolSchemas > 0);
  const serialized = JSON.stringify(profile);
  assert.equal(serialized.includes('SECRET SYSTEM PROMPT'), false);
  assert.equal(serialized.includes('PRIVATE SECRET'), false);
});
