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
  assert.match(promptUi, /let saved = parseStoredPromptSettings\(localStorage\.getItem\(PROMPT_SETTINGS_STORAGE_KEY\)\)/);
  assert.match(promptUi, /setTimeout\(\(\) => save\(\{ announce: false \}\), 350\)/);
  assert.match(promptUi, /localStorage\.setItem\(PROMPT_SETTINGS_STORAGE_KEY/);
  assert.match(promptUi, /Prompt này sẽ được giữ nguyên sau khi reload hoặc cập nhật code/);
});

test('saved prompt wins after async app startup and late default writes', () => {
  assert.match(promptUi, /if \(saved\) apply\(saved\)/);
  assert.match(promptUi, /await waitForMainApp\(\);/);
  assert.match(promptUi, /await nextPaint\(\);\s*await nextPaint\(\);/);
  assert.match(promptUi, /const stored = parseStoredPromptSettings\(localStorage\.getItem\(PROMPT_SETTINGS_STORAGE_KEY\)\);[\s\S]*apply\(saved\);/);
  assert.match(promptUi, /new MutationObserver/);
  assert.doesNotMatch(promptUi, /for \(let i = 0; i < 100; i \+= 1\)/);
});

test('pagehide never persists a programmatic default over the saved prompt', () => {
  assert.match(promptUi, /let userEdited = false;/);
  assert.match(promptUi, /function scheduleAutoSave\(\) \{\s*userEdited = true;/);
  assert.match(promptUi, /window\.addEventListener\('pagehide',[\s\S]*if \(userEdited\) save\(\{ announce: false \}\);/);
  assert.doesNotMatch(promptUi, /window\.addEventListener\('pagehide', \(\) => save\(/);
});
