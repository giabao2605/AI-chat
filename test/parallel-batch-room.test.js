import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ParallelBatchRoom } from '../src/parallel-batch-room.js';

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function waitForCompleted(room, timeoutMs = 2500) {
  if (room.status === 'completed') return Promise.resolve(room.snapshot());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off('state', onState);
      reject(new Error(`Room did not complete. Current status: ${room.status}`));
    }, timeoutMs);
    const onState = (snapshot) => {
      if (snapshot.status !== 'completed') return;
      clearTimeout(timer);
      room.off('state', onState);
      resolve(snapshot);
    };
    room.on('state', onState);
  });
}

const agents = {
  a: { id: 'a', name: 'Agent A', apiKey: 'a', model: 'mock-a', baseUrl: 'http://mock' },
  b: { id: 'b', name: 'Agent B', apiKey: 'b', model: 'mock-b', baseUrl: 'http://mock' },
  c: { id: 'c', name: 'Agent C', apiKey: 'c', model: 'mock-c', baseUrl: 'http://mock' },
};

test('free parallel mode starts new replies without waiting for every active agent', async () => {
  const calls = { a: 0, b: 0, c: 0 };
  const startedAt = { a: [], b: [], c: [] };
  const finishedAt = { a: [], b: [], c: [] };

  const delays = { a: 12, b: 180, c: 35 };
  const providerFactory = (config) => ({
    async streamChat({ onDelta = () => {} }) {
      calls[config.id] += 1;
      startedAt[config.id].push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, delays[config.id]));
      const text = `${config.name} #${calls[config.id]}`;
      onDelta(text);
      finishedAt[config.id].push(Date.now());
      return { text, usage: usage() };
    },
  });

  const room = new ParallelBatchRoom({ agents, providerFactory, hardTurnLimit: 10 });
  const done = waitForCompleted(room);
  await room.start({
    topic: 'free scheduler',
    conversationMode: 'parallel',
    maxTurns: 4,
    startSpeaker: 'a',
    sharedPrompt: 'Rules',
  });
  const snapshot = await done;

  assert.equal(snapshot.turn, 4);
  assert.equal(snapshot.history.filter((entry) => /^[abc]$/.test(entry.speaker)).length, 4);
  assert.equal(calls.a >= 2, true);
  assert.equal(startedAt.a[1] < finishedAt.b[0], true);
  assert.equal(snapshot.parallel.mode, 'free');
});

test('one failed provider does not abort the other free-running agents or the room', async () => {
  let bCalls = 0;
  const providerFactory = (config) => ({
    async streamChat({ onDelta = () => {} }) {
      if (config.id === 'b') {
        bCalls += 1;
        throw new Error('provider b exploded');
      }
      await new Promise((resolve) => setTimeout(resolve, config.id === 'a' ? 12 : 20));
      const text = `${config.name} ok`;
      onDelta(text);
      return { text, usage: usage() };
    },
  });

  const room = new ParallelBatchRoom({ agents, providerFactory, hardTurnLimit: 10 });
  let roomErrors = 0;
  room.on('room:error', () => { roomErrors += 1; });
  const done = waitForCompleted(room);
  await room.start({
    topic: 'failure isolation',
    conversationMode: 'parallel',
    maxTurns: 3,
    startSpeaker: 'a',
    sharedPrompt: 'Rules',
  });
  const snapshot = await done;

  assert.equal(bCalls >= 1, true);
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
  assert.match(server, /new MemoryProfiledRoom/);
  assert.match(server, /'parallel:agent-status'/);
  assert.doesNotMatch(server, /'parallel:batch'/);
  assert.match(runtime, /mode: 'free'/);
  assert.doesNotMatch(runtime, /Promise\.all\(/);
  assert.doesNotMatch(runtime, /finishParallelBatch/);
  assert.match(index, /src="\/parallel-stream-ui\.js"/);
  assert.match(ui, /parallel:agent-status/);
  assert.match(ui, /agentActivityPanel/);
  assert.doesNotMatch(ui, /Round\s|parallel:batch|parallel-round-badge/);
});
