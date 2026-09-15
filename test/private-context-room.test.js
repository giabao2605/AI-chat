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

test('one agent can fan out private context to multiple recipients in the same provider response', async () => {
  const room = new ProfiledRoom({
    agents,
    providerFactory: () => ({ streamChat: async () => ({ text: 'unused', usage: usage(), toolCalls: [] }) }),
  });
  const secretB = 'FANOUT-ONLY-B-314';
  const secretC = 'FANOUT-ONLY-C-271';
  let providerCalls = 0;

  const result = await room.streamChatWithPrivateContext('a', async () => {
    providerCalls += 1;
    if (providerCalls === 1) {
      return {
        text: '',
        usage: usage(),
        toolCalls: [
          {
            id: 'fanout_b',
            type: 'function',
            function: {
              name: PRIVATE_CONTEXT_TOOL_NAME,
              arguments: JSON.stringify({ recipient: 'b', content: secretB }),
            },
          },
          {
            id: 'fanout_c',
            type: 'function',
            function: {
              name: PRIVATE_CONTEXT_TOOL_NAME,
              arguments: JSON.stringify({ recipient: 'c', content: secretC }),
            },
          },
        ],
      };
    }
    return { text: 'public after fan-out', usage: usage(), toolCalls: [] };
  }, {
    messages: [{ role: 'user', content: 'send privately' }],
  });

  assert.equal(providerCalls, 2, 'both deliveries happen before the model resumes its public reply');
  assert.equal(result.text, 'public after fan-out');
  assert.equal(room.privateContexts.length, 2);
  assert.deepEqual(
    room.privateContexts.map((entry) => [entry.senderId, entry.recipientId, entry.content]),
    [['a', 'b', secretB], ['a', 'c', secretC]],
  );

  const senderBlock = room.privateContextSystemBlock('a');
  const bBlock = room.privateContextSystemBlock('b');
  const cBlock = room.privateContextSystemBlock('c');
  assert.match(senderBlock, new RegExp(secretB));
  assert.match(senderBlock, new RegExp(secretC));
  assert.match(bBlock, new RegExp(secretB));
  assert.doesNotMatch(bBlock, new RegExp(secretC));
  assert.match(cBlock, new RegExp(secretC));
  assert.doesNotMatch(cBlock, new RegExp(secretB));

  assert.equal(room.privateInboxVersion.b, 1);
  assert.equal(room.privateInboxVersion.c, 1);
  assert.equal(result.diagnostics.privateContextCalls, 2);
});

test('multiple senders can privately converge on one recipient without leaking across senders', () => {
  const room = new ProfiledRoom({
    agents,
    providerFactory: () => ({ streamChat: async () => ({ text: 'ok', usage: usage(), toolCalls: [] }) }),
  });
  room.settings = { conversationMode: 'parallel' };
  room.status = 'paused';

  room.recordPrivateContext('a', 'c', 'FROM-A-TO-C-111');
  room.recordPrivateContext('b', 'c', 'FROM-B-TO-C-222');

  assert.equal(room.privateInboxVersion.c, 2);
  assert.equal(room.hasUnseenParallelTrigger('c'), true);

  const cBlock = room.privateContextSystemBlock('c');
  const aBlock = room.privateContextSystemBlock('a');
  const bBlock = room.privateContextSystemBlock('b');
  assert.match(cBlock, /FROM-A-TO-C-111/);
  assert.match(cBlock, /FROM-B-TO-C-222/);
  assert.match(aBlock, /FROM-A-TO-C-111/);
  assert.doesNotMatch(aBlock, /FROM-B-TO-C-222/);
  assert.match(bBlock, /FROM-B-TO-C-222/);
  assert.doesNotMatch(bBlock, /FROM-A-TO-C-111/);

  const snapshot = room.snapshot();
  assert.equal(snapshot.privateContextStats.byAgent.c.received, 2);
  assert.equal(snapshot.privateContextStats.byAgent.a.sent, 1);
  assert.equal(snapshot.privateContextStats.byAgent.b.sent, 1);
});

test('private fan-out creates parallel triggers for every recipient and nobody else', () => {
  const room = new ProfiledRoom({
    agents,
    providerFactory: () => ({ streamChat: async () => ({ text: 'ok', usage: usage(), toolCalls: [] }) }),
  });
  room.settings = { conversationMode: 'parallel' };
  room.status = 'paused';

  room.recordPrivateContext('a', 'b', 'BLUE-428');
  room.recordPrivateContext('a', 'c', 'GREEN-529');

  assert.equal(room.hasUnseenParallelTrigger('b'), true);
  assert.equal(room.hasUnseenParallelTrigger('c'), true);
  assert.equal(room.hasUnseenParallelTrigger('a'), false);
});
