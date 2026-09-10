import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessagesForAgent, ConversationRoom } from '../src/orchestrator.js';

const agentA = { id: 'a', name: 'Alpha', apiKey: 'x', model: 'm1', baseUrl: 'http://mock' };
const agentB = { id: 'b', name: 'Beta', apiKey: 'y', model: 'm2', baseUrl: 'http://mock' };

test('custom shared prompt and persona are placed in the system message', () => {
  const messages = buildMessagesForAgent({
    agentId: 'a',
    agentName: 'Alpha',
    topic: 'Kiểm thử',
    history: [],
    sharedPrompt: 'CUSTOM-RULE: luôn phản biện ngắn gọn.',
    personaPrompt: 'CUSTOM-PERSONA-A: nhà khoa học hoài nghi.',
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /CUSTOM-RULE: luôn phản biện ngắn gọn\./);
  assert.match(messages[0].content, /CUSTOM-PERSONA-A: nhà khoa học hoài nghi\./);
  assert.match(messages[0].content, /Tên hiển thị của bạn trong phòng: Alpha/);
});

test('room sends the configured prompt and the correct persona on every agent turn', async () => {
  const captured = { a: [], b: [] };
  const providerFactory = (config) => ({
    async streamChat({ messages, onDelta }) {
      captured[config.id].push(messages[0]);
      const reply = `${config.name} ok`;
      onDelta(reply);
      return { text: reply, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true } };
    },
  });

  const room = new ConversationRoom({ agentA, agentB, hardTurnLimit: 4, providerFactory });
  const completed = new Promise((resolve) => {
    const onState = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', onState);
        resolve();
      }
    };
    room.on('state', onState);
  });

  await room.start({
    topic: 'Prompt delivery',
    maxTurns: 2,
    startSpeaker: 'a',
    sharedPrompt: 'SHARED-SAVED-PROMPT',
    personaA: 'PERSONA-ALPHA',
    personaB: 'PERSONA-BETA',
  });
  await completed;

  assert.equal(captured.a.length, 1);
  assert.equal(captured.b.length, 1);
  assert.match(captured.a[0].content, /SHARED-SAVED-PROMPT/);
  assert.match(captured.a[0].content, /PERSONA-ALPHA/);
  assert.doesNotMatch(captured.a[0].content, /PERSONA-BETA/);
  assert.match(captured.b[0].content, /SHARED-SAVED-PROMPT/);
  assert.match(captured.b[0].content, /PERSONA-BETA/);
  assert.doesNotMatch(captured.b[0].content, /PERSONA-ALPHA/);
});
