import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioRoom } from '../src/scenario-room.js';

const agents = {
  a: { id: 'a', name: 'Alpha', apiKey: 'a', model: 'mock', baseUrl: 'https://example.test/v1' },
  b: { id: 'b', name: 'Beta', apiKey: 'b', model: 'mock', baseUrl: 'https://example.test/v1' },
};

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function waitForState(room, predicate) {
  return new Promise((resolve) => {
    const listener = (snapshot) => {
      if (!predicate(snapshot)) return;
      room.off('state', listener);
      resolve(snapshot);
    };
    room.on('state', listener);
  });
}

test('active runtime preserves sequential speaker order, stats, and exact max-turn completion', async () => {
  const calls = [];
  const room = new ScenarioRoom({
    agents,
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
    providerFactory: (config) => ({
      async streamChat({ onDelta }) {
        calls.push(config.id);
        const text = `${config.name} reply ${calls.length}`;
        onDelta?.(text);
        return { text, usage: usage(), toolCalls: [] };
      },
    }),
  });

  const completed = waitForState(room, (snapshot) => snapshot.status === 'completed');
  await room.start({
    topicMode: 'manual',
    topic: 'characterize turns',
    conversationMode: 'turns',
    maxTurns: 3,
    startSpeaker: 'a',
  });
  const snapshot = await completed;

  assert.deepEqual(calls, ['a', 'b', 'a']);
  assert.deepEqual(snapshot.history.map((entry) => entry.speaker), ['a', 'b', 'a']);
  assert.equal(snapshot.turn, 3);
  assert.equal(snapshot.maxTurns, 3);
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.endedBy, 'limit');
  assert.equal(snapshot.stats.a.turns, 2);
  assert.equal(snapshot.stats.b.turns, 1);
});

test('active runtime accepts a human message and keeps it in transcript context', () => {
  const room = new ScenarioRoom({ agents });
  room.topic = 'Existing room';
  const entry = room.addUserMessage('Tôi chen vào nhé');
  assert.equal(entry.speaker, 'user');
  assert.equal(room.history.at(-1).text, 'Tôi chen vào nhé');
});

test('active runtime auto-topic provider failure ends in error instead of hanging in starting state', async () => {
  const room = new ScenarioRoom({
    agents,
    providerFactory: () => ({
      async streamChat() { throw new Error('gateway down'); },
    }),
  });

  await assert.rejects(room.start({ topicMode: 'auto' }), /gateway down/);
  assert.equal(room.status, 'error');
  assert.equal(room.currentSpeaker, null);
});

test('active runtime pause waits for the in-flight turn, blocks the next turn, then resume continues normally', async () => {
  const calls = [];
  const room = new ScenarioRoom({
    agents,
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
    providerFactory: (config) => ({
      async streamChat({ onDelta }) {
        calls.push(config.id);
        const text = `${config.name} reply`;
        onDelta?.(text);
        return { text, usage: usage(), toolCalls: [] };
      },
    }),
  });

  let pauseRequested = false;
  room.on('message:done', () => {
    if (pauseRequested) return;
    pauseRequested = true;
    room.pause();
  });

  const paused = waitForState(room, (snapshot) => snapshot.status === 'paused');
  await room.start({
    topicMode: 'manual',
    topic: 'characterize pause resume',
    conversationMode: 'turns',
    maxTurns: 2,
    startSpeaker: 'a',
  });
  const pausedSnapshot = await paused;

  assert.equal(pausedSnapshot.turn, 1);
  assert.deepEqual(calls, ['a']);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(calls, ['a'], 'no next provider call may start while paused');

  const completed = waitForState(room, (snapshot) => snapshot.status === 'completed');
  room.resume();
  const snapshot = await completed;
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(snapshot.turn, 2);
  assert.equal(snapshot.status, 'completed');
});

test('active runtime stop aborts an in-flight provider call without committing a partial message', async () => {
  const room = new ScenarioRoom({
    agents,
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
    providerFactory: () => ({
      async streamChat({ signal, onDelta }) {
        onDelta?.('partial');
        return await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      },
    }),
  });

  const started = new Promise((resolve) => room.once('message:start', resolve));
  const cancelled = new Promise((resolve) => room.once('message:cancelled', resolve));
  await room.start({
    topicMode: 'manual',
    topic: 'characterize stop',
    conversationMode: 'turns',
    maxTurns: 2,
    startSpeaker: 'a',
  });
  await started;
  room.stop();
  const event = await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(event.speaker, 'a');
  assert.equal(room.status, 'stopped');
  assert.equal(room.turn, 0);
  assert.equal(room.history.length, 0);
});

test('resetting an old in-flight active run cannot poison the next run', async () => {
  let call = 0;
  const room = new ScenarioRoom({
    agents,
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
    providerFactory: (config) => ({
      async streamChat({ signal, onDelta }) {
        call += 1;
        if (call === 1) {
          onDelta?.('old partial');
          return await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          });
        }
        const text = `${config.name} new run`;
        onDelta?.(text);
        return { text, usage: usage(), toolCalls: [] };
      },
    }),
  });

  const oldStarted = new Promise((resolve) => room.once('message:start', resolve));
  await room.start({
    topicMode: 'manual',
    topic: 'Old',
    conversationMode: 'turns',
    maxTurns: 1,
    startSpeaker: 'a',
  });
  await oldStarted;
  room.reset();

  const completed = waitForState(room, (snapshot) => snapshot.status === 'completed');
  await room.start({
    topicMode: 'manual',
    topic: 'New',
    conversationMode: 'turns',
    maxTurns: 1,
    startSpeaker: 'a',
  });
  const snapshot = await completed;

  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.history.length, 1);
  assert.match(snapshot.history[0].text, /new run/);
});
