import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const labJs = await readFile(new URL('../public/lab-v2.js', import.meta.url), 'utf8');
const labCss = await readFile(new URL('../public/lab-v2.css', import.meta.url), 'utf8');

test('retired prompt presets are no longer mounted or styled', () => {
  assert.doesNotMatch(labJs, /PRESETS|ensurePresetUi|applyPreset/);
  assert.doesNotMatch(labCss, /lab-preset-field/);
});
