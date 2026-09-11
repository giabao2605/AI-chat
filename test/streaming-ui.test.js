import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('live streaming appends provider deltas directly to one text node', () => {
  assert.match(appSource, /document\.createTextNode\(initialText\)/);
  assert.match(appSource, /node\.textNode\.appendData\(delta\)/);
  assert.match(appSource, /function scheduleStreamScroll/);
  assert.doesNotMatch(appSource, /function flushStream/);
  assert.doesNotMatch(appSource, /node\.pending \+= delta/);
});

test('stream completion reconciles text once before markdown finalization', () => {
  assert.match(appSource, /const finalText = data\.text \|\| node\.rendered/);
  assert.match(appSource, /node\.bubble\.classList\.remove\('typing'\)/);
  assert.match(appSource, /node\.textNode\.nodeValue = payload\.text/);
});
