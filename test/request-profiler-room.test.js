import test from 'node:test';
import assert from 'node:assert/strict';
import { ReasoningMemoryProfiledRoom } from '../src/reasoning-memory-room.js';

const agents = {
  a: { id: 'a', name: 'A', apiKey: 'a', model: 'gpt-5.6-luna', baseUrl: 'https://provider.example/v1' },
  b: { id: 'b', name: 'B', apiKey: 'b', model: 'gpt-5.6-luna', baseUrl: 'https://provider.example/v1' },
};

function configureProfiles(room) {
  room.agentProfiles = {
    a: { name: 'A', temperature: 0.8, maxOutputTokens: 1200 },
    b: { name: 'B', temperature: 0.8, maxOutputTokens: 1200 },
  };
}

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
  configureProfiles(room);
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

test('main agent request is budgeted before provider while helper calls keep their full context', async () => {
  const calls = [];
  const room = new ReasoningMemoryProfiledRoom({
    agents,
    contextConfig: {
      inputBudgetTokens: 240,
      budgetSafetyMargin: 0,
      imageTokenReserve: 0,
      minRecentMessages: 1,
    },
    providerFactory: () => ({
      async streamChat(options = {}) {
        calls.push(options);
        return {
          text: 'ok',
          usage: { inputTokens: 80, outputTokens: 4, totalTokens: 84, exact: true },
          toolCalls: [],
          diagnostics: { reasoningEffort: options.reasoningEffort || null },
        };
      },
    }),
  });

  room.createProviders();
  configureProfiles(room);
  room.profileTurnActive.add('a');
  const result = await room.providers.a.streamChat({
    messages: [
      { role: 'system', content: 'SYSTEM_KEEP' },
      { role: 'user', content: 'Chủ đề của phòng trò chuyện: TOPIC_KEEP' },
      { role: 'user', content: `OLD_HISTORY_MARKER ${'old '.repeat(700)}` },
      { role: 'user', content: `SECOND_OLD_MARKER ${'stale '.repeat(500)}` },
      { role: 'user', content: 'LATEST_TRIGGER_KEEP' },
    ],
    tools: [],
  });
  room.profileTurnActive.delete('a');

  const sentText = calls.at(-1).messages.map((message) => String(message.content || '')).join('\n');
  assert.match(sentText, /SYSTEM_KEEP/);
  assert.match(sentText, /TOPIC_KEEP/);
  assert.match(sentText, /LATEST_TRIGGER_KEEP/);
  assert.doesNotMatch(sentText, /OLD_HISTORY_MARKER/);
  assert.doesNotMatch(sentText, /SECOND_OLD_MARKER/);

  const budget = result.diagnostics.contextBudget;
  assert.equal(budget.enabled, true);
  assert.ok(budget.droppedCount >= 2);
  assert.ok(budget.afterEstimatedTokens <= budget.targetTokens);
  assert.equal(result.diagnostics.inputProfile.estimatedInputTokens <= budget.afterEstimatedTokens, true);

  const helperResult = await room.providers.a.streamChat({
    messages: [{ role: 'user', content: `HELPER_FULL_CONTEXT ${'keep '.repeat(700)}` }],
    tools: [],
  });
  const helperText = calls.at(-1).messages.map((message) => String(message.content || '')).join('\n');
  assert.match(helperText, /HELPER_FULL_CONTEXT/);
  assert.equal(helperResult.diagnostics.contextBudget, undefined);
});
