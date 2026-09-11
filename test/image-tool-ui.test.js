import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composerSource = await readFile(new URL('../public/composer-focus.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../public/image-tool-ui.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../public/image-tool.css', import.meta.url), 'utf8');

test('composer loads the image slash-command UI', () => {
  assert.match(composerSource, /import '\.\/image-tool-ui\.js';/);
});

test('image command intercepts submit in capture phase before normal chat submission', () => {
  assert.match(uiSource, /form\.addEventListener\('submit'/);
  assert.match(uiSource, /stopImmediatePropagation\(\)/);
  assert.match(uiSource, /\{ capture: true \}/);
  assert.match(uiSource, /\/api\/tools\/image/);
});

test('generated images are restricted to local generated URLs and rendered as image attachments', () => {
  assert.match(uiSource, /raw\.startsWith\('\/generated\/'\)/);
  assert.match(uiSource, /chat-generated-image/);
  assert.match(cssSource, /\.chat-generated-image/);
  assert.match(cssSource, /\.tool-command-menu/);
});
