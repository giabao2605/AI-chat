import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const focusSource = await readFile(new URL('../public/composer-focus.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../public/markdown-ui.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../public/markdown.css', import.meta.url), 'utf8');

test('markdown UI is loaded with the existing composer helper', () => {
  assert.match(focusSource, /import '\.\/markdown-ui\.js';/);
  assert.match(uiSource, /\.message\.a \.bubble, \.message\.b \.bubble/);
  assert.doesNotMatch(uiSource, /\.message\.user \.bubble/);
});

test('markdown observer only rewrites raw text nodes and loads dedicated styles', () => {
  assert.match(uiSource, /bubble\.childNodes\.length !== 1/);
  assert.match(uiSource, /Node\.TEXT_NODE/);
  assert.match(uiSource, /stylesheet\.href = '\/markdown\.css'/);
  assert.match(uiSource, /markdownToSafeHtml\(raw\)/);
});

test('markdown rendering is deferred while an AI bubble is actively streaming', () => {
  assert.match(uiSource, /bubble\.classList\.contains\('typing'\)/);
  assert.match(uiSource, /attributes: true/);
  assert.match(uiSource, /attributeFilter: \['class'\]/);
  assert.match(uiSource, /!target\.classList\.contains\('typing'\)/);
});

test('markdown stylesheet defines readable blocks for common model output', () => {
  assert.match(cssSource, /\.bubble\.markdown p/);
  assert.match(cssSource, /\.bubble\.markdown ul/);
  assert.match(cssSource, /\.bubble\.markdown pre/);
  assert.match(cssSource, /\.bubble\.markdown table/);
  assert.match(cssSource, /white-space: normal/);
});
