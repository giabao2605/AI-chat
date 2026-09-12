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

test('parallel rounds wait at a barrier and persist messages in first-token order', async () => {
  const callCount = { a: 0, b: 0, c: 0 };
  const firstDelay = { a: 20, b: 35, c: 5 };
  const tailDelay = { a: 30, b: 5, c: 55 };
  const providerFactory = (config) => ({
    async streamChat({ onDelta, signal }) {
      const round = ++callCount[config.id];
      await wait(firstDelay[config.id], signal);
      onDelta?.(`${config.id}${round}:`);
      await wait(tailDelay[config.id], signal);
      onDelta?.('done');
      return {
        text: `${config.id}${round}:done`,
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
  const batches = [];
  room.on('message:start', (event) => starts.push(event));
  room.on('parallel:batch', (event) => batches.push(event));
  const done = completion(room);

  await room.start({
    topicMode: 'manual',
    topic: 'test parallel barrier',
    conversationMode: 'parallel',
    maxTurns: 6,
    startSpeaker: 'a',
    sharedPrompt: 'Trò chuyện tự nhiên.',
  });
  const snapshot = await done;

  const batchStarts = batches.filter((event) => event.status === 'started');
  const batchDone = batches.filter((event) => event.status === 'completed');
  assert.equal(batchStarts.length, 2);
  assert.equal(batchDone.length, 2);
  assert.ok(Date.parse(batchStarts[1].startedAt) >= Date.parse(batchDone[0].finishedAt));
  assert.deepEqual(starts.slice(0, 3).map((event) => event.speaker), ['c', 'a', 'b']);
  assert.deepEqual(snapshot.history.slice(0, 3).map((entry) => entry.speaker), ['c', 'a', 'b']);
  assert.deepEqual(snapshot.history.slice(0, 3).map((entry) => entry.startSequence), [1, 2, 3]);
  assert.ok(snapshot.history.slice(0, 3).every((entry) => entry.batchNumber === 1));
  assert.equal(snapshot.turn, 6);
  assert.equal(snapshot.status, 'completed');
});

test('one failed provider does not abort the other agents or the room', async () => {
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
  let completedBatch = null;
  room.on('error', () => { roomErrors += 1; });
  room.on('parallel:batch', (event) => { if (event.status === 'completed') completedBatch = event; });
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
  assert.equal(completedBatch.failures, 1);
  assert.equal(completedBatch.successes, 2);
});

test('parallel live UI and SSE events are wired into the app', async () => {
  const [server, index, ui] = await Promise.all([
    readFile(new URL('../src/server.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/parallel-stream-ui.js', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /ParallelBatchRoom/);
  assert.match(server, /'parallel:batch'/);
  assert.match(server, /'parallel:agent-status'/);
  assert.match(index, /src="\/parallel-stream-ui\.js"/);
  assert.match(ui, /parallel:agent-status/);
  assert.match(ui, /parallel:batch/);
  assert.match(ui, /parallel-round-badge/);
});
