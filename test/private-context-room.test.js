import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrivateContextToolCall, PRIVATE_CONTEXT_TOOL_NAME } from '../src/agent-tools.js';
import { ProfiledRoom } from '../src/profiled-room.js';

const agents = {
  a: { id: 'a', name: 'Luna 1', apiKey: 'a', model: 'mock', baseUrl: 'http://mock' },
  b: { id: 'b', name: 'Luna 2', apiKey: 'b', model: 'mock', baseUrl: 'http://mock' },
  c: { id: 'c', name: 'Luna 3', apiKey: 'c', model: 'mock', baseUrl: 'http://mock' },
};

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function waitForCompleted(room) {
  if (room.status === 'completed') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off('state', onState);
      reject(new Error(`Room did not complete. Current status: ${room.status}`));
    }, 2000);
    const onState = (snapshot) => {
      if (snapshot.status !== 'completed') return;
      clearTimeout(timer);
      room.off('state', onState);
      resolve();
    };
    room.on('state', onState);
  });
}

test('private context tool parser validates recipient isolation', () => {
  const valid = parsePrivateContextToolCall({
    function: {
      name: PRIVATE_CONTEXT_TOOL_NAME,
      arguments: JSON.stringify({ recipient: 'b', content: 'RED-731' }),
    },
  }, { allowedRecipients: ['a', 'b', 'c'], senderId: 'a' });
  assert.deepEqual(valid, { recipient: 'b', content: 'RED-731', error: '' });

  const self = parsePrivateContextToolCall({
    function: {
      name: PRIVATE_CONTEXT_TOOL_NAME,
      arguments: JSON.stringify({ recipient: 'a', content: 'secret' }),
    },
  }, { allowedRecipients: ['a', 'b', 'c'], senderId: 'a' });
  assert.match(self.error, /chính mình/i);

  const missing = parsePrivateContextToolCall({
    function: {
      name: PRIVATE_CONTEXT_TOOL_NAME,
      arguments: JSON.stringify({ recipient: 'z', content: 'secret' }),
    },
  }, { allowedRecipients: ['a', 'b', 'c'], senderId: 'a' });
  assert.match(missing.error, /không tồn tại/i);
});

test('secret sent from one agent is visible only to sender and recipient model payloads', async () => {
  const captured = { a: [], b: [], c: [] };
  const calls = { a: 0, b: 0, c: 0 };
  const secret = 'RED-731-ONLY-B';

  const providerFactory = (config) => ({
    async streamChat({ messages, onDelta = () => {} }) {
      calls[config.id] += 1;
      captured[config.id].push(structuredClone(messages));

      if (config.id === 'a' && calls.a === 1) {
        return {
          text: '',
          usage: usage(),
          toolCalls: [{
            id: 'private_1',
            type: 'function',
            function: {
              name: PRIVATE_CONTEXT_TOOL_NAME,
              arguments: JSON.stringify({ recipient: 'b', content: secret }),
            },
          }],
        };
      }

      const text = `${config.name} public reply`;
      onDelta(text);
      return { text, usage: usage(), toolCalls: [] };
    },
  });

  const room = new ProfiledRoom({ agents, providerFactory, hardTurnLimit: 10 });
  const completed = waitForCompleted(room);
  await room.start({
    topic: 'Private context isolation test',
    maxTurns: 3,
    startSpeaker: 'a',
    sharedPrompt: 'Talk normally.',
  });
  await completed;

  assert.equal(room.privateContexts.length, 1);
  assert.equal(room.privateContexts[0].senderId, 'a');
  assert.equal(room.privateContexts[0].recipientId, 'b');
  assert.equal(room.privateContexts[0].content, secret);

  const senderPayload = JSON.stringify(captured.a);
  const recipientPayload = JSON.stringify(captured.b);
  const outsiderPayload = JSON.stringify(captured.c);
  assert.match(senderPayload, new RegExp(secret));
  assert.match(recipientPayload, new RegExp(secret));
  assert.doesNotMatch(outsiderPayload, new RegExp(secret));

  const publicTranscript = JSON.stringify(room.history);
  assert.doesNotMatch(publicTranscript, new RegExp(secret));

  const snapshot = room.snapshot();
  assert.equal(snapshot.privateContextStats.total, 1);
  assert.equal(snapshot.privateContextStats.byAgent.b.received, 1);
  assert.equal(snapshot.privateContexts[0].content, secret);
});

test('private delivery creates a parallel trigger only for the recipient', () => {
  const room = new ProfiledRoom({ agents, providerFactory: () => ({ streamChat: async () => ({ text: 'ok', usage: usage() }) }) });
  room.settings = { conversationMode: 'parallel' };
  room.status = 'paused';

  room.recordPrivateContext('a', 'b', 'BLUE-428');

  assert.equal(room.hasUnseenParallelTrigger('b'), true);
  assert.equal(room.hasUnseenParallelTrigger('c'), false);
});
