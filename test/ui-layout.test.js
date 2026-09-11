import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const layout = await readFile(new URL('../public/layout-v2.css', import.meta.url), 'utf8');

test('header branding is removed and status/history live inside Control Room', () => {
  assert.doesNotMatch(index, /AI CONVERSATION LAB/);
  assert.doesNotMatch(index, /class="topbar"/);

  const controlStart = index.indexOf('<aside id="controlPanel"');
  const controlEnd = index.indexOf('</aside>', controlStart);
  const controlMarkup = index.slice(controlStart, controlEnd);

  assert.match(controlMarkup, /id="connectionText"/);
  assert.match(controlMarkup, /id="roomStatus"/);
  assert.match(controlMarkup, /id="historyBtn"/);
  assert.match(controlMarkup, /id="agentATotal"/);
  assert.match(controlMarkup, /id="agentBTotal"/);
  assert.match(controlMarkup, /id="combinedTotal"/);
});

test('desktop workspace fills the viewport without a header row', () => {
  assert.match(layout, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(layout, /\.workspace\s*\{[^}]*height:\s*100%/s);
  assert.match(layout, /\.chat-panel\s*\{[^}]*height:\s*100%/s);
});
