import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/empty-state-v2.css', import.meta.url), 'utf8');
const ui = await readFile(new URL('../public/empty-state-ui.js', import.meta.url), 'utf8');

test('minimal empty state replaces the old decorative placeholder', () => {
  assert.match(index, /href="\/empty-state-v2\.css"/);
  assert.match(index, /class="empty-state empty-state-v2"/);
  assert.match(index, /Bắt đầu cuộc trò chuyện/);
  assert.doesNotMatch(index, /empty-orbit/);
  assert.doesNotMatch(index, /Chưa có drama trí tuệ nhân tạo/);
  assert.match(css, /\.empty-state-v2\s*\{/);
  assert.match(css, /background:\s*transparent/);
});

test('primary empty-state action starts an auto-topic session', () => {
  assert.match(index, /data-empty-action="auto-topic"/);
  assert.match(ui, /topicMode\.value = 'auto'/);
  assert.match(ui, /topicMode\.dispatchEvent\(new Event\('change'/);
  assert.match(ui, /startBtn\.click\(\)/);
  assert.match(ui, /Đang bắt đầu…/);
});

test('settings action opens the collapsed control room and focuses a real control', () => {
  assert.match(index, /data-empty-action="settings"/);
  assert.match(ui, /controls-collapsed/);
  assert.match(ui, /expandBtn\.click\(\)/);
  assert.match(ui, /\$\('conversationMode'\) \|\| \$\('topicMode'\)/);
});

test('suggestion chips switch to manual mode and populate editable inputs', () => {
  assert.match(index, /data-empty-template="explain"/);
  assert.match(index, /data-empty-template="ideate"/);
  assert.match(index, /data-empty-template="summarize"/);
  assert.match(ui, /topicMode\.value = 'manual'/);
  assert.match(ui, /topic\.value = text/);
  assert.match(ui, /userInput\.value = text/);
  assert.match(ui, /userInput\.focus\(\)/);
});

test('runtime-created legacy empty states are upgraded after reset or history changes', () => {
  assert.match(ui, /MutationObserver/);
  assert.match(ui, /document\.querySelectorAll\('#chat \.empty-state'\)/);
  assert.match(ui, /empty\.classList\.add\('empty-state-v2'\)/);
});
