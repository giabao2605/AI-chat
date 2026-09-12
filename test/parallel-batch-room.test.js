import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ParallelBatchRoom } from '../src/parallel-batch-room.js';

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
}

function agents(ids = ['a', 'b', 'c']) {
  return Object.fromEntries(ids.map((id) => [id, {
    id,
    name: `Agent ${id.toUpperCase()}`,
    apiKey: 'x',
    model: 'mock',
    baseUrl: 'https://example.test/v1',
  }]));
}

function completion(room) {
  return new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status !== 'completed') return;
      room.off('state', listener);
      resolve(snapshot);
    };
    room.on('state', listener);
  });
}

test('free parallel mode starts new replies without waiting for every active agent', async () => {
  const callCount = { a: 0, b: 0, c: 0 };
  const firstDelay = { a: 10, b: 20, c: 5 };
  const firstTail = { a: 20, b: 30, c: 300 };
  const providerFactory = (config) => ({
    async streamChat({ onDelta, signal }) {
      const call = ++callCount[config.id];
      await wait(call === 1 ? firstDelay[config.id] : 5, signal);
      onDelta?.(`${config.id}${call}:`);
      await wait(call === 1 ? firstTail[config.id] : 15, signal);
      onDelta?.('done');
      return {
        text: `${config.id}${call}:done`,
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4, exact: true },
        toolCalls: [],
      };
    },
  });

  const room = new ParallelBatchRoom({
    agents: agents(),
    providerFactory,
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
  });
  const starts = [];
  const dones = [];
  room.on('message:start', (event) => starts.push({ ...event, at: Date.now() }));
  room.on('message:done', (event) => dones.push({ ...event, at: Date.now() }));
  const done = completion(room);

  await room.start({
    topicMode: 'manual',
    topic: 'test free parallel scheduling',
    conversationMode: 'parallel',
    maxTurns: 5,
    startSpeaker: 'a',
    sharedPrompt: 'Trò chuyện tự nhiên.',
  });
  const snapshot = await done;

  const secondAStart = starts.filter((event) => event.speaker === 'a')[1];
  const firstCDone = dones.find((event) => event.speaker === 'c');
  assert.ok(secondAStart, 'Agent A should get another turn while Agent C is still working');
  assert.ok(firstCDone, 'Agent C should eventually finish');
  assert.ok(secondAStart.at < firstCDone.at, 'A second reply must begin before slow C finishes; no round barrier is allowed');

  assert.deepEqual(starts.slice(0, 3).map((event) => event.speaker), ['c', 'a', 'b']);
  assert.deepEqual(snapshot.history.slice(0, 3).map((entry) => entry.speaker), ['c', 'a', 'b']);
  assert.deepEqual(snapshot.history.slice(0, 3).map((entry) => entry.startSequence), [1, 2, 3]);
  assert.ok(snapshot.history.every((entry) => entry.batchNumber == null));
  assert.equal(snapshot.parallelBatch, null);
  assert.equal(snapshot.parallelScheduler.mode, 'free');
  assert.equal(snapshot.turn, 5);
  assert.equal(snapshot.status, 'completed');
});

test('one failed provider does not abort the other free-running agents or the room', async () => {
  const providerFactory = (config) => ({
    async streamChat({ onDelta, signal }) {
      if (config.id === 'b') {
        await wait(10, signal);
        throw new Error('mock provider timeout');
      }
      await wait(5, signal);
      onDelta?.(`${config.id}:`);
      await wait(20, signal);
      onDelta?.('ok');
      return {
        text: `${config.id}:ok`,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true },
        toolCalls: [],
      };
    },
  });
  const room = new ParallelBatchRoom({
    agents: agents(),
    providerFactory,
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
  });
  let roomErrors = 0;
  room.on('error', () => { roomErrors += 1; });
  const done = completion(room);

  await room.start({
    topicMode: 'manual',
    topic: 'failure isolation',
    conversationMode: 'parallel',
    maxTurns: 3,
    startSpeaker: 'a',
    sharedPrompt: 'Rules',
  });
  const snapshot = await done;

  assert.equal(roomErrors, 0);
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.turn, 3);
  assert.equal(snapshot.history.filter((entry) => /^[abc]$/.test(entry.speaker)).length, 2);
  assert.equal(snapshot.agentStates.b.status, 'failed');
});

test('parallel UI exposes free-running status without round concepts', async () => {
  const [server, runtime, index, ui] = await Promise.all([
    readFile(new URL('../src/server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/parallel-batch-room.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/parallel-stream-ui.js', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /new ProfiledRoom/);
  assert.match(server, /'parallel:agent-status'/);
  assert.doesNotMatch(server, /'parallel:batch'/);
  assert.match(runtime, /mode: 'free'/);
  assert.doesNotMatch(runtime, /Promise\.all\(/);
  assert.doesNotMatch(runtime, /finishParallelBatch/);
  assert.match(index, /src="\/parallel-stream-ui\.js"/);
  assert.match(ui, /parallel:agent-status/);
  assert.match(ui, /Song song tự do/);
  assert.doesNotMatch(ui, /Round\s|parallel:batch|parallel-round-badge/);
});
