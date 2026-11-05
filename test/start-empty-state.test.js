import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function harness(api) {
  let empty = { remove() { empty = null; } };
  const original = empty;
  const chat = { querySelector: () => empty, prepend(node) { empty = node; } };
  const context = vm.createContext({ api, els: { chat }, state: { status: 'idle' }, viewingHistoryId: null });
  const code = source.match(/async function requestStart\(payload\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(code, 'start requests share immediate empty-state removal');
  vm.runInContext(code, context);
  return { context, original, empty: () => empty, start: () => context.requestStart({ topic: 'Test' }) };
}

test('start hides welcome before the request resolves', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  const pending = h.start();
  assert.equal(h.empty(), null);
  resolve({ status: 'starting' });
  await pending;
  assert.equal(h.empty(), null);
});

test('failed start restores welcome, but not over an already active session', async () => {
  for (const status of ['idle', 'starting']) {
    const h = harness(async () => { h.context.state.status = status; throw new Error('offline'); });
    await assert.rejects(h.start(), /offline/);
    assert.equal(h.empty(), status === 'idle' ? h.original : null);
  }
});

test('active state removes welcome after an empty transcript is rendered', () => {
  const block = source.match(/function applyState\(next,[\s\S]*?\n\}/)[0];
  const calls = [];
  const el = () => ({});
  const context = vm.createContext({ state: null, viewingHistoryId: null, config: {},
    els: Object.fromEntries(['roomStatus','startBtn','stopBtn','pauseBtn','liveHint','topicPreview'].map(k => [k, { ...el(), dataset: {} }])),
    saveCurrentSnapshot() {}, updateComposerState() {}, activeSpeakerNames: () => [], renderStats() {},
    renderTranscript() { calls.push('render'); }, removeEmpty() { calls.push('remove'); } });
  vm.runInContext(block, context);
  context.applyState({ status: 'starting', history: [] }, { history: true });
  assert.deepEqual(calls, ['render', 'remove']);
});
