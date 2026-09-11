import test from 'node:test';
import assert from 'node:assert/strict';
import { decideConversationEnd, explicitStopRequested, parseConversationEndDecision } from '../src/conversation-end.js';
import { ConversationRoom } from '../src/orchestrator.js';

test('conversation end parser accepts strict JSON and fails closed', () => {
  assert.deepEqual(parseConversationEndDecision('```json\n{"end":true,"reason":"đã hội tụ"}\n```'), {
    end: true,
    reason: 'đã hội tụ',
  });
  assert.equal(parseConversationEndDecision('not json').end, false);
});

test('explicit human stop requests are detected without matching negations', () => {
  assert.equal(explicitStopRequested([{ speaker: 'user', text: 'thôi kết thúc đi' }]), true);
  assert.equal(explicitStopRequested([{ speaker: 'user', text: 'đủ rồi, dừng đi' }]), true);
  assert.equal(explicitStopRequested([{ speaker: 'user', text: 'đừng dừng, nói tiếp đi' }]), false);
});

test('a new user message after the agent reply prevents stale auto-ending', async () => {
  let calls = 0;
  const provider = { async streamChat() { calls += 1; throw new Error('should not be called'); } };
  const decision = await decideConversationEnd({
    provider,
    topic: 'test',
    agentId: 'a',
    agentName: 'A',
    history: [
      { speaker: 'a', name: 'A', text: 'Tôi vừa trả lời xong.' },
      { speaker: 'user', name: 'Bạn', text: 'Khoan, còn ý này nữa.' },
    ],
  });
  assert.equal(decision.end, false);
  assert.equal(calls, 0);
});

test('explicit stop ends after the answering agent without another model decision call', async () => {
  let calls = 0;
  const provider = { async streamChat() { calls += 1; throw new Error('should not be called'); } };
  const decision = await decideConversationEnd({
    provider,
    topic: 'test',
    agentId: 'b',
    agentName: 'B',
    history: [
      { speaker: 'user', name: 'Bạn', text: 'dừng cuộc trò chuyện đi' },
      { speaker: 'b', name: 'B', text: 'Được, mình kết lại ở đây.' },
    ],
  });
  assert.equal(decision.end, true);
  assert.equal(calls, 0);
});

test('natural ending uses a conservative hidden decision after enough AI turns', async () => {
  const calls = [];
  const provider = {
    async streamChat(options) {
      calls.push(options);
      return {
        text: '{"end":true,"reason":"Hai bên đã thống nhất kết luận."}',
        usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13, exact: true },
      };
    },
  };
  const decision = await decideConversationEnd({
    provider,
    topic: 'Một chủ đề hữu hạn',
    agentId: 'a',
    agentName: 'A',
    history: [
      { speaker: 'a', name: 'A', text: 'ý 1' },
      { speaker: 'b', name: 'B', text: 'ý 2' },
      { speaker: 'a', name: 'A', text: 'kết luận chung' },
    ],
  });
  assert.equal(decision.end, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].maxOutputTokens, 160);
});

test('conversation room stops alternating when an agent decides the topic is finished', async () => {
  const agentA = { id: 'a', name: 'Alpha', apiKey: 'x', model: 'm1', baseUrl: 'http://mock' };
  const agentB = { id: 'b', name: 'Beta', apiKey: 'y', model: 'm2', baseUrl: 'http://mock' };
  let finalAnswers = 0;
  let endChecks = 0;
  const providerFactory = (config) => ({
    async streamChat({ maxOutputTokens, temperature, messages, onDelta }) {
      if (maxOutputTokens === 160 && temperature === 0) {
        endChecks += 1;
        return {
          text: '{"end":true,"reason":"Đã có kết luận đầy đủ."}',
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, exact: true },
        };
      }
      finalAnswers += 1;
      const text = `${config.name} trả lời ${finalAnswers}`;
      onDelta(text);
      return {
        text,
        usage: { inputTokens: messages.length, outputTokens: 2, totalTokens: messages.length + 2, exact: true },
      };
    },
  });

  const room = new ConversationRoom({ agentA, agentB, hardTurnLimit: 20, providerFactory });
  const completed = new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', listener);
        resolve(snapshot);
      }
    };
    room.on('state', listener);
  });

  await room.start({ topic: 'Chủ đề có kết luận', maxTurns: 10, startSpeaker: 'a' });
  const snapshot = await completed;
  assert.equal(snapshot.turn, 3);
  assert.equal(snapshot.history.length, 3);
  assert.equal(snapshot.endedBy, 'a');
  assert.match(snapshot.endReason, /kết luận/i);
  assert.equal(finalAnswers, 3);
  assert.equal(endChecks, 1);
});
