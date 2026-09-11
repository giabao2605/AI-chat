import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/research-status.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/research-status.css', import.meta.url), 'utf8');

test('chat toolbar exposes a live web research status', () => {
  assert.match(index, /id="researchStatus"/);
  assert.match(index, /href="\/research-status\.css"/);
  assert.match(index, /src="\/research-status\.js"/);
});

test('research status listens to search lifecycle events', () => {
  assert.match(script, /research:start/);
  assert.match(script, /đang tìm kiếm web/);
  assert.match(script, /research:done/);
  assert.match(script, /đã lấy \$\{count\} nguồn/);
  assert.match(script, /research:error/);
  assert.match(script, /message:done/);
});

test('research status has a visible searching animation with reduced-motion fallback', () => {
  assert.match(styles, /\.research-status\.searching::before/);
  assert.match(styles, /@keyframes researchPulse/);
  assert.match(styles, /prefers-reduced-motion/);
});
