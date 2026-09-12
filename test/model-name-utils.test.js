import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeModelLabel, modelFamily, prettyModelName, resolveAgentDisplayName } from '../public/model-name-utils.js';

test('model-aware display name replaces stale Claude labels after switching to Luna', () => {
  const agent = { name: 'Claude Opus 4.6', model: 'gpt-5.6-luna' };
  assert.equal(resolveAgentDisplayName(agent, 'Claude Opus 4.6'), 'GPT 5.6 Luna');
});

test('custom profile names survive a model switch', () => {
  const agent = { name: 'Claude Opus 4.6', model: 'gpt-5.6-luna' };
  assert.equal(resolveAgentDisplayName(agent, 'Phản biện khó tính'), 'Phản biện khó tính');
});

test('matching model-like names are preserved', () => {
  const agent = { name: 'ChatGPT 5.6 Luna - 2', model: 'gpt-5.6-luna' };
  assert.equal(resolveAgentDisplayName(agent, 'ChatGPT 5.6 Luna - 2'), 'ChatGPT 5.6 Luna - 2');
});

test('model helpers recognize common families and prettify ids', () => {
  assert.equal(modelFamily('Claude Opus 4.6'), 'claude');
  assert.equal(modelFamily('gpt-5.6-luna'), 'gpt');
  assert.equal(looksLikeModelLabel('Claude Opus 4.6'), true);
  assert.equal(prettyModelName('gpt-5.6-luna'), 'GPT 5.6 Luna');
});
