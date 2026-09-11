import test from 'node:test';
import assert from 'node:assert/strict';
import { getComposerMode } from '../public/composer-mode.js';

test('composer starts a new manual session when the room is inactive', () => {
  for (const status of ['idle', 'completed', 'stopped', 'error']) {
    const mode = getComposerMode({ status, configured: true });
    assert.equal(mode.enabled, true, status);
    assert.equal(mode.action, 'start', status);
    assert.match(mode.placeholder, /chủ đề/i);
  }
});

test('composer remains a normal join message while a session exists', () => {
  for (const status of ['running', 'paused', 'pausing']) {
    const mode = getComposerMode({ status, configured: true });
    assert.equal(mode.enabled, true, status);
    assert.equal(mode.action, 'message', status);
    assert.match(mode.placeholder, /Chen vào/i);
  }
});

test('composer is disabled only for history, startup, missing config or an in-flight submit', () => {
  assert.equal(getComposerMode({ status: 'idle', configured: false }).enabled, false);
  assert.equal(getComposerMode({ status: 'starting', configured: true }).enabled, false);
  assert.equal(getComposerMode({ status: 'idle', configured: true, viewingHistory: true }).enabled, false);
  assert.equal(getComposerMode({ status: 'idle', configured: true, submitting: true }).enabled, false);
});
