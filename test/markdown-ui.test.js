import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const focusSource = await readFile(new URL('../public/composer-focus.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../public/markdown-ui.js', import.meta.url), 'utf8');
const mathSource = await readFile(new URL('../public/math-renderer.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../public/markdown.css', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('markdown UI is loaded explicitly and remains compatible with composer helper', () => {
  assert.match(focusSource, /import '\.\/markdown-ui\.js';/);
  assert.match(indexSource, /src="\/markdown-ui\.js"/);
  assert.match(uiSource, /\.message\.a \.bubble, \.message\.b \.bubble, \.message\.c \.bubble, \.message\.d \.bubble/);
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

test('math renderer uses MathJax and is triggered after markdown completes', () => {
  assert.match(uiSource, /import \{ typesetMath \} from '\.\/math-renderer\.js';/);
  assert.match(uiSource, /await typesetMath\(bubble\)/);
  assert.match(mathSource, /mathjax@3\/es5\/tex-chtml\.js/);
  assert.match(mathSource, /inlineMath:/);
  assert.match(mathSource, /displayMath:/);
  assert.match(mathSource, /typesetPromise/);
  assert.match(mathSource, /skipHtmlTags: \['script', 'noscript', 'style', 'textarea', 'pre', 'code'\]/);
});

test('markdown stylesheet defines readable blocks and math for all model agents', () => {
  assert.match(cssSource, /\.bubble\.markdown p/);
  assert.match(cssSource, /\.bubble\.markdown ul/);
  assert.match(cssSource, /\.bubble\.markdown pre/);
  assert.match(cssSource, /\.bubble\.markdown table/);
  assert.match(cssSource, /\.message\.c \.bubble\.markdown/);
  assert.match(cssSource, /\.message\.d \.bubble\.markdown/);
  assert.match(cssSource, /\.bubble\.markdown \.math-display/);
  assert.match(cssSource, /mjx-container/);
  assert.match(cssSource, /white-space: normal/);
});
