import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeProviderInputProfile, profileProviderInput } from '../src/request-metrics.js';

test('profiles provider input without exposing private content', () => {
  const profile = profileProviderInput([
    { role: 'system', content: 'system persona' },
    { role: 'user', content: 'Chủ đề của phòng trò chuyện: test' },
    { role: 'user', content: '<conversation_summary>old summary</conversation_summary>' },
    { role: 'user', content: '<agent_memory>memory text</agent_memory>' },
    { role: 'user', content: '<private_agent_context>TOP SECRET VALUE</private_agent_context>' },
    { role: 'user', content: '<untrusted_web_evidence>source</untrusted_web_evidence>' },
    { role: 'user', content: 'recent chat' },
  ], [{ type: 'function', function: { name: 'tool_x', parameters: { type: 'object' } } }]);

  assert.ok(profile.breakdown.systemAndPersona > 0);
  assert.ok(profile.breakdown.topicInstruction > 0);
  assert.ok(profile.breakdown.summary > 0);
  assert.ok(profile.breakdown.memory > 0);
  assert.ok(profile.breakdown.privateContext > 0);
  assert.ok(profile.breakdown.researchEvidence > 0);
  assert.ok(profile.breakdown.recentHistory > 0);
  assert.ok(profile.breakdown.toolSchemas > 0);
  assert.equal(JSON.stringify(profile).includes('TOP SECRET VALUE'), false);
});

test('compares anatomy estimate with exact provider usage only when exact', () => {
  const base = profileProviderInput([{ role: 'user', content: 'hello' }]);
  const exact = finalizeProviderInputProfile(base, { inputTokens: 42, exact: true });
  assert.equal(exact.reportedInputTokens, 42);
  assert.equal(exact.usageExact, true);
  assert.equal(exact.estimateDeltaTokens, 42 - base.estimatedInputTokens);

  const estimated = finalizeProviderInputProfile(base, { inputTokens: 2, exact: false });
  assert.equal(estimated.usageExact, false);
  assert.equal(estimated.estimateDeltaTokens, null);
});
