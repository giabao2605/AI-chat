import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptSettings, parseStoredPromptSettings, promptSettingsEqual } from '../public/prompt-settings.js';

test('createPromptSettings preserves user prompt formatting and personas', () => {
  const value = createPromptSettings({ sharedPrompt: 'Dòng 1\n\nDòng 2', personaA: 'hoài nghi', personaB: 'sáng tạo' }, '2026-09-10T09:00:00.000Z');
  assert.equal(value.sharedPrompt, 'Dòng 1\n\nDòng 2');
  assert.equal(value.personaA, 'hoài nghi');
  assert.equal(value.personaB, 'sáng tạo');
  assert.equal(value.savedAt, '2026-09-10T09:00:00.000Z');
});

test('parseStoredPromptSettings restores a valid saved configuration', () => {
  const raw = JSON.stringify({ sharedPrompt: 'rule', personaA: 'A', personaB: 'B', savedAt: '2026-09-10T09:01:00.000Z' });
  assert.deepEqual(parseStoredPromptSettings(raw), { sharedPrompt: 'rule', personaA: 'A', personaB: 'B', savedAt: '2026-09-10T09:01:00.000Z' });
});

test('parseStoredPromptSettings rejects corrupt or incomplete data', () => {
  assert.equal(parseStoredPromptSettings('{broken'), null);
  assert.equal(parseStoredPromptSettings(JSON.stringify({ sharedPrompt: 'x' })), null);
  assert.equal(parseStoredPromptSettings(JSON.stringify([])), null);
});

test('promptSettingsEqual ignores savedAt but detects edited prompt text', () => {
  const a = createPromptSettings({ sharedPrompt: 'rule', personaA: 'A', personaB: 'B' }, '2026-09-10T09:00:00.000Z');
  const b = createPromptSettings({ sharedPrompt: 'rule', personaA: 'A', personaB: 'B' }, '2026-09-10T10:00:00.000Z');
  const c = createPromptSettings({ sharedPrompt: 'changed', personaA: 'A', personaB: 'B' }, '2026-09-10T10:00:00.000Z');
  assert.equal(promptSettingsEqual(a, b), true);
  assert.equal(promptSettingsEqual(a, c), false);
});
