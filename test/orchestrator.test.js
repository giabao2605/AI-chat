import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessagesForAgent, ConversationRoom } from '../src/orchestrator.js';

const agentA = { id: 'a', name: 'Alpha', apiKey: 'x', model: 'm1', baseUrl: 'http://mock' };
const agentB = { id: 'b', name: 'Beta', apiKey: 'y', model: 'm2', baseUrl: 'http://mock' };

function mockFactory(config) {
  return {
    async streamChat({ messages, onDelta }) {
      const text = config.id === 'a' ? 'Alpha trả lời.' : 'Beta trả lời.';
      onDelta(text);
      return { text, usage: { inputTokens: messages.length, outputTokens: 3, totalTokens: messages.length + 3, exact: true } };
    },
  };
}

test('buildMessagesForAgent maps its own history to assistant and everyone else to user', () => {
  const messages = buildMessagesForAgent({
    agentId: 'a', agentName: 'Alpha', topic: 'Test', sharedPrompt: 'Rules', personaPrompt: '',
    history: [
      { speaker: 'a', name: 'Alpha', text: 'mine' },
      { speaker: 'b', name: 'Beta', text: 'theirs' },
      { speaker: 'user', name: 'Bạn', text: 'human' },
    ],
  });
  assert.equal(messages[2].role, 'assistant');
  assert.equal(messages[3].role, 'user');
  assert.match(messages[3].content, /Beta: theirs/);
  assert.match(messages[4].content, /Bạn: human/);
});

test('room alternates agents, records stats and completes at maxTurns', async () => {
  const room = new ConversationRoom({ agentA, agentB, hardTurnLimit: 10, providerFactory: mockFactory });
  const completed = new Promise((resolve) => {
    const onState = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', onState);
        resolve();
      }
    };
    room.on('state', onState);
  });
  await room.start({ topic: 'Test topic', maxTurns: 2, startSpeaker: 'a' });
  await completed;
  const snapshot = room.snapshot();
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.history.length, 2);
  assert.deepEqual(snapshot.history.map((m) => m.speaker), ['a', 'b']);
  assert.equal(snapshot.stats.a.turns, 1);
  assert.equal(snapshot.stats.b.turns, 1);
});

test('human can join an active room and becomes transcript context', async () => {
  const room = new ConversationRoom({ agentA, agentB, hardTurnLimit: 10, providerFactory: mockFactory });
  room.topic = 'Existing room';
  const entry = room.addUserMessage('Tôi chen vào nhé');
  assert.equal(entry.speaker, 'user');
  assert.equal(room.history.at(-1).text, 'Tôi chen vào nhé');
});

test('auto-topic provider failure leaves the room in error instead of starting forever', async () => {
  const failingFactory = () => ({
    async streamChat() { throw new Error('gateway down'); },
  });
  const room = new ConversationRoom({ agentA, agentB, providerFactory: failingFactory });
  await assert.rejects(room.start({ topicMode: 'auto' }), /gateway down/);
  assert.equal(room.status, 'error');
  assert.equal(room.currentSpeaker, null);
});

test('stopping an in-flight turn cancels it without turning the room into error', async () => {
  const blockingFactory = () => ({
    async streamChat({ signal, onDelta }) {
      onDelta('partial');
      return await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    },
  });
  const room = new ConversationRoom({ agentA, agentB, providerFactory: blockingFactory });
  const cancelled = new Promise((resolve) => room.once('message:cancelled', resolve));
  const started = new Promise((resolve) => room.once('message:start', resolve));
  await room.start({ topic: 'Stop test', maxTurns: 2, startSpeaker: 'a' });
  await started;
  room.stop();
  const event = await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(event.speaker, 'a');
  assert.equal(room.status, 'stopped');
  assert.equal(room.history.length, 0);
});

test('resetting an old in-flight run cannot poison a newer run', async () => {
  let call = 0;
  const mixedFactory = (config) => ({
    async streamChat({ signal, messages, onDelta }) {
      call += 1;
      if (call === 1) {
        onDelta('old partial');
        return await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      const text = `${config.name} new run`;
      onDelta(text);
      return { text, usage: { inputTokens: messages.length, outputTokens: 2, totalTokens: messages.length + 2, exact: true } };
    },
  });
  const room = new ConversationRoom({ agentA, agentB, providerFactory: mixedFactory });
  const oldStarted = new Promise((resolve) => room.once('message:start', resolve));
  await room.start({ topic: 'Old', maxTurns: 1, startSpeaker: 'a' });
  await oldStarted;
  room.reset();

  const completed = new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', listener);
        resolve();
      }
    };
    room.on('state', listener);
  });
  await room.start({ topic: 'New', maxTurns: 1, startSpeaker: 'a' });
  await completed;
  assert.equal(room.status, 'completed');
  assert.equal(room.history.length, 1);
  assert.match(room.history[0].text, /new run/);
});
