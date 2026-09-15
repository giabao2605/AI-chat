import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ReasoningMemoryProfiledRoom } from '../src/reasoning-memory-room.js';

const agents = {
  a: { id: 'a', name: 'Luna 1', apiKey: 'a', model: 'gpt-5.6-luna', baseUrl: 'https://provider.example/v1' },
  b: { id: 'b', name: 'Luna 2', apiKey: 'b', model: 'gpt-5.6-luna', baseUrl: 'https://provider.example/v1' },
};

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function acceptedFactory(calls) {
  return (config) => ({
    async streamChat(options = {}) {
      calls.push({ agentId: config.id, ...options });
      return {
        text: 'OK',
        usage: usage(),
        toolCalls: [],
        diagnostics: {
          reasoningEffort: options.reasoningEffort || null,
          reasoningControlSupport: Boolean(options.reasoningEffort),
        },
      };
    },
  });
}

test('manual reasoning mode is strict and overrides the adaptive low baseline for main agent providers', async () => {
  const calls = [];
  const room = new ReasoningMemoryProfiledRoom({ agents, providerFactory: acceptedFactory(calls) });

  await room.setReasoningMode('high', { probe: true, emit: false });
  assert.equal(room.reasoningMode, 'high');
  assert.equal(room.reasoningCapabilitySummary().high.status, 'accepted');

  room.createProviders();
  room.agentProfiles = {
    a: { name: 'Luna 1', temperature: 0.8, maxOutputTokens: 1200 },
    b: { name: 'Luna 2', temperature: 0.8, maxOutputTokens: 1200 },
  };
  room.profileTurnActive.add('a');
  const result = await room.providers.a.streamChat({
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'low',
    adaptiveReasoning: true,
  });
  room.profileTurnActive.delete('a');

  const mainCall = calls.at(-1);
  assert.equal(mainCall.reasoningEffort, 'high');
  assert.equal(mainCall.adaptiveReasoning, false);
  assert.equal(result.diagnostics.reasoningEffort, 'high');
});

test('manual mode refuses a provider that does not preserve the selected reasoning effort', async () => {
  const room = new ReasoningMemoryProfiledRoom({
    agents,
    providerFactory: () => ({
      async streamChat() {
        return {
          text: 'fallback',
          usage: usage(),
          toolCalls: [],
          diagnostics: { reasoningEffort: null, reasoningControlSupport: false },
        };
      },
    }),
  });

  await assert.rejects(
    room.setReasoningMode('xhigh', { probe: true, emit: false }),
    /không hỗ trợ mức suy luận 'xhigh'/i,
  );
  assert.equal(room.reasoningMode, 'auto', 'failed strict probe must not silently change the room mode');
  assert.equal(room.reasoningCapabilitySummary().xhigh.status, 'unsupported');
});

test('reasoning slider exposes Auto, Low, Medium, High, XHigh, Max and omits None', async () => {
  const source = await readFile(new URL('../public/reasoning-control.js', import.meta.url), 'utf8');
  for (const value of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.match(source, new RegExp(`value: '${value}'`));
  }
  assert.doesNotMatch(source, /value:\s*['"]none['"]/i);
});
