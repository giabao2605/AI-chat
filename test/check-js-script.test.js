import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { collectJavaScriptFiles } from '../scripts/check-js.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function relativeFiles(files) {
  return files.map((file) => relative(projectRoot, file).replaceAll('\\', '/'));
}

test('recursive syntax checker discovers JavaScript files added outside the old hard-coded list', async () => {
  const files = relativeFiles(await collectJavaScriptFiles(projectRoot));

  assert.ok(files.includes('src/reasoning-memory-room.js'));
  assert.ok(files.includes('public/reasoning-control.js'));
  assert.ok(files.includes('public/private-context-inspector.js'));
  assert.ok(files.includes('public/memory-inspector.js'));
  assert.ok(files.includes('public/header-toolbar-layout.js'));
  assert.ok(files.includes('public/model-name-utils.js'));
  assert.ok(files.includes('scripts/check-js.mjs'));
});

test('recursive syntax checker returns a stable sorted list without duplicates', async () => {
  const files = relativeFiles(await collectJavaScriptFiles(projectRoot));
  assert.deepEqual(files, [...files].sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(files).size, files.length);
});
