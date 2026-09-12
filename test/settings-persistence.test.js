import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const controlUi = await readFile(new URL('../public/control-ui.js', import.meta.url), 'utf8');
const promptUi = await readFile(new URL('../public/prompt-ui.js', import.meta.url), 'utf8');

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

test('prompt editor auto-saves and keeps its saved localStorage value', () => {
  assert.match(promptUi, /setTimeout\(\(\) => save\(\{ announce: false \}\), 350\)/);
  assert.match(promptUi, /localStorage\.setItem\(PROMPT_SETTINGS_STORAGE_KEY/);
  assert.match(promptUi, /window\.addEventListener\('pagehide'/);
  assert.match(promptUi, /Prompt này sẽ được giữ nguyên sau khi reload hoặc cập nhật code/);
});

test('saved prompt waits for the async main app load with no fixed timeout race', () => {
  assert.match(promptUi, /function mainAppReady\(\)/);
  assert.match(promptUi, /new MutationObserver/);
  assert.match(promptUi, /await waitForMainApp\(\);[\s\S]*parseStoredPromptSettings/);
  assert.doesNotMatch(promptUi, /for \(let i = 0; i < 100; i \+= 1\)/);
  assert.doesNotMatch(promptUi, /setTimeout\(resolve, 25\)/);
});
