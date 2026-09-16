import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('UI exposes the parallel mode selector and sends it in start payloads', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="conversationMode"/);
  assert.match(html, /value="parallel"/);
  assert.match(app, /conversationMode: els\.conversationMode\?\.value \|\| 'turns'/);
  assert.match(app, /currentSpeakers/);
});
