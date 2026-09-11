import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_SETTINGS_STORAGE_KEY, createControlSettings, parseStoredControlSettings, controlSettingsEqual } from '../public/control-settings.js';

test('control settings use a stable versioned localStorage key', () => {
  assert.equal(CONTROL_SETTINGS_STORAGE_KEY, 'ai-chat-control-settings-v1');
});

test('createControlSettings preserves valid user tuning', () => {
  const value = createControlSettings({
    maxTurns: 42,
    temperature: 1.3,
    maxOutputTokens: 4096,
    startSpeaker: 'b',
  }, {}, '2026-09-11T03:00:00.000Z');

  assert.deepEqual(value, {
    maxTurns: 42,
    temperature: 1.3,
    maxOutputTokens: 4096,
    startSpeaker: 'b',
    savedAt: '2026-09-11T03:00:00.000Z',
  });
});

test('stored control settings survive changed app defaults', () => {
  const raw = JSON.stringify({
    maxTurns: 35,
    temperature: 0.4,
    maxOutputTokens: 3000,
    startSpeaker: 'a',
    savedAt: '2026-09-11T03:00:00.000Z',
  });

  const restored = parseStoredControlSettings(raw, {
    maxTurns: 99,
    temperature: 1.8,
    maxOutputTokens: 9000,
    startSpeaker: 'random',
  });

  assert.equal(restored.maxTurns, 35);
  assert.equal(restored.temperature, 0.4);
  assert.equal(restored.maxOutputTokens, 3000);
  assert.equal(restored.startSpeaker, 'a');
});

test('invalid values are clamped and corrupt storage fails closed', () => {
  const value = createControlSettings({ maxTurns: 999, temperature: -2, maxOutputTokens: 2, startSpeaker: 'x' });
  assert.equal(value.maxTurns, 200);
  assert.equal(value.temperature, 0);
  assert.equal(value.maxOutputTokens, 64);
  assert.equal(value.startSpeaker, 'random');
  assert.equal(parseStoredControlSettings('{broken'), null);
  assert.equal(parseStoredControlSettings(JSON.stringify({ maxTurns: 10 })), null);
});

test('controlSettingsEqual ignores savedAt', () => {
  const a = createControlSettings({ maxTurns: 20, temperature: 0.8, maxOutputTokens: 1200, startSpeaker: 'random' }, {}, 'a');
  const b = createControlSettings({ maxTurns: 20, temperature: 0.8, maxOutputTokens: 1200, startSpeaker: 'random' }, {}, 'b');
  const c = createControlSettings({ maxTurns: 21, temperature: 0.8, maxOutputTokens: 1200, startSpeaker: 'random' }, {}, 'c');
  assert.equal(controlSettingsEqual(a, b), true);
  assert.equal(controlSettingsEqual(a, c), false);
});
