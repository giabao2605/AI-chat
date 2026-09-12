import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const labJs = await readFile(new URL('../public/lab-v2.js', import.meta.url), 'utf8');
const labCss = await readFile(new URL('../public/lab-v2.css', import.meta.url), 'utf8');

test('room presets stay implemented but are hidden from the UI', () => {
  assert.match(labJs, /const PRESETS = \{/);
  assert.match(labJs, /function ensurePresetUi\(\)/);
  assert.match(labJs, /function applyPreset\(key\)/);
  assert.match(labCss, /\.lab-preset-field\s*\{[^}]*display:\s*none\s*!important/s);
});
