import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const controlUi = await readFile(new URL('../public/control-ui.js', import.meta.url), 'utf8');
const session = await readFile(new URL('../public/room-session.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('control persistence loads after the main app and restores saved tuning', () => {
  const appIndex = index.indexOf('src="/app.js"');
  const controlIndex = index.indexOf('src="/control-ui.js"');
  assert.ok(appIndex >= 0);
  assert.ok(controlIndex > appIndex);
  assert.match(controlUi, /parseStoredControlSettings\(localStorage\.getItem\(CONTROL_SETTINGS_STORAGE_KEY\)/);
  assert.match(controlUi, /fields\.maxTurns\.value = String\(settings\.maxTurns\)/);
  assert.match(controlUi, /fields\.temperature\.value = String\(settings\.temperature\)/);
  assert.match(controlUi, /fields\.maxOutputTokens\.value = String\(settings\.maxOutputTokens\)/);
  assert.match(controlUi, /field\.addEventListener\('input', persist\)/);
  assert.match(controlUi, /field\.addEventListener\('change', persist\)/);
});

test('removed AI and Prompt editor cannot load or inject saved overrides', () => {
  assert.doesNotMatch(index, /promptPanel|sharedPrompt|personaA|personaB|prompt-ui/);
  assert.doesNotMatch(session, /readAgentProfiles|agent-profiles|readExtraPersonas|body\.personas|body\.agentProfiles/);
  assert.doesNotMatch(app, /els\.(sharedPrompt|personaA|personaB)/);
});

test('start and continue ignore retired settings still present in localStorage', async () => {
  const requests = [];
  const browser = {
    fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); },
    EventSource: class {},
  };
  runInNewContext(session.replace(/^import .*;\r?\n/gm, ''), {
    window: browser, URL, Request,
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    sessionStorage: { getItem: () => 'room_test123', setItem() {} },
    localStorage: { getItem: () => JSON.stringify({ a: { prompt: 'old custom prompt', temperature: 1.9 }, c: 'old persona' }) },
    document: { getElementById: () => null },
  });
  for (const endpoint of ['start', 'continue']) {
    await browser.fetch(`/api/${endpoint}`, { method: 'POST', body: JSON.stringify({ topic: 'test', maxTurns: 2 }) });
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.deepEqual(request.body, { topic: 'test', maxTurns: 2 });
    assert.match(request.url, /room=room_test123/);
  }
});
