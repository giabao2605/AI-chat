import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('stream renderer consumes the full pending buffer in one animation frame', () => {
  assert.match(appSource, /node\.rendered \+= node\.pending;/);
  assert.match(appSource, /node\.pending = '';/);
  assert.doesNotMatch(appSource, /const chunkSize =/);
  assert.doesNotMatch(appSource, /node\.pending\.slice\(0, chunkSize\)/);
});
