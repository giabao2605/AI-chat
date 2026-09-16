import test from 'node:test';
import assert from 'node:assert/strict';
import { applyContextBudget } from '../src/context-budget.js';

function long(prefix, size = 500) {
  return `${prefix} ${'x'.repeat(size)}`;
}

test('drops old optional context before protected recent messages', () => {
  const messages = [
    { role: 'system', content: long('system', 300) },
    { role: 'user', content: 'Chủ đề của phòng trò chuyện: test' },
    { role: 'user', content: '<conversation_summary>old summary</conversation_summary>' },
    { role: 'user', content: long('old-1') },
    { role: 'assistant', content: long('old-2') },
    { role: 'user', content: long('recent-1') },
    { role: 'assistant', content: long('recent-2') },
    { role: 'user', content: long('recent-3') },
    { role: 'assistant', content: long('recent-4') },
  ];

  const result = applyContextBudget(messages, [], {
    budgetTokens: 650,
    safetyMargin: 0,
    minRecentMessages: 4,
  });

  const text = result.messages.map((message) => String(message.content)).join('\n');
  assert.match(text, /system/);
  assert.match(text, /Chủ đề của phòng/);
  for (const value of ['recent-1', 'recent-2', 'recent-3', 'recent-4']) assert.match(text, new RegExp(value));
  assert.ok(result.debug.dropped.some((item) => item.category === 'recentHistory'));
  assert.ok(result.debug.afterEstimatedTokens <= result.debug.targetTokens);
  assert.equal(result.debug.enabled, true);
});

test('prefers dropping summary and memory before research/private context', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'Chủ đề của phòng trò chuyện: test' },
    { role: 'user', content: `<conversation_summary>${'s'.repeat(900)}</conversation_summary>` },
    { role: 'user', content: `<agent_memory>${'m'.repeat(900)}</agent_memory>` },
    { role: 'user', content: `<untrusted_web_evidence>${'w'.repeat(900)}</untrusted_web_evidence>` },
    { role: 'user', content: `<private_agent_context>${'p'.repeat(900)}</private_agent_context>` },
    { role: 'user', content: 'latest trigger' },
  ];

  const result = applyContextBudget(messages, [], {
    budgetTokens: 650,
    safetyMargin: 0,
    minRecentMessages: 1,
  });
  const categories = result.debug.dropped.map((item) => item.category);
  assert.ok(categories.indexOf('summary') >= 0);
  assert.ok(categories.indexOf('memory') >= 0);
  if (categories.includes('researchEvidence')) assert.ok(categories.indexOf('researchEvidence') > categories.indexOf('memory'));
  if (categories.includes('privateContext')) assert.ok(categories.indexOf('privateContext') > categories.indexOf('researchEvidence'));
});

test('does not silently cut mandatory context when mandatory content exceeds budget', () => {
  const system = long('mandatory-system', 3000);
  const latest = long('latest-trigger', 2000);
  const result = applyContextBudget([
    { role: 'system', content: system },
    { role: 'user', content: 'Chủ đề của phòng trò chuyện: test' },
    { role: 'user', content: latest },
  ], [], { budgetTokens: 100, safetyMargin: 0, minRecentMessages: 1 });

  assert.equal(result.messages.length, 3);
  assert.equal(result.debug.overBudget, true);
  assert.equal(result.debug.mandatoryExceeded, true);
});

test('budget zero is disabled and preserves input exactly', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const result = applyContextBudget(messages, [], { budgetTokens: 0 });
  assert.deepEqual(result.messages, messages);
  assert.equal(result.debug.enabled, false);
});
