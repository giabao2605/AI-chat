import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const focusSource = await readFile(new URL('../public/composer-focus.js', import.meta.url), 'utf8');

test('composer focus helper is loaded after the main app', () => {
  const appIndex = indexSource.indexOf('src="/app.js"');
  const focusIndex = indexSource.indexOf('src="/composer-focus.js"');
  assert.ok(appIndex >= 0);
  assert.ok(focusIndex > appIndex);
});

test('composer regains focus once submit processing re-enables the input', () => {
  assert.match(focusSource, /form\.addEventListener\('submit'/);
  assert.match(focusSource, /attributeFilter: \['disabled'\]/);
  assert.match(focusSource, /input\.focus\(\{ preventScroll: true \}\)/);
});
